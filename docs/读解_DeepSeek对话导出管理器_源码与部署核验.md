# 读解：deepseek-chat-manager（DeepSeek 对话导出管理器）

> 仓库：`https://github.com/skyboyhjj/deepseek-chat-manager`（默认分支 `custom`）
> 读解日期：2026-11-20
> 方法：按 README 的安装要求真部署一遍，再把「宣称的功能」改写成可执行断言，用仓库自己的源码跑样本；文档与代码不一致处逐条落地。
> 算据：`附录_DeepSeek对话导出管理器_部署与源码核验_算据脚本.md`（源码逐字节嵌入＋实跑输出＋抽回自校验）

---

## §0 定性 + 一句话结论

**体裁不是文章，是代码仓库。** 读法随之改变：不核「说法准不准」，而核「说法能不能跑出来、跑出来是不是它说的那件事」。

一句话结论：这是官方 `deepseek-ai/chat-demo` 的二次开发分支，主打「历史对话搜索 / 导出 / 旧版数据兼容导入」。三条通道（类型检查、lint、构建）全部通过，开发服务器与静态产物都在沙箱里跑通了；但三件事必须知道——**安装要求比依赖实际要求高（Node 22.12 vs 20.19）、构建脚本是 Windows 写法在 Linux 下「靠 CLI 默认值侥幸正确」、旧版导入遇到「同角色连发」会静默丢掉整枝消息**。

### 本体卡（★ 严格：来自 GitHub API 与 tar 解包统计）

| 项 | 值 |
| --- | --- |
| 仓库 | `skyboyhjj/deepseek-chat-manager`，MIT，GitHub 上 `fork=false` |
| 默认分支 | `custom`（head `2fd80c03`），另有 `main`（`429af5a4`） |
| 上游关系 | `main` 的 SHA 与 `deepseek-ai/chat-demo` 的 `main` 完全相同（`429af5a45…`），即纯镜像 |
| 规模 | 179 个文件 / 777,460 字节（不含 `node_modules` 与 `dist`）；`src` 下 TS/TSX 共 15,713 行 |
| 技术栈 | React 18.3.1 + zustand 4.4.7 + rspack 2.0.2 + TypeScript 7.0.2 + oxlint 1.63.0 |
| 依赖 | 20 个 dependencies、8 个 devDependencies；`pnpm-lock.yaml` 为 lockfileVersion 9.0 |
| 定制面 | 新增 `components/export/`、`services/chat/globalSearch.ts`、`searchExport.ts`、`history/legacy.ts`，另附 2 份 docs 与 1 个双轨同步脚本 |

---

## §1 README 的安装要求，逐条实测

| README 的说法 | 实测结果 | 依据 |
| --- | --- | --- |
| 准备 Node.js 22.12+ 和 pnpm | △ 偏严（实际下限是 Node 20.19） | 4 个关键包 `engines` 为「20.19 及以上，或 22.12 及以上」；用 Node v20.20.2 跑 rspack 构建与 serve 均成功 |
| `pnpm install` | ✓ 成功 | pnpm 9.15.9；首轮因 `fflate` 下载超时失败，加长 fetch 超时后 2 分 4 秒完成 |
| `pnpm dev` | ✓ 成功，监听 8090 | 首次编译 184.72 秒；`GET /` 返回 200 |
| 打开 `http://localhost:8090` | ✓ 与配置一致 | `rspack.config.ts` 中 `devServer: { port: 8090 }` |
| `pnpm build` 生成 `dist/` | ✓ 成功，但机制与脚本写法不符 | 见 §3 要害二 |
| 产物可部署到静态服务器 | ✓ 实测 | `python3 -m http.server` 下 index、js、LICENSE 均 200 |
| 也可直接打开 `dist/index.html` | 未测（无浏览器） | 静态检查：脚本与 CSS 均为相对路径，`publicPath: 'auto'` |
| 构建会把 LICENSE 复制到 `dist/LICENSE` | ✓ 实测 | 两处 md5 同为 `e578a79c…` |
| 导入导出无需 API Key | ✓ 代码层面成立 | 导入导出链路只碰 IndexedDB 与 ZIP，不经过 `api/client.ts` |
| 聊天默认 `deepseek-flash`，走 Anthropic 兼容 Messages / Files API | 代码一致，未联调 | `client.ts` 基址为 `API_ORIGIN + /anthropic/v1`；`GET /models` 实测返回 401（端点存在） |
| 兼容导入旧版 DeepSeek 导出 ZIP | ✓ 端到端跑通 | 自造 ZIP（仅 `conversations.json`）经 `zipReader` → `legacy` 解析出 2 个会话 |
| 搜索导出支持「标签策略」 | △ 名不符实 | UI 该项实为「记录全部命中词还是首个」；CSV 的「主题标签」列内容与「命中关键词」列逐字相同 |

