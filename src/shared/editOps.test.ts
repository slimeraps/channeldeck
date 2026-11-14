import { describe, expect, it } from 'vitest'
import {
  addSegment,
  cutPoints,
  locate,
  moveSegment,
  newEdit,
  removeSegment,
  setCanvas,
  setLayout,
  snap,
  splitAt,
  trimIn,
  trimOut
} from './editOps'
import { editDuration, editSpecSchema } from './schemas/edit'

const a = { path: '/c/a.mp4', durationSec: 10, clipId: 'a' }
const b = { path: '/c/b.mp4', durationSec: 4, clipId: null }
const edit = () => newEdit([a, b])

describe('newEdit', () => {
  it('uses each whole source, in order, and is a valid spec', () => {
    const spec = edit()
    expect(spec.segments.map((s) => [s.sourcePath, s.inSec, s.outSec])).toEqual([
      ['/c/a.mp4', 0, 10],
      ['/c/b.mp4', 0, 4]
    ])
    expect(editDuration(spec)).toBe(14)
    expect(editSpecSchema.safeParse(spec).success).toBe(true)
    expect(newEdit([a], 'square').segments[0]?.frame).toEqual({
      zoomStart: 1,
      zoomEnd: 1,
      cx: 0.5,
      cy: 0.5
    })
  })
})

describe('locate', () => {
  it('maps output time to a segment and a source time', () => {
    const spec = trimIn(edit(), 0, 2) // a plays 2–10 (8 s), then b 0–4
    expect(locate(spec, 0)).toEqual({ index: 0, offset: 0, sourceTime: 2 })
    expect(locate(spec, 8.5)).toEqual({ index: 1, offset: 0.5, sourceTime: 0.5 })
    // Past the end clamps to the end of the last segment.
    expect(locate(spec, 99)).toEqual({ index: 1, offset: 4, sourceTime: 4 })
  })
})

describe('splitAt', () => {
  it('cuts the segment under the time into two', () => {
    const out = splitAt(edit(), 3)
    expect(out?.index).toBe(1)
    expect(out?.spec.segments.map((s) => [s.sourcePath, s.inSec, s.outSec])).toEqual([
      ['/c/a.mp4', 0, 3],
      ['/c/a.mp4', 3, 10],
      ['/c/b.mp4', 0, 4]
    ])
  })

  it('refuses a cut right next to an existing one', () => {
    expect(splitAt(edit(), 10.02)).toBeNull()
    expect(splitAt(edit(), 0)).toBeNull()
  })
})

describe('trimming', () => {
  it('keeps in and out inside the source and at least 0.1 s apart', () => {
    expect(trimIn(edit(), 0, -5).segments[0]?.inSec).toBe(0)
    expect(trimIn(edit(), 0, 9.99).segments[0]?.inSec).toBeCloseTo(9.9)
    expect(trimOut(edit(), 1, 99, 4).segments[1]?.outSec).toBe(4)
    expect(trimOut(trimIn(edit(), 1, 2), 1, 1, 4).segments[1]?.outSec).toBeCloseTo(2.1)
  })
})

describe('arranging', () => {
  it('moves, adds and removes segments', () => {
    expect(moveSegment(edit(), 0, 1).segments.map((s) => s.sourcePath)).toEqual([
      '/c/b.mp4',
      '/c/a.mp4'
    ])
    const added = addSegment(edit(), b, 0)
    expect(added.segments.map((s) => s.sourcePath)).toEqual(['/c/a.mp4', '/c/b.mp4', '/c/b.mp4'])
    expect(removeSegment(added, 1).segments).toHaveLength(2)
    // The last segment stays.
    expect(removeSegment(newEdit([a]), 0).segments).toHaveLength(1)
  })

  it('gives an added piece the layout of the piece before it', () => {
    const layout = { kind: 'center_crop' as const, presetId: null, crops: {} }
    const spec = addSegment(setLayout(newEdit([a]), 0, layout), b)
    expect(spec.segments[1]?.layout).toEqual(layout)
  })
})

describe('setCanvas and setLayout', () => {
  it('starts horizontal pieces from the whole frame and keeps vertical layouts', () => {
    const layout = { kind: 'center_crop' as const, presetId: 2, crops: {} }
    const vertical = setLayout(edit(), 'all', layout)
    const wide = setCanvas(vertical, 'horizontal')
    expect(wide.segments[0]?.frame).toMatchObject({ zoomStart: 1 })
    expect(setCanvas(wide, 'vertical').segments[0]?.layout).toEqual(layout)
    expect(setLayout(edit(), 1, layout).segments.map((s) => s.layout)).toEqual([null, layout])
  })
})

describe('snap and cutPoints', () => {
  it('snaps to the nearest target in reach', () => {
    expect(snap(4.95, [0, 5, 10], 0.1)).toBe(5)
    expect(snap(4.5, [0, 5, 10], 0.1)).toBe(4.5)
    expect(cutPoints(edit())).toEqual([0, 10, 14])
  })
})
