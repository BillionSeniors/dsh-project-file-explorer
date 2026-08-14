import { readdir, stat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

// Host half of the project file explorer plugin: registers two HTTP routes on
// the dsh web server that expose host filesystem listing and file preview
// (the client cannot read files through the RPC surface, which only offers
// directory browsing under the `browse` capability). Routes:
//   GET /project-files/list?path=<abs dir>   -> { ok, path, dirs[], files[] }
//   GET /project-files/read?path=<abs file>  -> { ok, path, size, kind, ... , diff }
//     kind=image|audio|video|pdf -> media dataUrl for in-browser rendering
//     kind=text                  -> utf8 content (first 96KB) + diff 行级标注
//     kind=binary                -> not a text file, no preview content
//     kind=oversize              -> media file larger than the preview cap
//   diff: 快照对比 —— 插件缓存该文件「上次打开时的内容」，再次打开时与当前
//   内容做行级对比（无需 git），返回 [{type:context|added|removed,text,oldLine,newLine}]，
//   用于在预览里标注 AI 改动行（红=原本删除，绿=新增）。
const name = "project-file-explorer";
const inject = ["webServer"];
const LIST_PATH = "/project-files/list";
const READ_PATH = "/project-files/read";
const TEXT_PREVIEW_LIMIT = 96 * 1024;
const MEDIA_PREVIEW_LIMIT = 10 * 1024 * 1024;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"]);
const MEDIA_MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac", opus: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", m4v: "video/mp4"
};

function fileKind(abs) {
  const ext = extname(abs).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  return "text";
}

function mimeFor(abs) {
  return MEDIA_MIME[extname(abs).slice(1).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 行级 diff（LCS 动态规划），对比旧/新两份文本的每一行。
 * @returns { changed:boolean, lines:[{type,text,oldLine,newLine}] | null }
 *          lines 为 null 表示内容过大放弃对比（回退普通预览）。
 */
function diffLines(oldText, newText) {
  const a = String(oldText ?? "").split("\n");
  const b = String(newText ?? "").split("\n");
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return { changed: false, lines: null }; // 内容过大，放弃对比
  if (n === 0 && m === 0) return { changed: false, lines: [] };
  if (n === 0) {
    return {
      changed: true,
      lines: b.map((text, i) => ({ type: "added", text, oldLine: null, newLine: i + 1 }))
    };
  }
  if (m === 0) {
    return {
      changed: true,
      lines: a.map((text, i) => ({ type: "removed", text, oldLine: i + 1, newLine: null }))
    };
  }
  // LCS DP 矩阵（展平为 Uint32Array，行优先）
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    const row = i * W;
    const prev = (i - 1) * W;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      dp[row + j] = ai === b[j - 1]
        ? dp[prev + j - 1] + 1
        : Math.max(dp[prev + j], dp[row + j - 1]);
    }
  }
  // 回溯生成 diff
  const out = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ type: "context", text: a[i - 1], oldLine: i, newLine: j });
      i--; j--;
    } else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) {
      out.push({ type: "removed", text: a[i - 1], oldLine: i, newLine: null });
      i--;
    } else {
      out.push({ type: "added", text: b[j - 1], oldLine: null, newLine: j });
      j--;
    }
  }
  while (i > 0) { out.push({ type: "removed", text: a[i - 1], oldLine: i, newLine: null }); i--; }
  while (j > 0) { out.push({ type: "added", text: b[j - 1], oldLine: null, newLine: j }); j--; }
  out.reverse();
  const changed = out.some((l) => l.type !== "context");
  return { changed, lines: changed ? out : null };
}

/** 文件内容快照缓存：path -> 上次打开时的 utf8 内容（用于 diff 标注 AI 改动行）。 */
const fileSnapshots = new Map();
const SNAPSHOT_LIMIT = 256; // 最多缓存 256 个文件，防内存膨胀

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

/** Keep cross-origin pages from using this endpoint as a file read oracle. */
function hostAllowed(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // direct navigation / non-browser client
  try {
    const u = new URL(origin);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost";
  } catch {
    return false;
  }
}

