import { describe, expect, it } from 'vitest'
import {
  type EditSegment,
  type EditSpec,
  editFromLegacy,
  editSpecSchema,
  isEditSpec,
  renderSources
} from '@shared/schemas/edit'
import { editArgs, editFileName, editFilter, filterPath, outputFps } from './edit'

const seg = (o: Partial<EditSegment> = {}): EditSegment => ({
  sourcePath: '/clips/a_landscape.mp4',
  clipId: 'a',
  inSec: 1,
  outSec: 4,
  layout: null,
  frame: null,
  ...o
})

const spec = (o: Partial<EditSpec> = {}): EditSpec => ({
  version: 2,
  canvas: 'vertical',
  segments: [seg()],
  texts: [],
  volume: 1,
  ...o
})

const hd = { width: 1920, height: 1080, durationSec: 10, fps: 30, hasAudio: true }
const options = { assPath: null, fontsDir: '/app/fonts' }

describe('editFilter', () => {
  it('frames one vertical segment with blurred fill and passes audio through', () => {
    const graph = editFilter(spec(), [hd], options)
    expect(graph).toContain('[0:v]setpts=PTS-STARTPTS[in0]')
    expect(graph).toContain('[in0]split=2[bg_0][fg_0]')
    expect(graph).toContain('[lay0]fps=30,setsar=1,format=yuv420p[v0]')
    expect(graph).toContain('[0:a]asetpts=PTS-STARTPTS,aresample=48000')
    expect(graph).toContain('atrim=0:3.000[a0]')
    expect(graph).toContain('[v0]null[vc];[a0]anull[ac]')
    expect(graph).toMatch(/\[vc\]format=yuv420p\[v\];\[ac\]anull\[a\]$/)
  })

  it('joins segments with concat, using silence for a source without audio', () => {
    const graph = editFilter(
      spec({
        segments: [
          seg(),
          seg({
            sourcePath: '/clips/b.mp4',
            layout: { kind: 'center_crop', presetId: null, crops: {} }
          })
        ]
      }),
      [hd, { width: 1280, height: 720, durationSec: 5, fps: 60, hasAudio: false }],
      options
    )
    // Labels stay unique per segment, and the faster source sets the frame rate.
    expect(graph).toContain('[in1]crop=406:720:438:0')
    expect(graph).toContain('fps=60')
    expect(graph).toContain('anullsrc=r=48000:cl=stereo,atrim=0:3.000')
    expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]')
  })

  it('crops a horizontal canvas, and zooms over time with zoompan', () => {
    const fixed = editFilter(
      spec({
        canvas: 'square',
        segments: [seg({ frame: { zoomStart: 1.5, zoomEnd: 1.5, cx: 0.5, cy: 0.5 } })]
      }),
      [hd],
      options
    )
    expect(fixed).toContain('crop=720:720:600:180,scale=1080:1080,fps=30')

    const ramp = editFilter(
      spec({
        canvas: 'horizontal',
        segments: [seg({ frame: { zoomStart: 1, zoomEnd: 2, cx: 0.5, cy: 0.5 } })]
      }),
      [hd],
      options
    )
    expect(ramp).toContain('crop=1920:1080:0:0,scale=3840:2160,zoompan=')
    expect(ramp).toContain("z='1+(2-1)*min(1,in_time/3)'")
    expect(ramp).toContain('s=1920x1080:fps=30')
  })

  it('draws text through the ASS file and applies the volume', () => {
    const graph = editFilter(spec({ volume: 0.5 }), [hd], {
      assPath: '/tmp/x/text.ass',
      fontsDir: '/app/fonts'
    })
    expect(graph).toContain(
      "[vc]ass=filename='/tmp/x/text.ass':fontsdir='/app/fonts',format=yuv420p[v]"
    )
    expect(graph).toContain('[ac]volume=0.5[a]')
  })

  it('puts stickers over the video, each for its own time, under the text', () => {
    const sticker = {
      id: 's1',
      asset: '0123456789abcdef.png',
      startSec: 1,
      endSec: 2.5,
      x: 0.5,
      y: 0.25,
      width: 0.3,
      opacity: 0.8
    }
    const gif = { ...sticker, id: 's2', asset: 'fedcba9876543210.gif', opacity: 1 }
    const edit = spec({ overlays: [sticker, gif] })
    const graph = editFilter(edit, [hd], { assPath: '/tmp/t.ass', fontsDir: '/f' })
    expect(graph).toContain(
      '[1:v]format=rgba,scale=324:-2,colorchannelmixer=aa=0.8,setpts=PTS-STARTPTS+1.000/TB[st0]'
    )
    expect(graph).toContain(
      "[vc][st0]overlay=x=540-w/2:y=480-h/2:enable='between(t,1.000,2.500)':eof_action=pass[ov0]"
    )
    expect(graph).toContain('[2:v]format=rgba,scale=324:-2,setpts=PTS-STARTPTS+1.000/TB[st1]')
    expect(graph).toContain('[ov0][st1]overlay=')
    expect(graph).toContain("[ov1]ass=filename='/tmp/t.ass'")

    const args = editArgs({
      spec: edit,
      filter: 'F',
      output: '/o.mp4',
      stickerPaths: ['/assets/a.png', '/assets/b.gif']
    })
    expect(args.join(' ')).toContain('-loop 1 -t 3.000 -i /assets/a.png')
    expect(args.join(' ')).toContain('-stream_loop -1 -t 3.000 -i /assets/b.gif')
  })

  it('needs source info for every segment', () => {
    expect(() => editFilter(spec(), [], options)).toThrow(/source info/)
  })
})

