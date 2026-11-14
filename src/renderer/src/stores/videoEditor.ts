import { create } from 'zustand'
import type { EditSpec } from '@shared/schemas/edit'
import { editDuration } from '@shared/schemas/edit'

/**
 * The video editor's working state (UI only; the edit is saved by its owner). Every change to
 * the edit goes through `change()`, which keeps undo history. Dragging a trim handle calls
 * `change(…, { live: true })` many times and `commit()` once on release, so a whole drag is
 * one undo step.
 */

const MAX_HISTORY = 200

/** Timeline zoom limits, in pixels per second. */
export const MIN_PX_PER_SEC = 8
export const MAX_PX_PER_SEC = 400

interface VideoEditorState {
  spec: EditSpec | null
  past: EditSpec[]
  future: EditSpec[]
  /** The spec before a live drag started (null when not dragging). */
  dragStart: EditSpec | null
  selected: number | null
  playhead: number
  playing: boolean
  pxPerSec: number

  open: (spec: EditSpec) => void
  close: () => void
  change: (next: EditSpec, options?: { live?: boolean }) => void
  commit: () => void
  undo: () => void
  redo: () => void
  select: (index: number | null) => void
  seek: (t: number) => void
  setPlaying: (playing: boolean) => void
  zoom: (pxPerSec: number) => void
}

const clampTime = (spec: EditSpec | null, t: number): number =>
  Math.min(Math.max(0, t), spec ? editDuration(spec) : 0)

export const useVideoEditor = create<VideoEditorState>((set, get) => ({
  spec: null,
  past: [],
  future: [],
  dragStart: null,
  selected: null,
  playhead: 0,
  playing: false,
  pxPerSec: 60,

  open: (spec) =>
    set({ spec, past: [], future: [], dragStart: null, selected: 0, playhead: 0, playing: false }),

  close: () => set({ spec: null, past: [], future: [], dragStart: null, playing: false }),

  change(next, options = {}) {
    const { spec, past, dragStart } = get()
    if (!spec || next === spec) return
    if (options.live) {
      // Remember where the drag began; history is written once, on commit().
      set({ spec: next, dragStart: dragStart ?? spec, playhead: clampTime(next, get().playhead) })
      return
    }
    set({
      spec: next,
      past: [...past, spec].slice(-MAX_HISTORY),
      future: [],
      dragStart: null,
      playhead: clampTime(next, get().playhead),
      selected: Math.min(get().selected ?? 0, next.segments.length - 1)
    })
  },

  commit() {
    const { spec, past, dragStart } = get()
    if (!spec || !dragStart) return
    set({ past: [...past, dragStart].slice(-MAX_HISTORY), future: [], dragStart: null })
  },

  undo() {
    const { spec, past, future } = get()
    const previous = past.at(-1)
    if (!spec || !previous) return
    set({
      spec: previous,
      past: past.slice(0, -1),
      future: [spec, ...future],
      playhead: clampTime(previous, get().playhead),
      selected: Math.min(get().selected ?? 0, previous.segments.length - 1)
    })
  },

  redo() {
    const { spec, past, future } = get()
    const next = future[0]
    if (!spec || !next) return
    set({
      spec: next,
      past: [...past, spec],
      future: future.slice(1),
      playhead: clampTime(next, get().playhead),
      selected: Math.min(get().selected ?? 0, next.segments.length - 1)
    })
  },

  select: (index) => set({ selected: index }),
  seek: (t) => set({ playhead: clampTime(get().spec, t) }),
  setPlaying: (playing) => set({ playing }),
  zoom: (pxPerSec) =>
    set({ pxPerSec: Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, pxPerSec)) })
}))
