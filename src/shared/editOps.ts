import type { CanvasKind } from './geometry'
import {
  DEFAULT_TEXT_STYLE,
  EDIT_SPEC_VERSION,
  type EditFrame,
  type EditLayout,
  type EditOverlay,
  type EditText,
  type EditSegment,
  type EditSpec,
  editDuration,
  MIN_SEGMENT_SECONDS,
  overlaysOf,
  segmentDuration,
  segmentStarts
} from './schemas/edit'

/**
 * The editor's operations on an EditSpec, as pure functions (the store adds undo on top).
 * Each returns a new spec and never changes the one it was given. Times are seconds on the
 * output timeline unless a name says "source".
 */

export interface SourceRef {
  path: string
  durationSec: number
  clipId: string | null
}

const DEFAULT_FRAME = { zoomStart: 1, zoomEnd: 1, cx: 0.5, cy: 0.5 } as const

export function newSegment(source: SourceRef, canvas: CanvasKind): EditSegment {
  return {
    sourcePath: source.path,
    clipId: source.clipId,
    inSec: 0,
    outSec: Math.max(MIN_SEGMENT_SECONDS, source.durationSec),
    layout: null,
    frame: canvas === 'vertical' ? null : { ...DEFAULT_FRAME }
  }
}

/** A new edit of whole sources, in order. */
export function newEdit(sources: readonly SourceRef[], canvas: CanvasKind = 'vertical'): EditSpec {
  return {
    version: EDIT_SPEC_VERSION,
    canvas,
    segments: sources.map((s) => newSegment(s, canvas)),
    texts: [],
    volume: 1
  }
}

/** Which segment plays at output time `t`, and where in its source. */
export function locate(
  spec: Pick<EditSpec, 'segments'>,
  t: number
): { index: number; offset: number; sourceTime: number } {
  const starts = segmentStarts(spec)
  const total = editDuration(spec)
  const at = Math.min(Math.max(0, t), total)
  let index = spec.segments.length - 1
  for (let i = 0; i < spec.segments.length; i++) {
    const segment = spec.segments[i] as EditSegment
    if (at < (starts[i] as number) + segmentDuration(segment)) {
      index = i
      break
    }
  }
  const segment = spec.segments[index] as EditSegment
  const offset = Math.min(at - (starts[index] as number), segmentDuration(segment))
  return { index, offset, sourceTime: segment.inSec + offset }
}

const replaceAt = <T>(list: readonly T[], index: number, ...items: T[]): T[] => [
  ...list.slice(0, index),
  ...items,
  ...list.slice(index + 1)
]

/**
 * Cuts the segment under `t` in two. Returns null when `t` is too close to a cut already
 * (both halves must be at least the minimum segment length).
 */
export function splitAt(spec: EditSpec, t: number): { spec: EditSpec; index: number } | null {
  const { index, offset, sourceTime } = locate(spec, t)
  const segment = spec.segments[index] as EditSegment
  if (offset < MIN_SEGMENT_SECONDS || segmentDuration(segment) - offset < MIN_SEGMENT_SECONDS) {
    return null
  }
  const first = { ...segment, outSec: sourceTime }
  const second = { ...segment, inSec: sourceTime }
  return {
    spec: { ...spec, segments: replaceAt(spec.segments, index, first, second) },
    index: index + 1
  }
}

/** Moves a segment's in point (its start in the source), kept inside the source. */
export function trimIn(spec: EditSpec, index: number, sourceSec: number): EditSpec {
  const segment = spec.segments[index]
  if (!segment) return spec
  const inSec = Math.min(Math.max(0, sourceSec), segment.outSec - MIN_SEGMENT_SECONDS)
  return { ...spec, segments: replaceAt(spec.segments, index, { ...segment, inSec }) }
}

/** Moves a segment's out point, kept inside the source (`sourceDurationSec`). */
export function trimOut(
  spec: EditSpec,
  index: number,
  sourceSec: number,
  sourceDurationSec: number
): EditSpec {
  const segment = spec.segments[index]
  if (!segment) return spec
  const outSec = Math.max(
    segment.inSec + MIN_SEGMENT_SECONDS,
    Math.min(sourceSec, sourceDurationSec)
  )
  return { ...spec, segments: replaceAt(spec.segments, index, { ...segment, outSec }) }
}

/** Moves the segment at `from` so it ends up at position `to`. */
export function moveSegment(spec: EditSpec, from: number, to: number): EditSpec {
  const segment = spec.segments[from]
  if (!segment || from === to) return spec
  const rest = spec.segments.filter((_, i) => i !== from)
  const at = Math.min(Math.max(0, to), rest.length)
  return { ...spec, segments: [...rest.slice(0, at), segment, ...rest.slice(at)] }
}

