import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { CaptionWord } from '@shared/schemas/edit'
import { type WhisperJson, wordsFromWhisper } from '../domain/whisper'
import { UserFacingError } from '../errors'
import { resourcePath } from '../paths'
import { runFfmpeg } from './ffmpeg'

/**
 * Auto captions with whisper.cpp, entirely on this Mac. The whisper-cli binary is bundled
 * (scripts/build-whisper.sh); the speech model is downloaded once, after the user agrees, from
 * whisper.cpp's official model repository and checked against a pinned SHA-256.
 */

export const CAPTION_MODEL = {
  name: 'ggml-small.en-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin',
  sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30',
  sizeBytes: 190_098_681
} as const

export function whisperPath(): string {
  return resourcePath('bin/whisper-cli')
}

/**
 * Downloads the model to `dest` through a .part file, checking the size and SHA-256 before
 * the file is moved into place. Progress is reported as 0..1.
 */
export async function downloadModel(args: {
  dest: string
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  model?: { url: string; sha256: string; sizeBytes: number }
}): Promise<void> {
  const model = args.model ?? CAPTION_MODEL
  await mkdir(dirname(args.dest), { recursive: true })
  const part = `${args.dest}.part`
  try {
    const response = await (args.fetchImpl ?? fetch)(model.url, {
      ...(args.signal ? { signal: args.signal } : {})
    })
    if (!response.ok || !response.body) {
      throw new UserFacingError(
        `The caption model couldn't be downloaded (HTTP ${response.status}).`
      )
    }
    const hash = createHash('sha256')
    let received = 0
    let reported = 0
    const out = createWriteStream(part)
    const stream = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)
    for await (const chunk of stream) {
      const buffer = chunk as Buffer
      hash.update(buffer)
      received += buffer.length
      if (!out.write(buffer))
        await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      const fraction = Math.min(1, received / model.sizeBytes)
      if (fraction - reported >= 0.01) {
        reported = fraction
        args.onProgress?.(fraction)
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve()))
    )
    if (received !== model.sizeBytes || hash.digest('hex') !== model.sha256) {
      throw new UserFacingError(
        "The caption model didn't download correctly (its checksum doesn't match). Try again."
      )
    }
    await rename(part, args.dest)
    args.onProgress?.(1)
  } catch (error) {
    await rm(part, { force: true })
    if (args.signal?.aborted) throw new UserFacingError('Download canceled.')
    if (error instanceof UserFacingError) throw error
    throw new UserFacingError(
      `The caption model couldn't be downloaded: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}

function run(binary: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let log = ''
    child.stderr.on('data', (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-4000)
    })
    const abort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', reject)
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (code === 0) resolve()
      else
        reject(
          new Error(`whisper-cli exited with code ${code}: ${log.split('\n').slice(-4).join(' ')}`)
        )
    })
  })
}

/** Transcribes the speech in a video file into caption words (seconds in that file). */
export async function transcribe(args: {
  input: string
  model: string
  signal?: AbortSignal
  binary?: string
}): Promise<CaptionWord[]> {
  if (!existsSync(args.model)) throw new UserFacingError('Download the caption model first.')
  const work = await mkdtemp(join(tmpdir(), 'channeldeck-captions-'))
  try {
    const wav = join(work, 'audio.wav')
    // whisper.cpp wants 16 kHz mono PCM.
    await runFfmpeg(
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        args.input,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        wav
      ],
      args.signal ? { signal: args.signal } : {}
    )
    const out = join(work, 'out')
    await run(
      args.binary ?? whisperPath(),
      [
        '-m',
        args.model,
        '-f',
        wav,
        '-l',
        'en',
        '-t',
        String(Math.max(2, Math.min(8, availableParallelism()))),
        '-sns',
        '-np',
        '-ojf',
        '-of',
        out
      ],
      args.signal
    )
    const json = JSON.parse(await readFile(`${out}.json`, 'utf8')) as WhisperJson
    return wordsFromWhisper(json)
  } catch (error) {
    if (args.signal?.aborted) throw new UserFacingError('Captions canceled.')
    if (error instanceof UserFacingError) throw error
    throw new UserFacingError(
      `Couldn't make captions: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