function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/project-files",
    handler: async (req, res) => {
      if (!hostAllowed(req)) return json(res, 403, { ok: false, error: "forbidden origin" });
      try {
        const url = new URL(req.url, "http://localhost");
        const raw = url.searchParams.get("path");
        if (url.pathname === LIST_PATH) {
          if (!raw) return json(res, 400, { ok: false, error: "missing path" });
          const abs = resolve(raw);
          const st = await stat(abs).catch(() => null);
          if (!st || !st.isDirectory()) return json(res, 404, { ok: false, error: `not a directory: ${abs}` });
          const dirents = await readdir(abs, { withFileTypes: true });
          const dirs = [];
          const files = [];
          for (const d of dirents) {
            const full = join(abs, d.name);
            let info = null;
            try {
              info = await stat(full);
            } catch {
              continue;
            }
            const row = { name: d.name, path: full, size: info.size, mtime: info.mtimeMs };
            if (d.isDirectory() || d.isSymbolicLink()) dirs.push(row);
            else files.push(row);
          }
          const cmp = (a, b) => a.name.localeCompare(b.name, "zh");
          dirs.sort(cmp);
          files.sort(cmp);
          return json(res, 200, { ok: true, path: abs, home: homedir(), dirs, files });
        }
        if (url.pathname === READ_PATH) {
          if (!raw) return json(res, 400, { ok: false, error: "missing path" });
          const abs = resolve(raw);
          const st = await stat(abs).catch(() => null);
          if (!st || !st.isFile()) return json(res, 404, { ok: false, error: `not a file: ${abs}` });
          const kind = fileKind(abs);
          // 图片 / 音频 / 视频 / PDF：读取完整文件并以 data URL 返回，客户端直接渲染
          if (kind !== "text") {
            if (st.size > MEDIA_PREVIEW_LIMIT) {
              return json(res, 200, { ok: true, path: abs, size: st.size, kind: "oversize" });
            }
            const buf = Buffer.alloc(st.size);
            const fh = await open(abs, "r");
            try {
              await fh.read(buf, 0, st.size, 0);
            } finally {
              await fh.close();
            }
            return json(res, 200, {
              ok: true,
              path: abs,
              size: st.size,
              kind,
              dataUrl: `data:${mimeFor(abs)};base64,${buf.toString("base64")}`
            });
          }
          // 其余按文本处理：读取前 96KB；含 NUL 字节则视为二进制文件
          const readLen = Math.min(st.size, TEXT_PREVIEW_LIMIT);
          const buf = Buffer.alloc(readLen);
          const fh = await open(abs, "r");
          try {
            await fh.read(buf, 0, readLen, 0);
          } finally {
            await fh.close();
          }
          if (buf.includes(0)) {
            return json(res, 200, { ok: true, path: abs, size: st.size, kind: "binary", truncated: st.size > readLen });
          }
          return json(res, 200, {
            ok: true,
            path: abs,
            size: st.size,
            kind: "text",
            truncated: st.size > readLen,
            content: buf.toString("utf8"),
            // 快照对比：上次打开 vs 本次内容（标注 AI 改动行）；首次打开无对比
            diff: (() => {
              if (st.size > readLen) return { changed: false, lines: null }; // 截断了，不做对比
              const content = buf.toString("utf8");
              const prev = fileSnapshots.get(abs);
              const d = prev !== undefined ? diffLines(prev, content) : { changed: false, lines: null };
              fileSnapshots.set(abs, content);
              if (fileSnapshots.size > SNAPSHOT_LIMIT) {
                fileSnapshots.delete(fileSnapshots.keys().next().value);
              }
              return d;
            })()
          });
        }
        return json(res, 404, { ok: false, error: "unknown route" });
      } catch (e) {
        return json(res, 500, { ok: false, error: String((e && e.message) || e) });
      }
    }
  }), "project-file-explorer: fs routes");
}

export { apply, inject, name };
