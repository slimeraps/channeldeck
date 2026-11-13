import { createHash } from 'node:crypto'
import type { LayoutKind } from '@shared/constants/enums'
import type { CropRect, LayoutCrops } from '@shared/types/json'

/**
 * Vertical (1080×1920) conversion of a landscape clip, as pure ffmpeg arguments. Three
 * layouts: blurred fill (the clip centered over a blurred, zoomed copy), center crop, and
 * facecam split (the facecam rectangle on top, the gameplay rectangle below).
 */

export const OUT_W = 1080
export const OUT_H = 1920
/** Facecam band height limits in the split layout. */
const FACECAM_MIN_H = 480
const FACECAM_MAX_H = 960

export interface RenderSpec {
  sourcePath: string
  kind: LayoutKind
  crops: LayoutCrops
}

const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2))

/** Scales a rectangle drawn on the sample frame to the real video size, clamped and even. */
export function scaleRect(
  rect: CropRect,
  crops: LayoutCrops,
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
export function facecamBandHeight(facecam: CropRect): number {
  const natural = (OUT_W * facecam.height) / Math.max(1, facecam.width)
  return even(Math.min(FACECAM_MAX_H, Math.max(FACECAM_MIN_H, natural)))
}

/** Crop to fill: scale up until the box is covered, then cut the overflow. */
const fill = (w: number, h: number): string =>
  `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`

const finish = 'setsar=1,format=yuv420p'

/** The -filter_complex graph; its output is labeled [v]. */
export function renderFilter(
  kind: LayoutKind,
  crops: LayoutCrops,
  video: { width: number; height: number }
): string {
  if (kind === 'facecam_split' && crops.facecam && crops.gameplay) {
    const fc = scaleRect(crops.facecam, crops, video)
    const gp = scaleRect(crops.gameplay, crops, video)
    const top = facecamBandHeight(fc)
    const bottom = OUT_H - top
    return [
      '[0:v]split=2[fc][gp]',
      `[fc]crop=${fc.width}:${fc.height}:${fc.x}:${fc.y},${fill(OUT_W, top)}[top]`,
      `[gp]crop=${gp.width}:${gp.height}:${gp.x}:${gp.y},${fill(OUT_W, bottom)}[bot]`,
      `[top][bot]vstack=inputs=2,${finish}[v]`
    ].join(';')
  }
  if (kind === 'center_crop') {
    const width = even(Math.min(video.width, (video.height * 9) / 16))
    const x = even((video.width - width) / 2)
    return `[0:v]crop=${width}:${video.height - (video.height % 2)}:${x}:0,scale=${OUT_W}:${OUT_H},${finish}[v]`
  }
  // Blurred fill (also the fallback when a split layout has no rectangles yet). The
  // background is blurred at quarter size, which is much faster and looks the same.
  return [
    '[0:v]split=2[bg][fg]',
    `[bg]${fill(OUT_W / 4, OUT_H / 4)},boxblur=10:2,scale=${OUT_W}:${OUT_H},eq=brightness=-0.06[bgb]`,
    `[fg]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${finish}[v]`
  ].join(';')
}

export function renderArgs(args: {
  input: string
  output: string
  filter: string
  /** Stop after this many seconds (Shorts are ≤ 3 minutes; test renders are a few seconds). */
  maxSeconds?: number
}): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    args.input,
    '-filter_complex',
    args.filter,
    '-map',
    '[v]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    ...(args.maxSeconds ? ['-t', String(args.maxSeconds)] : []),
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'mp4',
    args.output
  ]
}

/**
 * File name for a vertical render of `sourcePath` with a layout, in the renders folder
 * (PLAN.md decision 11). The name includes a hash of the source and the layout, so the same
 * render is reused (e.g. "Render now" in the editor, then the upload) and a changed layout
 * never picks up a stale file.
 */
export function renderFileName(sourcePath: string, kind: LayoutKind, crops: LayoutCrops): string {
  const base = (sourcePath.split('/').pop() ?? 'video')
    .replace(/\.[^.]+$/, '')
    .replace(/_(landscape|portrait)$/, '')
    .slice(0, 80)
  const hash = createHash('sha256')
    .update(JSON.stringify([sourcePath, kind, kind === 'facecam_split' ? crops : {}]))
    .digest('hex')
    .slice(0, 8)
  return `${base}_${kind}_${hash}.mp4`
}
