import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { locate, setFrame, updateText } from '@shared/editOps'
import { CANVAS_SIZES, frameRect } from '@shared/geometry'
import {
  type EditSegment,
  type EditSpec,
  editDuration,
  fillEditText,
  segmentStarts
} from '@shared/schemas/edit'
import type { EditorSource } from '@shared/schemas/editor'
import { drawSegmentFrame } from '@renderer/lib/drawEdit'
import { drawTexts, type TextHit } from '@renderer/lib/drawText'
import { loadEditorFonts } from '@renderer/lib/fonts'
import { useVideoEditor } from '@renderer/stores/videoEditor'

/**
 * Areas of a vertical video that YouTube's Shorts player covers (output pixels, approximate):
 * the top bar, the like/comment/share buttons on the right, and the title and channel at the
 * bottom. Shown when "Guides" is on.
 */
const SHORTS_COVERED = [
  { x: 0, y: 0, width: 1080, height: 140 },
  { x: 900, y: 760, width: 180, height: 800 },
  { x: 0, y: 1480, width: 1080, height: 440 }
]

type PointerDrag =
  | { kind: 'text'; id: string; startX: number; startY: number; x: number; y: number }
  | {
      kind: 'pan'
      index: number
      startX: number
      startY: number
      cx: number
      cy: number
      perPixel: { x: number; y: number }
    }

/**
 * The live preview: one hidden <video> per source, drawn onto a canvas framed exactly like the
 * render. While playing it moves from segment to segment and drives the playhead; while
 * paused it seeks to the playhead. The exact result is always one "Render now" away.
 */
