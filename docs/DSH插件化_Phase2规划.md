# DSH 插件化 Phase 2 规划

> 目标：在 DSH 里，让「新版导入」与「旧版导入」通过统一入口兼容共存。
> 状态：规划已评审，待实现（依赖 Phase 1 的 legacy 解析器）。

---

## 0. 背景与目标

Phase 1 交付 `@deepseek-ai/dsh-deepseek-chat-import-legacy`，把旧版 `conversations.json`（`mapping` 树）解析为 `SessionEvent[]` 并写入 DSH 会话。

Phase 2 在此基础上，让「新版导入」（`@deepseek-ai/dsh-deepseek-chat-import`，支持 `manifest.json` + `fragments`）与「旧版导入」**通过统一入口兼容共存**：用户上传任意版本 ZIP，自动识别并正确导入，无需自判版本。

## 1. 共存的核心问题

| 问题 | 说明 |
| :--- | :--- |
| ① 格式自动识别 | 区分新版 vs 旧版 ZIP |
| ② 统一入口 | 一个 upload route 路由到正确解析器 |
| ③ 数据一致性 | 两者写相同的 `SessionEvent`/`SessionPersistence`，天然共存 |

## 2. 格式识别方案

| 判断依据 | 判定 |
| :--- | :--- |
| ZIP 含 `manifest.json`（含 `export_format_version`） | 新版 |
| ZIP 含 `conversations.json`（无 `manifest`） | 旧版 |
| 两者皆无 | 报错「不支持的格式」 |

识别逻辑读 ZIP 条目列表即可（列出文件名，无需解压全部），与 deepseek-chat-manager 侧 `isLegacyArchive` 思路一致。

## 3. 架构方案（已确认）

**方案 A：统一入口 + 自动识别路由**，新建独立包 `deepseek-chat-import-router`（`@deepseek-ai/dsh-deepseek-chat-import-router`）。

- 一个 import 服务：`detect(file)` → 路由到「fragments 解析器」（新版）或「mapping 解析器」（旧版）。
- 用户无感知，体验最好。
- 不改造现有 `deepseek-chat-import`，职责清晰、与 Phase 1「独立包」思路一致。

## 4. 解析器抽象

```ts
interface ArchiveConverter {
  detect(file: File): 'v3' | 'legacy' | 'unknown'
  convert(file: File): ConvertedConversation[]  // { title, createdAt, events: SessionEvent[] }
}
```

- 新版 converter：包装现有 `deepseek-chat-import` 的 `convertConversation`；
- 旧版 converter：Phase 1 的 legacy 解析器（mapping 树 → SessionEvent）。

两者 `detect` 结果互补、互斥，保证一个 ZIP 只被一个解析器处理。

## 5. 工作分解（文件级）

| 步骤 | 内容 | 复用/新建 |
| :--- | :--- | :--- |
| 1 | 定义 `ArchiveConverter` 接口 + `detectArchiveType` | 新建 |
| 2 | legacy converter（复用 Phase 1 mapping 解析器） | 复用 Phase 1 |
| 3 | v3 converter（包装 deepseek-chat-import） | 复用现有 |
| 4 | 统一入口服务：detect → 路由 → 写 SessionPersistence | 新建 |
| 5 | 共存测试：新版 ZIP + 旧版 ZIP 同入口导入 | 新建 |

## 6. 与 Phase 1 的关系

Phase 1 交付 legacy 解析器（mapping → SessionEvent），是 Phase 2 的前置。Phase 2 叠加「识别 + 统一入口 + 共存」，可顺序实施或合并推进。

## 7. 里程碑

- **M1**：`detectArchiveType` 格式识别模块（两种 ZIP 对拍）。
- **M2**：统一入口 + 路由（一个 upload route 处理两种格式）。
- **M3**：共存测试（新/旧 ZIP 混传，数据层一致、互不干扰）。

## 8. 已确认决策

1. **入口形态**：统一入口 + 自动识别路由（方案 A）。
2. **包形态**：新建独立包 `deepseek-chat-import-router`（`@deepseek-ai/dsh-deepseek-chat-import-router`），不改造现有 `deepseek-chat-import`。
