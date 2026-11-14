import {
  CANVAS_SIZES,
  type CanvasKind,
  facecamBandHeight,
  frameRect,
  OUT_H,
  OUT_W,
  scaleRect
} from '@shared/geometry'
import { type EditLayout, type EditSegment, segmentDuration } from '@shared/schemas/edit'
import type { CropRect } from '@shared/types/json'

/**
 * Draws one frame of a segment onto the editor's preview canvas, framed exactly as the ffmpeg
 * render frames it (main/domain/render.ts and main/domain/edit.ts), using the same geometry.
 * The canvas can be any size; positions are scaled from the 1080/1920 output.
 */

export interface FrameSource {
  image: CanvasImageSource
  width: number
  height: number
}

/** Draws the `src` rectangle of the image so it covers the destination box (crop to fill). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  src: CropRect,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const scale = Math.max(dw / src.width, dh / src.height)
  const sw = dw / scale
  const sh = dh / scale
  ctx.drawImage(
    source.image,
    src.x + (src.width - sw) / 2,
    src.y + (src.height - sh) / 2,
    sw,
    sh,
    dx,
    dy,
    dw,
    dh
  )
}

function drawVertical(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  segment: EditSegment,
  W: number,
  H: number
): void {
  const k = W / OUT_W
  const video = { width: source.width, height: source.height }
  const full = { x: 0, y: 0, width: source.width, height: source.height }
  const layout: Pick<EditLayout, 'kind' | 'crops'> = segment.layout ?? {
    kind: 'blur_fill',
    crops: {}
  }
  const { crops } = layout
  if (layout.kind === 'facecam_split' && crops.facecam && crops.gameplay) {
    const fc = scaleRect(crops.facecam, crops, video)
    const gp = scaleRect(crops.gameplay, crops, video)
    const top = facecamBandHeight(fc) * k
    drawCover(ctx, source, fc, 0, 0, W, top)
    drawCover(ctx, source, gp, 0, top, W, H - top)
    return
  }
  if (layout.kind === 'center_crop') {
    const width = Math.min(source.width, (source.height * 9) / 16)
    drawCover(
      ctx,
      source,
      { x: (source.width - width) / 2, y: 0, width, height: source.height },
      0,
      0,
      W,
      H
    )
    return
  }
  // Blurred fill: a darkened, blurred copy covering the frame, the whole clip on top.
  ctx.save()
  ctx.filter = `blur(${Math.max(2, 40 * k)}px) brightness(0.88)`
  drawCover(ctx, source, full, -40 * k, -40 * k, W + 80 * k, H + 80 * k)
  ctx.restore()
  const fit = Math.min(W / source.width, (OUT_H * k) / source.height)
  const w = source.width * fit
  const h = source.height * fit
  ctx.drawImage(source.image, (W - w) / 2, (H - h) / 2, w, h)
}

/** The part of the source shown at `localT` seconds into a horizontal or square segment. */
export function frameAt(
  segment: EditSegment,
  canvas: CanvasKind,
  video: { width: number; height: number },
  localT: number
): CropRect {
  const size = CANVAS_SIZES[canvas]
  const aspect = size.width / size.height
  const frame = segment.frame ?? { zoomStart: 1, zoomEnd: 1, cx: 0.5, cy: 0.5 }
  const center = { cx: frame.cx, cy: frame.cy }
  if (Math.abs(frame.zoomEnd - frame.zoomStart) < 0.001) {
    return frameRect(video, aspect, frame.zoomStart, center)
  }
  // Same as the render: zoom within the unzoomed frame, toward its middle.
  const base = frameRect(video, aspect, 1, center)
  const d = Math.max(0.001, segmentDuration(segment))
  const z =
    frame.zoomStart + (frame.zoomEnd - frame.zoomStart) * Math.min(1, Math.max(0, localT) / d)
  const width = base.width / z
  const height = base.height / z
  return {
    x: base.x + (base.width - width) / 2,
    y: base.y + (base.height - height) / 2,
    width,
    height
  }
}

/** Clears the canvas and draws the segment's frame for the canvas kind. */
export function drawSegmentFrame(
  ctx: CanvasRenderingContext2D,
  source: FrameSource,
  segment: EditSegment,
  canvas: CanvasKind,
  localT: number
): void {
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  if (!source.width || !source.height) return
  if (canvas === 'vertical') {
    drawVertical(ctx, source, segment, W, H)
    return
  }
  const r = frameAt(segment, canvas, source, localT)
  ctx.drawImage(source.image, r.x, r.y, r.width, r.height, 0, 0, W, H)
}
