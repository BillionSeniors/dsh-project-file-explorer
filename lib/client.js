window.__ModuleLoader__.load({
	id: "@local/dsh-project-file-explorer",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		let prim = require("@deepseek-ai/dsh-client-ui-primitives");

		const {
			Button, Input,
			IconFolderOpen16, IconCodeOutline16,
			IconSearchOutline16, IconRefreshOutline14, IconBrowseOutline16,
			IconChevronRightOutline14, IconFolderOpenOutline16, IconCloseOutline16
		} = prim;

		// ---------- details dock state (project file browser docks in the native right column) ----------
		const detailsListeners = new Set();
		let detailsOpen = false;
		function setDetailsOpen(v) {
			if (detailsOpen === v) return;
			detailsOpen = v;
			for (const l of detailsListeners) l();
		}
		function subscribeDetails(l) {
			detailsListeners.add(l);
			return () => detailsListeners.delete(l);
		}
		function getDetailsOpen() {
			return detailsOpen;
		}
		function toggleDetailsPanel(ctx) {
			if (detailsOpen) ctx.layout.closeDetails();
			else ctx.layout.openDetails();
			setDetailsOpen(!detailsOpen);
		}

		// ---------- file preview tabs (conversation.view entries, next to 对话/轨迹) ----------
		// 点击文件后，在主会话区的「对话 / 轨迹」标签栏右侧新增一个文件标签；
		// 点击标签即在主区域打开该文件预览（代码=文本、图片=图片、媒体=播放器）。
		const tabListeners = new Set();
		const openTabs = new Map(); // tabId -> { id, path, name }
		let tabSeq = 0;
		let registerTab = null; // set in apply(ctx): (tab) => disposer
		let disposeTab = null; // set in apply(ctx): (tabId) => void
		let closeDock = null; // set in apply(ctx): () => void —— 窄屏打开文件后收起抽屉
		function subscribeTabs(fn) {
			tabListeners.add(fn);
			return () => tabListeners.delete(fn);
		}
		function notifyTabs() {
			for (const l of [...tabListeners]) l();
		}
		/** 打开一个文件标签；同路径已打开则关闭（切换）。返回 tabId 或 null。 */
		function openFileTab(file) {
			for (const [id, tab] of openTabs) {
				if (tab.path === file.path) {
					closeFileTab(id);
					return null;
				}
			}
			const id = "pfe-tab-" + (++tabSeq);
			const tab = { id, path: file.path, name: file.name };
			openTabs.set(id, tab);
			registerTab?.(tab);
			notifyTabs();
			// 自动激活：等标签渲染到「对话/轨迹」标签栏后，模拟点击最后一个新标签
			// （标签按钮的 onClick 即 actions.setView(id)）。
			setTimeout(() => {
				const tabs = [...document.querySelectorAll('[role="tab"]')];
				const target = tabs[tabs.length - 1];
				if (target) target.click();
				// 窄屏（手机/平板）下自动收起右侧抽屉，让主区域的文件预览可见
				if (window.innerWidth < 768) closeDock?.();
			}, 150);
			return id;
		}
		function closeFileTab(id) {
			if (!openTabs.has(id)) return;
			openTabs.delete(id);
			disposeTab?.(id);
			notifyTabs();
		}
		function closeAllTabs() {
			for (const id of [...openTabs.keys()]) closeFileTab(id);
		}

		// ---------- drag & drop: drag a file row into the chat input (IDE style) ----------
		// 从项目文件面板把文件拖到「给智能体发消息」输入框，松手即在光标处生成路径引用，
		// 可连续拖多个文件（路径以空格分隔追加）。输入框是 React 受控 <textarea>
		// （外层 [data-input-scroll]），必须走原生 value setter + input 事件才能被
		// React onChange 捕获，直接改 .value 会被 React 状态覆盖。
		function isChatInput(target) {
			return target instanceof Element && target.closest("[data-input-scroll]") !== null;
		}
		function insertPathToInput(path) {
			const el = document.querySelector("[data-input-scroll] textarea");
			if (!el || el.disabled || el.readOnly) return false;
			try {
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
				const cur = el.value;
				const sep = cur && !/\s$/.test(cur) ? " " : "";
				const next = cur + sep + path;
				setter.call(el, next);
				el.dispatchEvent(new Event("input", { bubbles: true }));
				el.focus();
				setTimeout(() => el.setSelectionRange(next.length, next.length), 0);
				return true;
			} catch (e) { return false; }
		}
		function notifyDropToast(text) {
			let el = document.querySelector(".pfe-drop-toast");
			if (!el) {
				el = document.createElement("div");
				el.className = "pfe-drop-toast";
				document.body.appendChild(el);
			}
			el.textContent = text;
			el.style.opacity = "1";
			clearTimeout(el._hideTimer);
			el._hideTimer = setTimeout(() => { el.style.opacity = "0"; }, 2200);
		}

		// ---------- pointer-based custom drag (no native HTML5 DnD) ----------
		// 用 mousedown + mousemove + mouseup 模拟拖拽，避免原生 DnD 会话异常时
		// 光标卡死（拖拽源被 React 重渲染替换 / dataTransfer 异常都会导致拖不住、
		// 松不开）。拖拽中显示跟随鼠标的「幽灵」提示，经过对话输入框时给输入框
		// 加虚线高亮，松开落在输入框内即插入路径引用。
		let pfeDrag = null; // { path, ghost, dx, dy }
		function pfeMoveGhost(x, y) {
			if (!pfeDrag) return;
			pfeDrag.ghost.style.left = (x - pfeDrag.dx) + "px";
			pfeDrag.ghost.style.top = (y - pfeDrag.dy) + "px";
			pfeSetInputHighlight(isChatInput(document.elementFromPoint(x, y)));
		}
		function pfeSetInputHighlight(on) {
			const ta = document.querySelector("[data-input-scroll] textarea");
			if (ta) ta.classList.toggle("pfe-drop-target", on);
		}
		function pfeStartDrag(path, name, x, y) {
			pfeStopDrag();
			const ghost = document.createElement("div");
			ghost.className = "pfe-ghost";
			ghost.textContent = name + " — 拖到对话输入框松开，插入文件路径";
			document.body.appendChild(ghost);
			const r = ghost.getBoundingClientRect();
			pfeDrag = { path, ghost, dx: x - r.left, dy: y - r.top };
			pfeMoveGhost(x, y);
		}
		function pfeStopDrag() {
			if (pfeDrag) {
				pfeDrag.ghost.remove();
				pfeDrag = null;
			}
			pfeSetInputHighlight(false);
		}
		/** 在行上按下鼠标后，超过阈值移动即进入拖拽；松开落在输入框内则插入路径。 */
		function pfeRowMouseHandlers(item) {
			let moved = false;
			let sx = 0, sy = 0;
			const onMouseDown = (e) => {
				if (e.button !== 0) return;
				sx = e.clientX; sy = e.clientY;
				moved = false;
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onUp);
			};
			const onMove = (e) => {
				if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 5) {
					moved = true;
					document.body.style.userSelect = "none";
					pfeStartDrag(item.path, item.name, e.clientX, e.clientY);
				}
				if (moved) pfeMoveGhost(e.clientX, e.clientY);
			};
			const onUp = (e) => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
				document.body.style.userSelect = "";
				if (!moved) return; // 没拖动 = 普通点击，走 onClick 打开预览
				e.preventDefault(); // 阻止拖拽松手后触发 click
				if (isChatInput(document.elementFromPoint(e.clientX, e.clientY))) {
					if (insertPathToInput(item.path)) notifyDropToast("已插入文件路径：" + item.path);
					else notifyDropToast("无法插入：对话输入框当前不可编辑");
				}
				pfeStopDrag();
			};
			return onMouseDown;
		}

		// ---------- styles (theme tokens from dsh-client-ui-theme) ----------
		const styleTagId = "@local/dsh-project-file-explorer/styles";
		const css = [
			/* docked file browser — fills the native details column (right side) */
			".pfe-panel{display:flex;flex-direction:column;height:100%;min-width:0;background:var(--dsw-alias-bg-layer-2,#171a21);border-left:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));color:var(--dsw-alias-label-primary,#e6e9ef)}",
			"@keyframes pfe-slide-in{from{transform:translateX(32px);opacity:.4}to{transform:translateX(0);opacity:1}}",
			".pfe-panel-header{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));flex:none}",
			".pfe-panel-title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#e6e9ef);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".pfe-panel-title .path{color:var(--dsw-alias-label-secondary,#9aa3b2);font-weight:400}",
			".pfe-close-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid transparent;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary,#9aa3b2);cursor:pointer}",
			".pfe-close-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e6e9ef)}",
			/* toolbar */
			".pfe-toolbar{display:flex;gap:8px;align-items:center;padding:12px 18px 8px;flex:none}",
			".pfe-toolbar .pfe-path-input{flex:1;min-width:0}",
			/* breadcrumbs */
			".pfe-crumbs{display:flex;align-items:center;flex-wrap:nowrap;overflow-x:auto;gap:0;padding:2px 18px 10px;scrollbar-width:thin;flex:none}",
			".pfe-crumb{display:inline-flex;align-items:center;background:none;border:none;color:var(--dsw-alias-label-secondary,#9aa3b2);cursor:pointer;padding:3px 6px;border-radius:6px;font-size:12px;white-space:nowrap}",
			".pfe-crumb:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e6e9ef)}",
			".pfe-crumb.last{color:var(--dsw-alias-label-primary,#e6e9ef);font-weight:500}",
			".pfe-crumb-sep{color:var(--dsw-alias-label-secondary,#9aa3b2);opacity:.5;display:inline-flex;align-items:center;flex:none}",
			/* error */
			".pfe-error{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;margin:0 18px 8px;border:1px solid var(--dsw-alias-state-error-primary,rgba(255,120,120,.4));background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ff7878) 10%,transparent);border-radius:8px;color:var(--dsw-alias-state-error-primary,#ff8080);font-size:12px;flex:none;word-break:break-all}",
			/* body: collapsible list on top, LARGE full-width preview below */
			".pfe-body{flex:1;display:flex;flex-direction:column;min-height:0;padding:0 18px;gap:10px}",
			".pfe-list-region{flex:0 0 auto;max-height:34%;min-height:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base,rgba(0,0,0,.16))}",
			".pfe-list-region.full{flex:1;max-height:none}",
			".pfe-list-toggle{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 12px;background:none;border:none;color:var(--dsw-alias-label-secondary,#9aa3b2);cursor:pointer;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;flex:none}",
			".pfe-list-toggle:hover{color:var(--dsw-alias-label-primary,#e6e9ef)}",
			".pfe-list-toggle .caret{display:inline-flex;align-items:center;justify-content:center;width:14px;flex:none;transition:transform .15s ease}",
			".pfe-list-toggle .caret.open{transform:rotate(90deg)}",
			".pfe-list{overflow-y:auto;flex:1;min-height:0;padding:0 2px 4px;display:flex;flex-direction:column;gap:1px;scrollbar-width:thin}",
			".pfe-group{display:flex;align-items:center;padding:9px 10px 3px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#9aa3b2);flex:none}",
			".pfe-row{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:none;border:none;color:var(--dsw-alias-label-primary,#e6e9ef);padding:7px 10px;border-radius:7px;cursor:pointer;font-size:13px;line-height:1.4;white-space:nowrap;overflow:hidden}",
			".pfe-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}",
			".pfe-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:-1px}",
			".pfe-row-icon{flex:none;width:18px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#9aa3b2)}",
			".pfe-row-icon.dir{color:var(--dsw-alias-brand-primary,#5b9dff)}",
			".pfe-row-name{flex:1;overflow:hidden;text-overflow:ellipsis}",
			".pfe-row-meta{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3b2);margin-left:8px}",
			/* preview - fills ALL remaining space, full width */
			".pfe-preview{flex:1;min-height:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base,rgba(0,0,0,.22))}",
			".pfe-preview-head{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2);flex:none;white-space:nowrap;overflow:hidden}",
			".pfe-preview-head .name{flex:1;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary,#e6e9ef);font-weight:500}",
			".pfe-preview-body{flex:1;overflow:auto;padding:10px 0;font-family:ui-monospace,'Cascadia Code',Consolas,Menlo,monospace;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-primary,#e6e9ef);margin:0;word-break:normal;tab-size:4;scrollbar-width:thin}",
			/* line numbers (IDE style) */
			".pfe-lines{min-width:max-content;display:flex;flex-direction:column}",
			".pfe-line{display:flex;align-items:stretch}",
			".pfe-ln{flex:none;width:52px;padding-right:14px;text-align:right;color:var(--dsw-alias-label-secondary,#9aa3b2);user-select:none;border-right:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));margin-right:16px;position:sticky;left:0;background:var(--dsw-alias-bg-base,#101319)}",
			".pfe-code{flex:1;white-space:pre;padding-right:16px}",
			/* diff highlights (AI 改动行：红=原本删除，绿=新增) */
			".pfe-diff-added{background:rgba(34,197,94,.13)}",
			".pfe-diff-removed{background:rgba(239,68,68,.15)}",
			".pfe-diff-added .pfe-ln{background:rgba(34,197,94,.13)}",
			".pfe-diff-removed .pfe-ln{background:rgba(239,68,68,.15)}",
			".pfe-ln-added{color:#4ade80}",
			".pfe-ln-removed{color:#f87171}",
			".pfe-diff-added .pfe-code{padding-left:10px;border-left:3px solid rgba(34,197,94,.65)}",
			".pfe-diff-removed .pfe-code{padding-left:10px;border-left:3px solid rgba(239,68,68,.7);text-decoration:line-through;text-decoration-color:rgba(239,68,68,.6)}",
			/* media previews: images, audio, video, pdf */
			".pfe-preview-media{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto}",
			".pfe-preview-media img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px}",
			".pfe-preview-video{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:14px;background:#000}",
			".pfe-preview-video video{max-width:100%;max-height:100%;border-radius:6px}",
			".pfe-preview-audio{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:14px}",
			".pfe-preview-audio audio{width:100%}",
			".pfe-preview-pdf{flex:1;min-height:0;width:100%;border:0}",
			".pfe-note{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:28px 16px;color:var(--dsw-alias-label-secondary,#9aa3b2);font-size:12px;flex:1}",
			".pfe-status{display:flex;align-items:center;gap:8px;padding:10px 18px 0;font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3b2);flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".pfe-footer{display:flex;align-items:center;gap:8px;padding:12px 18px 16px;flex:none}",
			".pfe-footer-sep{flex:1}",
			".pfe-toggle-active{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e6e9ef)}",
			/* conversation.view file tabs: shrink + scroll when many */
			".wSkVaW_tabs{gap:14px;overflow-x:auto;flex-wrap:nowrap;min-width:0;max-width:100%;scrollbar-width:thin}",
			".wSkVaW_tab{flex:0 1 auto;min-width:0;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			/* file preview view (tab content) */
			".pfe-view{display:flex;flex-direction:column;height:100%;min-height:0}",
			".pfe-view-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.07));flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2)}",
			".pfe-view-head .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#e6e9ef);font-weight:500}",
			".pfe-view-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:7px;background:none;color:var(--dsw-alias-label-secondary,#9aa3b2);cursor:pointer;font-size:15px;line-height:1}",
			".pfe-view-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e6e9ef)}",
			".pfe-view-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}",
			/* drag & drop: pointer-based custom drag (IDE style, avoids native DnD stuck cursor) */
			".pfe-ghost{position:fixed;z-index:1000;pointer-events:none;padding:7px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,#1f242c);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));box-shadow:0 12px 32px rgba(0,0,0,.45);font-size:12px;color:var(--dsw-alias-label-primary,#e6e9ef);max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".pfe-drop-target{outline:2px dashed var(--dsw-alias-brand-primary,#3b82f6);outline-offset:-2px}",
			".pfe-drop-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:1000;background:var(--dsw-alias-bg-layer-3,#1f242c);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;padding:9px 14px;font-size:12px;color:var(--dsw-alias-label-primary,#e6e9ef);box-shadow:0 12px 32px rgba(0,0,0,.45);max-width:82vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:opacity .3s ease}"
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = styleTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const { useState, useEffect, useCallback, useSyncExternalStore, Fragment } = react;
		const { jsx, jsxs } = jsxRuntime;

		function formatSize(bytes) {
			if (bytes < 1024) return bytes + " B";
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
			if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
			return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
		}

		/**
		 * 渲染代码行（带行号，可选 diff 高亮）。
		 * diff 为 host /project-files/diff 返回的行级标注：红=removed（原本），
		 * 绿=added（新改）；无 diff 时按普通行号渲染。
		 */
		function renderCodeLines(content, diff) {
			if (diff && diff.length > 0) {
				return jsx("div", {
					className: "pfe-lines",
					children: diff.map((ln, i) => jsxs("div", {
						className: "pfe-line" + (ln.type === "removed" ? " pfe-diff-removed" : ln.type === "added" ? " pfe-diff-added" : ""),
						children: [
							jsx("span", {
								className: "pfe-ln" + (ln.type === "removed" ? " pfe-ln-removed" : ln.type === "added" ? " pfe-ln-added" : ""),
								children: ln.type === "context" ? String(ln.newLine) : ln.type === "added" ? String(ln.newLine) : String(ln.oldLine)
							}),
							jsx("span", { className: "pfe-code", children: ln.text })
						]
					}, i))
				});
			}
			return jsx("div", {
				className: "pfe-lines",
				children: content.split("\n").map((ln, i) => jsxs("div", {
					className: "pfe-line",
					children: [
						jsx("span", { className: "pfe-ln", children: String(i + 1) }),
						jsx("span", { className: "pfe-code", children: ln })
					]
				}, i))
			});
		}

		function crumbsOf(path) {
			if (!path) return [];
			const parts = path.split(/[\\/]+/).filter((s) => s.length > 0);
			const out = [];
			let acc = "";
			for (let i = 0; i < parts.length; i++) {
				acc = i === 0 ? parts[i] : acc + "\\" + parts[i];
				out.push({ name: parts[i], path: acc });
			}
			return out;
		}

		// ---------- file browser panel (docked in the right details column) ----------
		function FileBrowserPanel(props) {
			const { api, workspaceList, sessionId, onClose } = props;
			const workspaceState = useSyncExternalStore(
				(cb) => workspaceList.subscribe(cb),
				() => workspaceList.getSnapshot()
			);
			// 定位当前会话所属的工作区（而不是全局“最近打开”的工作区），
			// 这样在 NewCar 会话里添加新工作区不会把面板切到新场景。
			let workspacePath = null;
			if (workspaceState && Array.isArray(workspaceState.items)) {
				if (sessionId) {
					const own = workspaceState.items.find((w) => Array.isArray(w.sessionIds) && w.sessionIds.includes(sessionId));
					if (own && own.path) workspacePath = own.path;
				}
				if (!workspacePath && workspaceState.recentWorkspaceId != null) {
					const recent = workspaceState.items.find((w) => w.workspaceId === workspaceState.recentWorkspaceId);
					if (recent && recent.path) workspacePath = recent.path;
				}
			}
			const [path, setPath] = useState(null);
			const [dirs, setDirs] = useState([]);
			const [files, setFiles] = useState([]);
			const [loading, setLoading] = useState(false);
			const [error, setError] = useState(null);
			const [pathInput, setPathInput] = useState("");
			const [opening, setOpening] = useState(false);
			const [listCollapsed, setListCollapsed] = useState(false);

			const load = useCallback(async (target) => {
				if (!target) return;
				setLoading(true);
				setError(null);
				try {
					const r = await api.listFiles(target);
					if (!r.ok) throw new Error(r.error || "list failed");
					setPath(r.path);
					setPathInput(r.path);
					setDirs(r.dirs || []);
					setFiles(r.files || []);
				} catch (e) {
					setError(e && e.message ? e.message : String(e));
					setDirs([]);
					setFiles([]);
				} finally {
					setLoading(false);
				}
			}, [api]);

			// Auto-load the workspace root once the workspace list resolves.
			useEffect(() => {
				if (!path && workspacePath) load(workspacePath);
			}, [workspacePath, path, load]);

			const pick = async () => {
				setError(null);
				try {
					const picked = await api.pickDirectory();
					if (picked) load(picked);
				} catch (e) {
					setError(e && e.message ? e.message : String(e));
				}
			};

			const openHere = async (target) => {
				setOpening(true);
				setError(null);
				try {
					await api.openPath(target);
				} catch (e) {
					setError(e && e.message ? e.message : String(e));
				} finally {
					setOpening(false);
				}
			};

			const crumbs = crumbsOf(path);
			const rowIcon = (icon, extra) => jsx("span", { className: "pfe-row-icon " + (extra || ""), children: icon });

			const listBody = loading
				? jsx("div", { className: "pfe-note", children: "加载中…" })
				: (dirs.length === 0 && files.length === 0)
					? jsxs("div", {
						className: "pfe-note",
						children: [
							jsx(IconFolderOpenOutline16, { size: 20 }),
							jsx("span", { children: "此文件夹为空" })
						]
					})
					: jsxs(Fragment, {
						children: [
							dirs.length > 0
								? jsxs(Fragment, {
									children: [
										jsx("div", { className: "pfe-group", children: "文件夹 · " + dirs.length }),
										dirs.map((d) => jsx("button", {
											className: "pfe-row",
											title: d.path,
											onMouseDown: pfeRowMouseHandlers(d),
											onClick: () => load(d.path),
											children: [
												rowIcon(jsx(IconFolderOpen16, { size: 16 }), "dir"),
												jsx("span", { className: "pfe-row-name", children: d.name })
											]
										}, d.path))
									]
								})
								: null,
							files.length > 0
								? jsxs(Fragment, {
									children: [
										jsx("div", { className: "pfe-group", children: "文件 · " + files.length }),
										files.map((f) => jsx("button", {
											className: "pfe-row",
											title: f.path,
											onMouseDown: pfeRowMouseHandlers(f),
											onClick: () => openFileTab(f),
											children: [
												rowIcon(jsx(IconCodeOutline16, { size: 16 })),
												jsx("span", { className: "pfe-row-name", children: f.name }),
												jsx("span", { className: "pfe-row-meta", children: formatSize(f.size) })
											]
										}, f.path))
									]
								})
								: null
						]
					});

			const statusLine = path
				? dirs.length + " 个文件夹 · " + files.length + " 个文件"
				: "";

			return jsxs("div", {
				className: "pfe-panel",
				role: "dialog",
				"aria-label": "项目文件浏览器",
				children: [
					jsxs("div", {
						className: "pfe-panel-header",
						children: [
							jsx("div", {
								className: "pfe-panel-title",
								children: [
									"项目文件",
									path ? jsx("span", { className: "path", children: " · " + path }) : null
								]
							}),
							jsx("button", {
								className: "pfe-close-btn",
								"aria-label": "关闭文件面板",
								onClick: onClose,
								children: jsx(IconCloseOutline16, { size: 16 })
							})
						]
					}),
					jsxs("div", {
						className: "pfe-toolbar",
						children: [
							jsx(Input, {
								className: "pfe-path-input",
								icon: jsx(IconSearchOutline16, { size: 16 }),
								placeholder: "文件夹路径，如 D:\\NewCar",
								value: pathInput,
								onChange: (e) => setPathInput(e.target.value),
								onKeyDown: (e) => {
									if (e.key === "Enter") load(pathInput);
								}
							}),
							jsx(Button, {
								variant: "outline",
								size: "sm",
								icon: jsx(IconBrowseOutline16, { size: 16 }),
								onClick: pick,
								title: "选择文件夹",
								children: "浏览"
							}, "btn-pick"),
							jsx(Button, {
								variant: "ghost",
								size: "sm",
								icon: jsx(IconRefreshOutline14, { size: 14 }),
								onClick: () => load(path),
								disabled: !path,
								title: "刷新"
							}, "btn-refresh")
						]
					}),
					crumbs.length > 0
						? jsxs("div", {
							className: "pfe-crumbs",
							children: crumbs.map((c, i) =>
								jsxs(Fragment, { children: [
									jsx("button", {
										className: "pfe-crumb" + (i === crumbs.length - 1 ? " last" : ""),
										onClick: () => load(c.path),
										children: c.name
									}, c.path + "#crumb"),
									i < crumbs.length - 1
										? jsx("span", { className: "pfe-crumb-sep", children: jsx(IconChevronRightOutline14, { size: 12 }) }, c.path + "#sep")
										: null
								]}, c.path + "#pair")
							)
						})
						: null,
					error
						? jsxs("div", {
							className: "pfe-error",
							children: [
								jsx("span", { style: { flex: "none" }, children: "⚠" }),
								jsx("span", { children: error })
							]
						})
						: null,
					jsxs("div", {
						className: "pfe-body",
						children: [
							jsxs("div", {
								className: "pfe-list-region full",
								children: [
									jsxs("button", {
										className: "pfe-list-toggle",
										onClick: () => setListCollapsed(!listCollapsed),
										"aria-expanded": !listCollapsed,
										children: [
											jsx("span", { className: "caret" + (listCollapsed ? "" : " open"), children: jsx(IconChevronRightOutline14, { size: 12 }) }),
											jsx("span", { children: "文件列表 · " + (dirs.length + files.length) })
										]
									}),
									listCollapsed
										? null
										: jsx("div", { className: "pfe-list", children: listBody })
								]
							})
						]
					}),
					jsx("div", { className: "pfe-status", children: statusLine }),
					jsxs("div", {
						className: "pfe-footer",
						children: [
							jsx(Button, {
								variant: "ghost",
								size: "sm",
								onClick: () => load(workspacePath),
								disabled: !workspacePath,
								children: "回到工作区"
							}, "btn-back"),
							jsx("div", { className: "pfe-footer-sep" }),
							jsx(Button, {
								variant: "primary",
								size: "sm",
								icon: jsx(IconFolderOpenOutline16, { size: 16 }),
								onClick: () => openHere(path),
								disabled: opening || !path,
								children: opening ? "打开中…" : "资源管理器"
							}, "btn-open")
						]
					})
				]
			});
		}

		// ---------- session-header action: dock/undock the details panel ----------
		function FileExplorerToggle(props) {
			const { toggleDetails } = props;
			const open = useSyncExternalStore(subscribeDetails, getDetailsOpen);
			return jsx(Button, {
				variant: "ghost",
				size: "sm",
				className: open ? "pfe-toggle-active" : undefined,
				icon: jsx(IconFolderOpenOutline16, { size: 16 }),
				title: open ? "收起项目文件面板" : "展开项目文件面板",
				"aria-pressed": open,
				onClick: toggleDetails,
				children: "项目文件"
			});
		}

		// ---------- file preview tab content (rendered inside conversation.view) ----------
		function FilePreviewView({ api, tab }) {
			const [state, setState] = useState({ loading: true, preview: null, error: null, diff: null });
			useEffect(() => {
				let alive = true;
				setState({ loading: true, preview: null, error: null, diff: null });
				api.readFile(tab.path)
					.then((r) => {
						if (!alive) return;
						if (!r.ok) setState({ loading: false, error: r.error || "read failed" });
						else {
							const preview = { path: r.path, kind: r.kind, dataUrl: r.dataUrl, content: r.content, size: r.size, truncated: r.truncated };
							// read 已附带快照对比 diff（上次打开 vs 本次，标注 AI 改动行）
							setState({
								loading: false,
								preview,
								error: null,
								diff: r.kind === "text" && r.diff && r.diff.changed && Array.isArray(r.diff.lines) ? r.diff.lines : null
							});
						}
					})
					.catch((e) => {
						if (alive) setState({ loading: false, error: e && e.message ? e.message : String(e) });
					});
				return () => { alive = false; };
			}, [api, tab.path]);
			const { loading, preview, error, diff } = state;
			let body;
			if (loading) body = jsx("div", { className: "pfe-note", children: "加载中…" });
			else if (error) body = jsx("div", { className: "pfe-note", children: [jsx(IconCodeOutline16, { size: 20 }), jsx("span", { children: error })] });
			else if (preview.kind === "image") body = jsx("div", { className: "pfe-preview-media", children: jsx("img", { src: preview.dataUrl, alt: preview.path }) });
			else if (preview.kind === "video") body = jsx("div", { className: "pfe-preview-video", children: jsx("video", { src: preview.dataUrl, controls: true }) });
			else if (preview.kind === "audio") body = jsx("div", { className: "pfe-preview-audio", children: jsx("audio", { src: preview.dataUrl, controls: true }) });
			else if (preview.kind === "pdf") body = jsx("iframe", { className: "pfe-preview-pdf", src: preview.dataUrl, title: preview.path });
			else if (preview.kind === "binary") body = jsx("div", { className: "pfe-note", children: [jsx(IconCodeOutline16, { size: 20 }), jsx("span", { children: "二进制文件，不支持在线预览（可在资源管理器中打开）" })] });
			else if (preview.kind === "oversize") body = jsx("div", { className: "pfe-note", children: [jsx(IconCodeOutline16, { size: 20 }), jsx("span", { children: "文件过大（>10MB），不支持在线预览（可在资源管理器中打开）" })] });
			else body = jsx("div", { className: "pfe-preview-body", children: renderCodeLines(preview.content, diff) });
			return jsxs("div", {
				className: "pfe-view",
				children: [
					jsxs("div", {
						className: "pfe-view-head",
						children: [
							jsx("span", { className: "name", children: preview ? preview.path : tab.path }),
							jsx("button", {
								className: "pfe-view-close",
								title: "关闭标签",
								onClick: () => closeFileTab(tab.id),
								children: "\u00d7"
							})
						]
					}),
					jsx("div", { className: "pfe-view-body", children: body })
				]
			});
		}

		// ---------- plugin body ----------
		function apply(ctx) {
			const api = () => ({
				listFiles: async (path) => {
					const r = await fetch("/project-files/list?path=" + encodeURIComponent(path), { cache: "no-store" });
					return r.json();
				},
				readFile: async (path) => {
					const r = await fetch("/project-files/read?path=" + encodeURIComponent(path), { cache: "no-store" });
					return r.json();
				},
				pickDirectory: () => ctx.workspaces.pickDirectory(),
				openPath: (path) => ctx.workspaces.openPath(path)
			});
			// conversation.view 标签：点击文件时动态注册/注销（主会话区「对话/轨迹」旁的文件标签）
			const tabDisposers = new Map();
			registerTab = (tab) => {
				const dispose = ctx.slots.register({
					name: "conversation.view",
					id: tab.id,
					order: 100,
					label: tab.name,
					inject: () => ({ api: api(), tab })
				}, FilePreviewView);
				tabDisposers.set(tab.id, dispose);
			};
			disposeTab = (id) => {
				tabDisposers.get(id)?.();
				tabDisposers.delete(id);
			};
			closeDock = () => {
				try {
					ctx.layout.closeDetails();
					setDetailsOpen(false);
				} catch (e) { /* layout 尚未就绪 */ }
			};
			// Entry point: top-right of the conversation header (dock/undock).
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				id: "project-file-explorer",
				name: "conversation.session.header.actions",
				inject: () => ({ toggleDetails: () => toggleDetailsPanel(ctx) })
			}, FileExplorerToggle));
			// 文件浏览器停靠在原生 details 右列（single 槽位，priority -1 最低者渲染，
			// 抢占原生详情面板）：对话区宽度随停靠面板自动收缩/还原，自带 300-520px
			// 缩放把手。面板内的关闭按钮调用 layout.closeDetails() 收起。
			ctx.slots.inject("details", () => ctx.slots.register({
				name: "details",
				priority: -1,
				inject: (sessionId) => ({
					api: api(),
					workspaceList: ctx.workspaces.list,
					sessionId,
					onClose: () => {
						ctx.layout.closeDetails();
						setDetailsOpen(false);
					}
				})
			}, FileBrowserPanel));
			// 新工作区出现时自动停靠右侧面板（用户新建文件夹/工作区后直接看到内容）
			const seenWorkspaces = new Set();
			try {
				const wsSnap = ctx.workspaces.list.getSnapshot();
				if (wsSnap && Array.isArray(wsSnap.items)) for (const w of wsSnap.items) seenWorkspaces.add(w.workspaceId);
			} catch (e) { /* 工作区列表尚未就绪 */ }
			ctx.effect(() => ctx.workspaces.list.subscribe(() => {
				const snap = ctx.workspaces.list.getSnapshot();
				if (!snap || !Array.isArray(snap.items)) return;
				for (const w of snap.items) {
					if (seenWorkspaces.has(w.workspaceId)) continue;
					seenWorkspaces.add(w.workspaceId);
					try {
						ctx.layout.openDetails();
						setDetailsOpen(true);
					} catch (e) { /* layout 尚未就绪 */ }
				}
			}), "project-file-explorer: new-workspace dock");
			// 默认停靠右侧：启动后自动打开 details 右列（等 layout 挂载完成）。
			setTimeout(() => {
				try {
					ctx.layout.openDetails();
					setDetailsOpen(true);
				} catch (e) { /* layout 尚未就绪则跳过，用户可点「项目文件」展开 */ }
			}, 400);
		}
		exports.apply = apply;
		// 重要：exports.inject 必须是 cordis 服务名（本插件用到 ctx.slots、
		// ctx.workspaces 与 ctx.layout）。绝不能写成 npm 包名（如 @deepseek-ai/...），
		// 否则 web boot 会报 "pending (waiting for services: ...)" 并失败。
		exports.inject = ["slots", "workspaces", "layout"];
		return module.exports;
	}
});
