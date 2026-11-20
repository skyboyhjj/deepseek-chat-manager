import { formatDate } from '../../utils/format.js'
import type { ConversationHit, MessageHit } from './globalSearch.js'

type Hit = ConversationHit | MessageHit

const isConversation = (hit: Hit): hit is ConversationHit => 'messages' in hit

const roleLabel = (role: 'user' | 'assistant') => (role === 'user' ? '用户' : '助手')

const escapeCsv = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

const csvLine = (fields: string[]) => fields.map(escapeCsv).join(',')

export const toMarkdown = (hits: Hit[]): string => {
  const lines = ['# DeepSeek 对话导出', '']
  for (const hit of hits) {
    lines.push(`\n## 【${hit.title}】\n`)
    if (isConversation(hit)) {
      lines.push(`命中词: 「${hit.hits.join('、')}」\n`)
      for (const message of hit.messages) {
        lines.push(`### [${roleLabel(message.role)}]\n`)
        lines.push(message.text)
        lines.push('')
      }
    } else {
      lines.push(`### [${roleLabel(hit.role)}] 命中词: 「${hit.hit}」\n`)
      lines.push(hit.text)
      lines.push('\n---')
    }
  }
  return lines.join('\n')
}

export const toCsv = (hits: Hit[]): string => {
  if (hits.length > 0 && isConversation(hits[0])) {
    const header = csvLine(['对话标题', '创建时间', '命中关键词', '主题标签', '上下文'])
    const rows = hits.map((hit) => {
      const conversation = hit as ConversationHit
      const context = conversation.messages
        .map((message) => `[${roleLabel(message.role)}] ${message.text}`)
        .join('\n\n')
      return csvLine([
        conversation.title,
        new Date(conversation.createdAt).toISOString(),
        conversation.hits.join('、'),
        conversation.hits.join('、'),
        context,
      ])
    })
    return [header, ...rows].join('\r\n')
  }
  const header = csvLine(['对话标题', '角色', '主题标签', '命中关键词', '上下文'])
  const rows = hits.map((hit) => {
    const message = hit as MessageHit
    return csvLine([
      message.title,
      roleLabel(message.role),
      message.hit,
      message.hit,
      message.text,
    ])
  })
  return [header, ...rows].join('\r\n')
}

export const toJsonl = (hits: Hit[]): string =>
  hits
    .map((hit) => {
      if (isConversation(hit)) {
        return JSON.stringify({
          对话标题: hit.title,
          创建时间: new Date(hit.createdAt).toISOString(),
          命中关键词: hit.hits.join('、'),
          主题标签: hit.hits.join('、'),
          消息: hit.messages.map((message) => ({
            角色: roleLabel(message.role),
            正文: message.text,
          })),
        })
      }
      return JSON.stringify({
        对话标题: hit.title,
        角色: roleLabel(hit.role),
        主题标签: hit.hit,
        命中关键词: hit.hit,
        上下文: hit.text,
      })
    })
    .join('\n')

export const downloadSearch = (hits: Hit[], format: 'md' | 'csv' | 'jsonl') => {
  const name = `deepseek_search-${formatDate(new Date()) ?? 'export'}.${format}`
  let content: string
  let type: string
  if (format === 'md') {
    content = toMarkdown(hits)
    type = 'text/markdown;charset=utf-8'
  } else if (format === 'csv') {
    content = `\uFEFF${toCsv(hits)}`
    type = 'text/csv;charset=utf-8'
  } else {
    content = toJsonl(hits)
    type = 'application/x-ndjson;charset=utf-8'
  }
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
