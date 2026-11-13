import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { aspectRatioLabel, isLongVideo, isShortCandidate } from '@shared/schemas/post'
import { UserFacingError } from '../errors'

const execFileAsync = promisify(execFile)

/** ffprobe binary from @ffprobe-installer (arm64). Packaged apps read it outside the asar. */
export function ffprobePath(): string {
  return ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked')
}

export interface ProbeResult {
  path: string
  fileName: string
  sizeBytes: number
  mtimeMs: number
  durationSec: number
  /** Display width/height, after applying rotation (phone videos are often rotated 90°). */
  width: number
  height: number
  videoCodec: string | null
  aspectRatio: string
  isShort: boolean
  isLong: boolean
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  tags?: Record<string, string>
  side_data_list?: { rotation?: number | string }[]
}

interface FfprobeJson {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

/** Pure: turns ffprobe's JSON into the numbers the editor needs. */
export function parseProbeJson(
  json: FfprobeJson,
  file: { path: string; sizeBytes: number; mtimeMs: number }
): ProbeResult {
  const video = json.streams?.find((s) => s.codec_type === 'video' && s.width && s.height)
  if (!video?.width || !video.height) {
    throw new UserFacingError(
      `${basename(file.path)} doesn't contain a video track ChannelDeck can read.`
    )
  }
  const rotationRaw =
    video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
    video.tags?.['rotate'] ??
    0
  const rotation = Math.abs(Number(rotationRaw)) % 180
  const [width, height] =
    rotation === 90 ? [video.height, video.width] : [video.width, video.height]

  const durationSec = Number(json.format?.duration ?? video.duration ?? 0)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new UserFacingError(`ChannelDeck couldn't read the length of ${basename(file.path)}.`)
  }

  return {
    path: file.path,
    fileName: basename(file.path),
    sizeBytes: file.sizeBytes,
    mtimeMs: file.mtimeMs,
    durationSec,
    width,
    height,
    videoCodec: video.codec_name ?? null,
    aspectRatio: aspectRatioLabel(width, height),
    isShort: isShortCandidate({ width, height, durationSec }),
    isLong: isLongVideo(durationSec)
  }
}

export async function probeVideo(path: string): Promise<ProbeResult> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch {
    throw new UserFacingError(`File missing: ${path}`)
  }
  if (!info.isFile()) throw new UserFacingError(`${path} is not a file.`)

  let stdout: string
  try {
    ;({ stdout } = await execFileAsync(
      ffprobePath(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 }
    ))
  } catch (error) {
    throw new UserFacingError(`ChannelDeck couldn't read ${basename(path)}. Is it a video file?`, {
      cause: error
    })
  }
  return parseProbeJson(JSON.parse(stdout) as FfprobeJson, {
    path,
    sizeBytes: info.size,
    mtimeMs: Math.round(info.mtimeMs)
  })
}
