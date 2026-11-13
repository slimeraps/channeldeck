import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ffprobePath, parseProbeJson, probeVideo } from './ffprobe'

const file = { path: '/clips/a.mp4', sizeBytes: 1234, mtimeMs: 1 }

describe('parseProbeJson', () => {
  it('reads a landscape video', () => {
    const r = parseProbeJson(
      {
        streams: [
          { codec_type: 'audio', codec_name: 'aac' },
          { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }
        ],
        format: { duration: '612.4' }
      },
      file
    )
    expect(r).toMatchObject({
      width: 1920,
      height: 1080,
      durationSec: 612.4,
      aspectRatio: '16:9',
      isShort: false,
      isLong: false,
      videoCodec: 'h264',
      fileName: 'a.mp4'
    })
  })

  it('applies phone rotation so portrait videos read as vertical Shorts', () => {
    const r = parseProbeJson(
      {
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            side_data_list: [{ rotation: -90 }]
          }
        ],
        format: { duration: '45' }
      },
      file
    )
    expect([r.width, r.height]).toEqual([1080, 1920])
    expect(r.isShort).toBe(true)
  })

  it('also understands the older rotate tag', () => {
    const r = parseProbeJson(
      {
        streams: [{ codec_type: 'video', width: 1280, height: 720, tags: { rotate: '270' } }],
        format: { duration: '20' }
      },
      file
    )
    expect(r.aspectRatio).toBe('9:16')
  })

  it('flags long videos and rejects files without video', () => {
    const long = parseProbeJson(
      {
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
        format: { duration: '1200' }
      },
      file
    )
    expect(long.isLong).toBe(true)
    expect(() => parseProbeJson({ streams: [{ codec_type: 'audio' }] }, file)).toThrow(
      /video track/
    )
  })
})

describe('probeVideo with the real ffprobe binary', () => {
  it('has a working ffprobe', () => {
    expect(existsSync(ffprobePath())).toBe(true)
    expect(execFileSync(ffprobePath(), ['-version']).toString()).toMatch(/ffprobe version/)
  })

  it('explains a missing file and a non-video file', async () => {
    await expect(probeVideo('/definitely/not/here.mp4')).rejects.toThrow(/File missing/)
    const dir = mkdtempSync(join(tmpdir(), 'cd-probe-'))
    try {
      const fake = join(dir, 'fake.mp4')
      writeFileSync(fake, 'not a video')
      await expect(probeVideo(fake)).rejects.toThrow(/couldn't read fake\.mp4/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
