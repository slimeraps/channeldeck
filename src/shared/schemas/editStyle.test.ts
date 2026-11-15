import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_TEXT_STYLE,
  EDIT_SPEC_VERSION,
  editFromStyle,
  editSpecSchema,
  editStyleSpecSchema,
  styleFromSpec,
  type EditSpec,
  type EditStyleSpec
} from './edit'

const text = (id: string, startSec: number, endSec: number) => ({
  id,
  text: id,
  startSec,
  endSec,
  x: 0.5,
  y: 0.2,
  style: DEFAULT_TEXT_STYLE,
  animation: 'none' as const
})

const style: EditStyleSpec = {
  canvas: 'vertical',
  durationSec: 10,
  texts: [text('title', 0, 10), text('intro', 0, 3), text('late', 8, 9), text('outro', 4, 6)],
  overlays: [],
  captions: DEFAULT_CAPTION_STYLE
}

describe('editFromStyle', () => {
  it('puts the style over a clip: whole-length layers stretch, others keep or lose their times', () => {
    const spec = editFromStyle({
      style,
      sourcePath: '/clips/a_landscape.mp4',
      clipId: 'a',
      durationSec: 5,
      layout: null
    })
    expect(editSpecSchema.safeParse(spec).success).toBe(true)
    expect(spec.version).toBe(EDIT_SPEC_VERSION)
    expect(spec.segments).toHaveLength(1)
    expect(spec.segments[0]).toMatchObject({ inSec: 0, outSec: 5, clipId: 'a' })
    expect(spec.segments[0]?.layout).toEqual({ kind: 'blur_fill', presetId: null, crops: {} })
    const byId = Object.fromEntries(spec.texts.map((t) => [t.id, t]))
    expect(byId['title']?.endSec).toBe(5) // ran to the end of the style: runs to the end of the clip
    expect(byId['intro']?.endSec).toBe(3)
    expect(byId['outro']?.endSec).toBe(5) // clamped
    expect(byId['late']).toBeUndefined() // starts after the clip ends
  })

  it('turns captions on with no words yet (they are made when it renders)', () => {
    const spec = editFromStyle({
      style,
      sourcePath: '/clips/a.mp4',
      clipId: null,
      durationSec: 20,
      layout: null
    })
    expect(spec.captions).toEqual({ enabled: true, style: DEFAULT_CAPTION_STYLE, sources: [] })
    const plain = editFromStyle({
      style: { ...style, captions: null },
      sourcePath: '/clips/a.mp4',
      clipId: null,
      durationSec: 20,
      layout: null
    })
    expect(plain.captions).toBeUndefined()
  })

  it('uses a wide canvas without a layout', () => {
    const spec = editFromStyle({
      style: { ...style, canvas: 'horizontal' },
      sourcePath: '/clips/a.mp4',
      clipId: null,
      durationSec: 20,
      layout: { kind: 'center_crop', presetId: null, crops: {} }
    })
    expect(spec.canvas).toBe('horizontal')
    expect(spec.segments[0]?.layout).toBeNull()
  })
})

describe('styleFromSpec', () => {
  it('keeps the look but not the footage or the caption words', () => {
    const spec: EditSpec = {
      ...editFromStyle({
        style,
        sourcePath: '/clips/a.mp4',
        clipId: 'a',
        durationSec: 10,
        layout: null
      }),
      captions: {
        enabled: true,
        style: DEFAULT_CAPTION_STYLE,
        sources: [{ sourcePath: '/clips/a.mp4', words: [{ text: 'hi', startSec: 0, endSec: 1 }] }]
      }
    }
    const saved = styleFromSpec(spec)
    expect(editStyleSpecSchema.safeParse(saved).success).toBe(true)
    expect(saved).toMatchObject({
      canvas: 'vertical',
      durationSec: 10,
      captions: DEFAULT_CAPTION_STYLE
    })
    expect(JSON.stringify(saved)).not.toContain('/clips/a.mp4')
  })

  it('drops hidden captions', () => {
    const spec = editFromStyle({
      style,
      sourcePath: '/a.mp4',
      clipId: null,
      durationSec: 10,
      layout: null
    })
    expect(
      styleFromSpec({ ...spec, captions: { ...spec.captions!, enabled: false } }).captions
    ).toBeNull()
  })
})
