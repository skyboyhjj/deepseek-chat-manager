# DSH 插件化 Phase 1 规划

> 目标：把 deepseek-chat-manager 的「旧版 ZIP 导入」能力，移植为 deepseek-harness（DSH）的一个插件。
> 状态：规划已评审，待实现。

---

## 0. 背景与目标

deepseek-chat-manager 的「旧版导入」能解析 DeepSeek 旧版导出的 `conversations.json`（ChatGPT 风格 `mapping` 消息树），归一化为会话数据。

本 Phase 目标：把这一能力做成 DSH 插件 `@deepseek-ai/dsh-deepseek-chat-import-legacy`，实现「旧版 ZIP → DSH 会话」。

## 1. 关键发现

DSH 仓库（默认分支 `master`，版本 `0.2.2-rc.5`）**已存在** `packages/experimental/deepseek-chat-import`（`@deepseek-ai/dsh-deepseek-chat-import`），实现了完整「DeepSeek 导出 ZIP → 会话」导入链路，但仅支持**新版导出**（`manifest.json` + `chat_sessions/*.json` 的 `fragments` 结构）。

因此 Phase 1 本质 = **照抄 `deepseek-chat-import` 的写入链路，只替换解析器**（把 `mapping` 树解析成 `SessionEvent[]`）。

## 2. DSH 关键机制（调研一手结论）

### 2.1 Session 是事件溯源 append-only 日志

`packages/core/session/src/types.ts`（`@deepseek-ai/dsh-session`）：

```ts
export const SESSION_FORMAT_VERSION = 4

export interface SessionHeader {
  readonly version: typeof SESSION_FORMAT_VERSION
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
}

// 事件类型（节选）
export interface SessionEventMap {
  'turn/start': { turn: number }
  'turn/end': { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }
  'user/message': UserMessage
  'assistant/message': { turn; step; message: AssistantMessage; stream; usage?; interrupted? }
  'tool/call': { turn; step; callId; name; arguments }
  'tool/result': { turn; step; message: ToolResultMessage; error?; meta? }
  'system/message': { turn; step; message: SystemMessage }
}

export type SessionEvent<T> = { type: T; seq: SessionSeq; time: number; data: SessionEventMap[T]; ignorable?: true }
```

- `seq` 从 0 连续，每条事件 JSON 可序列化。
- 消息历史从日志派生，不是直接存消息列表。

### 2.2 Session.fromRestore 契约

`packages/core/session/src/index.ts`（第 642 行）：

```ts
static fromRestore(id, seed: readonly SessionEvent[], header, inheritedEventCount, eventState, projections?): Session
```

### 2.3 SessionPersistence capability seam

`packages/session/session-persistence/src/index.ts`（`@deepseek-ai/dsh-session-persistence`）：

```ts
export abstract class SessionPersistence extends Service {
  constructor(ctx: Context) { super(ctx, 'sessionPersistence') }
  abstract create(header, options?): Promise<SessionHandle>
  abstract open(id, access, options?): Promise<SessionHandle>
  abstract flush(): Promise<void>
  abstract stat(id, options?): Promise<SessionPersistenceSnapshot | undefined>
  abstract list(options?): Promise<readonly SessionPersistenceSnapshot[]>
}
declare module '@deepseek-ai/cordis' {
  interface Context { sessionPersistence: SessionPersistence }
}
```

`SessionHandle`：`{ read(offset?, length?, options?), append(events, options?), flush(options?), close() }`，`AsyncDisposable`。

### 2.4 写入链路（照抄对象）

`packages/experimental/deepseek-chat-import/src/importer.ts` 的 `writeSession()`：

```ts
const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: conversion.createdAt, cwd, isSeeded: false }
Session.create(id, conversion.events, header)          // 种子校验（与 fromRestore 同套不变量）
const handle = await deps.persistence.create(header, { signal })
await handle.append(conversion.events)
await handle.flush()
await handle.close()
deps.projectionCache?.coldSnapshot(header, brandNumber<SessionLogOffset>(0), conversion.events)
```

### 2.5 插件最小结构

`name` + `Config`（schemastery schema）+ `async apply(ctx, config)`，内部 `ctx.plugin({ name, apply(ctx){ ... } })` 注册服务；`static inject = ['sessionPersistence', ...]` 注入能力。

## 3. 技术映射（旧版 `conversations.json` → `SessionEvent`）

| 旧版字段 | DSH 目标 |
| :--- | :--- |
| 会话 `inserted_at`（`+08:00`） | `SessionHeader.createdAt`（epoch ms） |
| 会话 `title` | 标题元数据 |
| `mapping` 树 `root` 节点 | 忽略（虚拟根，`message: null`） |
| `mapping` 树线性化（DFS 重编号、丢弃孤立节点） | 事件 `seq` 从 0 连续 |
| USER 消息（含 REQUEST 片段） | `turn/start` → `step/start` → `user/message` → `step/end` → `turn/end` |
| ASSISTANT 消息（RESPONSE/THINK/SEARCH） | `step/start` → `assistant/message` → `step/end` |
| 无 `role` 字段 | 复用 legacy 逻辑：`REQUEST→USER`、否则 `ASSISTANT`、同角色连发合并 |
| 旧版 `files[]`（无二进制） | 降级为元数据附件 |
| 时间戳 `+08:00` / SEARCH 的 UNIX 时间 | 统一转 epoch ms |