---

## §2 部署实录（沙箱，Linux x86_64）

沙箱自带的 Node 是 v20.20.2，没装 pnpm。为对齐 README，先装 Node v22.23.5：

| 步骤 | 耗时 | 说明 |
| --- | --- | --- |
| 下载 Node v22.23.5 | 96 秒 | `nodejs.org` 源 5 分钟只下到 18 MB 后超时，改换 npmmirror 镜像一次成功（31 MB） |
| `npm i -g pnpm@9.15.9` | 6 分 12 秒 | 沙箱出网慢，属环境问题，与项目无关 |
| `pnpm install`（第一轮） | 约 40 分钟后失败 | 停在 234/235，`fflate-0.8.3.tgz` 连续 `ERR_SOCKET_TIMEOUT` 与 `ETIMEDOUT` |
| `pnpm install`（第二轮） | 2 分 4 秒 | 加 `--fetch-timeout=300000 --network-concurrency=4`，复用 234 个包，补下 1 个 |
| `pnpm type` | 4 分钟 | `tsc -p tsconfig.json`，exit 0（strict、`noUnusedLocals`、`noImplicitReturns` 全开） |
| `pnpm lint` | 87 秒 | oxlint：0 warnings、0 errors，127 个文件、100 条规则 |
| `pnpm build` | 184 至 278 秒 | exit 0，153 个文件 / 4,411,352 字节 / 0 个 `.map` |
| `pnpm dev` | 首次编译 184.72 秒 | 8090 端口，`main.js` 3,042,908 字节，`.map` 可访问 |
| 静态托管 `dist/` | 秒级 | index 414 字节、`main.js` 485,180 字节、LICENSE 1,065 字节，均 200 |

两次 production 构建产出的主包文件名完全相同（`main.f934bb40.js`），构建可复现。

---

## §3 三个要害

### 要害一 · 安装要求比依赖实际要求高，而且没人拦着

README 只说 Node 22.12+，但仓库的四个关键包写的是同一条 `engines`：

- `@rspack/core@2.0.2`、`@rspack/dev-server@2.0.1`
- `oxlint@1.63.0`、`oxfmt@0.48.0`

它们的 `engines.node` 都是「`^20.19.0` 或 `>=22.12.0`」。也就是说 Node 20.19 以上的 20.x 分支完全够用。

- **下限偏严的代价**：守着 Node 20 LTS 的 CI 会被一句「22.12+」劝退，其实能跑。
- **更要紧的一面**：`package.json` 里既没有 `engines` 字段，也没有 `packageManager` 字段。README 的要求是纸面要求，装到 Node 20.18 或 pnpm 8 上不会提前报错，会在安装或构建阶段以别的方式炸。
- **实测**：`/usr/bin/node`（v20.20.2）直接跑 `@rspack/cli/bin/rspack.js`，build 与 serve 都成功。

一句话：**要求写严了，而且没有把它变成可执行约束。**

### 要害二 · `build` 脚本是 Windows 写法，在 Linux 下「靠 CLI 默认值侥幸正确」

`package.json` 里这一行：

```json
"build": "set NODE_ENV=production&& rspack build -c rspack.config.ts"
```

`set VAR=value` 是 cmd 语法。POSIX 的 `set` 只改位置参数、**不导出环境变量**。实测：

