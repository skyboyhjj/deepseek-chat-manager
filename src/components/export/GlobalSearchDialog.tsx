import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { searchAllSessions, type SearchOutcome } from '../../services/chat/globalSearch.js'
import { downloadSearch } from '../../services/chat/searchExport.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { closeSearch, useGlobalSearch } from './globalSearchState.js'
import styles from './GlobalSearchDialog.module.css'

type Mode = 'messages' | 'conversations'
type Format = 'md' | 'csv' | 'jsonl'

const dayStart = (value: string) => new Date(`${value}T00:00:00`).getTime()
const dayEnd = (value: string) => new Date(`${value}T23:59:59.999`).getTime()

export const GlobalSearchDialog = () => {
  const t = useTranslate()
  const open = useGlobalSearch((state) => state.open)
  const [keywordText, setKeywordText] = useState('')
  const [matchAll, setMatchAll] = useState(false)
  const [allHits, setAllHits] = useState(false)
  const [mode, setMode] = useState<Mode>('conversations')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)

  if (!open) {
    return null
  }

  const keywords = keywordText.split(/[\s,，、]+/).filter(Boolean)
  const hitCount = outcome?.hits.length ?? 0

  const run = async () => {
    if (keywords.length === 0 || busy) {
      return
    }
    setBusy(true)
    try {
      setOutcome(
        await searchAllSessions({
          keywords,
          matchAll,
          allHits,
          mode,
          start: start ? dayStart(start) : undefined,
          end: end ? dayEnd(end) : undefined,
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const exportHits = (format: Format) => {
    if (outcome && outcome.hits.length > 0) {
      downloadSearch(outcome.hits, format)
    }
  }

  return (
    <Modal
      title={t('searchExport')}
      closable
      className={styles.dialog}
      mainClassName={styles.main}
      onClose={closeSearch}
      footer={
        <div className={styles.footer}>
          <Button variant="outlined" size="m" onClick={closeSearch}>
            {t('close')}
          </Button>
          <div className={styles.exportActions}>
            <Button variant="outlined" size="m" disabled={hitCount === 0} onClick={() => exportHits('md')}>
              MD
            </Button>
            <Button variant="outlined" size="m" disabled={hitCount === 0} onClick={() => exportHits('csv')}>
              CSV
            </Button>
            <Button variant="outlined" size="m" disabled={hitCount === 0} onClick={() => exportHits('jsonl')}>
              JSONL
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>{t('searchExportKeywords')}</span>
          <input
            className={styles.input}
            value={keywordText}
            placeholder={t('searchExportKeywords')}
            onChange={(event) => setKeywordText(event.target.value)}
          />
        </label>

        <div className={styles.selectRow}>
          <label className={styles.field}>
            <span className={styles.label}>{t('searchExportMatch')}</span>
            <Select
              ariaLabel={t('searchExportMatch')}
              value={matchAll ? 'all' : 'any'}
              options={[
                { value: 'any', label: t('searchExportMatchAny') },
                { value: 'all', label: t('searchExportMatchAll') },
              ]}
              onChange={(value) => setMatchAll(value === 'all')}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('searchExportTag')}</span>
            <Select
              ariaLabel={t('searchExportTag')}
              value={allHits ? 'all' : 'first'}
              options={[
                { value: 'first', label: t('searchExportTagFirst') },
                { value: 'all', label: t('searchExportTagAll') },
              ]}
              onChange={(value) => setAllHits(value === 'all')}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('searchExportMode')}</span>
            <Select
              ariaLabel={t('searchExportMode')}
              value={mode}
              options={[
                { value: 'conversations', label: t('searchExportModeConversations') },
                { value: 'messages', label: t('searchExportModeMessages') },
              ]}
              onChange={(value) => setMode(value)}
            />
          </label>
        </div>

        <div className={styles.selectRow}>
          <label className={styles.field}>
            <span className={styles.label}>{t('searchExportStart')}</span>
            <input
              className={styles.input}
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('searchExportEnd')}</span>
            <input
              className={styles.input}
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>

        <div className={styles.runRow}>
          <Button disabled={keywords.length === 0 || busy} onClick={() => void run()}>
            {t('searchExportRun')}
          </Button>
        </div>
      </div>

      {outcome ? (
        <div className={styles.result}>
          <div className={styles.stats}>
            <span>{t('searchExportStats', { count: hitCount })}</span>
            {[...outcome.stats.entries()].map(([keyword, count]) => (
              <span key={keyword} className={styles.statItem}>
                {keyword}: {count}
              </span>
            ))}
          </div>
          {hitCount === 0 ? (
            <div className={styles.empty}>{t('searchExportNoResult')}</div>
          ) : (
            <ul className={styles.list}>
              {outcome.mode === 'conversations'
                ? outcome.hits.map((hit) => (
                    <li key={hit.sessionId} className={styles.item}>
                      <div className={styles.itemTitle}>{hit.title || hit.sessionId}</div>
                      <div className={styles.itemMeta}>
                        {hit.hits.join('、')} · {hit.messages.length} 条消息
                      </div>
                      <div className={styles.itemSnippet}>{hit.messages[0]?.text.slice(0, 160)}</div>
                    </li>
                  ))
                : outcome.hits.map((hit, index) => (
                    <li key={`${hit.sessionId}-${index}`} className={styles.item}>
                      <div className={styles.itemTitle}>{hit.title || hit.sessionId}</div>
                      <div className={styles.itemMeta}>
                        [{hit.role === 'user' ? '用户' : '助手'}] {hit.hit}
                      </div>
                      <div className={styles.itemSnippet}>{hit.text.slice(0, 160)}</div>
                    </li>
                  ))}
            </ul>
          )}
        </div>
      ) : null}
    </Modal>
  )
}
