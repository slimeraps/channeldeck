import { create } from 'zustand'
import type { PageId } from '@renderer/app/nav'

/** UI-only state. Data from main goes through TanStack Query, never here. */
interface UiState {
  page: PageId
  newPostOpen: boolean
  setPage: (page: PageId) => void
  openNewPost: () => void
  setNewPostOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  page: 'queue',
  newPostOpen: false,
  setPage: (page) => set({ page }),
  openNewPost: () => set({ newPostOpen: true }),
  setNewPostOpen: (open) => set({ newPostOpen: open })
}))