- `sh -c 'set NODE_ENV=production&& node -e "…"'` → 打印 `undefined`（`/bin/sh` 实际是 dash）
- 用 pnpm 跑同样的脚本（临时挂一个 `envtest` 脚本，测完已还原）→ `[ENV]undefined`

那么为什么产物是 production 的？因为 `@rspack/cli` 自己对子命令注入了默认值。探针实测（在 `rspack.config.ts` 同构配置里打印 `process.env.NODE_ENV`）：

| 场景 | 探针读到 NODE_ENV | `dev = NODE_ENV !== 'production'` |
| --- | --- | --- |
| `rspack build`，shell 未设 | `"production"` | false |
| `rspack build`，shell 设 `NODE_ENV=development` | `"development"` | true |
| `rspack serve`，shell 未设 | `"development"` | true |

结论：**开发/生产的切换实际由「子命令」决定，不由那行 `set` 决定。** 脚本里的 `set` 在 Windows 上有效、在 Linux 上无效，恰好被 CLI 默认值兜住了，于是「看起来没问题」。

这个侥幸有代价，而且这个代价是**可复现**的：只要环境里带着 `NODE_ENV=development`（容器、某些 CI 镜像常见），同一条 `pnpm build` 就会静默产出开发版：

| 指标 | 正常 `pnpm build` | `NODE_ENV=development pnpm build` |
| --- | --- | --- |
| 产物文件数 | 153 | 243 |
| 产物体积 | 4,411,352 字节 | 22,194,893 字节 |
| `.map` 文件 | 0 | 90 |
| `main.js` | 485,180 字节 | 2,929,963 字节 |
| 全部 JS 字符数 | 3,208,987 | 10,211,854 |
| `react-dom.development` 出现 | 0 次 | 3 次 |

差 5 倍体积、多出 90 份源码映射、还带着 React 开发版警告——**构建成功、退出码 0、没有任何提示**。

正确写法是 `cross-env NODE_ENV=production rspack build`，或者干脆把模式判定改成读 `--mode`；再退一步，用 `rspack build --mode production` 并让配置只读 `argv`。

### 要害三 · 旧版导入：遇到「同角色连发」会静默丢掉整枝

`history/legacy.ts` 用前序遍历把旧版 `mapping` 树重编号成线性消息数组（父 id 必须小于子 id）。遍历里有一条硬规则（第 220–224 行）：

```ts
const role = roleHint ?? (parentRole === 'ASSISTANT' ? 'USER' : parentRole === 'USER' ? 'ASSISTANT' : 'USER')
if ((parentRole !== null && role === parentRole) || (parentRole === null && role !== 'USER')) {
  return
}
```

只要子节点角色与父节点相同，**直接 return，且不递归它的子节点**。

实测样本（三条消息：USER「第一句」→ USER「第二句（补问）」→ RESPONSE「回答」）：

| 观测 | 值 |
| --- | --- |
| 源文件消息数 | 3 |
| 导入结果消息数 | 1 |
| `current_message_id` | 1 |
| 是否有警告或错误 | 无 |

第二条 USER 被丢弃是本意（角色必须交替）；但**它后面的 ASSISTANT 回答也一起消失了**，因为 `visit` 在被丢弃的节点上不再往下走。真实旧数据里「用户连发补问」并不罕见，这类会话会以「只剩第一问」的样子导进来，而且不报错。

同一段代码还有一处与设计文档相反：设计文档 §3.2 写 `SEARCH` 片段「仅旧格式，实测 316 条且 results 为空，直接丢弃」；代码第 93–99 行却把它映射成 `TOOL_SEARCH` 保留下来。实测空 `results` 的样本得到片段序列 `["TOOL_SEARCH","RESPONSE"]`，`search_enabled` 被置为 true；带 1 条 `results` 的样本则完整保留了 1 条结果。哪个更对可以讨论，但**文档说的和代码做的不是一件事**。

---

## §4 先算后说：四组实跑

全部在 Node 里跑仓库**真实源码**：把 `legacy.ts`、`searchExport.ts`、`zipReader.ts` 用仓库自己的 rspack 打成 node bundle 再执行（脚本见附录）。唯一例外是检索匹配语义，该函数未导出且其模块依赖 zustand store，只能复刻后标注为半严格。

