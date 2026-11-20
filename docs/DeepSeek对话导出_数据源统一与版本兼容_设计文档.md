# DeepSeek 对话导出 — 数据源统一与版本兼容 设计文档

> 版本：v1.1
> 状态：已评审（已实施）
> 关联文档：[开发需求文档](./DeepSeek对话导出_开发需求文档.md)

---

## 一、背景与目标

当前存在两套数据源、两套独立解析逻辑，各自只认一种格式：

| 数据源 | 解析方 | 格式特征 |
|---|---|---|
| `conversations.json`（旧导出） | Python 工具包 `E:\Trac Project\deepseek_export\` | 顶层 `conversations[]`，每项 `{title, mapping{id→message.fragments[]}}`，`fragment.type` = REQUEST/RESPONSE/TEXT |
| v3 ZIP（`deepseek_data-*.zip`） | chat-demo `src/services/chat/history/` | `manifest.json`（`export_format_version=3`）+ `chat_sessions/{id}.json`（消息树）+ `chat_session_index.json` |

**目标**：
1. 定义一套**版本无关的统一中间数据模型（canonical）**，两侧各写 adapter 把原始格式转成它，检索/统计/导出全部基于 canonical。
2. 建立**版本兼容层**，支持 DeepSeek 后续升级导出格式后，老工具仍可降级解析。

**非目标**：本次不改导出物格式（MD/CSV/TXT）、不改检索/打标签语义、不引入新的持久化。

---

## 二、已确认决策

| 编号 | 决策 | 结论 |
|---|---|---|
| D1 | THINK 思考链是否纳入检索/统计 | **不纳入**。检索/统计只用用户+助手正文；THINK 单独存放、可导出、不进检索 |
| D2 | 高于当前支持版本时 | **best-effort 尽力解析**，不拒绝，丢弃无法识别的新片段类型，保留正文与消息树 |
| D3 | 标签配置 | 单一事实来源一份 `tag_map.json`，两侧共享 |

---

## 三、统一中间数据模型（canonical）

canonical 是内存模型，不做跨语言落盘（Python 离线批量、chat-demo 前端交互，各自转 canonical 后各用各的）。字段语义对齐即可，命名遵循各语言约定（Python snake_case，TS camelCase）。

### 3.1 字段语义表

| 语义字段 | 类型 | 可空 | 说明 |
|---|---|---|---|
| `source_version` | int | 否 | 记录原始数据来自哪个导出格式版本 |
| `sessions` | list | 否 | 会话列表 |
| `session.id` | string | 否 | 会话唯一标识 |
| `session.title` | string | 否 | 标题（空则兜底「无标题」） |
| `session.pinned` | bool | 否 | 置顶标记 |
| `session.created_at` | ISO8601 | 是 | 旧格式无 |
| `session.updated_at` | ISO8601 | 是 | 旧格式无 |
| `session.current_message_id` | string | 是 | 线性化入口，旧格式无 |
| `session.messages` | list | 否 | 消息数组（已线性化） |
| `message.id` | string | 否 | 消息唯一标识 |
| `message.parent_id` | string | 是 | 父消息，null 表示会话首条 |
| `message.role` | enum | 否 | `user` / `assistant` |
| `message.timestamp` | ISO8601 | 是 | 旧格式无 |
| `message.text` | string | 否 | **正文纯文本**，检索/统计/导出唯一依据 |
| `message.think` | string | 否 | THINK 思考链文本，独立存放，不混入 text |
| `message.status` | string | 是 | 供选择性导出做脏数据过滤 |
| `message.attachments` | list | 否 | 附件（FILE 片段归一），字段定义见第九节 |
| `message.references` | list | 否 | 搜索/打开/图搜/链接等引用来源，字段定义见第九节 |
| `message.meta` | object | 否 | thinking_enabled / search_enabled / token 等扩展字段 |

### 3.2 归一规则（两侧 adapter 必须一致）

| 原始类型 | 出现格式 | canonical 归属 | 说明 |
|---|---|---|---|
| `REQUEST` | 两格式 | `text`（role=user） | 正文 |
| `RESPONSE`（v3）/ `TEXT`（旧） | 两格式 | `text`（role=assistant） | 正文 |
| `THINK` | 两格式 | `think` | 不进检索，见第九节 |
| `FILE` | 两格式 | `attachments[]` | 图片/非图片附件，见第九节 |
| `SEARCH` | 仅旧 | 丢弃 | v3 已废弃，旧格式实测 316 条且 `results` 为空 → 直接丢弃 |
| `TOOL_SEARCH` | 两格式 | `references[]`（kind=search） | 两格式字段不同（见第九节） |
| `TOOL_OPEN` | 两格式 | `references[]`（kind=open_page） | 旧格式可能缺字段 |
| `TOOL_FIND` | 两格式 | `references[]`（kind=find） | |
| `READ_LINK` | 仅 v3 | `references[]`（kind=read_link） | |
| `TOOL_IMAGE_SEARCH` | 仅 v3 | `references[]`（kind=image_search） | 图搜 |
| `TEMPLATE_RESPONSE` / `TIP` / `CONTENT_RISK` / `PARTIAL_FILE_READ` | 仅 v3 | `meta` | 服务端提示类，不进 text |

> 检索口径仅认 `REQUEST / RESPONSE / TEXT` 三个稳定类型，保证新旧格式统计口径一致（如「813 条」回归可对齐）。富媒体类型一律不进 text。

---

## 四、版本兼容层

### 4.1 检测路由

```
detect(input)
  ├─ .zip ──► 读 manifest.json 的 export_format_version ──► 路由 PARSERS[version]
  └─ .json ──► 顶层含 conversations 键 ──► v1（旧 conversations.json）
               └─ 其余 ──► unknown，报错
