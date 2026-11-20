/**
 * v3 归档 -> canonical 转换（与 Python 工具包 parsers.py 的 v3_parser 归一规则一致）。
 *
 * 正文只认 REQUEST / RESPONSE，THINK 单独进 think，富媒体进 attachments / references，
 * 服务端提示类（TEMPLATE_RESPONSE / TIP / CONTENT_RISK / PARTIAL_FILE_READ）进 meta，
 * 未知片段类型直接丢弃（best-effort 片段级容错）。
 */

import type {
  CanonicalAttachment,
  CanonicalMessage,
  CanonicalReference,
  CanonicalRole,
  CanonicalSession,
} from './canonical.js'
import type { ChatMessage, FileEntry, SessionFile } from './format.js'

const toRole = (role: ChatMessage['role']): CanonicalRole =>
  role === 'USER' ? 'user' : 'assistant'

const toAttachment = (file: FileEntry): CanonicalAttachment => ({
  id: file.id,
  fileName: file.file_name,
  fileSize: file.file_size,
  isImage: file.is_image,
  mimeType: '',
  exportPath: file.export_path,
  width: file.width,
  height: file.height,
})

/** 单个 v3 消息 -> canonical 消息。 */
export function messageToCanonical(message: ChatMessage): CanonicalMessage {
  const textParts: string[] = []
  const thinkParts: string[] = []
  const attachments: CanonicalAttachment[] = []
  const references: CanonicalReference[] = []
  const serverNotices: unknown[] = []

  const pushReference = (reference: CanonicalReference) => references.push(reference)

  for (const fragment of message.fragments) {
    switch (fragment.type) {
      case 'REQUEST':
      case 'RESPONSE':
        if (fragment.content) {
          textParts.push(fragment.content)
        }
        break
      case 'THINK':
        if (fragment.content) {
          thinkParts.push(fragment.content)
        }
        break
      case 'FILE':
        for (const file of fragment.files) {
          attachments.push(toAttachment(file))
        }
        break
      case 'TOOL_SEARCH':
        for (const result of fragment.results) {
          pushReference({
            kind: 'search',
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            siteName: result.site_name,
            publishedAt: result.published_at,
          })
        }
        break
      case 'TOOL_OPEN':
        if (fragment.url || fragment.title) {
          pushReference({
            kind: 'open_page',
            url: fragment.url,
            title: fragment.title,
            snippet: fragment.snippet ?? null,
            siteName: fragment.site_name ?? null,
            publishedAt: fragment.published_at,
          })
        }
        break
      case 'TOOL_FIND':
        pushReference({
          kind: 'find',
          url: null,
          title: fragment.pattern ?? null,
          snippet: null,
          siteName: null,
          publishedAt: null,
        })
        break
      case 'READ_LINK':
        for (const result of fragment.results) {
          pushReference({
            kind: 'read_link',
            url: result.url ?? null,
            title: result.title ?? null,
            snippet: null,
            siteName: null,
            publishedAt: null,
          })
        }
        break
      case 'TOOL_IMAGE_SEARCH':
        for (const result of fragment.results) {
          pushReference({
            kind: 'image_search',
            url: result.source_page_url,
            title: result.title,
            snippet: result.snippet,
            siteName: result.site_name,
            publishedAt: result.published_at,
          })
        }
        break
      case 'TEMPLATE_RESPONSE':
      case 'TIP':
      case 'CONTENT_RISK':
      case 'PARTIAL_FILE_READ':
        serverNotices.push(fragment)
        break
      default:
        // 未知片段类型：丢弃（best-effort，未来版本新增类型不阻断正文导出）。
        break
    }
  }

  const meta: Record<string, unknown> = {
    thinking_enabled: message.thinking_enabled,
    search_enabled: message.search_enabled,
  }
  if (serverNotices.length > 0) {
    meta.server_notices = serverNotices
  }

  return {
    id: String(message.id),
    parentId: message.parent_id === null ? null : String(message.parent_id),
    role: toRole(message.role),
    timestamp: message.inserted_at,
    text: textParts.join('\n').trim(),
    think: thinkParts.join('\n').trim(),
    status: message.status,
    attachments,
    references,
    meta,
  }
}

/** 单个 v3 会话 -> canonical 会话。 */
export function sessionToCanonical(file: SessionFile): CanonicalSession {
  return {
    id: file.id,
    title: file.title ?? '',
    pinned: file.pinned,
    createdAt: file.inserted_at,
    updatedAt: file.updated_at,
    currentMessageId: String(file.current_message_id),
    messages: file.messages.map(messageToCanonical),
  }
}
