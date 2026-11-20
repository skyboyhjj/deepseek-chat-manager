# deepseek-chat-manager 项目上下文

## 项目概述

**DeepSeek 对话导出管理器（deepseek-chat-manager）** — 在官方 [chat-demo](https://github.com/deepseek-ai/chat-demo) 基础上二次开发（independent repository，非 GitHub fork），重点增强历史对话的**搜索、导出与旧版数据兼容导入**能力。

做三件事：把 DeepSeek 的历史对话导进来（含旧版）、按关键词全局搜出来、按需导出成可分享的格式。

- 仓库：[skyboyhjj/deepseek-chat-manager](https://github.com/skyboyhjj/deepseek-chat-manager)（public，默认分支 `custom`）
- 线上部署：**暂无公开实例**，本地自托管（`pnpm dev` 起静态前端）
- 当前版本：package.json `0.1.2`（对齐上游 chat-demo v0.1.2；二开功能未独立版本号）

核心特色：全局搜索导出、会话级选择性导出、旧版 `conversations.json` 导入兼容、canonical 中间模型、双轨分支（`main` 镜像上游 / `custom` 承载二开）。

## 关键文件

| 文件 | 用途 |
|------|------|
| `README.md` / `README.zh-CN.md` | 项目说明：定位、功能、数据与隐私、目录结构、开发命令 |
| `PROJECT_CONTEXT.md` | 本文件：项目上下文，**新对话先读它** |
| `package.json` | 依赖与脚本；`engines` Node `^20.19.0 \|\| >=22.12.0`、`packageManager pnpm@9.15.9` |
| `rspack.config.ts` | 构建配置，`mode` 读 `argv.mode`（不依赖易被污染的 `NODE_ENV`） |
| `tsconfig.json` | TS 7 native 编译配置 |
| `src/app/` | 应用布局、主题、全局样式 |
| `src/components/sider/` | 会话侧边栏（SessionItem 右键菜单重命名/删除在此） |
| `src/components/base/` | 通用组件：`Modal`、`Menu`、`anchored.ts`（浮层定位 hook）等 |
| `src/components/export/` | 全局搜索导出 UI（GlobalSearchDialog） |
| `src/i18n/zh.ts` / `en.ts` | 中英文文案（appName = 「DeepSeek 对话导出管理器」） |
| `src/services/api/` | DeepSeek API 请求、SSE 与协议类型 |
| `src/services/chat/store.ts` | zustand 会话/消息状态、`getVisibleMessages` 走当前分支 |
| `src/services/chat/db.ts` | IndexedDB 存储（库名 `chat-demo`，local-first） |
| `src/services/chat/backup.ts` | 历史导入导出入口（`importHistory` / `exportHistory`） |
| `src/services/chat/branches.ts` | 消息分支（`getVisibleMessages` / `normalizeSession`） |
| `src/services/chat/globalSearch.ts` | 全局搜索（正文只认 REQUEST/RESPONSE，THINK 单独） |
| `src/services/chat/searchExport.ts` | 搜索导出（MD / CSV / JSONL，OR/AND、粒度、日期） |
| `src/services/chat/history/format.ts` | v3 格式类型定义，`EXPORT_FORMAT_VERSION = 3` |
| `src/services/chat/history/schema.ts` | 导入校验：manifest / 会话 / 消息 / 时间（RFC3339 `Z`） |
| `src/services/chat/history/importArchive.ts` | v3 流式导入 + 旧版识别分支 + `importLegacyArchive` |
| `src/services/chat/history/exportArchive.ts` | 导出（会话级选择性 + 全局搜索导出） |
| `src/services/chat/history/legacy.ts` | **旧版兼容核心**：`conversations.json` mapping 树归一化为 `SessionFile` |
| `src/services/chat/history/canonical.ts` / `adapter-v3.ts` | canonical 中间模型，与 Python `canonical.py` 对齐 |
| `src/services/chat/history/toLocal.ts` / `toArchive.ts` | `SessionFile ↔ 本地 Session` 双向转换 |
| `src/services/chat/history/paths.ts` | ZIP 路径常量（`manifest.json` / `conversations.json` / 会话路径） |
| `src/services/chat/history/zipReader.ts` / `zipWriter.ts` | ZIP 读写 |
| `src/services/markdown/` | Markdown 解析、代码高亮、图表 |
| `src/services/speech/` | 录音与朗读 |
| `docs/` | 设计文档、需求文档、宪法自查报告、DSH 插件化评估、上游 Bug 修复与提 PR 流程 |
| `scripts/sync-upstream.ps1` | 上游同步脚本（默认 rebase / `-Merge` / `-DryRun`，冲突回滚） |

## 运行与部署命令

```bash
pnpm install          # 安装依赖（跨盘迁移必须重装，勿直接复制 node_modules）
pnpm dev              # 本地开发，起 rspack dev server（默认 8090）
pnpm build            # 生产构建（rspack build --mode production）
pnpm type             # 类型检查（tsc）
pnpm lint             # 静态检查（oxlint）
pnpm format           # 格式化（oxfmt）
```

Windows PowerShell 5 注意：不支持 `&&` / `||`，命令用 `;` 分隔；运行含中文 `.ps1` 需存 UTF-8 带 BOM。

## 服务架构

无后端、纯静态前端，浏览器直接请求用户配置的 DeepSeek API：

```
                    浏览器（rspack + React 18 + TS7 + zustand + idb）
                              │  chat completions + SSE
                              ▼
                    DeepSeek API（用户自填 API Key）
                              │
        ┌─────────────────────────────────────────┐
        │  本地存储                                 │
        │  对话/消息/分支  → IndexedDB（库 chat-demo）│
        │  API Key/设置    → localStorage           │
        └─────────────────────────────────────────┘
```

数据 local-first：对话数据不出设备，唯一出设备路径是「用户主动导出」与「调用 DeepSeek API」。

## 数据模型与导入导出规则（改逻辑前必读）

### 当前导出格式 v3

ZIP 固定结构：`manifest.json`（含 `export_format_version`）→ `user.json`（可选，导入时跳过）→ `chat_sessions/{id}.json`（逐会话）→ `chat_session_index.json` → 图片目录 `chat_sessions/{id}_files/`。

- `manifest.json` **必须是 ZIP 第一个条目**，否则判定为不可识别归档。
- `SessionFile`：`{ id, title, pinned, current_message_id, inserted_at, updated_at, messages[] }`；`ChatMessage.id/parent_id` 为 number，消息树靠 `parent_id` 线性化，`current_message_id` 标记当前分支。
- 时间字段只接受 RFC3339 `Z` 结尾。

### 旧版格式兼容（pre-v3）

ZIP 仅 `user.json` + `conversations.json`（无 manifest）。`conversations.json` 是顶层数组，每会话 `{ id, title, mapping }`，`mapping` 为 ChatGPT 风格树（含 `root` 虚拟节点）。

`legacy.ts` 归一化规则（best-effort 降级）：

- 前序 DFS 重编号，保证父 id 小于子 id；孤立节点丢弃。
- role 由 fragment 推断，**同角色连发合并进父消息**（否则整枝丢弃）。
- 时间 `+08:00` → `Z` 归一；`SEARCH` → `TOOL_SEARCH`（`published_at` UNIX→ISO）。
- 图片降级为元数据附件（`export_path: null`、按扩展名判 `is_image`、丢弃 `content`）。
- 片段级容错：未知片段只丢弃不中断；容器级严格（manifest 版本非法/过低拒绝）。

### 检索口径

正文只认 `REQUEST` / `RESPONSE` / `TEXT`，`THINK` 思考链单独存放不纳入检索。前端全局检索必须走 `getVisibleMessages(normalizeSession(session))` 取当前分支，不能直接遍历 `session.messages`（否则混入被放弃分支）。

## 测试

- 静态：`pnpm type` + `pnpm lint`（每次改动必跑）。
- 双端一致性对拍：canonical 归一规则两端（前端 TS / Python）100% 一致（491 会话 / 11558 消息逐条相同）；统一到「当前分支」口径后 P vs FL 零差异。
- 独立脚本验证：旧版导入解析（186 会话 / 0 跳过 / 0 约束违规）；legacy 同角色连发样本。
- 浏览器端到端：交互类 bug（弹窗遮挡、菜单漂移）必须浏览器实测复现 + 复测。

## 分支管理

**双轨分支**（见 `docs/上游Bug修复与提PR标准流程.md`）：

- `main`：上游镜像，永久对齐 `deepseek-ai/chat-demo`，零二开代码。**只追踪 upstream，不合并二开。**
- `custom`：默认分支，承载全部二开改动。
- 临时 `fix/<name>`：基于 `main` 建干净分支 + `cherry-pick` 单一修复，用于向上游提 PR。

## 版本控制约定

每次提交前：

1. 读本文件，与仓库实际状态比较，冲突先改本文件。
2. 改动影响使用者行为 → 同步 README；改导入导出规则 → 同步 `history/README.md` 与 `docs/` 对应文档。
3. 提交信息用 Conventional Commits：`feat(scope):` / `fix(scope):` / `docs:` / `chore:`，中文描述。

其他约定：

- 二开改动只落 `custom`，`main` 不合并二开（保持与 upstream 零冲突对齐）。
- 界面应用名统一「DeepSeek 对话导出管理器」；内部存储标识（localStorage 前缀、IndexedDB 库名）保留 `chat-demo` 以兼容老用户数据。
- 数据治理：凭证与业务数据物理隔离，导出脱敏不携带 token；API Key 明文存 localStorage（仅请求配置的 API，不离开本机，已知限制已在 README 透明说明）。

## 已完成

### 1. 数据源统一（canonical 中间模型）

- **实现**：所有版本对话格式先归一化为标准中间模型再检索/统计/导出，实现后续版本兼容
- **文件**：`canonical.ts`、`adapter-v3.ts`（对齐 Python `canonical.py`）

### 2. 会话级选择性导出（feature #1）

- **实现**：用户按会话勾选导出，走 `exportArchive.ts`
- **文件**：`backup.ts`、`exportArchive.ts`

### 3. 全局搜索导出（feature #2）

- **实现**：命中单元支持「聚焦片段（消息级）」与「整篇提取（对话级）」；多关键词命中策略 `all_hits`；时间按会话创建时间过滤；导出 MD/CSV/JSONL
- **文件**：`globalSearch.ts`、`searchExport.ts`、`components/export/GlobalSearchDialog`

### 4. 旧版 ZIP 导入兼容

- **实现**：`conversations.json` mapping 树 → `SessionFile` 归一化，复用 `toLocalSession` 管线
- **关键修复**：仅含 PDF 附件无文本的用户消息会因 fragments 为空误判角色 → 改按树结构交替推断（根默认 USER）
- **文件**：`legacy.ts`、`importArchive.ts`（`isLegacyArchive` / `importLegacyArchive`）、`zipReader.ts`（`readPaths`）

### 5. 双端一致性对拍（task A）

- **结果**：canonical 归一规则两端 100% 一致；唯一分歧是分支遍历（Python 曾遍历全分支、前端只走当前分支），已统一到「当前分支」，P vs FL 零差异
- **文件**：`canonical.ts`、Python `canonical.py`（`visible_messages()`）

### 6. 无障碍修复（a11y）

- **根因**：Chromium a11y tree 不暴露 `position:fixed` 弹窗，因 `body{overflow:hidden}` 且 `.frame` 用 `position:absolute;inset:0`，body 无正常流导致高度塌陷为 0
- **修复**：`html/body/#root` 统一 `height:100%`，修复后 snapshot 从 2 节点恢复到 54 节点
- **文件**：全局样式

### 7. git 规范化与双轨分支

- **实现**：双轨分支落地（`main` 镜像 upstream v0.1.2 / `custom` 二开）；上游同步脚本
- **文件**：`scripts/sync-upstream.ps1`

### 8. 宪法审核与优化

- **实现**：对照「慧惠产品宪法」自查；唯一实质偏离（外挂增强 vs fork）按「路径 A 备案」；补导出隐私提示、API Key 透明说明
- **文件**：`docs/宪法自查报告.md`、README、i18n、导出组件

### 9. 搜索导出弹窗遮挡修复

- **根因**：Modal 内容无 max-height 且垂直居中，超高内容溢出视口
- **修复**：弹窗 `max-height: calc(100vh - 32px)`，内容区 `overflow-y: auto` 内部滚动
- **文件**：`GlobalSearchDialog.module.css`

### 10. 会话菜单漂移修复 + 溯源 + 上游 PR

- **根因**：菜单触发元素 `.action` 仅在会话项 hover 时显示，鼠标移向 portal 菜单时触发元素 `display:none` → anchor 矩形归零 → `ResizeObserver` 重定位到左上角
- **溯源**：`git log main -- anchored.ts` + `git diff main custom` 判定为**上游存量缺陷**（非二开引入，二开「大量会话导入」提高暴露概率）
- **修复**：`useAnchoredPosition.update()` 检测空矩形跳过重定位（通用防御）
- **提 PR**：基于 `main` 建 `fix/menu-drift` 干净分支，fork 到 `skyboyhjj/chat-demo`，走邮件提交上游
- **文件**：`components/base/anchored.ts`、`docs/上游Bug修复与提PR标准流程.md`

## 待办

- **DSH 插件化 Phase 1**：把「旧版 ZIP 导入」做成 DSH 插件（`@deepseek-ai/dsh-session-import-legacy`），接入 SessionPersistence restore 侧，从根本上消除宪法第十条偏离。详见 `docs/DSH插件化可行性评估.md`
- **上游 PR 跟进**：菜单漂移修复已邮件提交上游，待上游合入后 `main` 同步更新并回填本文件

## 新对话快速启动

在新对话中引用此文件即可继续开发：

> 「参考 PROJECT_CONTEXT.md 继续开发 deepseek-chat-manager」

配套必读（按任务类型）：

| 任务类型 | 先读 |
|---|---|
| 改导入导出逻辑 | `src/services/chat/history/README.md` |
| 改数据模型 / 检索口径 | `docs/DeepSeek对话导出_数据源统一与版本兼容_设计文档.md` |
| 向上游提 PR / 修上游 bug | `docs/上游Bug修复与提PR标准流程.md` |
| 对照产品宪法 | `docs/宪法自查报告.md`、`docs/DSH插件化可行性评估.md` |
| 同步上游 | `scripts/sync-upstream.ps1` |
