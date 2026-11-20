import * as db from '../db.js'
import { BackupError, fail } from './errors.js'
import { EXPORT_FORMAT_VERSION, type SessionFile, type SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath, sessionFilesDir } from './paths.js'
import { detectManifest, readSessionFile, readSessionIndex } from './schema.js'
import { parseLegacyConversations } from './legacy.js'
import { toLocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  readPaths,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

/** 旧版归档的会话文件条目名（无 manifest.json）。 */
const LEGACY_PATH = 'conversations.json'

/** 判断是否为旧版归档：无 manifest.json 且含 conversations.json。 */
const isLegacyArchive = async (file: File): Promise<boolean> => {
  try {
    const paths = await readPaths(file)
    return !paths.includes(MANIFEST_PATH) && paths.includes(LEGACY_PATH)
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
}

/**
 * 旧版导入：读 conversations.json，归一化为 v3 SessionFile 后复用 toLocalSession 管线。
 * 旧版不含图片二进制，文件的 content（OCR/文本）不导入。
 */
const importLegacyArchive = async (file: File): Promise<void> => {
  let conversations: unknown
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path === LEGACY_PATH) {
        conversations = await readJson(entry)
      } else {
        await skipEntry(entry)
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (conversations === undefined) {
    fail('backupUnrecognized')
  }
  const sessions = parseLegacyConversations(conversations)
  const seen = new Set<string>()
  for (const fileSession of sessions) {
    if (seen.has(fileSession.id)) {
      fail('backupIncomplete')
    }
    seen.add(fileSession.id)
    await db.addStagingSession(toLocalSession(fileSession).session)
  }
}

/**
 * 会话解析器注册表：export_format_version -> 会话 JSON 解析器。
 * DeepSeek 后续升级导出格式时，在此登记对应 parser，导入逻辑无需改动。
 */
const SESSION_PARSERS: Record<number, (value: unknown) => SessionFile> = {
  [EXPORT_FORMAT_VERSION]: readSessionFile,
}

/** 按版本解析单个会话；高于当前支持版本时按最近已知版本 best-effort 解析。 */
const parseSessionFile = (version: number, value: unknown): SessionFile => {
  const parser = SESSION_PARSERS[version]
  if (parser) {
    return parser(value)
  }
  if (version > EXPORT_FORMAT_VERSION) {
    return readSessionFile(value)
  }
  return fail('backupInvalidVersion')
}

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  // 旧版无 manifest.json，结构校验在 importLegacyArchive 中进行。
  if (await isLegacyArchive(file)) {
    return
  }
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      detectManifest(await readJson(entry))
      return
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  fail('backupUnrecognized')
}

/**
 * 流式导入：manifest → user（不导入）→ 全部会话 JSON → index → 全部图片。
 * 也支持会话与图片交错排列、index 位于末尾的条目顺序。
 * 会话读完立即暂存，只保留图片路径映射；图片全部读完后逐会话回填 MIME，不改变图片身份。
 * 写入导入暂存存储；调用方负责先清空暂存，成功后替换正式数据，失败时清理暂存。
 */
export const importArchive = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  if (await isLegacyArchive(file)) {
    return importLegacyArchive(file)
  }
  const imported = new Set<string>()
  const images = new Map<string, string>()
  /** 已保存的原件：文件 ID → MIME。同一图片出现在多个会话目录时只保存一次。 */
  const stored = new Map<string, string>()
  let manifest = false
  let sourceVersion = EXPORT_FORMAT_VERSION
  let index: SessionIndexEntry[] | undefined
  let currentSessionId: string | undefined

  const saveImage = async (entry: ArchiveEntry, id: string) => {
    if (stored.has(id)) {
      await skipEntry(entry)
      return
    }
    const data = await readEntry(entry)
    const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    await db.saveStagingFiles([{ id, blob: new Blob([data], { type }) }])
    stored.set(id, type)
  }

  try {
    for await (const entry of readArchive(file)) {
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (!manifest) {
        if (path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        sourceVersion = detectManifest(await readJson(entry)).version
        manifest = true
      } else if (path === USER_PATH && !index && imported.size === 0) {
        // 账号信息（已脱敏）不导入；文件可能缺失。
        await skipEntry(entry)
      } else if (sessionId !== null && !index) {
        const local = toLocalSession(parseSessionFile(sourceVersion, await readJson(entry)))
        if (local.session.id !== sessionId || imported.has(sessionId)) {
          fail('backupIncomplete')
        }
        imported.add(sessionId)
        currentSessionId = sessionId
        for (const [imagePath, id] of local.images) {
          images.set(imagePath, id)
        }
        await db.addStagingSession(local.session)
      } else if (path === INDEX_PATH && !index) {
        index = readSessionIndex(await readJson(entry))
      } else if (
        index
          ? imported.has(/^chat_sessions\/([^/]+)_files\//.exec(path)?.[1] ?? '')
          : currentSessionId && path.startsWith(sessionFilesDir(currentSessionId))
      ) {
        // 没有被引用的条目不保存，引用了但缺失的图片只展示文件名。
        const id = images.get(path)
        await (id === undefined ? skipEntry(entry) : saveImage(entry, id))
      } else {
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifest) {
    fail('backupUnrecognized')
  }
  // index 只列出成功写出的会话，与会话文件一一对应。
  const listed = new Set(index?.map((entry) => entry.id))
  if (
    !index ||
    listed.size !== index.length ||
    listed.size !== imported.size ||
    [...imported].some((id) => !listed.has(id))
  ) {
    fail('backupIncomplete')
  }
  await db.updateStagingFileTypes(stored)
}
