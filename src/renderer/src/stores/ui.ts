import { create } from 'zustand'
import type { PageId } from '@renderer/app/nav'

export interface EditorState {
  open: boolean
  /** Editing an existing post; null for a new one. */
  postId: string | null
  /** A video dropped onto the window or chosen before the editor opened. */
  initialFilePath: string | null
  /** Bumps on every open so the form remounts with fresh state. */
  session: number
}

/** UI-only state. Data from main goes through TanStack Query, never here. */
interface UiState {
  page: PageId
  editor: EditorState
  setPage: (page: PageId) => void
  openNewPost: (filePath?: string) => void
  openEditPost: (postId: string) => void
  closeEditor: () => void
}

const closed: EditorState = { open: false, postId: null, initialFilePath: null, session: 0 }

export const useUiStore = create<UiState>()((set) => ({
  page: 'queue',
  editor: closed,
  setPage: (page) => set({ page }),
  openNewPost: (filePath) =>
    set((s) => ({
      editor: {
        open: true,
        postId: null,
        initialFilePath: filePath ?? null,
        session: s.editor.session + 1
      }
    })),
  openEditPost: (postId) =>
    set((s) => ({
      editor: { open: true, postId, initialFilePath: null, session: s.editor.session + 1 }
    })),
  closeEditor: () => set((s) => ({ editor: { ...closed, session: s.editor.session } }))
}))
