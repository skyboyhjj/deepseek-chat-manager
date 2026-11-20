# 将 deepseek-chat-manager 升级为 DSH 插件的可行性评估

**评估日期**：2026-11-20
**状态**：已评估，待启动（后续 Task）
**关联宪法**：第十条 外挂增强原则（本方案是从「fork 二开」转向「外挂插件」的路径）

---

## 一、结论

**可行，且落点清晰——但正确形态是「能力移植」，不是「整个应用变成插件」。**

deepseek-chat-manager 是官方 chat-demo 的 fork（独立静态前端）；DSH（deepseek-harness）是**另一个** TypeScript monorepo，基于 **Cordis 微内核 + 插件架构**。所谓「升级为 DSH 插件」，本质是把 deepseek-chat-manager 的二开增量能力（全局搜索导出、旧版 ZIP 导入、会话选择性导出）**重新实现为 DSH 生态里的 cordis 插件**，而非把 chat-demo 的 React 应用塞进去。

## 二、DSH 插件机制（调研结论）

| 维度 | 现状 |
| :--- | :--- |
| 框架 | Cordis（`Context` / `Service` / `inject` / `ctx.plugin()` / Fiber 生命周期 / 事件系统） |
| 扩展点① | **Command surface**：`command.register`，支持 leadingInput / popupSelect / execute 三种形态，以 `sessionId` 投影 |
| 扩展点② | **Layered SkillRegistry**：`registerProvider()` / `register()` 按 scope 注册，全局层 + scope 层合并读取 |
| 扩展点③ | **SessionPersistence capability seam**：`create/open/stat/list/flush` 抽象，已有 `dsh-session-persistence-jsonl` 实现 |
| 扩展点④ | filesystem / bash subprocess 等 capability seam |
| 分发 | monorepo `packages/<group>/<pkg>/`，包名 `@deepseek-ai/dsh-*`，group 区分 core/llm/bash/session-persistence/ui/support |

## 三、能力 → 插件落点映射

| deepseek-chat-manager 二开能力 | DSH 插件落点 | 契合度 |
| :--- | :--- | :--- |
| 旧版 `conversations.json`（mapping 树）导入 | **SessionPersistence seam 的 restore 侧**（已有 `large-session-jsonl-restore-pipeline`：JSONL → `Session.fromRestore`） | ★★★ 高 |
| 全局搜索导出（OR/AND/粒度/日期/MD·CSV·JSONL） | **SkillRegistry + Command surface**（注册「搜索导出」技能/命令） | ★★☆ 中高 |
| 会话级选择性导出 | SessionPersistence 的 `list/flush` 导出侧 | ★★★ 高 |

## 四、关键契合点（为什么可行）

1. **同语言**：两边都是 TypeScript，天然兼容，无跨语言桥接成本。
2. **canonical 思想一致**：deepseek-chat-manager 的「canonical 中间模型」与 DSH 的 `SessionEvent` / `Session.fromRestore` 归一化思路**同源**，数据层可平滑对齐。
3. **接缝现成**：DSH 已有 SessionPersistence seam 和 JSONL restore pipeline，「旧版导入」无需自建基础，只需加一个「旧版 conversations.json → SessionEvent」的 adapter。

## 五、挑战与成本

1. **UI 层不可复用**：chat-demo 的 React 组件（GlobalSearchDialog 等）无法直接进 DSH 的 web shell，需按 command/skill 机制重写入口。
2. **数据映射是核心工作**：需把旧版 `mapping` 树 → `SessionEvent`（而非 v3 的 `SessionFile`），要深入对齐 DSH 的 `SessionEvent` / `Session.fromRestore` 契约。
3. **包规范重构**：需按 `packages/<group>/<pkg>/` + `@deepseek-ai/dsh-*` 拆分。
4. **fork 存量如何处置**：现有 deepseek-chat-manager 是能跑的产品，插件化是「另起一份实现」，短期内是并行维护，不是无缝迁移。

## 六、分阶段路径建议

- **Phase 1（价值验证）**：把「旧版 ZIP 导入」做成第一个 DSH 插件——`@deepseek-ai/dsh-session-import-legacy`，实现 `conversations.json → SessionEvent` adapter，接入 SessionPersistence restore 侧。
- **Phase 2（搜索导出）**：`@deepseek-ai/dsh-session-search-export`，走 SkillRegistry + Command。
- **Phase 3（UI 集成）**：按 DSH web shell 的 command surface 做交互入口。

## 七、宪法意义

这一步若落地，将**从根本上消除**宪法自查发现的唯一实质偏离——「第十条 外挂增强原则 vs fork」。插件形态不入侵宿主核心、可独立开关、随时回退，**完全对齐宪法第十条**。

---

**后续 Task**：启动 Phase 1 前，需先深入 DSH 的 `SessionEvent` 契约与 `Session.fromRestore` 定义，产出「旧版 conversations.json → SessionEvent」的字段级映射方案。
