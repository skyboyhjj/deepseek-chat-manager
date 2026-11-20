import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { exportSessions } from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { closeSessionExport, useSessionExport } from './sessionExportState.js'
import styles from './SessionExportDialog.module.css'

/** 会话选择性导出：勾选部分会话，导出为可再导入的 ZIP 归档。 */
export const SessionExportDialog = () => {
  const t = useTranslate()
  const open = useSessionExport((state) => state.open)
  const sessions = useChatStore((state) => state.sessions)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // 关闭弹窗后重置选择状态，避免再次打开时残留上次的勾选与计数
  useEffect(() => {
    if (!open) {
      setSelected(new Set())
      setBusy(false)
    }
  }, [open])

  if (!open) {
    return null
  }

  const allSelected = sessions.length > 0 && selected.size === sessions.length

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(sessions.map((session) => session.id)))
  }

  const onExport = async () => {
    const ids = [...selected]
    if (ids.length === 0 || busy) {
      return
    }
    setBusy(true)
    try {
      const { name, blob } = await exportSessions(ids)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      closeSessionExport()
    } catch (error) {
      showToast({
        key: 'sessionExportFailed',
        params: { message: error instanceof Error ? error.message : String(error) },
        type: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('sessionExportTitle')}
      closable
      className={styles.dialog}
      mainClassName={styles.main}
      onClose={closeSessionExport}
      footer={
        <div className={styles.footer}>
          <Button variant="outlined" size="m" onClick={closeSessionExport}>
            {t('close')}
          </Button>
          <Button size="m" disabled={selected.size === 0 || busy} onClick={() => void onExport()}>
            {t('sessionExportDownload', { count: selected.size })}
          </Button>
        </div>
      }
    >
      {sessions.length === 0 ? (
        <div className={styles.empty}>{t('sessionExportEmpty')}</div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <Button variant="outlined" size="m" onClick={toggleAll}>
              {allSelected ? t('sessionExportUnselectAll') : t('sessionExportSelectAll')}
            </Button>
            <span className={styles.count}>
              {t('sessionExportSelected', { count: selected.size })}
            </span>
          </div>
          <ul className={styles.list}>
            {sessions.map((session) => (
              <li key={session.id}>
                <label className={styles.item}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={selected.has(session.id)}
                    onChange={() => toggle(session.id)}
                  />
                  <span className={styles.title}>{session.title || session.id}</span>
                  <span className={styles.date}>
                    {new Date(session.updatedAt).toLocaleDateString()}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
