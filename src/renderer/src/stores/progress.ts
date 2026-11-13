import { create } from 'zustand'

/** Live upload progress pushed from main (posts:progress). UI-only; the DB has a coarser copy. */
interface ProgressState {
  byPost: Record<string, { sent: number; total: number }>
  set: (postId: string, sent: number, total: number) => void
}

export const useProgressStore = create<ProgressState>()((set) => ({
  byPost: {},
  set: (postId, sent, total) => set((s) => ({ byPost: { ...s.byPost, [postId]: { sent, total } } }))
}))
