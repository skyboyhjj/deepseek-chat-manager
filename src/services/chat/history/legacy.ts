/**
 * 旧版本（pre-v3）导出格式解析：conversations.json 里的 ChatGPT 风格 mapping 树，
 * 归一化为 v3 SessionFile 后复用 toLocalSession 导入管线。
 *
 * 旧版与 v3 的关键差异：
 * - 无 manifest.json，单文件 conversations.json（顶层数组）；
 * - 消息树是 mapping（含 root 虚拟节点），节点 id 为数字字符串且可能有空洞；
 * - 消息无 role/status/thinking_enabled/search_enabled/accumulated_token_usage；
 * - fragment 仅 REQUEST / RESPONSE / SEARCH / THINK 四类；
 * - 文件无二进制，只有 id / file_name / content（OCR 或文本），content 不导入；
 * - 时间戳为 +08:00 偏移，SEARCH 结果的 published_at 是 UNIX 秒。
 */

import { fail } from './errors.js'
import type {
  ChatMessage,
  ChatRole,
  FileEntry,
  Fragment,
  SearchResult,
  SessionFile,
} from './format.js'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|tiff?|ico)$/i

// ---- 宽松读取（旧格式字段可能缺失；结构错误直接 fail） ----

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail('backupIncomplete')

const string = (value: unknown): string =>
  typeof value === 'string' ? value : fail('backupIncomplete')

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : fail('backupIncomplete'))

/** 会话 ID 用于拼接条目名，不能含路径分隔符。 */
const sessionId = (value: unknown): string => {
  const id = string(value)
  return id && !/[/\\]/.test(id) && id !== '.' && id !== '..' ? id : fail('backupIncomplete')
}

/** 旧版时间形如 2025-02-03T21:57:59.103000+08:00，统一归一为 UTC 的 RFC3339（Z 结尾）。 */
const normalizeTime = (value: unknown): string => {
  const date = new Date(string(value))
  if (!Number.isFinite(date.getTime())) {
    fail('backupIncomplete')
  }
  return date.toISOString()
}

/** SEARCH 结果的 published_at 是 UNIX 秒，转为 ISO；null/undefined 保持 null。 */
const unixToIso = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(seconds)) {
    fail('backupIncomplete')
  }
  const date = new Date(seconds * 1000)
  if (!Number.isFinite(date.getTime())) {
    fail('backupIncomplete')
  }
  return date.toISOString()
}

const toSearchResult = (value: unknown): SearchResult => {
  const item = record(value)
  return {
    url: string(item.url ?? ''),
    title: string(item.title ?? ''),
    snippet: string(item.snippet ?? ''),
    published_at: unixToIso(item.published_at),
    site_name: item.site_name == null ? null : string(item.site_name),
    ...(item.site_icon !== undefined
      ? { site_icon: item.site_icon == null ? null : string(item.site_icon) }
      : {}),
  }
}

/** 旧版 fragment → v3 fragment；未知类型丢弃（best-effort）。 */
const toFragment = (value: unknown): Fragment | null => {
  const item = record(value)
  switch (string(item.type)) {
    case 'REQUEST':
      return { type: 'REQUEST', content: string(item.content ?? '') }
    case 'RESPONSE':
      return { type: 'RESPONSE', content: string(item.content ?? '') }
    case 'THINK':
      return { type: 'THINK', content: string(item.content ?? ''), elapsed_secs: null }
    case 'SEARCH':
      return {
        type: 'TOOL_SEARCH',
        queries: [],
        results: list(item.results ?? []).map(toSearchResult),
        status: 'FINISHED',
      }
    default:
      return null
  }
}

/** 旧版文件只有元数据（无二进制），按扩展名判断是否图片，不导出原图。 */
const toFileEntry = (value: unknown, insertedAt: string): FileEntry => {
  const item = record(value)
  const rawId = string(item.id ?? '')
  const id = rawId.startsWith('file-') ? rawId.slice(5) : rawId
  const fileName = string(item.file_name ?? '')
  return {
    id: id || rawId,
    file_name: fileName,
    file_size: 0,
    token_usage: null,
    inserted_at: insertedAt,
    export_path: null,
    is_image: IMAGE_EXT.test(fileName),
    width: null,
    height: null,
  }
}

type ParsedMessage = {
  insertedAt: string
  fragments: Fragment[]
  /** 由 fragment 推断的角色；无 REQUEST/RESPONSE/THINK/SEARCH 时为 null，交由树结构交替推断。 */
  roleHint: ChatRole | null
  thinkingEnabled: boolean
  searchEnabled: boolean
}

type ParsedNode = {
  parent: string | null
  children: string[]
  message: ParsedMessage | null
}