export function Preview({
  spec,
  sources,
  values
}: {
  spec: EditSpec
  sources: Map<string, EditorSource>
  /** Template values for text variables ({{clip_title}}…), from the first clip. */
  values: Record<string, string>
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const valuesRef = useRef(values)
  useLayoutEffect(() => {
    valuesRef.current = values
  }, [values])
  const hits = useRef<TextHit[]>([])
  const pointer = useRef<PointerDrag | null>(null)
  const selectedText = useVideoEditor((s) => s.selectedText)
  const showGuides = useVideoEditor((s) => s.showGuides)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [waiting, setWaiting] = useState(true)
  const playhead = useVideoEditor((s) => s.playhead)
  const playing = useVideoEditor((s) => s.playing)

  const size = CANVAS_SIZES[spec.canvas]

  /** Draws the frame under the playhead from whatever the video element shows now. */
  const drawNow = useCallback((segment?: EditSegment, localT?: number) => {
    const state = useVideoEditor.getState()
    const current = state.spec
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!current || !ctx) return
    const at = locate(current, state.playhead)
    const seg = segment ?? (current.segments[at.index] as EditSegment)
    const video = videos.current.get(seg.sourcePath)
    if (!video || video.readyState < 2) {
      setWaiting(true)
      return
    }
    setWaiting(false)
    drawSegmentFrame(
      ctx,
      { image: video, width: video.videoWidth, height: video.videoHeight },
      seg,
      current.canvas,
      localT ?? at.offset
    )
    const filled = fillEditText(current, valuesRef.current)
    hits.current = drawTexts(ctx, filled, filled.texts, state.playhead)

    const out = CANVAS_SIZES[current.canvas]
    const k = ctx.canvas.width / out.width
    ctx.save()
    ctx.scale(k, k)
    if (state.showGuides && current.canvas === 'vertical') {
      ctx.fillStyle = 'rgba(255, 166, 201, 0.22)'
      ctx.strokeStyle = 'rgba(255, 166, 201, 0.8)'
      ctx.lineWidth = 3 / k
      ctx.setLineDash([12, 10])
      for (const r of SHORTS_COVERED) {
        ctx.fillRect(r.x, r.y, r.width, r.height)
        ctx.strokeRect(r.x, r.y, r.width, r.height)
      }
    }
    const chosen = hits.current.find((h) => h.id === state.selectedText)
    if (chosen && !state.playing) {
      ctx.strokeStyle = '#ffa6c9'
      ctx.lineWidth = 2 / k
      ctx.setLineDash([8 / k, 6 / k])
      ctx.strokeRect(
        chosen.box.x - 8,
        chosen.box.y - 8,
        chosen.box.width + 16,
        chosen.box.height + 16
      )
    }
    ctx.restore()
  }, [])

  // The fonts load once; redraw when they're ready so text uses them.
  useEffect(() => {
    void loadEditorFonts().then(() => drawNow())
  }, [drawNow])

  // Redraw when the selection or the guides change (while paused).
  useEffect(() => {
    if (!playing) drawNow()
  }, [selectedText, showGuides, values, playing, drawNow])

  /** Output pixels under the pointer. */
  function outputPoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * size.width,
      y: ((e.clientY - rect.top) / rect.height) * size.height
    }
  }

  function onPointerDown(e: React.PointerEvent): void {
    const state = useVideoEditor.getState()
    const current = state.spec
    if (!current) return
    const at = outputPoint(e)
    // The text on top wins (texts are drawn in order, so search from the last one).
    const hit = [...hits.current]
      .reverse()
      .find(
        (h) =>
          at.x >= h.box.x - 12 &&
          at.x <= h.box.x + h.box.width + 12 &&
          at.y >= h.box.y - 12 &&
          at.y <= h.box.y + h.box.height + 12
      )
    e.currentTarget.setPointerCapture(e.pointerId)
    if (hit) {
      const text = current.texts.find((t) => t.id === hit.id)
      if (!text) return
      state.setPlaying(false)
      state.selectText(hit.id)
      pointer.current = {
        kind: 'text',
        id: hit.id,
        startX: at.x,
        startY: at.y,
        x: text.x,
        y: text.y
      }
      return
    }
    state.selectText(null)
    if (current.canvas === 'vertical') return
    // Horizontal and square: dragging the picture moves what part of the video is shown.
    const { index } = locate(current, state.playhead)
    const segment = current.segments[index] as EditSegment
    const video = videos.current.get(segment.sourcePath)
    const frame = segment.frame ?? { zoomStart: 1, zoomEnd: 1, cx: 0.5, cy: 0.5 }
    if (!video?.videoWidth) return
    const shown = frameRect(
      { width: video.videoWidth, height: video.videoHeight },
      size.width / size.height,
      frame.zoomStart,
      frame
    )
    state.select(index)
    pointer.current = {
      kind: 'pan',
      index,
      startX: at.x,
      startY: at.y,
      cx: frame.cx,
      cy: frame.cy,
      // One output pixel of drag moves the center by this share of the source frame.
      perPixel: {
        x: shown.width / size.width / video.videoWidth,
        y: shown.height / size.height / video.videoHeight
      }
    }
  }

  function onPointerMove(e: React.PointerEvent): void {
    const drag = pointer.current
    const state = useVideoEditor.getState()
    const current = state.spec
    if (!drag || !current) return
    const at = outputPoint(e)
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    if (drag.kind === 'text') {
      state.change(
        updateText(current, drag.id, {
          x: clamp(drag.x + (at.x - drag.startX) / size.width),
          y: clamp(drag.y + (at.y - drag.startY) / size.height)
        }),
        { live: true }
      )
      return
    }
    const segment = current.segments[drag.index]
    if (!segment) return
    const frame = segment.frame ?? { zoomStart: 1, zoomEnd: 1, cx: 0.5, cy: 0.5 }
    state.change(
      setFrame(current, drag.index, {
        ...frame,
        cx: clamp(drag.cx - (at.x - drag.startX) * drag.perPixel.x),
        cy: clamp(drag.cy - (at.y - drag.startY) * drag.perPixel.y)
      }),
      { live: true }
    )
  }

  function onPointerUp(): void {
    if (pointer.current) useVideoEditor.getState().commit()
    pointer.current = null
  }

  // One <video> per source file; removed when the edit stops using it.
  const paths = [...new Set(spec.segments.map((s) => s.sourcePath))]
  const pathsKey = paths.join('\n')
  useEffect(() => {
    const pool = videos.current
    for (const path of paths) {
      const source = sources.get(path)
      if (!source || pool.has(path)) continue
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.src = source.previewUrl
      video.addEventListener('loadeddata', () => drawNow())
      video.addEventListener('seeked', () => {
        if (!useVideoEditor.getState().playing) drawNow()
      })
      pool.set(path, video)
    }
    for (const [path, video] of pool) {
      if (!paths.includes(path)) {
        video.pause()
        video.removeAttribute('src')
        video.load()
        pool.delete(path)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathsKey stands for paths
  }, [pathsKey, sources, drawNow])

  useEffect(() => {
    const pool = videos.current
    return () => {
      for (const video of pool.values()) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      pool.clear()
    }
  }, [])

  // Fit the canvas to the space available, keeping the canvas's shape.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      const scale = Math.min(width / size.width, height / size.height)
      setBox({ width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [size.width, size.height])

  // Canvas pixels: the shown size at screen resolution, never more than the output itself.
  const ratio = Math.min(window.devicePixelRatio || 1, size.width / Math.max(1, box.width))
  const pixelWidth = Math.max(1, Math.round(box.width * ratio))
  const pixelHeight = Math.max(1, Math.round(box.height * ratio))
  useEffect(() => drawNow(), [pixelWidth, pixelHeight, drawNow])

  // Paused: show the frame under the playhead (also after any change to the edit).
  useEffect(() => {
    if (playing) return
    const at = locate(spec, playhead)
    const segment = spec.segments[at.index] as EditSegment
    const video = videos.current.get(segment.sourcePath)
    if (!video) return
    if (Math.abs(video.currentTime - at.sourceTime) > 0.01) video.currentTime = at.sourceTime
    else drawNow()
  }, [spec, playhead, playing, drawNow])

  // Playing: play each segment's video in turn and follow it with the playhead.
  useEffect(() => {
    if (!playing) return
    const state = useVideoEditor.getState()
    const starts = segmentStarts(spec)
    const total = editDuration(spec)
    let index = locate(spec, state.playhead).index
    let active: HTMLVideoElement | null = null
    let frame = 0

    function start(i: number, sourceTime: number): boolean {
      const segment = spec.segments[i]
      const video = segment ? videos.current.get(segment.sourcePath) : undefined
      if (!segment || !video) return false
      if (active && active !== video) {
        active.pause()
        active.muted = true
      }
      active = video
      index = i
      video.muted = false
      video.volume = Math.min(1, spec.volume)
      video.currentTime = sourceTime
      void video.play().catch(() => undefined)
      return true
    }

    function tick(): void {
      const segment = spec.segments[index] as EditSegment
      const video = active
      if (!video) return
      const local = Math.min(
        Math.max(0, video.currentTime - segment.inSec),
        segment.outSec - segment.inSec
      )
      useVideoEditor.getState().seek((starts[index] as number) + local)
      drawNow(segment, local)
      if (video.currentTime >= segment.outSec - 0.02 || video.ended) {
        const next = spec.segments[index + 1]
        if (!next || !start(index + 1, next.inSec)) {
          video.pause()
          useVideoEditor.getState().seek(total)
          useVideoEditor.getState().setPlaying(false)
          return
        }
      }
      frame = requestAnimationFrame(tick)
    }

    const at = locate(spec, state.playhead)
    if (!start(at.index, at.sourceTime)) {
      useVideoEditor.getState().setPlaying(false)
      return
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      if (active) {
        active.pause()
        active.muted = true
      }
    }
  }, [playing, spec, drawNow])

  return (
    <div ref={containerRef} className="relative grid min-h-0 min-w-0 flex-1 place-items-center p-4">
      <canvas
        ref={canvasRef}
        width={pixelWidth}
        height={pixelHeight}
        style={{ width: box.width, height: box.height }}
        className={
          'rounded-lg bg-black shadow-lg ring-1 ring-border ' +
          (spec.canvas === 'vertical' ? 'cursor-default' : 'cursor-grab active:cursor-grabbing')
        }
        aria-label="Preview of the edit"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {waiting ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : null}
    </div>
  )
}
