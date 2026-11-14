import type { CropRect, LayoutCrops } from './types/json'

/**
 * Frame geometry shared by the ffmpeg renders (main/domain/render.ts, main/domain/edit.ts)
 * and the editor's live preview, so what you see is what gets rendered. Pure math, no IO.
 */

/** Output canvases. A vertical render is 1080×1920 (YouTube Shorts). */
export const CANVAS_SIZES = {
  vertical: { width: 1080, height: 1920 },
  horizontal: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 }
} as const
export type CanvasKind = keyof typeof CANVAS_SIZES

export const OUT_W = CANVAS_SIZES.vertical.width
export const OUT_H = CANVAS_SIZES.vertical.height

/** Facecam band height limits in the split layout. */
export const FACECAM_MIN_H = 480
export const FACECAM_MAX_H = 960

/** The nearest even number, at least 2 (x264 needs even frame sizes). */
export const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2))

/** Scales a rectangle drawn on the sample frame to the real video size, clamped and even. */
export function scaleRect(
  rect: CropRect,
  crops: Pick<LayoutCrops, 'sourceWidth' | 'sourceHeight'>,
  video: { width: number; height: number }
): CropRect {
  const sx = crops.sourceWidth ? video.width / crops.sourceWidth : 1
  const sy = crops.sourceHeight ? video.height / crops.sourceHeight : 1
  let x = Math.max(0, Math.round(rect.x * sx))
  let y = Math.max(0, Math.round(rect.y * sy))
  let width = even(Math.min(rect.width * sx, video.width))
  let height = even(Math.min(rect.height * sy, video.height))
  if (x + width > video.width) x = Math.max(0, video.width - width)
  if (y + height > video.height) y = Math.max(0, video.height - height)
  width = Math.min(width, video.width - (video.width % 2))
  height = Math.min(height, video.height - (video.height % 2))
  return { x: x - (x % 2), y: y - (y % 2), width, height }
}

/** Height of the facecam band: the facecam's own shape at full width, within limits. */
export function facecamBandHeight(facecam: CropRect, outWidth: number = OUT_W): number {
  const natural = (outWidth * facecam.height) / Math.max(1, facecam.width)
  return even(Math.min(FACECAM_MAX_H, Math.max(FACECAM_MIN_H, natural)))
}

/**
 * The largest rectangle of `aspect` (width / height) that fits in the video, centered, then
 * zoomed in by `zoom` (1 = no zoom) around the point (cx, cy) given as 0–1 of the frame.
 * Used for the horizontal and square canvases' "frame" (crop and zoom).
 */
export function frameRect(
  video: { width: number; height: number },
  aspect: number,
  zoom = 1,
  center: { cx: number; cy: number } = { cx: 0.5, cy: 0.5 }
): CropRect {
  let width = video.width
  let height = width / aspect
  if (height > video.height) {
    height = video.height
    width = height * aspect
  }
  const z = Math.max(1, zoom)
  width = Math.min(evenDown(width / z), evenDown(video.width))
  height = Math.min(evenDown(height / z), evenDown(video.height))
  const clamp = (v: number, max: number) => evenDown(Math.min(Math.max(0, v), max))
  return {
    x: clamp(center.cx * video.width - width / 2, video.width - width),
    y: clamp(center.cy * video.height - height / 2, video.height - height),
    width,
    height
  }
}

/** Rounds down to an even number (offsets and sizes that must stay inside the frame). */
export const evenDown = (n: number): number => Math.max(0, 2 * Math.floor(n / 2))
