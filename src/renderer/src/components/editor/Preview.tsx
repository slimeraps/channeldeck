import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { locate } from '@shared/editOps'
import { CANVAS_SIZES } from '@shared/geometry'
import { type EditSegment, type EditSpec, editDuration, segmentStarts } from '@shared/schemas/edit'
import type { EditorSource } from '@shared/schemas/editor'
import { drawSegmentFrame } from '@renderer/lib/drawEdit'
import { useVideoEditor } from '@renderer/stores/videoEditor'

/**
 * The live preview: one hidden <video> per source, drawn onto a canvas framed exactly like the
 * render. While playing it moves from segment to segment and drives the playhead; while
 * paused it seeks to the playhead. The exact result is always one "Render now" away.
 */
export function Preview({
  spec,
  sources
}: {
  spec: EditSpec
  sources: Map<string, EditorSource>
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videos = useRef(new Map<string, HTMLVideoElement>())
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
  }, [])

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
        className="rounded-lg bg-black shadow-lg ring-1 ring-border"
        aria-label="Preview of the edit"
      />
      {waiting ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : null}
    </div>
  )
}