| 组 | 输入 | 观测 | 结论 |
| --- | --- | --- | --- |
| A 旧版解析（规范链） | USER → ASSISTANT(THINK+RESPONSE) → USER | 3 条消息；角色 USER/ASSISTANT/USER；时间 `21:57:59.103+08:00` → `13:57:59.103Z`；THINK 进 `think` 字段；`model=deepseek-reasoner` 使 `thinking_enabled=true`；`current_message_id=3` | 正常路径正确，含时区归一与思考链剥离 |
| B 旧版解析（同角色连发） | USER → USER → ASSISTANT | 只剩 1 条，`current_message_id=1`，无告警 | 整枝被静默丢弃（要害三） |
| C 旧版解析（空 SEARCH） | REQUEST → [SEARCH(results=[]) , RESPONSE] | 片段序列 `["TOOL_SEARCH","RESPONSE"]`，`search_enabled=true` | 与设计文档「直接丢弃」相反 |
| D 旧版 ZIP 端到端 | 自造 ZIP（仅 `conversations.json`） | `isZipFile=true`；`readPaths=["conversations.json"]`；`legacy_route=true`；解析出 2 会话；带结果的搜索片段保留 1 条 | 旧版 ZIP 路由成立 |
| E 旧版 ZIP 反例 | 同名 `.json` 直接当归档读 | `isZipFile=false`；`readPaths` 抛 `ArchiveError` | 拒绝非 ZIP，行为正确 |
| F 搜索导出 CSV | 一条命中两个关键词的会话 | 表头为「对话标题/创建时间/命中关键词/主题标签/上下文」；第 2、3 列内容逐字相同；行分隔为 CRLF；BOM 在下载层加 | 「主题标签」列是同义重复列 |
| G 检索匹配语义（复刻，半严格） | 三个小样本 | `deepseek` 不命中 `DeepSeek`；`量寿` 命中 `无量寿佛`；AND 要求同一消息（或同一会话拼接文本）内全部命中 | 大小写敏感、纯子串匹配 |

> 说明：G 组的 `matchedHits` 逐字取自 `globalSearch.ts` 第 79–88 行，但未直跑原函数，故标半严格。其余各组的结论都来自真跑。

---

## §5 作为「仓库」的问题（不是技术缺陷，是文档与实现不同步）

1. **`tag_map.json` 不存在。** 设计文档把它写成「单一事实来源」，README 把「标签策略」列成卖点，仓库里搜不到这个文件。结果是 CSV 的「主题标签」列只能重复「命中关键词」——实测两列逐字相同。
2. **设计文档与代码对 `SEARCH` 的处理相反**（见要害三后半）。文档状态还挂着「已评审（待实施）」，读者会以为已实现。
3. **品牌残留三处。** `package.json` 的 `name` 仍是 `chat-demo`、版本 `0.1.2`；构建出的 HTML 标题仍是「API 使用 demo」；产物里的 chunk 全局变量名是 `rspackChunkchat_demo`。用户下载 `dist/` 打开，浏览器标签写的是别人的产品名。
4. **需求文档的开放问题已成代码，文档没回填。** `docs/DeepSeek对话导出_开发需求文档.md` 列了 8 条「待确认」：其中「AND/OR 组合」「时间范围筛选」「标签策略」「多关键词命中记录」四条在 UI 与代码里都已经实现，文档仍是「待确认后进入设计阶段」。
5. **版本要求不可执行**：无 `engines`、无 `packageManager`（见要害一）。
6. **元数据小不一致**：仓库描述自称 `fork of deepseek-ai/chat-demo`，GitHub 的 `fork` 标记为 false（是独立建库、非 GitHub fork 关系）。语义上没错，API 上不一致。

---

## §6 公平起见：哪些值得留下

这份代码不是拼凑的，几处工程判断明显是想过的：

