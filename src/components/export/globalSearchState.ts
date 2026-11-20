import { create } from 'zustand'

/** 全局搜索导出弹窗的开合状态（对齐 settingsDialogState 模式）。 */
export const useGlobalSearch = create<{ open: boolean }>(() => ({ open: false }))

export const openSearch = () => useGlobalSearch.setState({ open: true })

export const closeSearch = () => useGlobalSearch.setState({ open: false })
