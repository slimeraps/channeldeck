import type { CanvasKind } from './geometry'
import {
  EDIT_SPEC_VERSION,
  type EditLayout,
  type EditSegment,
  type EditSpec,
  editDuration,
  MIN_SEGMENT_SECONDS,
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