精确的 turn/step 边界与事件序列，实现时**照抄 `deepseek-chat-import` 的 `convertConversation()`**，仅替换「选分支 + 逐消息生成事件」为「mapping 树遍历」。

## 4. 工作分解（文件级）

| 步骤 | 文件 | 复用/新建 |
| :--- | :--- | :--- |
| 1 | `packages/experimental/deepseek-chat-import-legacy/`（新包） | 新建 |
| 2 | `src/conversation.ts`：旧版 `mapping` 树 → `ConvertedConversation { title, createdAt, events }` | 移植 deepseek-chat-manager `legacy.ts` 归一逻辑 |
| 3 | `src/importer.ts`：`Session.create` + `persistence.create→append→flush→close` | 照抄 `deepseek-chat-import` |
| 4 | `src/index.ts`：`DeepseekChatImportLegacyService`，`static inject=['typert','connection','sessionPersistence','workspaceRegistry']`，暴露 upload route | 照抄 |
| 5 | `package.json`：`@deepseek-ai/dsh-*` 命名、`type:module`、`bundle:tsdown`、peerDeps | 照抄约定 |

## 5. 已确认决策

1. **包形态**：新建独立包 `deepseek-chat-import-legacy`（`@deepseek-ai/dsh-deepseek-chat-import-legacy`）。
2. **触发方式**：通过 `upload route`（复用 `deepseek-chat-import` 的模式）暴露导入入口。

## 6. 生命周期与数据管理

### 6.1 核心设计原则

**插件无状态、数据有状态；数据与插件生命周期解耦。**

- 插件是「转换器 + 写入器」：把旧版 ZIP 解析成 `SessionEvent[]`，写入 DSH 会话持久化。
- 导入完成后插件不留运行态；数据落在 `SessionPersistence` 管理的存储。
- 卸载插件 ≠ 删除数据，重新安装后之前导入的会话仍在。

### 6.2 安装（加载）

1. 包作为 DSH monorepo 的 workspace 依赖（`pnpm`）安装。
2. 在 DSH 插件配置里声明启用（`name` + `Config`，Cordis 按 `name` 定位、按 `Config` schema 校验）。
3. 加载：解析 `static inject` → 调用 `apply(ctx, config)` → 校验 config → `ctx.plugin(...)` 挂载服务 → 注册 `upload route` → 服务就绪（`await service.await()`）。

### 6.3 使用（运行）

1. 用户经 `upload route` 上传旧版 ZIP。
2. 解析 `conversations.json`（mapping 树）→ `SessionEvent[]`。
3. 经注入的 `ctx.sessionPersistence` 写会话（`create → append → flush → close`）。
4. 会话进入 DSH 会话列表，可继续对话 / 检索，与其它来源会话无差别。

### 6.4 卸载（dispose）

1. 配置里禁用插件（或运行时 dispose）。
2. Cordis 触发 Fiber 作用域清理（`ctx.effect(function*(){ ... })` + `yield dispose` 模式）：注销 `upload route`、卸载子插件服务、关闭未关闭的 `SessionHandle`、清理 tracker。
3. 按注册逆序执行，保证无泄漏（打开的 handle 先 `close()`）。

### 6.5 数据管理

| 维度 | 说明 |
| :--- | :--- |
| 归属 | 会话数据归 `SessionPersistence` 管理，不归插件自身 |
| 存储 | `SessionPersistence` 的 `root` 目录，`session-v4.jsonl.zstd`（或 `.jsonl`），首行 header + 逐行事件 |
| 写入 | 插件导入时 `create → append → flush → close`，事件 `seq` 连续、append-only |
| 读取 | DSH 打开会话时经 `open(id) → handle.read()` |
| 删除 | 经 `SessionPersistence` 接口（或 `stat/list` 后清理文件），与插件卸载无关 |
| 幂等 | 重复导入同一 ZIP 新建会话（不同 `id`），由 `SessionHeader.id` 区分，不覆盖旧数据 |

### 6.6 生命周期一览

```
安装： 声明启用 → 注入依赖 → apply() → 注册服务+route → 就绪
  │
使用： 上传 ZIP → 解析 mapping 树 → 写 SessionPersistence → 会话可见
  │
卸载： 禁用插件 → Fiber dispose → 注销 route/服务/handle → 内存清理
  │
数据： 独立于插件，落在 SessionPersistence 存储，卸载不删、重装仍在
```

## 7. 里程碑

- **M1**：解析器——旧版 `conversations.json` → `SessionEvent[]`（用真实旧版 ZIP 对拍验证）。
- **M2**：写入链路——复用 `SessionPersistence` 把事件写入会话。
- **M3**：服务接入——upload route 暴露导入入口。

## 8. 参考文件清单（DSH 侧关键路径）

| 用途 | 路径 |
| :--- | :--- |
| Session 类型 | `packages/core/session/src/types.ts` |
| Session.fromRestore / Session.create | `packages/core/session/src/index.ts` |
| SessionPersistence seam | `packages/session/session-persistence/src/index.ts` |
| JSONL 持久化实现 | `packages/session/session-persistence-jsonl/src/index.ts`、`format.ts` |
| 会话格式 catalog | `packages/session/session-format/src/types.ts` |
| **照抄参照（写入链路）** | `packages/experimental/deepseek-chat-import/src/{conversation,importer,index}.ts` |
