import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { captionEvents } from '@shared/captions'
import { type EditSpec, editDuration, overlaysOf } from '@shared/schemas/edit'
import { buildAss } from '../domain/ass'
import { editArgs, editFilter, type SourceInfo } from '../domain/edit'
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

/**
 * Renders an edit (trim, join, layout or crop and zoom, text) to `output`, through a .part
 * file. `sources` holds each segment's probe, in segment order. Text layers go through a
 * temporary .ass file that is removed afterwards.
 */
export async function renderEdit(args: {
  spec: EditSpec
  sources: readonly SourceInfo[]
  output: string
  fontsDir: string
  /** The sticker library (userData/editor-assets); stickers name files in it. */
  assetsDir: string
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
  binary?: string
}): Promise<void> {
  const stickerPaths = overlaysOf(args.spec).map((o) => join(args.assetsDir, o.asset))
  const gone = stickerPaths.find((path) => !existsSync(path))
  if (gone) {
    throw new UserFacingError(
      `A sticker in this edit was removed from the library (${basename(gone)}). Delete it from the edit or import it again.`
    )
  }
  await mkdir(dirname(args.output), { recursive: true })
  const part = `${args.output}.part`
  const work = await mkdtemp(join(tmpdir(), 'channeldeck-edit-'))
  try {
    let assPath: string | null = null
    const captions = captionEvents(args.spec)
    if (args.spec.texts.length > 0 || captions.length > 0) {
      assPath = join(work, 'text.ass')
      const style = args.spec.captions?.style
      await writeFile(
        assPath,
        buildAss(
          args.spec.canvas,
          args.spec.texts,
          style && captions.length > 0 ? { events: captions, style } : undefined
        ),
        'utf8'
      )
    }
    const filter = editFilter(args.spec, args.sources, { assPath, fontsDir: args.fontsDir })
    await runFfmpeg(editArgs({ spec: args.spec, filter, output: part, stickerPaths }), {
      durationSec: editDuration(args.spec),
      ...(args.signal ? { signal: args.signal } : {}),
      ...(args.onProgress ? { onProgress: args.onProgress } : {}),
      ...(args.binary ? { binary: args.binary } : {})
    })
    await rename(part, args.output)
  } catch (error) {
    await rm(part, { force: true })
    if (args.signal?.aborted) throw error
    throw new UserFacingError(
      `Couldn't render the edit: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Tiles across a filmstrip: about one a second, between 8 and 60. */
export function filmstripFrames(durationSec: number): number {
  return Math.max(8, Math.min(60, Math.ceil(durationSec)))
}

/**
 * A filmstrip for the editor's timeline: `frames` small frames spread evenly over the whole
 * video, side by side in one JPEG (160 px wide each).
 */
export async function makeFilmstrip(args: {
  input: string
  output: string
  durationSec: number
  frames: number
  binary?: string
}): Promise<void> {
  await mkdir(dirname(args.output), { recursive: true })
  const rate = args.frames / Math.max(0.1, args.durationSec)
  await runFfmpeg(
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      args.input,
      '-an',
      '-vf',
      `fps=${rate.toFixed(6)},scale=160:-2,tile=${args.frames}x1`,
      '-frames:v',
      '1',
      '-q:v',
      '5',
      args.output
    ],
    args.binary ? { binary: args.binary } : {}
  )
}

/** The audio's waveform over the whole video, as a light PNG on transparent. */
export async function makeWaveform(args: {
  input: string
  output: string
  binary?: string
}): Promise<void> {
  await mkdir(dirname(args.output), { recursive: true })
  await runFfmpeg(
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      args.input,
      '-filter_complex',
      'aformat=channel_layouts=mono,showwavespic=s=2400x96:colors=0xf5f7fa',
      '-frames:v',
      '1',
      args.output
    ],
    args.binary ? { binary: args.binary } : {}
  )
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
