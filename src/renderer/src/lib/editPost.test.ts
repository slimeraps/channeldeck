import { describe, expect, it } from 'vitest'
import { newEdit } from '@shared/editOps'
import type { EditorSource } from '@shared/schemas/editor'
import type { MediaInfo, PostInput } from '@shared/schemas/post'
import { postClipId, startingEdit } from './editPost'

const source = (
  path: string,
  clipId: string | null,
  twitchAccountId: number | null
): EditorSource => ({
  path,
  fileName: path,
  durationSec: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  previewUrl: `cdmedia://file/${path}`,
  clipId,
  clipTitle: clipId,
  twitchAccountId,
  values: {}
})

describe('postClipId', () => {
  const spec = newEdit([
    { path: '/a.mp4', durationSec: 10, clipId: 'a' },
    { path: '/b.mp4', durationSec: 10, clipId: 'b' },
    { path: '/own.mp4', durationSec: 10, clipId: null }
  ])

  it('links the first clip when every clip is from one Twitch channel', () => {
    const sources = new Map([
      ['/a.mp4', source('/a.mp4', 'a', 1)],
      ['/b.mp4', source('/b.mp4', 'b', 1)],
      ['/own.mp4', source('/own.mp4', null, null)]
    ])
    expect(postClipId(spec, sources)).toBe('a')
  })

  it('links none for a mix of channels or no clips', () => {
    const mixed = new Map([
      ['/a.mp4', source('/a.mp4', 'a', 1)],
      ['/b.mp4', source('/b.mp4', 'b', 2)]
    ])
    expect(postClipId(spec, mixed)).toBeNull()
    expect(postClipId(spec, new Map())).toBeNull()
  })
})

describe('startingEdit', () => {
  const media = {
    path: '/c/x_landscape.mp4',
    durationSec: 20,
    width: 1920,
    height: 1080
  } as MediaInfo
  const input = (o: Partial<PostInput>) =>
    ({ filePath: media.path, clipId: 'x', ...o }) as PostInput

  it('keeps the post its own edit', () => {
    const edit = newEdit([{ path: '/e.mp4', durationSec: 5, clipId: null }])
    expect(startingEdit(input({ edit }), media, [])).toBe(edit)
  })

  it('turns a vertical layout into a one-piece vertical edit with that layout', () => {
    const preset = {
      id: 4,
      twitchAccountId: 1,
      twitchName: 'x',
      twitchColor: '#fff',
      name: 'Cam',
      kind: 'facecam_split' as const,
      crops: { facecam: { x: 0, y: 0, width: 10, height: 10 } },
      usedByRules: 0
    }
    const spec = startingEdit(input({ render: { kind: 'facecam_split', presetId: 4 } }), media, [
      preset
    ])
    expect(spec.canvas).toBe('vertical')
    expect(spec.segments[0]).toMatchObject({
      sourcePath: media.path,
      clipId: 'x',
      outSec: 20,
      layout: { kind: 'facecam_split', presetId: 4, crops: preset.crops }
    })
  })

  it('keeps a plain video in its own shape', () => {
    expect(startingEdit(input({}), media, []).canvas).toBe('horizontal')
    expect(startingEdit(input({}), { ...media, width: 1080, height: 1920 }, []).canvas).toBe(
      'vertical'
    )
  })
})