/** Removes a segment; the last one can't be removed (an edit needs at least one). */
export function removeSegment(spec: EditSpec, index: number): EditSpec {
  if (spec.segments.length <= 1 || !spec.segments[index]) return spec
  return { ...spec, segments: spec.segments.filter((_, i) => i !== index) }
}

/** Adds a whole source after `afterIndex` (default: at the end). */
export function addSegment(spec: EditSpec, source: SourceRef, afterIndex?: number): EditSpec {
  const at = afterIndex === undefined ? spec.segments.length : afterIndex + 1
  const segment = newSegment(source, spec.canvas)
  // A new piece from the same Twitch channel's clip starts with the layout used before it.
  const previous = spec.segments[at - 1]
  if (spec.canvas === 'vertical' && previous?.layout) segment.layout = previous.layout
  return {
    ...spec,
    segments: [...spec.segments.slice(0, at), segment, ...spec.segments.slice(at)]
  }
}

/** Changes the canvas; horizontal and square pieces get a whole-frame crop to start from. */
export function setCanvas(spec: EditSpec, canvas: CanvasKind): EditSpec {
  if (spec.canvas === canvas) return spec
  return {
    ...spec,
    canvas,
    segments: spec.segments.map((s) =>
      canvas === 'vertical' ? s : { ...s, frame: s.frame ?? { ...DEFAULT_FRAME } }
    )
  }
}

/** Sets the vertical layout of one segment, or of every segment (`index` = 'all'). */
export function setLayout(
  spec: EditSpec,
  index: number | 'all',
  layout: EditLayout | null
): EditSpec {
  return {
    ...spec,
    segments: spec.segments.map((s, i) => (index === 'all' || i === index ? { ...s, layout } : s))
  }
}

/** The closest target within `tolerance`, or `value` itself. */
export function snap(value: number, targets: readonly number[], tolerance: number): number {
  let best = value
  let distance = tolerance
  for (const target of targets) {
    const d = Math.abs(target - value)
    if (d <= distance) {
      best = target
      distance = d
    }
  }
  return best
}

/** Output times where segments meet (plus the start and end): what trims and the playhead snap to. */
export function cutPoints(spec: Pick<EditSpec, 'segments'>): number[] {
  return [...segmentStarts(spec), editDuration(spec)]
}

// ---- text layers --------------------------------------------------------------------------

/** How long a new text stays on screen. */
export const NEW_TEXT_SECONDS = 3

/**
 * A new text layer at output time `t`, near the top of the frame, about three seconds long
 * (less at the end of the edit; it starts earlier rather than fall off the end).
 */
export function newText(spec: EditSpec, t: number, id: string): EditText {
  const total = editDuration(spec)
  const length = Math.min(NEW_TEXT_SECONDS, total)
  const startSec = Math.max(0, Math.min(t, total - length))
  return {
    id,
    text: 'Your text',
    startSec,
    endSec: Math.min(total, startSec + length),
    x: 0.5,
    y: spec.canvas === 'vertical' ? 0.2 : 0.15,
    style: { ...DEFAULT_TEXT_STYLE, size: spec.canvas === 'vertical' ? 96 : 80 },
    animation: 'pop'
  }
}

export function addText(spec: EditSpec, text: EditText): EditSpec {
  return { ...spec, texts: [...spec.texts, text] }
}

