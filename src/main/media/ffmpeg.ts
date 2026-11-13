import { spawn } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { renderArgs, renderFilter, type RenderSpec } from '../domain/render'
import { UserFacingError } from '../errors'

/**
 * Runs the bundled ffmpeg (ffmpeg-static, arm64) for vertical renders and sample frames.
 * Packaged apps read the binary outside the asar.
 */

export function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg-static has no binary for this platform')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

export interface RunOptions {
  signal?: AbortSignal
  /** Called with 0..1 as the output advances (needs `durationSec`). */
  onProgress?: (fraction: number) => void
  durationSec?: number
  binary?: string
}

/** Runs ffmpeg; rejects with the last lines of its log on failure. */
export function runFfmpeg(args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary ?? ffmpegPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.signal ? { signal: options.signal } : {})
    })
    let stderr = ''
    let progressBuffer = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      if (!options.onProgress || !options.durationSec) return
      progressBuffer += chunk.toString()
      const lines = progressBuffer.split('\n')
      progressBuffer = lines.pop() ?? ''
      for (const line of lines) {
        // -progress pipe:1 reports out_time_us (microseconds of output written).
        const match = /^out_time_us=(\d+)/.exec(line)
        if (match) {
          const seconds = Number(match[1]) / 1_000_000
          options.onProgress(Math.min(1, seconds / options.durationSec))
        }
      }
    })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else {
        const tail = stderr.trim().split('\n').slice(-3).join(' | ')
        reject(new Error(`ffmpeg exited with code ${code}: ${tail}`))
      }
    })
  })
}

/** Converts a landscape clip to 1080×1920 at `output` (written to .part, then renamed). */
export async function renderVertical(args: {
  spec: RenderSpec
  video: { width: number; height: number; durationSec: number }
  output: string
  maxSeconds?: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  binary?: string
}): Promise<void> {
  await mkdir(dirname(args.output), { recursive: true })
  const part = `${args.output}.part`
  const filter = renderFilter(args.spec.kind, args.spec.crops, args.video)
  try {
    await runFfmpeg(
      renderArgs({
        input: args.spec.sourcePath,
        output: part,
        filter,
        ...(args.maxSeconds ? { maxSeconds: args.maxSeconds } : {})
      }),
      {
        durationSec: Math.min(args.video.durationSec, args.maxSeconds ?? Infinity),
        ...(args.signal ? { signal: args.signal } : {}),
        ...(args.onProgress ? { onProgress: args.onProgress } : {}),
        ...(args.binary ? { binary: args.binary } : {})
      }
    )
    await rename(part, args.output)
  } catch (error) {
    await rm(part, { force: true })
    if (args.signal?.aborted) throw error
    throw new UserFacingError(
      `Couldn't convert the clip to vertical: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}

/** Saves one frame as a JPEG (for the crop editor). */
export async function grabFrame(args: {
  input: string
  atSec: number
  output: string
  binary?: string
}): Promise<void> {
  await mkdir(dirname(args.output), { recursive: true })
  await runFfmpeg(
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-ss',
      args.atSec.toFixed(2),
      '-i',
      args.input,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-f',
      'image2',
      args.output
    ],
    args.binary ? { binary: args.binary } : {}
  )
}
