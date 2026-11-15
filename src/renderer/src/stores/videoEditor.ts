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

/**
 * Who the open edit belongs to: a saved project on the Editor page (autosaved), or a post
 * being edited in the post editor (handed back on Done).
 */
export type EditorOrigin = { kind: 'project'; id: number; name: string } | { kind: 'post' }

/** Timeline zoom limits, in pixels per second. */
export const MIN_PX_PER_SEC = 8
export const MAX_PX_PER_SEC = 400

interface VideoEditorState {
  spec: EditSpec | null
  origin: EditorOrigin | null
  past: EditSpec[]
  future: EditSpec[]
  /** The spec before a live drag started (null when not dragging). */
  dragStart: EditSpec | null
  selected: number | null
  /** The text layer being edited (its panel shows instead of the piece's). */
  selectedText: string | null
  /** The sticker being edited (only one of text and sticker is selected at a time). */
  selectedOverlay: string | null
  /** Shows where YouTube's Shorts buttons and captions cover the video. */
  showGuides: boolean
  playhead: number
  playing: boolean
  pxPerSec: number

  open: (spec: EditSpec, origin: EditorOrigin) => void
  rename: (name: string) => void
  close: () => void
  change: (next: EditSpec, options?: { live?: boolean }) => void
  commit: () => void
  undo: () => void
  redo: () => void
  select: (index: number | null) => void
  selectText: (id: string | null) => void
  selectOverlay: (id: string | null) => void
  toggleGuides: () => void
  seek: (t: number) => void
  setPlaying: (playing: boolean) => void
  zoom: (pxPerSec: number) => void
}

/** The selected text, if it still exists in this version of the edit. */
const keepText = (spec: EditSpec, id: string | null): string | null =>
  id && spec.texts.some((t) => t.id === id) ? id : null

const keepOverlay = (spec: EditSpec, id: string | null): string | null =>
  id && (spec.overlays ?? []).some((o) => o.id === id) ? id : null

const clampTime = (spec: EditSpec | null, t: number): number =>
  Math.min(Math.max(0, t), spec ? editDuration(spec) : 0)

export const useVideoEditor = create<VideoEditorState>((set, get) => ({
  spec: null,
  origin: null,
  past: [],
  future: [],
  dragStart: null,
  selected: null,
  selectedText: null,
  selectedOverlay: null,
  showGuides: false,
  playhead: 0,
  playing: false,
  pxPerSec: 60,

  open: (spec, origin) =>
    set({
      spec,
      origin,
      past: [],
      future: [],
      dragStart: null,
      selected: 0,
      selectedText: null,
      selectedOverlay: null,
      playhead: 0,
      playing: false
    }),

  close: () =>
    set({ spec: null, origin: null, past: [], future: [], dragStart: null, playing: false }),

  rename(name) {
    const { origin } = get()
    if (origin?.kind === 'project') set({ origin: { ...origin, name } })
  },

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
      selected: Math.min(get().selected ?? 0, next.segments.length - 1),
      selectedText: keepText(next, get().selectedText),
      selectedOverlay: keepOverlay(next, get().selectedOverlay)
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
      selected: Math.min(get().selected ?? 0, previous.segments.length - 1),
      selectedText: keepText(previous, get().selectedText),
      selectedOverlay: keepOverlay(previous, get().selectedOverlay)
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
      selected: Math.min(get().selected ?? 0, next.segments.length - 1),
      selectedText: keepText(next, get().selectedText),
      selectedOverlay: keepOverlay(next, get().selectedOverlay)
    })
  },

  select: (index) => set({ selected: index, selectedText: null, selectedOverlay: null }),
  selectText: (id) => set({ selectedText: id, ...(id ? { selectedOverlay: null } : {}) }),
  selectOverlay: (id) => set({ selectedOverlay: id, ...(id ? { selectedText: null } : {}) }),
  toggleGuides: () => set({ showGuides: !get().showGuides }),
  seek: (t) => set({ playhead: clampTime(get().spec, t) }),
  setPlaying: (playing) => set({ playing }),
  zoom: (pxPerSec) =>
    set({ pxPerSec: Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, pxPerSec)) })
}))
