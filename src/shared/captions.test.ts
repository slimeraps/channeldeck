import { describe, expect, it } from 'vitest'
import {
  captionEvents,
  captionLines,
  captionWordsOnTimeline,
  LINE_HOLD_SEC,
  rewordLine
} from './captions'
import { newEdit, splitAt, trimIn } from './editOps'
import { DEFAULT_CAPTION_STYLE, type EditSpec, editSpecSchema } from './schemas/edit'

const words = [
  { text: 'no', startSec: 1, endSec: 1.2 },
  { text: 'way', startSec: 1.2, endSec: 1.5 },
  { text: 'bro,', startSec: 1.5, endSec: 1.8 },
  { text: 'these', startSec: 1.9, endSec: 2.1 },
  { text: 'kids.', startSec: 2.1, endSec: 2.4 },
  { text: 'Holy', startSec: 5, endSec: 5.3 },
  { text: 'shit', startSec: 5.3, endSec: 5.6 }
]

function withCaptions(spec: EditSpec, look = DEFAULT_CAPTION_STYLE.look): EditSpec {
  return {
    ...spec,
    captions: {
      enabled: true,
      style: { ...DEFAULT_CAPTION_STYLE, look, maxWords: 3, uppercase: false },
      sources: [{ sourcePath: '/a.mp4', words }]
    }
  }
}

const base = () => withCaptions(newEdit([{ path: '/a.mp4', durationSec: 10, clipId: null }]))

describe('captionWordsOnTimeline', () => {
  it('follows trims: words keep their source time and move with the piece', () => {
    expect(editSpecSchema.safeParse(base()).success).toBe(true)
    const trimmed = trimIn(base(), 0, 1.5)
    const placed = captionWordsOnTimeline(trimmed)
    // "no" and "way" are cut off; "bro," now plays at 0.
    expect(placed.map((w) => w.text)).toEqual(['bro,', 'these', 'kids.', 'Holy', 'shit'])
    expect(placed[0]).toMatchObject({ startSec: 0, index: 2 })
  })

  it('places a source used twice in both pieces', () => {
    const spec = withCaptions(
      newEdit([
        { path: '/a.mp4', durationSec: 10, clipId: null },
        { path: '/a.mp4', durationSec: 10, clipId: null }
      ])
    )
    expect(
      captionWordsOnTimeline(spec)
        .filter((w) => w.text === 'shit')
        .map((w) => w.startSec)
    ).toEqual([5.3, 15.3])
  })
})

describe('captionLines', () => {
  it('breaks at the word limit, sentence ends, pauses and cuts', () => {
    const lines = captionLines(captionWordsOnTimeline(base()), 3)
    expect(lines.map((l) => l.words.map((w) => w.text).join(' '))).toEqual([
      'no way bro,',
      'these kids.',
      'Holy shit'
    ])
    const split = splitAt(base(), 1.9)?.spec
    expect(split).toBeDefined()
    const cut = captionLines(captionWordsOnTimeline(split as EditSpec), 10)
    expect(cut.map((l) => l.words.length)).toEqual([3, 2, 2])
  })
})

describe('captionEvents', () => {
  it('highlights the spoken word on its line', () => {
    const events = captionEvents(base())
    expect(events[0]).toMatchObject({
      startSec: 1,
      endSec: 1.2,
      parts: [
        { text: 'no', highlight: true },
        { text: 'way', highlight: false },
        { text: 'bro,', highlight: false }
      ]
    })
    // The last word of a line stays until a little after it ends (or the next line starts).
    expect(events[2]).toMatchObject({ startSec: 1.5, endSec: 1.9 })
    expect(events.at(-1)?.endSec).toBeCloseTo(5.6 + LINE_HOLD_SEC)
  })

  it('shows one word at a time for pop, and whole lines for plain', () => {
    const pop = captionEvents(withCaptions(base(), 'pop'))
    expect(pop).toHaveLength(7)
    expect(pop[0]).toMatchObject({ parts: [{ text: 'no' }], pop: true })
    const plain = captionEvents(withCaptions(base(), 'plain'))
    expect(plain.map((e) => e.parts[0]?.text)).toEqual(['no way bro,', 'these kids.', 'Holy shit'])
  })

  it('shows nothing when captions are off, and capitals when asked', () => {
    const spec = base()
    expect(captionEvents({ ...spec, captions: { ...spec.captions!, enabled: false } })).toEqual([])
    const upper = {
      ...spec,
      captions: { ...spec.captions!, style: { ...spec.captions!.style, uppercase: true } }
    }
    expect(captionEvents(upper)[0]?.parts[0]?.text).toBe('NO')
  })
})

describe('rewordLine', () => {
  it('replaces a line and spreads the new words over its time', () => {
    const out = rewordLine(words, 0, 3, 'no way bruh')
    expect(out.slice(0, 3).map((w) => w.text)).toEqual(['no', 'way', 'bruh'])
    expect(out[0]?.startSec).toBe(1)
    expect(out[2]?.endSec).toBeCloseTo(1.8)
    expect(out).toHaveLength(7)
    expect(
      rewordLine(words, 0, 3, 'nah')
        .slice(0, 2)
        .map((w) => w.text)
    ).toEqual(['nah', 'these'])
  })
})
