import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grabFrame, renderVertical, runFfmpeg } from './ffmpeg'
import { probeVideo } from './ffprobe'

// Real ffmpeg + ffprobe on a generated 1920×1080 clip with audio (about a second of work).
let dir: string
let source: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cd-ffmpeg-'))
  source = join(dir, 'landscape.mp4')
  await runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1920x1080:rate=30:duration=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    source
  ])
}, 60_000)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const video = { width: 1920, height: 1080, durationSec: 2 }

describe('renderVertical', () => {
  it.each([
    ['blur_fill', {}],
    ['center_crop', {}],
    [
      'facecam_split',
      {
        facecam: { x: 1440, y: 0, width: 480, height: 270 },
        gameplay: { x: 420, y: 0, width: 1080, height: 1080 },
        sourceWidth: 1920,
        sourceHeight: 1080
      }
    ]
  ] as const)(
    'renders %s to a 1080×1920 video with audio',
    async (kind, crops) => {
      const output = join(dir, 'out', `${kind}.mp4`)
      const progress: number[] = []
      await renderVertical({
        spec: { sourcePath: source, kind, crops },
        video,
        output,
        onProgress: (f) => progress.push(f)
      })
      expect(existsSync(`${output}.part`)).toBe(false)
      const probe = await probeVideo(output)
      expect(probe).toMatchObject({ width: 1080, height: 1920, isShort: true })
      expect(probe.durationSec).toBeGreaterThan(1.5)
      expect(progress.at(-1)).toBeGreaterThan(0.5)
    },
    60_000
  )

  it('stops at maxSeconds (test renders)', async () => {
    const output = join(dir, 'out', 'short.mp4')
    await renderVertical({
      spec: { sourcePath: source, kind: 'blur_fill', crops: {} },
      video,
      output,
      maxSeconds: 1
    })
    expect((await probeVideo(output)).durationSec).toBeLessThan(1.5)
  }, 60_000)

  it('fails with a readable message and leaves no partial file', async () => {
    const output = join(dir, 'out', 'broken.mp4')
    await expect(
      renderVertical({
        spec: { sourcePath: join(dir, 'missing.mp4'), kind: 'blur_fill', crops: {} },
        video,
        output
      })
    ).rejects.toThrow(/Couldn't convert the clip to vertical: ffmpeg exited/)
    expect(existsSync(output)).toBe(false)
    expect(existsSync(`${output}.part`)).toBe(false)
  }, 60_000)
})

describe('grabFrame', () => {
  it('saves a JPEG of one frame', async () => {
    const output = join(dir, 'frames', 'f.jpg')
    await grabFrame({ input: source, atSec: 1, output })
    expect(statSync(output).size).toBeGreaterThan(1000)
  }, 30_000)
})
