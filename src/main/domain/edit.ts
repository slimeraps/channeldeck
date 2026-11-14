import { createHash } from 'node:crypto'
import { CANVAS_SIZES, even, frameRect } from '@shared/geometry'
import { type EditSegment, type EditSpec, segmentDuration } from '@shared/schemas/edit'
import { renderFilter } from './render'

/**
 * An EditSpec as pure ffmpeg arguments (PLAN.md → Editor, E1). Each segment is its own
 * input, cut with input seeking (`-ss` + `-t` before `-i`, accurate when re-encoding), then
 * framed for the canvas: a vertical layout (the same graphs as the older vertical renders) or
 * a crop of the canvas's shape with an optional zoom. Segments are joined with `concat`, text
 * comes from an ASS file drawn by libass, and the original audio's volume is applied last.
 * Every segment gets a stereo 48 kHz track (silence if the source has none) so joins line up.
 */

export interface SourceInfo {
  width: number
  height: number
  durationSec: number
  /** Frames per second (unknown → 30). */
  fps?: number
  /** Whether the file has audio (unknown → treated as silent). */
  hasAudio?: boolean
}

export interface EditRenderOptions {
  /** The .ass file with the text layers, or null when there are none. */
  assPath: string | null
  /** Folder with the bundled fonts (resources/fonts). */
  fontsDir: string
}

const MAX_FPS = 60
const DEFAULT_FPS = 30
const SAMPLE_RATE = 48_000

/** Output frame rate: the sources' own if they agree, else the fastest (at most 60). */
export function outputFps(sources: readonly SourceInfo[]): number {
  const rates = sources.map((s) => s.fps ?? DEFAULT_FPS)
  const fastest = Math.min(MAX_FPS, Math.max(...rates))
  return Math.round(fastest * 1000) / 1000
}

/** Seconds as an ffmpeg time, millisecond precision. */
const time = (sec: number): string => (Math.round(sec * 1000) / 1000).toFixed(3)

/**
 * A path inside a filter option. Rather than juggle ffmpeg's two levels of escaping, refuse
 * the few characters that would need it; our paths (temp files, the app's fonts folder)
 * never contain them.
 */
export function filterPath(path: string): string {
  if (/['\\:\n\r]/.test(path)) {
    throw new Error(`Can't use this path in an ffmpeg filter: ${path}`)
  }
  return `'${path}'`
}

/** One segment's framing for a horizontal or square canvas: crop, then zoom if asked. */
function frameChain(
  segment: EditSegment,
  source: SourceInfo,
  canvas: { width: number; height: number },
  fps: number
): string {
  const frame = segment.frame ?? { zoomStart: 1, zoomEnd: 1, cx: 0.5, cy: 0.5 }
  const aspect = canvas.width / canvas.height
  const center = { cx: frame.cx, cy: frame.cy }
  const size = `${canvas.width}:${canvas.height}`
  if (Math.abs(frame.zoomEnd - frame.zoomStart) < 0.001) {
    const r = frameRect(source, aspect, frame.zoomStart, center)
    return `crop=${r.width}:${r.height}:${r.x}:${r.y},scale=${size},fps=${fps}`
  }
  // A zoom over time: crop the unzoomed frame, scale it to twice the canvas (zoompan steps
  // in whole pixels, so working larger keeps the motion smooth), then zoom in steps per frame.
  const base = frameRect(source, aspect, 1, center)
  const d = Math.max(0.001, segmentDuration(segment))
  const z = `${frame.zoomStart}+(${frame.zoomEnd}-${frame.zoomStart})*min(1,in_time/${d})`
  return [
    `crop=${base.width}:${base.height}:${base.x}:${base.y}`,
    `scale=${even(canvas.width * 2)}:${even(canvas.height * 2)}`,
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${canvas.width}x${canvas.height}:fps=${fps}`
  ].join(',')
}

/** The -filter_complex graph. Outputs [v] and [a]. */
export function editFilter(
  spec: EditSpec,
  sources: readonly SourceInfo[],
  options: EditRenderOptions
): string {
  if (sources.length !== spec.segments.length) {
    throw new Error('Every segment needs its source info')
  }
  const canvas = CANVAS_SIZES[spec.canvas]
  const fps = outputFps(sources)
  const parts: string[] = []

  spec.segments.forEach((segment, i) => {
    const source = sources[i] as SourceInfo
    const d = time(segmentDuration(segment))
    if (spec.canvas === 'vertical') {
      const layout = segment.layout ?? { kind: 'blur_fill' as const, presetId: null, crops: {} }
      parts.push(`[${i}:v]setpts=PTS-STARTPTS[in${i}]`)
      parts.push(
        renderFilter(layout.kind, layout.crops, source, {
          input: `in${i}`,
          output: `lay${i}`,
          tag: `_${i}`
        })
      )
      parts.push(`[lay${i}]fps=${fps},setsar=1,format=yuv420p[v${i}]`)
    } else {
      parts.push(
        `[${i}:v]setpts=PTS-STARTPTS,${frameChain(segment, source, canvas, fps)},setsar=1,format=yuv420p[v${i}]`
      )
    }
    parts.push(
      source.hasAudio
        ? `[${i}:a]asetpts=PTS-STARTPTS,aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${d}[a${i}]`
        : `anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=0:${d},aformat=sample_fmts=fltp[a${i}]`
    )
  })

  const n = spec.segments.length
  if (n === 1) {
    parts.push('[v0]null[vc]', '[a0]anull[ac]')
  } else {
    const pads = spec.segments.map((_, i) => `[v${i}][a${i}]`).join('')
    parts.push(`${pads}concat=n=${n}:v=1:a=1[vc][ac]`)
  }

  parts.push(
    options.assPath
      ? `[vc]ass=filename=${filterPath(options.assPath)}:fontsdir=${filterPath(options.fontsDir)}[v]`
      : '[vc]null[v]'
  )
  parts.push(spec.volume === 1 ? '[ac]anull[a]' : `[ac]volume=${spec.volume}[a]`)
  return parts.join(';')
}

/** The whole ffmpeg command line for an edit. */
export function editArgs(args: { spec: EditSpec; filter: string; output: string }): string[] {
  const inputs = args.spec.segments.flatMap((s) => [
    '-ss',
    time(s.inSec),
    '-t',
    time(segmentDuration(s)),
    '-i',
    s.sourcePath
  ])
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    ...inputs,
    '-filter_complex',
    args.filter,
    '-map',
    '[v]',
    '-map',
    '[a]',
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
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'mp4',
    args.output
  ]
}

/**
 * File name for an edit's render in the renders folder: named after the first source, with a
 * hash of the whole edit, so the same edit reuses its file and any change makes a new one.
 */
export function editFileName(spec: EditSpec): string {
  const first = spec.segments[0]?.sourcePath ?? 'video'
  const base = (first.split('/').pop() ?? 'video')
    .replace(/\.[^.]+$/, '')
    .replace(/_(landscape|portrait)$/, '')
    .slice(0, 80)
  const hash = createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 10)
  return `${base}_edit_${hash}.mp4`
}
