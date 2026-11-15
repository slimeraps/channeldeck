import { create } from 'zustand'
import type { EditSpec } from '@shared/schemas/edit'
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
  /** An edit from the video editor ("Post…"): the post uploads its render. */
  initialEdit: EditSpec | null
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
  openNewPost: (filePath?: string, publishAtUtc?: string, clipId?: string, edit?: EditSpec) => void
  openEditPost: (postId: string) => void
  closeEditor: () => void
}

const closed: EditorState = {
  open: false,
  postId: null,
  initialFilePath: null,
  initialPublishAtUtc: null,
  initialClipId: null,
  initialEdit: null,
  session: 0
}

export const useUiStore = create<UiState>()((set) => ({
  page: 'queue',
  editor: closed,
  deviceCode: null,
  setDeviceCode: (deviceCode) => set({ deviceCode }),
  setPage: (page) => set({ page }),
  openNewPost: (filePath, publishAtUtc, clipId, edit) =>
    set((s) => ({
      editor: {
        open: true,
        postId: null,
        // A post from an edit starts from its first video (or its clip).
        initialFilePath:
          filePath ?? (edit && !clipId ? (edit.segments[0]?.sourcePath ?? null) : null),
        initialPublishAtUtc: publishAtUtc ?? null,
        initialClipId: clipId ?? null,
        initialEdit: edit ?? null,
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
        initialEdit: null,
        session: s.editor.session + 1
      }
    })),
  closeEditor: () => set((s) => ({ editor: { ...closed, session: s.editor.session } }))
}))
