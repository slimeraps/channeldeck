import { useEffect, useRef, useState } from 'react'
import {
  cutPoints,
  moveOverlay,
  moveSegment,
  moveText,
  retimeOverlay,
  retimeText,
  snap,
  trimIn,
  trimOut
} from '@shared/editOps'
import {
  type EditSegment,
  type EditSpec,
  editDuration,
  segmentDuration,
  segmentStarts
} from '@shared/schemas/edit'
import type { EditorSource, EditorStrips } from '@shared/schemas/editor'
import { formatClock } from '@renderer/lib/clock'
import { cn } from '@renderer/lib/utils'
import { useVideoEditor } from '@renderer/stores/videoEditor'

/**
 * The timeline: a ruler to seek on, one block per segment (its filmstrip and waveform), trim
 * handles on each block's edges, drag a block to move it, and the playhead. Trims are
 * "ripple" trims: later segments move up or back. ⌘ + scroll zooms.
 */

const HANDLE = 8
const SNAP_PX = 8
const RULER_H = 22
const TRACK_H = 72
const TEXT_ROW_H = 24
/** Everything below the ruler: the pieces, the text row and the sticker row. */
const BODY_H = TRACK_H + 2 * TEXT_ROW_H + 18
/** Seconds between ruler labels: the first that leaves at least 70 px between them. */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

interface LayerDrag {
  id: string
  part: 'body' | 'start' | 'end'
  startX: number
  startSpec: EditSpec
  moved: boolean
}

type Drag =
  | { kind: 'seek' }
  | {
      kind: 'trim'
      edge: 'in' | 'out'
      index: number
      startX: number
      startSpec: EditSpec
    }
  | { kind: 'move'; index: number; startX: number; moved: boolean; target: number }
  | ({ kind: 'text' } & LayerDrag)
  | ({ kind: 'overlay' } & LayerDrag)

