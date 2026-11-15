import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runFfmpeg } from './ffmpeg'
import { downloadModel, transcribe } from './whisper'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cd-whisper-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('downloadModel', () => {
  const bytes = Buffer.from('pretend model bytes '.repeat(500))
  const model = {
    url: 'https://example.test/model.bin',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length
  }
  const serve = (body: Buffer) =>
    (async () => new Response(new Uint8Array(body), { status: 200 })) as unknown as typeof fetch

  it('saves the model once its checksum matches, reporting progress', async () => {
    const dest = join(dir, 'models', 'ok.bin')
    const progress: number[] = []
    await downloadModel({
      dest,
      model,
      fetchImpl: serve(bytes),
      onProgress: (f) => progress.push(f)
    })
    expect(readFileSync(dest).equals(bytes)).toBe(true)
    expect(progress.at(-1)).toBe(1)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('refuses a file that was changed on the way, and leaves nothing behind', async () => {
    const dest = join(dir, 'models', 'bad.bin')
    const tampered = Buffer.from(bytes)
    tampered[0] = 0
    await expect(downloadModel({ dest, model, fetchImpl: serve(tampered) })).rejects.toThrow(
      /checksum doesn't match/
    )
    expect(existsSync(dest) || existsSync(`${dest}.part`)).toBe(false)
  })
})

// A real transcription, when a model is available (the CI and most test runs skip it):
// CHANNELDECK_TEST_WHISPER_MODEL=/path/to/ggml-small.en-q5_1.bin npm test
const MODEL = process.env['CHANNELDECK_TEST_WHISPER_MODEL']
const BINARY = resolve(import.meta.dirname, '../../../resources/bin/whisper-cli')

describe.skipIf(!MODEL || process.platform !== 'darwin')(
  'transcribe with the bundled whisper-cli',
  () => {
    it('turns speech into timed words', async () => {
      const speech = join(dir, 'speech.aiff')
      const video = join(dir, 'speech.mp4')
      execFileSync('say', ['-o', speech, 'This is a caption test for the editor.'])
      await runFfmpeg([
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=320x240:r=10',
        '-i',
        speech,
        '-shortest',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        video
      ])
      const words = await transcribe({ input: video, model: MODEL as string, binary: BINARY })
      const text = words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, '')).join(' ')
      expect(text).toContain('caption test')
      expect(words.every((w) => w.endSec > w.startSec)).toBe(true)
      expect(words.map((w) => w.startSec)).toEqual(
        [...words.map((w) => w.startSec)].sort((a, b) => a - b)
      )
    }, 120_000)
  }
)
