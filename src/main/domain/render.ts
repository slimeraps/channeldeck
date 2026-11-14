import { createHash } from 'node:crypto'
import type { LayoutKind } from '@shared/constants/enums'
import { even, facecamBandHeight, OUT_H, OUT_W, scaleRect } from '@shared/geometry'
import type { LayoutCrops } from '@shared/types/json'

// The geometry lives in @shared/geometry so the editor's preview uses the same math.
export { facecamBandHeight, OUT_H, OUT_W, scaleRect } from '@shared/geometry'

/**
 * Vertical (1080×1920) conversion of a landscape clip, as pure ffmpeg arguments. Three
 * layouts: blurred fill (the clip centered over a blurred, zoomed copy), center crop, and
 * facecam split (the facecam rectangle on top, the gameplay rectangle below).
 */

export interface RenderSpec {
  sourcePath: string
  kind: LayoutKind
  crops: LayoutCrops
}

/** Crop to fill: scale up until the box is covered, then cut the overflow. */
const fill = (w: number, h: number): string =>
  `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`

const finish = 'setsar=1,format=yuv420p'

/** Where a layout graph reads from and writes to, so several can share one filter_complex. */
export interface FilterLabels {
  /** Input pad, e.g. "0:v". */
  input: string
  /** Output pad, e.g. "v". */
  output: string
  /** Suffix for the graph's internal pads (unique per segment when joining clips). */
  tag: string
}

const DEFAULT_LABELS: FilterLabels = { input: '0:v', output: 'v', tag: '' }

/** The -filter_complex graph; by default it reads [0:v] and its output is labeled [v]. */
export function renderFilter(
  kind: LayoutKind,
  crops: LayoutCrops,
  video: { width: number; height: number },
  labels: FilterLabels = DEFAULT_LABELS
): string {
  const { input, output, tag } = labels
  const pad = (name: string) => `[${name}${tag}]`
  if (kind === 'facecam_split' && crops.facecam && crops.gameplay) {
    const fc = scaleRect(crops.facecam, crops, video)
    const gp = scaleRect(crops.gameplay, crops, video)
    const top = facecamBandHeight(fc)
    const bottom = OUT_H - top
    return [
      `[${input}]split=2${pad('fc')}${pad('gp')}`,
      `${pad('fc')}crop=${fc.width}:${fc.height}:${fc.x}:${fc.y},${fill(OUT_W, top)}${pad('top')}`,
      `${pad('gp')}crop=${gp.width}:${gp.height}:${gp.x}:${gp.y},${fill(OUT_W, bottom)}${pad('bot')}`,
      `${pad('top')}${pad('bot')}vstack=inputs=2,${finish}[${output}]`
    ].join(';')
  }
  if (kind === 'center_crop') {
    const width = even(Math.min(video.width, (video.height * 9) / 16))
    const x = even((video.width - width) / 2)
    return `[${input}]crop=${width}:${video.height - (video.height % 2)}:${x}:0,scale=${OUT_W}:${OUT_H},${finish}[${output}]`
  }
  // Blurred fill (also the fallback when a split layout has no rectangles yet). The
  // background is blurred at quarter size, which is much faster and looks the same.
  return [
    `[${input}]split=2${pad('bg')}${pad('fg')}`,
    `${pad('bg')}${fill(OUT_W / 4, OUT_H / 4)},boxblur=10:2,scale=${OUT_W}:${OUT_H},eq=brightness=-0.06${pad('bgb')}`,
    `${pad('fg')}scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease${pad('fgs')}`,
    `${pad('bgb')}${pad('fgs')}overlay=(W-w)/2:(H-h)/2,${finish}[${output}]`
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