```

### 4.2 parser 注册表

每个版本一个 parser，统一接口 `parse(input) -> CanonicalArchive`：

| parser | 输入 | 说明 |
|---|---|---|
| `v1_parser` | 旧 `conversations.json` | 扁平遍历 `mapping` 全部 message，保持现有 863 条遍历口径 |
| `v3_parser` | 当前 v3 ZIP | 读 `chat_sessions/*.json` + `chat_session_index.json` |
| `v4/v5...` | 未来版本 | 按需新增，默认先走 best-effort |

> **chat-demo 侧已实施**：旧版 ZIP 导入由 `src/services/chat/history/legacy.ts` 实现——识别 ZIP 内无 `manifest.json`、直接含 `conversations.json`；将 `mapping` 树前序 DFS 重编号（父 ID 恒小于子 ID）、丢弃不可达孤立节点、按树结构交替推断角色（根默认用户）、沿 `root.children` 选 ID 最大子节点链作为 `current_message_id`、时间 `+08:00→Z` 归一、`SEARCH→TOOL_SEARCH`、`files[]` 降级为元数据附件，归一为 v3 `SessionFile` 后复用 `toLocalSession` + `addStagingSession` 管线。

### 4.3 降级策略（核心）

沿用 v3 `schema.ts` 已有思路 —— **容器/元数据严格，片段级容错**：

- `manifest.export_format_version` **大于**当前支持的最高版本 → **不拒绝**，标记 `source_version` 并进入 best-effort，仅提示「来自更新版本」。
- 未知 fragment type → 丢弃该片段，不影响同消息其他片段；正文只认 `REQUEST/RESPONSE/TEXT`。
- 未知顶层字段 → 忽略。
- 关键字段缺失（`messages` / `session.id`）→ 丢弃整会话，记录警告。

> 只要 DeepSeek 升级后不改变正文片段（REQUEST/RESPONSE/TEXT）的语义，老工具即可正常导出正文与消息树。

---

## 五、共享 tag-map

单一事实来源一份 `tag_map.json`，由 Python 工具包现有 `config.py` 的 `KEYWORD_GROUPS` 抽出：

```json
{
  "schema_version": 1,
  "groups": {
    "道境坐标系": {
      "keywords": ["道境坐标系", "道境空间坐标系", "时位", "宇位", "识位", "缘位", "四维坐标", "四维分析"],
      "tag_mapping": {
        "时位": "时位轴（熵流脉动）",
        "宇位": "宇位轴（能量涟漪）",
        "识位": "识位轴（觉知光锥）",
        "缘位": "缘位轴（因果纠缠）"
      },
      "default_tag": "道境坐标系（总纲）"
    },
    "二十七章": {
      "keywords": ["善行无辙迹", "善言无瑕谪", "善数不用筹策", "善闭", "善结", "袭明", "虽智大迷", "要妙", "不贵其师", "不爱其资"],
      "tag_mapping": {},
      "default_tag": "道德经二十七章"
    }
  }
}
```

- Python 侧：`config.py` 改为加载 `tag_map.json`，代码内保留默认值作 fallback。
- chat-demo 侧：构建时引用同一份（复制或软链），前端按组渲染。

---

## 六、落点与文件改动清单

### 6.1 Python 工具包 `E:\Trac Project\deepseek_export\`

| 文件 | 动作 | 内容 |
|---|---|---|
| `canonical.py` | 新增 | canonical 数据类定义 |
| `parsers.py` | 新增 | `v1_parser` / `v3_parser` + 注册表 |
| `detect.py` | 新增 | 检测路由 + best-effort 降级 |
| `tag_map.json` | 新增 | 共享标签配置（单一事实来源） |
| `core.py` | 改 | `search` / `statistics` 改为消费 canonical |
| `config.py` | 改 | `KEYWORD_GROUPS` 移入 `tag_map.json`，改为加载 |

### 6.2 chat-demo `E:\00-ds-chat-demo\src\services\chat\history\`

| 文件 | 动作 | 内容 |
|---|---|---|
| `canonical.ts` | 新增 | canonical 类型定义 |
| `adapter-v3.ts` | 新增 | v3 → canonical 转换 |
| `importArchive.ts` | 改 | 版本检测改为「注册表路由 + best-effort」 |
| tag-map | 引用 | 加载共享 `tag_map.json` |

---

## 七、实施顺序与回归验收

1. 冻结 canonical 模型 + `tag_map.json` schema（即本文档）。
2. Python 侧实现 adapter / parser / router，重构 `core.py`。
   - **回归验收**：`--group 道境坐标系 --stat` 输出总 813 条、时位 407、道境坐标系 138（D1 剔除 THINK 后的实测口径）。
3. chat-demo 侧实现 canonical + adapter-v3 + 降级路由。
   - **回归验收**：v3 ZIP 正常导入，会话数/消息数与源一致。
4. 构造「未来版本样本」（`export_format_version=4` + 新增未知 fragment type），验证 best-effort 仍能导出正文与消息树。

---

## 八、风险与边界

- **旧格式消息顺序**：`mapping` 是 JSON 对象，`v1_parser` 依赖其插入顺序做线性化；若未来 DeepSeek 旧导出含显式 children 树，需在 v1_parser 内补充树重建逻辑（本次不做，保持现有口径）。
- **canonical 不落盘**：两侧各自在内存转 canonical，不引入新的序列化格式，避免额外契约成本。

---

## 九、附件与图表等富媒体数据类型的处理原则与解决方案

> 本节为追加章节，覆盖正文（REQUEST/RESPONSE/TEXT）与思考链（THINK）之外的所有非文本数据类型：附件、图片、图表文件、搜索/图搜/链接等引用来源。

### 9.1 类型盘点与两格式差异（实测）

对旧 `conversations.json`（484 会话）实测的 fragment type 分布，与 v3 格式定义对照：

| 类型 | 旧格式 | v3 格式 | 差异要点 |
|---|---|---|---|
| `FILE` | 486 条 | 有 | 旧：`{file_id, file_name, file_size}`，**无 is_image/export_path/尺寸**；v3：`{id, file_name, file_size, token_usage, inserted_at, export_path, is_image, width, height}` |
| `SEARCH` | 316 条 | **无（已废弃）** | 旧独占，`results` 实测为空 → 直接丢弃 |
| `TOOL_SEARCH` | 810 条 | 有 | 旧结果仅 `{url, title}`；v3 多 `snippet/published_at/site_name/site_icon` + `queries/status` |
| `TOOL_OPEN` | 2902 条 | 有 | 旧可能为空对象/缺 `url`；v3 有 `status/url/title/...` |
| `TOOL_FIND` | 125 条 | 有 | 结构相近 |
| `READ_LINK` | 无 | 有 | v3 独占 |
| `TOOL_IMAGE_SEARCH` | 无 | 有 | v3 独占（图搜） |
| `TIP` / `CONTENT_RISK` / `TEMPLATE_RESPONSE` / `PARTIAL_FILE_READ` | 无 | 有 | v3 独占（服务端提示类） |

> 结论：富媒体类型是**高频变更**的字段区，同类型跨版本字段不同、类型有增有删。这正是版本兼容层必须对富媒体做「字段级容错」的根本原因。

### 9.2 处理原则（六条）

1. **正文与富媒体彻底分离**：`text` 只承载可检索正文；附件、搜索、图搜、链接一律进 `attachments` / `references`，绝不混入 `text`。
2. **附件图片与非图片区别对待**：图片是二进制本体（v3 在 ZIP 内、旧格式无本体）；非图片附件（文档/表格/图表数据文件）两格式都只有元数据，本体永远不在导出物里。
3. **引用来源只存元数据、不抓取本体**：搜索/图搜/链接结果只保留 URL/title/snippet/站点等元数据，不抓取远程内容（隐私 + 稳定性）。
4. **导出落点分层**：纯文本格式（MD/CSV/TXT）只承载「引用 + 元数据」，不内嵌二进制；完整二进制保真仅在 ZIP 导出（chat-demo）实现。
5. **字段级容错**：同类型跨版本字段差异由各 adapter 归一（缺失置空）；未知富媒体类型降级处理，不阻断正文导出。
6. **隐私脱敏可选**：搜索/图搜结果含外部 URL、站点名、分享链接，导出提供脱敏开关。

### 9.3 canonical 扩展结构

```
CanonicalAttachment           # 附件（FILE 片段归一）
  id            string        # 旧 file_id 与 v3 id 统一归一到此
  file_name     string
  file_size     number
  is_image      bool          # v3 直接取；旧格式缺省，按扩展名启发式推断
  mime_type     string        # 图片导入后补全；非图片/旧格式为空
  export_path   string|null   # 图片在 ZIP 的条目路径；非图片/旧格式为 null
  width/height  number|null   # 可空

CanonicalReference            # 搜索/打开/图搜/链接等引用来源
  kind          string        # search | open_page | find | read_link | image_search
  url           string|null
  title         string|null
  snippet       string|null
  site_name     string|null
  published_at  string|null
```

### 9.4 图表/图片文件的识别

旧格式 `FILE` 无 `is_image`，需靠 `file_name` 扩展名做启发式判定：

- **图片/图表图**：`.png .jpg .jpeg .gif .webp .bmp .tiff .avif .svg` → `is_image=true`
- **数据表格/图表源文件**：`.xlsx .xls .csv .tsv` 等 → `is_image=false`（非图片附件，仅元数据）
- **其他文档**：`.docx .pdf .txt .md` 等 → `is_image=false`

> 与 v3 `imageType()`（读文件头魔数判定 MIME）互补：旧格式无本体，只能扩展名兜底；v3 有本体则用魔数精确判定。

### 9.5 导出落点方案（分层）

| 导出格式 | 附件图片 | 非图片附件 | 引用来源（搜索/图搜/链接） |
|---|---|---|---|
| **MD** | 本体不落盘，显示 `[图片: name]` 占位 + 元数据（文件名/尺寸） | 元数据列表（文件名/大小） | 附录「引用来源」章节，列 URL/标题/摘要 |
| **CSV** | 附件明细列：文件名/大小/是否图片/路径/尺寸 | 同左 | 引用列：URL/标题/站点（受脱敏开关控制） |
| **TXT** | 占位文本 `[图片: name]` | 元数据一行 | `[引用] title (url)` 一行 |
| **ZIP**（chat-demo 保真） | 本体随 `chat_sessions/{id}_files/` 打包 | 仅元数据（DeepSeek 约定） | 保留完整结构化 fragment |

### 9.6 隐私脱敏

搜索/图搜/链接结果含外部 URL、站点名与分享链接，可能泄露浏览记录。脱敏开关（默认**开**）行为：

- **保留**：title、snippet 摘要（供内容定位）
- **剔除/置空**：`url`、`site_name`、`published_at`（定位到人的痕迹）

### 9.7 富媒体版本兼容（降级）

- 已知富媒体类型：按字段级容错提取，缺失字段置 `null`，不影响同消息其他片段。
- 未知富媒体类型（未来新增）：不阻断正文导出，默认丢弃；如需保真可配置透传原始 JSON 到 `meta.raw_fragments`。
- 同类型字段差异（`file_id` vs `id`、`TOOL_SEARCH` 结果字段）由各 adapter 归一，不进入兼容层职责。

### 9.8 已确认决策

| 编号 | 事项 | 结论 |
|---|---|---|
| E1 | 旧格式 `SEARCH`（316 条，`results` 实测为空） | 直接丢弃，不归一为 references |
| E2 | MD 导出图片 | 本体不落盘，仅占位 + 元数据 |
| E3 | 脱敏开关默认值 | 默认「开」，剔除 URL / 站点名 / 发布时间 |
| E4 | 图表数据文件（`.xlsx/.csv`） | 仅列元数据，不展开表格内容 |
