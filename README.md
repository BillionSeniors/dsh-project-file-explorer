# dsh-project-file-explorer

> **作者：亿哲学长**（GitHub: [BillionSeniors](https://github.com/BillionSeniors)）· 版权所有，禁止侵权转载

DeepSeek Harness (dsh) 的**项目文件浏览器**插件：右侧停靠项目文件树，点击文件在主会话区打开预览标签，支持代码 / 文本 / 图片 / 音视频 / PDF，窄屏自动降级为右侧抽屉（响应式）。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 演示视频

📺 点击观看插件功能演示视频（哔哩哔哩）：**[【亿哲学长】DeepSeek Harness 项目文件浏览器插件演示](https://www.bilibili.com/video/BV1UUgP6pEm6/)**

## 功能特性

- **右侧停靠文件树**：点击会话区顶部的「项目文件」按钮，项目文件夹停靠在右侧（可关闭 / 展开，宽度 300-520px 可缩放）
- **跟随当前会话工作区**：切换到哪个工作区，右侧就显示哪个文件夹；**新建工作区自动弹出**对应目录
- **一键打开预览**：点击文件即自动打开预览标签，无需再手动点击标签
- **标签式预览**：文件名显示在「对话 / 轨迹」旁边，多文件往右排、自动缩窄
- **媒体支持**：图片 / 音视频 / PDF 在浏览器内直接渲染（data URL），不再显示乱码
- **安全预览**：超大文件 / 二进制文件给出友好提示，不卡界面
- **未分组可删除**：侧边栏「未分组」提供与普通工作区一致的删除能力（归档桶内孤儿会话）
- **会话切换不收起**：切换对话时右侧面板保持停靠
- **响应式抽屉**：手机 / 窄屏下详情列降级为右侧抽屉 + 半透明遮罩，打开文件自动收起
- **幂等补丁脚本**：一键应用 / 检查 harness 补丁，升级 dsh 后可重复运行

## 更新日志

### v1.1.0（2026-08）

在早期版本基础上新增 / 增强的功能：

- **右侧停靠文件树**：点击会话区顶部「项目文件」按钮，右侧停靠当前工作区文件树，宽度 300-520px 可缩放
- **跟随工作区 + 自动弹出**：切换工作区自动刷新文件树；**新建工作区自动停靠弹出**对应目录
- **一键预览**：点击文件即自动打开预览标签并激活，无需手动点击标签；多文件标签往右排、自动缩窄
- **媒体渲染**：图片 / 音视频 / PDF 以 data URL 在浏览器内直接渲染，不再显示乱码
- **安全预览**：超大文件 / 二进制文件给出友好提示，不卡界面
- **「未分组」可删除**：harness 补丁让「未分组」支持删除，一键归档桶内全部孤儿会话
- **会话切换不收起**：详情列始终跟随当前会话，切换对话时右侧面板保持停靠
- **窄屏响应式抽屉**：手机 / 窄屏下详情列自动降级为右侧抽屉 + 半透明遮罩，打开文件自动收起
- **幂等安装**：`npm run install` 一条命令完成 复制插件 + 注册 + 应用补丁，重复运行自动跳过；升级 dsh 后重新运行即可

> 插件与补丁基于 `@deepseek-ai/dsh` `0.1.0-rc.6` 打包产物编写。

## 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| DeepSeek Harness | `dsh` 最新版 | `npm install -g @deepseek-ai/dsh` |
| Node.js | >= 18 | 运行补丁脚本 |
| 操作系统 | Windows / macOS / Linux | 使用 `dsh web` |

> 插件与补丁基于 `@deepseek-ai/dsh` 的 `dsh-client-ui-workspace` / `dsh-client-ui-layout` `0.1.0-rc.6` 打包产物编写；补丁脚本会检测源码片段，版本不一致时给出提示。

## 安装

安装前请确认目标电脑已安装 DeepSeek Harness（`npm install -g @deepseek-ai/dsh`）与 Node.js >= 18。

### 方式 A：一键安装（推荐）

获取插件后，在插件目录里运行一条命令即可完成复制 + 注册 + 打补丁：

```bash
cd dsh-project-file-explorer
npm run install        # 复制到 profile、注册 cordis.patch.yml、应用补丁（全部幂等）
dsh web                # 重启启动
```

> `npm run install` 等价于 `node scripts/install.mjs`。可选参数：
> `--profile <dir>` 指定 dsh profile（默认 `~/.dsh/profiles/web`）、`--target <dir>` 指定依赖目录、`--skip-patch` 跳过补丁。
> 在另一台电脑上安装时：把整个文件夹拷过去（U 盘 / 局域网），进入文件夹执行上面的命令即可。

### 方式 B：手动安装

### 1. 获取插件

```bash
git clone https://github.com/<你的用户名>/dsh-project-file-explorer.git
# 或直接下载 ZIP 并解压
```

### 2. 复制插件到 dsh profile

```bash
# Linux / macOS
mkdir -p ~/.dsh/profiles/node_modules/@local
cp -r dsh-project-file-explorer ~/.dsh/profiles/node_modules/@local/

# Windows (PowerShell)
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.dsh\profiles\node_modules\@local" | Out-Null
Copy-Item -Recurse dsh-project-file-explorer "$env:USERPROFILE\.dsh\profiles\node_modules\@local\"
```

### 3. 注册插件

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，追加：

```yaml
- insert:
    - id: project-file-explorer
      name: '@local/dsh-project-file-explorer'
```

完整示例见 [`example/cordis.patch.yml`](example/cordis.patch.yml)。

### 4. 应用 harness 补丁（获取全部效果）

```bash
cd dsh-project-file-explorer
npm run patch     # 应用补丁（幂等，可重复运行）
npm run check     # 只检查是否已应用，不写入
```

### 5. 启动

```bash
dsh web
```

浏览器打开 `http://127.0.0.1:3080`，点击侧边栏底部的文件夹按钮即可停靠右侧面板。

## 使用

1. **打开面板**：点击侧边栏底部的文件夹按钮，右侧弹出当前工作区的项目文件树
2. **浏览文件**：点击文件夹展开 / 折叠；顶部有搜索过滤和刷新按钮
3. **预览文件**：点击文件 → 主区「对话 / 轨迹」旁新增文件标签并自动打开内容
   - 代码 / 文本：语法文本预览（前 96KB）
   - 图片 / 音视频 / PDF：浏览器内直接渲染
   - 二进制 / 超大文件：友好提示
4. **关闭面板**：点击面板关闭按钮（之后可再次点底部按钮展开）
5. **窄屏（手机）**：面板自动变成右侧抽屉，点击文件打开后抽屉自动收起
6. **新建工作区**：创建新的工作区 / 文件夹后右侧自动弹出对应目录

## 为什么需要补丁脚本？

插件核心（`lib/`）通过 dsh 的 slots 服务即可加载，但完整效果需要微调 dsh 自带的两个打包组件：

| 补丁目标 | 改动 | 作用 |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-workspace` | 未分组菜单 / 删除动作 / 归档逻辑 | 「未分组」支持删除 |
| `@deepseek-ai/dsh-client-ui-layout` | 详情列跟随会话 / 不自动收起 / 抽屉渲染 | 空白会话也停靠、切换不收起、窄屏响应式 |

补丁**直接修改 node_modules 内打包产物**，所以：

- 升级 / 重装 `@deepseek-ai/dsh` 后，请重新运行 `npm run patch`
- 脚本是**幂等**的：已打过的补丁自动跳过（检测 marker 注释）
- dsh 大版本升级导致源码片段变化时，脚本会提示失败，按提示手动处理即可

## 目录结构

```
dsh-project-file-explorer/
├── lib/
│   ├── index.js          # host 端：/project-files/list、/project-files/read HTTP 路由
│   │                     #        媒体分类 + data URL + 二进制/超大文件检测
│   └── client.js         # 浏览器端：详情停靠、文件标签、媒体渲染、自动激活、响应式
├── scripts/
│   ├── install.mjs      # 一键安装（复制 + 注册 + 打补丁，幂等）
│   └── patch-harness.mjs # 幂等补丁脚本（--check / --target 参数）
├── example/
│   └── cordis.patch.yml  # loader patch 配置示例
├── package.json
├── LICENSE               # MIT
└── README.md
```

## 常见问题 (FAQ)

**Q: 右侧面板没出现？**
先确认补丁已应用（`npm run check` 全部显示"已存在"），然后完全重启 `dsh web`（停掉进程再启动，热重载可能不生效）。

**Q: 插件报 `pending (waiting for services: ...)`？**
这是 inject 写错导致的。插件注入的必须是 **cordis 服务名**（`slots` / `workspaces` / `layout`），绝不能写 npm 包名（如 `@deepseek-ai/dsh-client-runtime`）。

**Q: 升级 dsh 后补丁失败 / 提示找不到代码段？**
dsh 版本升级改变了源码。补丁脚本会明确提示哪一处失败，请对照该版本的打包产物手动调整补丁定义（`scripts/patch-harness.mjs` 中的 find / replace 片段），或提 issue。

**Q: 图片显示乱码 / 不显示？**
确认 `lib/index.js` 是最新版（支持 media data URL 渲染）。老版本只返回 base64 文本会被当作文本预览。

**Q: 预览标签点击不自动激活？**
插件通过 DOM 模拟点击最后一个 `role="tab"` 实现自动激活。若失效，请确认浏览器端插件是当前版本且未被覆盖。

**Q: 怎么卸载？**
1. 从 `cordis.patch.yml` 删除 insert 条目
2. 删除 `~/.dsh/profiles/node_modules/@local/dsh-project-file-explorer/`
3. （可选）用 git 还原被补丁的两个 `lib/client.js`（`npm i -g @deepseek-ai/dsh` 重装或重新解压对应包）

## 作者

- **亿哲学长**（GitHub: [BillionSeniors](https://github.com/BillionSeniors)）
- 本插件为原创作品，版权所有。未经作者书面许可，禁止任何形式的转载、盗用或二次发布。
- 如需商用 / 合作 / 授权，请通过 GitHub 联系作者。

## License

[MIT](LICENSE)