export function updateText(
  spec: EditSpec,
  id: string,
  patch: Partial<Omit<EditText, 'id'>>
): EditSpec {
  return { ...spec, texts: spec.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
}

export function removeText(spec: EditSpec, id: string): EditSpec {
  return { ...spec, texts: spec.texts.filter((t) => t.id !== id) }
}

/** Moves a text in time, keeping its length and keeping it inside the edit. */
export function moveText(spec: EditSpec, id: string, startSec: number): EditSpec {
  const text = spec.texts.find((t) => t.id === id)
  if (!text) return spec
  const length = text.endSec - text.startSec
  const start = Math.max(0, Math.min(startSec, editDuration(spec) - length))
  return updateText(spec, id, { startSec: start, endSec: start + length })
}

/** Changes when a text starts or ends; it stays at least 0.1 s long and inside the edit. */
export function retimeText(
  spec: EditSpec,
  id: string,
  edge: 'start' | 'end',
  sec: number
): EditSpec {
  const text = spec.texts.find((t) => t.id === id)
  if (!text) return spec
  const total = editDuration(spec)
  return edge === 'start'
    ? updateText(spec, id, {
        startSec: Math.max(0, Math.min(sec, text.endSec - MIN_SEGMENT_SECONDS))
      })
    : updateText(spec, id, {
        endSec: Math.min(total, Math.max(sec, text.startSec + MIN_SEGMENT_SECONDS))
      })
}

/** Texts on screen at output time `t`. */
export function textsAt(spec: Pick<EditSpec, 'texts'>, t: number): EditText[] {
  return spec.texts.filter((x) => t >= x.startSec && t < x.endSec)
}

// ---- frame (horizontal and square canvases) -------------------------------------------------

/** Sets the crop and zoom of one segment, or of every segment. */
export function setFrame(spec: EditSpec, index: number | 'all', frame: EditFrame): EditSpec {
  return {
    ...spec,
    segments: spec.segments.map((s, i) => (index === 'all' || i === index ? { ...s, frame } : s))
  }
}

// ---- stickers and logos ---------------------------------------------------------------------

/** A new sticker at the playhead: in the middle, a third of the width, three seconds. */
export function newOverlay(spec: EditSpec, t: number, id: string, asset: string): EditOverlay {
  const total = editDuration(spec)
  const length = Math.min(NEW_TEXT_SECONDS, total)
  const startSec = Math.max(0, Math.min(t, total - length))
  return {
    id,
    asset,
    startSec,
    endSec: Math.min(total, startSec + length),
    x: 0.5,
    y: 0.5,
    width: spec.canvas === 'vertical' ? 0.35 : 0.2,
    opacity: 1
  }
}

/**
 * A logo watermark: the whole video, top right, slightly see-through. On a vertical video it
 * sits below the area YouTube's Shorts player covers at the top.
 */
export function newLogoWatermark(spec: EditSpec, id: string, asset: string): EditOverlay {
  const vertical = spec.canvas === 'vertical'
  return {
    id,
    asset,
    startSec: 0,
    endSec: editDuration(spec),
    x: vertical ? 0.84 : 0.9,
    y: vertical ? 0.12 : 0.12,
    width: vertical ? 0.22 : 0.12,
    opacity: 0.85
  }
}

/** A channel-name watermark: the streamer's name, small, top left, for the whole video. */
export function newNameWatermark(spec: EditSpec, id: string): EditText {
  const vertical = spec.canvas === 'vertical'
  return {
    id,
    text: '{{broadcaster}}',
    startSec: 0,
    endSec: editDuration(spec),
    x: vertical ? 0.06 : 0.04,
    y: vertical ? 0.12 : 0.08,
    style: {
      ...DEFAULT_TEXT_STYLE,
      size: vertical ? 56 : 48,
      color: '#ffffffd9',
      outlineWidth: 4,
      align: 'left'
    },
    animation: 'none'
  }
}

export function addOverlay(spec: EditSpec, overlay: EditOverlay): EditSpec {
  return { ...spec, overlays: [...overlaysOf(spec), overlay] }
}

export function updateOverlay(
  spec: EditSpec,
  id: string,
  patch: Partial<Omit<EditOverlay, 'id'>>
): EditSpec {
  return {
    ...spec,
    overlays: overlaysOf(spec).map((o) => (o.id === id ? { ...o, ...patch } : o))
  }
}

export function removeOverlay(spec: EditSpec, id: string): EditSpec {
  return { ...spec, overlays: overlaysOf(spec).filter((o) => o.id !== id) }
}

/** Moves a sticker in time, keeping its length and keeping it inside the edit. */
export function moveOverlay(spec: EditSpec, id: string, startSec: number): EditSpec {
  const o = overlaysOf(spec).find((x) => x.id === id)
  if (!o) return spec
  const length = o.endSec - o.startSec
  const start = Math.max(0, Math.min(startSec, editDuration(spec) - length))
  return updateOverlay(spec, id, { startSec: start, endSec: start + length })
}

/** Changes when a sticker starts or ends; at least 0.1 s long and inside the edit. */
export function retimeOverlay(
  spec: EditSpec,
  id: string,
  edge: 'start' | 'end',
  sec: number
): EditSpec {
  const o = overlaysOf(spec).find((x) => x.id === id)
  if (!o) return spec
  const total = editDuration(spec)
  return edge === 'start'
    ? updateOverlay(spec, id, {
        startSec: Math.max(0, Math.min(sec, o.endSec - MIN_SEGMENT_SECONDS))
      })
    : updateOverlay(spec, id, {
        endSec: Math.min(total, Math.max(sec, o.startSec + MIN_SEGMENT_SECONDS))
      })
}
