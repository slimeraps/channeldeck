import { describe, expect, it } from 'vitest'
import { facecamBandHeight, renderArgs, renderFileName, renderFilter, scaleRect } from './render'

const hd = { width: 1920, height: 1080 }

describe('scaleRect', () => {
  it('scales a rectangle drawn on a smaller sample frame to the video size', () => {
    const crops = { sourceWidth: 960, sourceHeight: 540 }
    expect(scaleRect({ x: 10, y: 20, width: 200, height: 100 }, crops, hd)).toEqual({
      x: 20,
      y: 40,
      width: 400,
      height: 200
    })
  })

  it('keeps the rectangle inside the frame and even-sized', () => {
    const r = scaleRect({ x: 1800, y: 1000, width: 301, height: 151 }, {}, hd)
    expect(r.x + r.width).toBeLessThanOrEqual(1920)
    expect(r.y + r.height).toBeLessThanOrEqual(1080)
    expect(r.width % 2).toBe(0)
    expect(r.height % 2).toBe(0)
    expect(r.x % 2).toBe(0)
  })
})

describe('facecamBandHeight', () => {
  it('follows the facecam shape within limits', () => {
    expect(facecamBandHeight({ x: 0, y: 0, width: 480, height: 270 })).toBe(608) // 16:9
    expect(facecamBandHeight({ x: 0, y: 0, width: 800, height: 100 })).toBe(480) // min
    expect(facecamBandHeight({ x: 0, y: 0, width: 300, height: 400 })).toBe(960) // max
  })
})

describe('renderFilter', () => {
  it('stacks facecam over gameplay for a split layout', () => {
    const f = renderFilter(
      'facecam_split',
      {
        facecam: { x: 1440, y: 0, width: 480, height: 270 },
        gameplay: { x: 420, y: 0, width: 1080, height: 1080 },
        sourceWidth: 1920,
        sourceHeight: 1080
      },
      hd
    )
    expect(f).toBe(
      '[0:v]split=2[fc][gp];' +
        '[fc]crop=480:270:1440:0,scale=1080:608:force_original_aspect_ratio=increase,crop=1080:608[top];' +
        '[gp]crop=1080:1080:420:0,scale=1080:1312:force_original_aspect_ratio=increase,crop=1080:1312[bot];' +
        '[top][bot]vstack=inputs=2,setsar=1,format=yuv420p[v]'
    )
  })

  it('center-crops a 9:16 strip', () => {
    expect(renderFilter('center_crop', {}, hd)).toBe(
      '[0:v]crop=608:1080:656:0,scale=1080:1920,setsar=1,format=yuv420p[v]'
    )
  })

  it('falls back to a blurred fill when a split has no rectangles', () => {
    const f = renderFilter('facecam_split', {}, hd)
    expect(f).toContain('boxblur')
    expect(f.endsWith('[v]')).toBe(true)
  })
})

describe('renderArgs', () => {
  it('maps the filtered video and optional audio to an mp4', () => {
    const args = renderArgs({ input: '/in.mp4', output: '/out.part', filter: 'F', maxSeconds: 8 })
    expect(args.slice(0, 7)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      '/in.mp4',
      '-filter_complex',
      'F'
    ])
    expect(args).toContain('0:a?')
    expect(args.join(' ')).toContain('-t 8')
    expect(args.slice(-3)).toEqual(['-f', 'mp4', '/out.part'])
  })

  it('names renders by clip and preset', () => {
    expect(renderFileName('AbcClip', 4)).toBe('AbcClip_4.mp4')
    expect(renderFileName('AbcClip', null)).toBe('AbcClip_blur.mp4')
  })
})