const readMessage = (value: unknown): ParsedMessage => {
  const item = record(value)
  const insertedAt = normalizeTime(item.inserted_at)
  const fragments = list(item.fragments ?? [])
    .map(toFragment)
    .filter((fragment): fragment is Fragment => fragment !== null)
  const files = list(item.files ?? [])
  if (files.length > 0) {
    fragments.push({ type: 'FILE', files: files.map((file) => toFileEntry(file, insertedAt)) })
  }
  const hasRequest = fragments.some((fragment) => fragment.type === 'REQUEST')
  const hasAssistant = fragments.some(
    (fragment) =>
      fragment.type === 'RESPONSE' || fragment.type === 'THINK' || fragment.type === 'TOOL_SEARCH'
  )
  const roleHint: ChatRole | null = hasRequest ? 'USER' : hasAssistant ? 'ASSISTANT' : null
  const model = typeof item.model === 'string' ? item.model : ''
  return {
    insertedAt,
    fragments,
    roleHint,
    thinkingEnabled: model === 'deepseek-reasoner' || fragments.some((f) => f.type === 'THINK'),
    searchEnabled: fragments.some((f) => f.type === 'TOOL_SEARCH'),
  }
}

const readNode = (value: unknown): ParsedNode => {
  const item = record(value)
  return {
    parent: item.parent == null ? null : string(item.parent),
    children: list(item.children ?? []).map((child) => string(child)),
    message: item.message == null ? null : readMessage(item.message),
  }
}

const numericId = (key: string): number => {
  const parsed = Number(key)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 单个旧版会话 → v3 SessionFile；无有效消息时返回 null（跳过）。 */
const parseConversation = (value: unknown): SessionFile | null => {
  const item = record(value)
  const id = sessionId(item.id)
  const mapping = record(item.mapping)
  const nodes = new Map<string, ParsedNode>()
  for (const key in mapping) {
    nodes.set(key, readNode(mapping[key]))
  }

  // 旧格式必含 root 虚拟节点；缺失时回退到 message 为空的节点，找不到则跳过。
  let rootKey: string | undefined
  if (nodes.has('root')) {
    rootKey = 'root'
  } else {
    for (const [key, node] of nodes) {
      if (!node.message) {
        rootKey = key
        break
      }
    }
  }
  if (!rootKey) {
    return null
  }

  const messages: ChatMessage[] = []
  const assigned = new Map<string, number>()
  let sequence = 0

  // 前序重编号，保证父 id 小于子 id；只保留从 root 可达、角色交替合法的节点。
  const visit = (key: string, parentRole: ChatRole | null, parentId: number | null): void => {
    if (assigned.has(key)) {
      return
    }
    const node = nodes.get(key)
    if (!node || !node.message) {
      return
    }
    const { roleHint } = node.message
    // 片段无角色信号时按树结构交替推断；根默认 USER。
    const role: ChatRole =
      roleHint ?? (parentRole === 'ASSISTANT' ? 'USER' : parentRole === 'USER' ? 'ASSISTANT' : 'USER')
    // 根必须是提问。
    if (parentRole === null && role !== 'USER') {
      return
    }
    const children = node.children
      .filter((child) => nodes.has(child))
      .sort((a, b) => numericId(a) - numericId(b))
    // 同角色连发（如用户补问）：不新建消息，把片段合并进父消息，子节点继续挂到父消息下，
    // 避免「丢弃该节点导致其后整枝消息一起丢失」。
    if (parentRole !== null && role === parentRole && parentId !== null) {
      const parentMessage = messages[parentId - 1]
      if (parentMessage) {
        parentMessage.fragments.push(...node.message.fragments)
        if (node.message.thinkingEnabled) {
          parentMessage.thinking_enabled = true
        }
        if (node.message.searchEnabled) {
          parentMessage.search_enabled = true
        }
      }
      assigned.set(key, parentId)
      for (const child of children) {
        visit(child, parentRole, parentId)
      }
      return
    }
    sequence += 1
    assigned.set(key, sequence)
    messages.push({
      id: sequence,
      parent_id: parentId,
      role,
      status: 'FINISHED',
      thinking_enabled: node.message.thinkingEnabled,
      search_enabled: node.message.searchEnabled,
      accumulated_token_usage: 0,
      inserted_at: node.message.insertedAt,
      fragments: node.message.fragments,
    })
    for (const child of children) {
      visit(child, role, sequence)
    }
  }

  for (const child of (nodes.get(rootKey)?.children ?? []).filter((key) => nodes.has(key))) {
    visit(child, null, null)
  }

  if (messages.length === 0) {
    return null
  }

  // current_message_id：沿「子节点中 id 最大者」走到末梢，等价用户最后停留的最新分支。
  let currentKey = rootKey
  while (true) {
    const children = (nodes.get(currentKey)?.children ?? []).filter((key) => assigned.has(key))
    if (children.length === 0) {
      break
    }
    currentKey = children.reduce((a, b) => (numericId(a) >= numericId(b) ? a : b))
  }
  const currentMessageId = assigned.get(currentKey) ?? messages[messages.length - 1].id

  return {
    id,
    title: item.title == null ? null : string(item.title),
    pinned: false,
    current_message_id: currentMessageId,
    inserted_at: normalizeTime(item.inserted_at),
    updated_at: normalizeTime(item.updated_at),
    messages,
  }
}

/** 旧版 conversations.json（顶层数组）→ v3 SessionFile 列表。 */
export const parseLegacyConversations = (value: unknown): SessionFile[] => {
  const conversations = list(value).map(parseConversation)
  return conversations.filter((session): session is SessionFile => session !== null)
}
