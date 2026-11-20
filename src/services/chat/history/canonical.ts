/**
 * canonical 统一中间数据模型（版本无关）。
 *
 * 与 Python 工具包 canonical.py 字段语义对齐，命名遵循 TS camelCase。
 * 各版本 adapter（adapter-v3.ts）把原始格式转成它，检索/统计/导出统一基于 canonical。
 * 归一规则见 docs/DeepSeek对话导出_数据源统一与版本兼容_设计文档.md 第三节：
 * 正文只认 REQUEST/RESPONSE/TEXT，THINK 单独存放不进 text，富媒体进 attachments/references。
 */

/** 附件（FILE 片段归一）。 */
export type CanonicalAttachment = {
  /** 旧 file_id 与 v3 id 统一归一到此 */
  id: string
  fileName: string
  fileSize: number
  /** v3 直接取；旧格式按扩展名启发式推断 */
  isImage: boolean
  /** 图片导入后补全；非图片/旧格式为空 */
  mimeType: string
  /** 图片在 ZIP 的条目路径；非图片/旧格式为 null */
  exportPath: string | null
  width: number | null
  height: number | null
}

/** 搜索/打开/图搜/链接等引用来源。 */
export type CanonicalReferenceKind =
  | 'search'
  | 'open_page'
  | 'find'
  | 'read_link'
  | 'image_search'

export type CanonicalReference = {
  kind: CanonicalReferenceKind
  url: string | null
  title: string | null
  snippet: string | null
  siteName: string | null
  publishedAt: string | null
}

export type CanonicalRole = 'user' | 'assistant'

export type CanonicalMessage = {
  id: string
  parentId: string | null
  role: CanonicalRole
  timestamp: string | null
  /** 正文纯文本，检索/统计/导出唯一依据 */
  text: string
  /** THINK 思考链，独立存放，不进检索 */
  think: string
  status: string | null
  attachments: CanonicalAttachment[]
  references: CanonicalReference[]
  /** thinking_enabled / search_enabled / token 等扩展字段 */
  meta: Record<string, unknown>
}

export type CanonicalSession = {
  id: string
  title: string
  pinned: boolean
  createdAt: string | null
  updatedAt: string | null
  currentMessageId: string | null
  messages: CanonicalMessage[]
}

export type CanonicalArchive = {
  /** 记录原始数据来自哪个导出格式版本 */
  sourceVersion: number
  sessions: CanonicalSession[]
  /** 降级/丢弃告警 */
  warnings: string[]
}
