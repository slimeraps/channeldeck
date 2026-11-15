import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, type EditSpec, type EditText } from '@shared/schemas/edit'
import { ffmpegPath, renderEdit, runFfmpeg } from './ffmpeg'
import { probeVideo } from './ffprobe'

// Real ffmpeg + libass on generated clips: a 1920×1080 30 fps clip with audio, a silent
// 1280×720 60 fps clip, and a black clip for checking that text is really drawn.
const FONTS = resolve(import.meta.dirname, '../../../resources/fonts')
let ASSETS: string
let dir: string
let withAudio: string
let silent: string
let black: string

function generate(output: string, video: string, audio: string | null): Promise<void> {
  return runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    video,
    ...(audio ? ['-f', 'lavfi', '-i', audio, '-c:a', 'aac', '-shortest'] : []),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    output
  ])
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cd-edit-'))
  withAudio = join(dir, 'with-audio_landscape.mp4')
  silent = join(dir, 'silent.mp4')
  black = join(dir, 'black.mp4')
  ASSETS = join(dir, 'assets')
  mkdirSync(ASSETS, { recursive: true })
  await Promise.all([
    runFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=200x200,format=rgba',
      '-frames:v',
      '1',
      join(ASSETS, 'aaaaaaaaaaaaaaaa.png')
    ]),
    runFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=s=120x120:r=10:d=1',
      join(ASSETS, 'bbbbbbbbbbbbbbbb.gif')
    ]),
    generate(
      withAudio,
      'testsrc2=size=1920x1080:rate=30:duration=3',
      'sine=frequency=440:duration=3'
    ),
    generate(silent, 'testsrc=size=1280x720:rate=60:duration=2', null),
    generate(black, 'color=c=black:size=1920x1080:rate=30:duration=2', null)
  ])
}, 60_000)

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const text = (o: Partial<EditText> = {}): EditText => ({
  id: 't1',
  text: 'BIG PLAY',
  startSec: 0.2,
  endSec: 1.4,
  x: 0.5,
  y: 0.5,
  style: DEFAULT_TEXT_STYLE,
  animation: 'none',
  ...o
})

const spec = (o: Partial<EditSpec>): EditSpec => ({
  version: 2,
  canvas: 'vertical',
  segments: [],
  texts: [],
  volume: 1,
  ...o
})

async function render(edit: EditSpec, name: string): Promise<string> {
  const sources = await Promise.all(edit.segments.map((s) => probeVideo(s.sourcePath)))
  const output = join(dir, 'out', `${name}.mp4`)
  await renderEdit({ spec: edit, sources, output, fontsDir: FONTS, assetsDir: ASSETS })
  expect(existsSync(`${output}.part`)).toBe(false)
  return output
}

