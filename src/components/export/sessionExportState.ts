import { create } from 'zustand'

/** 会话选择性导出弹窗的开合状态（对齐 globalSearchState 模式）。 */
export const useSessionExport = create<{ open: boolean }>(() => ({ open: false }))

export const openSessionExport = () => useSessionExport.setState({ open: true })

export const closeSessionExport = () => useSessionExport.setState({ open: false })
