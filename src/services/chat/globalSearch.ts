import { getVisibleMessages, normalizeSession } from './branches.js'
import * as db from './db.js'
import { useChatStore } from './store.js'
import type { Session } from './types.js'

/** 检索正文（已从本地消息模型提取，只认正文、跳过思考/工具块/服务端提示）。 */
export type SearchMessage = { role: 'user' | 'assistant'; text: string; createdAt: number }

/** 整篇提取：命中对话的完整对话。 */
export type ConversationHit = {
  sessionId: string
  title: string
  createdAt: number
  updatedAt: number
  /** 命中关键词（allHits 决定数组长度）。 */
  hits: string[]
  messages: SearchMessage[]
}

/** 聚焦片段：命中消息。 */
export type MessageHit = {
  sessionId: string
  title: string
  createdAt: number
  role: 'user' | 'assistant'
  text: string
  hit: string
}

export type SearchOptions = {
  keywords: string[]
  matchAll: boolean
  allHits: boolean
  mode: 'messages' | 'conversations'
  start?: number
  end?: number
}

export type SearchOutcome =
  | { mode: 'messages'; hits: MessageHit[]; stats: Map<string, number> }
  | { mode: 'conversations'; hits: ConversationHit[]; stats: Map<string, number> }

/** 提取会话可见分支的正文消息（用户 content / 助手 TextPart.text，跳过思考与工具块）。 */
export function extractMessages(session: Session): SearchMessage[] {
  const result: SearchMessage[] = []
  for (const message of getVisibleMessages(normalizeSession(session))) {
    if (message.role === 'user') {
      const text = message.content.trim()
      if (text) {
        result.push({ role: 'user', text, createdAt: message.createdAt })
      }
    } else {
      const parts: string[] = []
      for (const block of message.blocks) {
        if (block.type === 'text' && !block.isTemplate) {
          parts.push(block.text)
        }
      }
      const text = parts.join('\n').trim()
      if (text) {
        result.push({ role: 'assistant', text, createdAt: message.createdAt })
      }
    }
  }
  return result
}

/** 全局检索：遍历全部会话（快照），按时间/OR/AND 匹配，返回命中 + 词频统计。 */
export async function searchAllSessions(opts: SearchOptions): Promise<SearchOutcome> {
  const { sessions, sessionCache } = useChatStore.getState()
  const stats = new Map<string, number>()
  const messageHits: MessageHit[] = []
  const conversationHits: ConversationHit[] = []

  const inTimeRange = (createdAt: number) =>
    (opts.start === undefined || createdAt >= opts.start) &&
    (opts.end === undefined || createdAt <= opts.end)

  const matchedHits = (text: string): string[] => {
    const hits = opts.keywords.filter((keyword) => text.includes(keyword))
    if (hits.length === 0) {
      return []
    }
    if (opts.matchAll && hits.length !== opts.keywords.length) {
      return []
    }
    return opts.allHits ? hits : [hits[0]]
  }

  const addStat = (hits: string[]) => {
    for (const keyword of hits) {
      stats.set(keyword, (stats.get(keyword) ?? 0) + 1)
    }
  }

  for (const summary of sessions) {
    if (!inTimeRange(summary.createdAt)) {
      continue
    }
    const session = Object.hasOwn(sessionCache, summary.id)
      ? sessionCache[summary.id]
      : await db.loadSession(summary.id)
    if (!session) {
      continue
    }
    const messages = extractMessages(session)
    if (messages.length === 0) {
      continue
    }

    if (opts.mode === 'messages') {
      for (const message of messages) {
        const hits = matchedHits(message.text)
        if (hits.length === 0) {
          continue
        }
        addStat(hits)
        messageHits.push({
          sessionId: summary.id,
          title: summary.title,
          createdAt: summary.createdAt,
          role: message.role,
          text: message.text,
          hit: hits.join('、'),
        })
      }
    } else {
      const hits = matchedHits(messages.map((message) => message.text).join('\n'))
      if (hits.length === 0) {
        continue
      }
      addStat(hits)
      conversationHits.push({
        sessionId: summary.id,
        title: summary.title,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        hits,
        messages,
      })
    }
  }

  return opts.mode === 'messages'
    ? { mode: 'messages', hits: messageHits, stats }
    : { mode: 'conversations', hits: conversationHits, stats }
}