export function Timeline({
  spec,
  sources,
  strips,
  assetNames
}: {
  spec: EditSpec
  sources: Map<string, EditorSource>
  strips: Map<string, EditorStrips>
  /** Sticker file → its name in the library (for the sticker row's labels). */
  assetNames?: Map<string, string>
}): React.JSX.Element {
  const pxPerSec = useVideoEditor((s) => s.pxPerSec)
  const playhead = useVideoEditor((s) => s.playhead)
  const playing = useVideoEditor((s) => s.playing)
  const selected = useVideoEditor((s) => s.selected)
  const selectedText = useVideoEditor((s) => s.selectedText)
  const selectedOverlay = useVideoEditor((s) => s.selectedOverlay)
  const { select, selectText, selectOverlay, seek, change, commit, zoom } =
    useVideoEditor.getState()
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const total = editDuration(spec)
  const starts = segmentStarts(spec)
  const width = Math.max(total * pxPerSec + 240, 600)
  const step = STEPS.find((s) => s * pxPerSec >= 70) ?? 600

  /** Timeline seconds under the pointer. */
  function timeAt(clientX: number): number {
    const el = scrollRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return (clientX - rect.left + el.scrollLeft) / pxPerSec
  }

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const x = playhead * pxPerSec
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80
  }, [playhead, playing, pxPerSec])

  // ⌘ + scroll zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onWheel(e: WheelEvent): void {
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      const state = useVideoEditor.getState()
      const anchor = timeAt(e.clientX)
      const next = state.pxPerSec * Math.exp(-e.deltaY * 0.01)
      state.zoom(next)
      const applied = useVideoEditor.getState().pxPerSec
      if (scrollRef.current) {
        const rect = scrollRef.current.getBoundingClientRect()
        scrollRef.current.scrollLeft = anchor * applied - (e.clientX - rect.left)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timeAt reads refs and pxPerSec from the store
  }, [])

  function onSeekDown(e: React.PointerEvent): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind: 'seek' }
    seek(snapTime(timeAt(e.clientX)))
  }

  /** Snaps a time to the cuts when it's within a few pixels. */
  function snapTime(t: number): number {
    return snap(t, cutPoints(spec), SNAP_PX / pxPerSec)
  }

  function onLayerDown(
    e: React.PointerEvent,
    kind: 'text' | 'overlay',
    id: string,
    part: 'body' | 'start' | 'end'
  ): void {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (kind === 'text') selectText(id)
    else selectOverlay(id)
    drag.current = { kind, id, part, startX: e.clientX, startSpec: spec, moved: false }
  }

  function onHandleDown(e: React.PointerEvent, index: number, edge: 'in' | 'out'): void {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    select(index)
    drag.current = { kind: 'trim', edge, index, startX: e.clientX, startSpec: spec }
  }

  function onBlockDown(e: React.PointerEvent, index: number): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind: 'move', index, startX: e.clientX, moved: false, target: index }
  }

  function onMove(e: React.PointerEvent): void {
    const d = drag.current
    if (!d) return
    if (d.kind === 'seek') {
      seek(snapTime(timeAt(e.clientX)))
      return
    }
    if (d.kind === 'text' || d.kind === 'overlay') {
      const text =
        d.kind === 'text'
          ? d.startSpec.texts.find((x) => x.id === d.id)
          : (d.startSpec.overlays ?? []).find((x) => x.id === d.id)
      if (!text) return
      const move = d.kind === 'text' ? moveText : moveOverlay
      const retime = d.kind === 'text' ? retimeText : retimeOverlay
      const dSec = (e.clientX - d.startX) / pxPerSec
      if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return
      d.moved = true
      const targets = [playhead, ...cutPoints(d.startSpec)]
      const tolerance = SNAP_PX / pxPerSec
      if (d.part === 'body') {
        change(move(d.startSpec, d.id, snap(text.startSec + dSec, targets, tolerance)), {
          live: true
        })
      } else {
        const at = snap(
          (d.part === 'start' ? text.startSec : text.endSec) + dSec,
          targets,
          tolerance
        )
        change(retime(d.startSpec, d.id, d.part, at), { live: true })
      }
      return
    }
    if (d.kind === 'trim') {
      const base = d.startSpec.segments[d.index]
      const source = base ? sources.get(base.sourcePath) : undefined
      if (!base || !source) return
      const dSec = (e.clientX - d.startX) / pxPerSec
      if (d.edge === 'in') {
        const inSec = snap(base.inSec + dSec, [0], SNAP_PX / pxPerSec)
        change(trimIn(d.startSpec, d.index, inSec), { live: true })
      } else {
        // Snap where this segment ends on the timeline to the playhead and the other cuts.
        const start = segmentStarts(d.startSpec)[d.index] ?? 0
        const end = start + (base.outSec + dSec - base.inSec)
        const others = cutPoints(d.startSpec).filter((_, i) => i !== d.index + 1)
        const snapped = snap(end, [playhead, ...others], SNAP_PX / pxPerSec)
        change(trimOut(d.startSpec, d.index, snapped - start + base.inSec, source.durationSec), {
          live: true
        })
      }
      return
    }
    // Moving a block: past a few pixels it becomes a drag; find where it would drop.
    if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return
    d.moved = true
    const t = timeAt(e.clientX)
    let target = spec.segments.length
    for (let i = 0; i < spec.segments.length; i++) {
      const mid = (starts[i] as number) + segmentDuration(spec.segments[i] as EditSegment) / 2
      if (t < mid) {
        target = i
        break
      }
    }
    d.target = target
    setDropAt(target)
  }

  function onUp(e: React.PointerEvent): void {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'trim') commit()
    if (d.kind === 'text' || d.kind === 'overlay') {
      if (d.moved) commit()
      return
    }
    if (d.kind === 'move') {
      setDropAt(null)
      if (!d.moved) {
        // A click: select the block and put the playhead where you clicked.
        select(d.index)
        seek(timeAt(e.clientX))
        return
      }
      // Dropping before itself or right after itself changes nothing.
      const to = d.target > d.index ? d.target - 1 : d.target
      if (to !== d.index) {
        change(moveSegment(spec, d.index, to))
        select(to)
      }
    }
  }

  const ticks: number[] = []
  for (let t = 0; t <= total + step; t += step) ticks.push(t)

  return (
    <div className="border-t bg-card/60">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {spec.segments.length} piece{spec.segments.length === 1 ? '' : 's'} ·{' '}
          {formatClock(total, true)}
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="rounded px-1.5 hover:bg-muted"
            onClick={() => zoom(pxPerSec / 1.5)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="rounded px-1.5 hover:bg-muted"
            onClick={() => {
              const el = scrollRef.current
              if (el && total > 0) zoom((el.clientWidth - 60) / total)
            }}
          >
            Fit
          </button>
          <button
            type="button"
            className="rounded px-1.5 hover:bg-muted"
            onClick={() => zoom(pxPerSec * 1.5)}
            aria-label="Zoom in"
          >
            +
          </button>
        </span>
      </div>
      <div
        ref={scrollRef}
        className="relative overflow-x-auto overflow-y-hidden pb-2 select-none"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="relative" style={{ width, height: RULER_H + BODY_H }}>
          {/* Ruler */}
          <div
            className="absolute inset-x-0 top-0 cursor-text border-b border-border/60"
            style={{ height: RULER_H }}
            onPointerDown={onSeekDown}
          >
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 h-full border-l border-border/60 pl-1 text-[10px] leading-[22px] text-muted-foreground"
                style={{ left: t * pxPerSec }}
              >
                {formatClock(t)}
              </div>
            ))}
          </div>

          {/* Segments */}
          <div className="absolute inset-x-0" style={{ top: RULER_H + 4, height: TRACK_H }}>
            {spec.segments.map((segment, i) => {
              const source = sources.get(segment.sourcePath)
              const strip = strips.get(segment.sourcePath)
              const full = (source?.durationSec ?? segment.outSec) * pxPerSec
              const left = (starts[i] as number) * pxPerSec
              const w = Math.max(6, segmentDuration(segment) * pxPerSec)
              const isSelected = selected === i
              return (
                <div
                  key={`${i}-${segment.sourcePath}-${segment.inSec}`}
                  className={cn(
                    'absolute top-0 flex h-full cursor-grab flex-col overflow-hidden rounded-md border bg-muted active:cursor-grabbing',
                    isSelected ? 'border-primary ring-2 ring-primary/60' : 'border-border'
                  )}
                  style={{ left, width: w - 2 }}
                  onPointerDown={(e) => onBlockDown(e, i)}
                  title={source?.clipTitle ?? source?.fileName ?? segment.sourcePath}
                >
                  <div
                    className="min-h-0 flex-1 bg-no-repeat"
                    style={
                      strip?.filmstripUrl
                        ? {
                            backgroundImage: `url("${strip.filmstripUrl}")`,
                            backgroundSize: `${full}px 100%`,
                            backgroundPositionX: -segment.inSec * pxPerSec
                          }
                        : undefined
                    }
                  />
                  <div
                    className="h-5 shrink-0 bg-black/50 bg-no-repeat opacity-80"
                    style={
                      strip?.waveformUrl
                        ? {
                            backgroundImage: `url("${strip.waveformUrl}")`,
                            backgroundSize: `${full}px 100%`,
                            backgroundPositionX: -segment.inSec * pxPerSec
                          }
                        : undefined
                    }
                  />
                  <span className="pointer-events-none absolute top-1 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/60 px-1 text-[10px] text-white">
                    {source?.clipTitle ?? source?.fileName ?? '…'}
                  </span>
                  {/* Trim handles */}
                  <div
                    className="absolute inset-y-0 left-0 cursor-ew-resize bg-primary/0 hover:bg-primary/60"
                    style={{ width: HANDLE }}
                    onPointerDown={(e) => onHandleDown(e, i, 'in')}
                    role="separator"
                    aria-label="Trim the start"
                  />
                  <div
                    className="absolute inset-y-0 right-0 cursor-ew-resize bg-primary/0 hover:bg-primary/60"
                    style={{ width: HANDLE }}
                    onPointerDown={(e) => onHandleDown(e, i, 'out')}
                    role="separator"
                    aria-label="Trim the end"
                  />
                </div>
              )
            })}
            {dropAt !== null ? (
              <div
                className="absolute -top-1 w-0.5 rounded bg-primary"
                style={{
                  left: (starts[dropAt] ?? total) * pxPerSec - 2,
                  height: TRACK_H + 8
                }}
              />
            ) : null}
          </div>

          {/* Text layers */}
          <div
            className="absolute inset-x-0"
            style={{ top: RULER_H + TRACK_H + 10, height: TEXT_ROW_H }}
          >
            {spec.texts.map((text) => (
              <div
                key={text.id}
                className={cn(
                  'absolute top-0 flex h-full cursor-grab items-center overflow-hidden rounded border px-2 text-[11px] active:cursor-grabbing',
                  selectedText === text.id
                    ? 'border-brand bg-brand/30 text-foreground'
                    : 'border-brand/40 bg-brand/15 text-muted-foreground'
                )}
                style={{
                  left: text.startSec * pxPerSec,
                  width: Math.max(8, (text.endSec - text.startSec) * pxPerSec)
                }}
                onPointerDown={(e) => onLayerDown(e, 'text', text.id, 'body')}
                title={text.text}
              >
                <span className="pointer-events-none truncate">{text.text}</span>
                <div
                  className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-brand/70"
                  onPointerDown={(e) => onLayerDown(e, 'text', text.id, 'start')}
                  role="separator"
                  aria-label="Change when the text starts"
                />
                <div
                  className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-brand/70"
                  onPointerDown={(e) => onLayerDown(e, 'text', text.id, 'end')}
                  role="separator"
                  aria-label="Change when the text ends"
                />
              </div>
            ))}
          </div>

          {/* Stickers and logos */}
          <div
            className="absolute inset-x-0"
            style={{ top: RULER_H + TRACK_H + 14 + TEXT_ROW_H, height: TEXT_ROW_H }}
          >
            {(spec.overlays ?? []).map((o) => (
              <div
                key={o.id}
                className={cn(
                  'absolute top-0 flex h-full cursor-grab items-center overflow-hidden rounded border px-2 text-[11px] active:cursor-grabbing',
                  selectedOverlay === o.id
                    ? 'border-sky-400 bg-sky-400/30 text-foreground'
                    : 'border-sky-400/40 bg-sky-400/15 text-muted-foreground'
                )}
                style={{
                  left: o.startSec * pxPerSec,
                  width: Math.max(8, (o.endSec - o.startSec) * pxPerSec)
                }}
                onPointerDown={(e) => onLayerDown(e, 'overlay', o.id, 'body')}
                title={assetNames?.get(o.asset) ?? 'Sticker'}
              >
                <span className="pointer-events-none truncate">
                  {assetNames?.get(o.asset) ?? 'Sticker'}
                </span>
                <div
                  className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-sky-400/70"
                  onPointerDown={(e) => onLayerDown(e, 'overlay', o.id, 'start')}
                  role="separator"
                  aria-label="Change when the sticker starts"
                />
                <div
                  className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-sky-400/70"
                  onPointerDown={(e) => onLayerDown(e, 'overlay', o.id, 'end')}
                  role="separator"
                  aria-label="Change when the sticker ends"
                />
              </div>
            ))}
          </div>

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 w-px bg-brand"
            style={{ left: playhead * pxPerSec, height: RULER_H + BODY_H }}
          >
            <div className="absolute -top-0.5 -left-1 size-2.5 rotate-45 rounded-sm bg-brand" />
          </div>
        </div>
      </div>
    </div>
  )
}