- **ZIP 解析自己写**（`zipReader.ts`）：不引 JSZip，逐块解压、边解边算 CRC、按条目大小与 CRC 双重校验，明确拒绝 ZIP64／加密／分卷，路径按 NFC 比较并校验分隔符。这类「宁可拒收也不猜」的写法，正是导入别人数据时该有的姿态。
- **导入用「暂存区 + 单事务替换」**：先写到 IndexedDB 暂存区，全部校验通过才在同一事务里替换既有数据，失败保留原记录，中断遗留的暂存在下次导入前清理。README 里那句「导入会替换全部本地会话」因此有底气。
- **父 id 必须小于子 id、根必须是提问**：把服务端 schema 的隐含约束显式化，重编号而不是照搬原 id。
- **类型与 lint 全绿**：`tsc` 在 strict + `noUnusedLocals` + `noImplicitReturns` 下 0 错，oxlint 127 文件 0 警告。
- **双轨分支治理**：`main` 纯镜像、`custom` 叠定制，配一个 `sync-upstream.ps1`（UTF-8 带 BOM，适配 PowerShell 5.1；rebase/merge 双模式、冲突自动回滚、`-DryRun`）。实测 `main` 的 SHA 与上游完全一致，这套约定是**真的在遵守**，不是写在文档里。
- **导入导出文档写到可交付程度**：`history/README.md` 60 行，覆盖归档顺序、降级策略、哪些东西不保留（API Key、设置、非图片附件原件、非当前分支），这类「说清楚不保留什么」的文档比功能列表有用。
- **搜索导出三格式**：CSV 加 BOM 与 CRLF（Excel 直接打开不乱码），JSONL 一行一条便于管道处理。

---

## §7 可靠性总表

| 层 | 内容 | 标注 |
| --- | --- | --- |
| 事实层 | 仓库元数据、分支 SHA、文件规模、依赖版本、engines | ★ 严格（API 与本地统计） |
| 部署层 | 安装、类型检查、lint、构建、dev server、静态托管的实际结果 | ★ 严格（沙箱实测，附数字） |
| 数据层 | 旧版解析、ZIP 路由、搜索导出、匹配语义 | ★ 严格（真函数真跑），唯匹配语义为半严格（复刻） |
| 模式层 | `pnpm build` 的真实模式来源、5 倍体积降级 | ★ 严格（探针三组 + 两种构建对照） |
| 界面层 | 页面渲染、交互、导入确认弹窗、移动端布局 | 未测（沙箱无浏览器） |
| 服务层 | 与 `api.deepseek.com` 的真实对话、附件上传、语音 | 未测（无 API Key，仅验 `/models` 返回 401） |
| 打开方式 | `file://` 直接打开 `dist/index.html` | 未测（无浏览器；静态检查为相对路径） |

---

## §8 读者手册

**想只是部署看看（三行）：**

```sh
curl -sL -o r.tgz https://codeload.github.com/skyboyhjj/deepseek-chat-manager/tar.gz/refs/heads/custom
tar xzf r.tgz && cd deepseek-chat-manager-custom
pnpm install && pnpm dev      # 打开 http://localhost:8090
```

国内网络建议给 `pnpm install` 加 `--registry=https://registry.npmmirror.com --fetch-timeout=300000`；若下载反复超时，加 `--network-concurrency=4` 降并发比加大超时更有效（本次实测：40 分钟失败 → 2 分 4 秒成功）。

**要当产品用，先改三处：**

1. `package.json`：`name`、`engines`（写 `^20.19.0 || >=22.12.0`）、`packageManager`；`build` 脚本换成 `cross-env` 或 `--mode production`。
2. `src/index.html`：`<title>` 还是「API 使用 demo」。
3. `history/legacy.ts` 的角色交替规则：改成「同角色时合并或记警告」，别再整枝丢弃。

**要导入旧对话，先备份：** 导入会**替换**全部本地会话。另外注意同角色连发会丢消息——导入后抽检几条「连问」的会话，确认回答还在。

**给读者的三句话：**

1. 构建能过、lint 干净、产物能开——这是一份**能用**的前端。
2. 但它的构建模式切换是「Windows 写法 + CLI 兜底」，换环境会静默出开发版；把它当发布流水线之前，先修那一行。
3. 它的旧版导入是「严格交替、否则丢枝」，不是「尽力兼容」；这正是最容易在你自己的数据上悄悄少东西的地方。