/** Average brightness (0–255) of a region of the frame at `atSec`. */
function brightness(
  file: string,
  atSec: number,
  region: { w: number; h: number; x: number; y: number }
): Promise<number> {
  return new Promise((done, fail) => {
    const child = spawn(ffmpegPath(), [
      '-hide_banner',
      '-ss',
      String(atSec),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `crop=${region.w}:${region.h}:${region.x}:${region.y},signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      '-f',
      'null',
      '-'
    ])
    let log = ''
    child.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()))
    child.on('error', fail)
    child.on('close', () => {
      const match = /YAVG=([\d.]+)/.exec(log)
      if (match?.[1]) done(Number(match[1]))
      else fail(new Error(`No brightness in ffmpeg output:\n${log.slice(-800)}`))
    })
  })
}

describe('renderEdit', () => {
  it('trims and joins two clips into a vertical video, with layouts, text and audio', async () => {
    const output = await render(
      spec({
        segments: [
          {
            sourcePath: withAudio,
            clipId: 'clip1',
            inSec: 0.5,
            outSec: 2,
            layout: {
              kind: 'facecam_split',
              presetId: null,
              crops: {
                facecam: { x: 1440, y: 0, width: 480, height: 270 },
                gameplay: { x: 420, y: 0, width: 1080, height: 1080 },
                sourceWidth: 1920,
                sourceHeight: 1080
              }
            },
            frame: null
          },
          { sourcePath: silent, clipId: null, inSec: 0, outSec: 1, layout: null, frame: null }
        ],
        texts: [
          text({ animation: 'pop', style: { ...DEFAULT_TEXT_STYLE, box: true } }),
          text({
            id: 't2',
            text: 'second line',
            startSec: 1.6,
            endSec: 2.4,
            y: 0.8,
            animation: 'fade'
          })
        ]
      }),
      'join'
    )
    const probe = await probeVideo(output)
    expect(probe).toMatchObject({ width: 1080, height: 1920, hasAudio: true })
    expect(probe.durationSec).toBeGreaterThan(2.35)
    expect(probe.durationSec).toBeLessThan(2.7)
    // The faster source sets the frame rate.
    expect(probe.fps).toBeCloseTo(60, 0)
  }, 120_000)

  it('zooms in over a horizontal segment', async () => {
    const output = await render(
      spec({
        canvas: 'horizontal',
        segments: [
          {
            sourcePath: withAudio,
            clipId: null,
            inSec: 0,
            outSec: 1.5,
            layout: null,
            frame: { zoomStart: 1, zoomEnd: 1.5, cx: 0.4, cy: 0.5 }
          }
        ]
      }),
      'zoom'
    )
    const probe = await probeVideo(output)
    expect(probe).toMatchObject({ width: 1920, height: 1080, hasAudio: true })
    expect(probe.durationSec).toBeGreaterThan(1.35)
    expect(probe.durationSec).toBeLessThan(1.7)
  }, 120_000)

  it('crops a square canvas with a fixed zoom and lowers the volume', async () => {
    const output = await render(
      spec({
        canvas: 'square',
        volume: 0.5,
        segments: [
          {
            sourcePath: withAudio,
            clipId: null,
            inSec: 1,
            outSec: 2,
            layout: null,
            frame: { zoomStart: 1.2, zoomEnd: 1.2, cx: 0.5, cy: 0.5 }
          }
        ]
      }),
      'square'
    )
    expect(await probeVideo(output)).toMatchObject({ width: 1080, height: 1080, hasAudio: true })
  }, 120_000)

  it('draws the text with the bundled font only while it is on screen', async () => {
    const output = await render(
      spec({
        canvas: 'horizontal',
        segments: [
          { sourcePath: black, clipId: null, inSec: 0, outSec: 2, layout: null, frame: null }
        ],
        texts: [
          text({
            text: 'HELLO',
            startSec: 1,
            endSec: 2,
            style: { ...DEFAULT_TEXT_STYLE, size: 300, outlineWidth: 0 }
          })
        ]
      }),
      'text'
    )
    const middle = { w: 600, h: 200, x: 660, y: 440 }
    expect(await brightness(output, 0.5, middle)).toBeLessThan(25)
    expect(await brightness(output, 1.5, middle)).toBeGreaterThan(60)
  }, 120_000)

  it('shows a still sticker only for its time and loops a GIF sticker', async () => {
    const sticker = {
      id: 'red',
      asset: 'aaaaaaaaaaaaaaaa.png',
      startSec: 1,
      endSec: 2,
      x: 0.5,
      y: 0.5,
      width: 0.2,
      opacity: 1
    }
    const gif = {
      ...sticker,
      id: 'gif',
      asset: 'bbbbbbbbbbbbbbbb.gif',
      startSec: 0,
      x: 0.1,
      y: 0.15,
      width: 0.1
    }
    const output = await render(
      spec({
        canvas: 'horizontal',
        segments: [
          { sourcePath: black, clipId: null, inSec: 0, outSec: 2, layout: null, frame: null }
        ],
        overlays: [sticker, gif]
      }),
      'stickers'
    )
    expect((await probeVideo(output)).durationSec).toBeLessThan(2.2)
    const middle = { w: 120, h: 120, x: 900, y: 480 }
    expect(await brightness(output, 0.5, middle)).toBeLessThan(25)
    expect(await brightness(output, 1.5, middle)).toBeGreaterThan(40)
    expect(await brightness(output, 0.5, { w: 60, h: 60, x: 162, y: 132 })).toBeGreaterThan(40)
  }, 120_000)

  it('names a sticker that is missing from the library', async () => {
    await expect(
      renderEdit({
        spec: spec({
          canvas: 'horizontal',
          segments: [
            { sourcePath: black, clipId: null, inSec: 0, outSec: 1, layout: null, frame: null }
          ],
          overlays: [
            {
              id: 'x',
              asset: 'cccccccccccccccc.png',
              startSec: 0,
              endSec: 1,
              x: 0.5,
              y: 0.5,
              width: 0.2,
              opacity: 1
            }
          ]
        }),
        sources: [{ width: 1920, height: 1080, durationSec: 2 }],
        output: join(dir, 'out', 'missing-sticker.mp4'),
        fontsDir: FONTS,
        assetsDir: ASSETS
      })
    ).rejects.toThrow(/removed from the library \(cccccccccccccccc\.png\)/)
  })

  it('fails with a readable message and leaves no partial file', async () => {
    const output = join(dir, 'out', 'broken.mp4')
    await expect(
      renderEdit({
        spec: spec({
          segments: [
            {
              sourcePath: join(dir, 'missing.mp4'),
              clipId: null,
              inSec: 0,
              outSec: 1,
              layout: null,
              frame: null
            }
          ]
        }),
        sources: [{ width: 1920, height: 1080, durationSec: 1 }],
        output,
        fontsDir: FONTS,
        assetsDir: ASSETS
      })
    ).rejects.toThrow(/Couldn't render the edit/)
    expect(existsSync(output)).toBe(false)
    expect(existsSync(`${output}.part`)).toBe(false)
  }, 60_000)
})
