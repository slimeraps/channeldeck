import { create } from 'zustand'
import type { PageId } from '@renderer/app/nav'

export interface EditorState {
  open: boolean
  /** Editing an existing post; null for a new one. */
  postId: string | null
  /** A video dropped onto the window or chosen before the editor opened. */
  initialFilePath: string | null
  /** A publish time picked in the calendar (empty slot clicked). */
  initialPublishAtUtc: string | null
  /** A clip chosen on the Clips page ("Post…"). */
  initialClipId: string | null
  /** Bumps on every open so the form remounts with fresh state. */
  session: number
}

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  expiresAtUtc: string
}

/** UI-only state. Data from main goes through TanStack Query, never here. */
interface UiState {
  page: PageId
  editor: EditorState
  /** Twitch Device Code sign-in in progress: the code to type at twitch.tv/activate. */
  deviceCode: DeviceCodeInfo | null
  setDeviceCode: (info: DeviceCodeInfo | null) => void
  setPage: (page: PageId) => void
  openNewPost: (filePath?: string, publishAtUtc?: string, clipId?: string) => void
  openEditPost: (postId: string) => void
  closeEditor: () => void
}

const closed: EditorState = {
  open: false,
  postId: null,
  initialFilePath: null,
  initialPublishAtUtc: null,
  initialClipId: null,
  session: 0
}

export const useUiStore = create<UiState>()((set) => ({
  page: 'queue',
  editor: closed,
  deviceCode: null,
  setDeviceCode: (deviceCode) => set({ deviceCode }),
  setPage: (page) => set({ page }),
  openNewPost: (filePath, publishAtUtc, clipId) =>
    set((s) => ({
      editor: {
        open: true,
        postId: null,
        initialFilePath: filePath ?? null,
        initialPublishAtUtc: publishAtUtc ?? null,
        initialClipId: clipId ?? null,
        session: s.editor.session + 1
      }
    })),
  openEditPost: (postId) =>
    set((s) => ({
      editor: {
        open: true,
        postId,
        initialFilePath: null,
        initialPublishAtUtc: null,
        initialClipId: null,
        session: s.editor.session + 1
      }
    })),
  closeEditor: () => set((s) => ({ editor: { ...closed, session: s.editor.session } }))
}))