describe('filterPath', () => {
  it('quotes plain paths and refuses ones that would need ffmpeg escaping', () => {
    expect(filterPath('/Users/me/My Clips/a.ass')).toBe("'/Users/me/My Clips/a.ass'")
    expect(() => filterPath("/tmp/it's.ass")).toThrow()
    expect(() => filterPath('/tmp/a:b.ass')).toThrow()
  })
})

describe('outputFps', () => {
  it('uses the fastest source, at most 60, and 30 when unknown', () => {
    expect(outputFps([{ ...hd, fps: 29.97 }])).toBe(29.97)
    expect(outputFps([hd, { ...hd, fps: 120 }])).toBe(60)
    expect(outputFps([{ width: 1, height: 1, durationSec: 1 }])).toBe(30)
  })
})

describe('editArgs', () => {
  it('seeks each input and maps the graph outputs', () => {
    const args = editArgs({ spec: spec(), filter: 'F', output: '/out.mp4' })
    expect(args.slice(3, 9)).toEqual([
      '-ss',
      '1.000',
      '-t',
      '3.000',
      '-i',
      '/clips/a_landscape.mp4'
    ])
    expect(args).toContain('[v]')
    expect(args).toContain('[a]')
    expect(args.at(-1)).toBe('/out.mp4')
  })
})

describe('editFileName', () => {
  it('names the render after the first source, with a hash of the edit', () => {
    const name = editFileName(spec())
    expect(name).toMatch(/^a_edit_[0-9a-f]{10}\.mp4$/)
    expect(editFileName(spec())).toBe(name)
    expect(editFileName(spec({ volume: 0.5 }))).not.toBe(name)
  })
})

describe('EditSpec helpers', () => {
  it('validates segments and text timing', () => {
    expect(editSpecSchema.safeParse(spec()).success).toBe(true)
    expect(editSpecSchema.safeParse(spec({ segments: [seg({ outSec: 1.05 })] })).success).toBe(
      false
    )
    expect(editSpecSchema.safeParse(spec({ segments: [] })).success).toBe(false)
  })

  it('reads an older vertical render as a one-segment edit', () => {
    const legacy = { sourcePath: '/c/x.mp4', kind: 'center_crop' as const, crops: {}, presetId: 3 }
    expect(isEditSpec(legacy)).toBe(false)
    const edit = editFromLegacy(legacy, 12.5)
    expect(isEditSpec(edit)).toBe(true)
    expect(edit.segments[0]).toMatchObject({
      inSec: 0,
      outSec: 12.5,
      layout: { kind: 'center_crop', presetId: 3 }
    })
    expect(editSpecSchema.safeParse(edit).success).toBe(true)
  })

  it('lists every source a render reads, once each', () => {
    expect(renderSources(null)).toEqual([])
    expect(
      renderSources({ sourcePath: '/c/x.mp4', kind: 'blur_fill', crops: {}, presetId: null })
    ).toEqual(['/c/x.mp4'])
    expect(
      renderSources(
        spec({ segments: [seg(), seg({ inSec: 5, outSec: 6 }), seg({ sourcePath: '/c/b.mp4' })] })
      )
    ).toEqual(['/clips/a_landscape.mp4', '/c/b.mp4'])
  })
})
