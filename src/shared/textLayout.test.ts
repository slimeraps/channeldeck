import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from './schemas/edit'
import { layoutText, wrapText } from './textLayout'

/** A fake font: every character is 50 px wide. */
const measure = (s: string) => s.length * 50

describe('wrapText', () => {
  it('fits as many words per line as it can and keeps typed line breaks', () => {
    expect(wrapText('one two three four', 400, measure)).toEqual(['one two', 'three', 'four'])
    expect(wrapText('first\nsecond line', 2000, measure)).toEqual(['first', 'second line'])
    expect(wrapText('unbreakablewordthatistoolong', 100, measure)).toEqual([
      'unbreakablewordthatistoolong'
    ])
  })
})

describe('layoutText', () => {
  const text = { text: 'GG', x: 0.5, y: 0.5, style: { ...DEFAULT_TEXT_STYLE, size: 200 } }

  it('centers the block on the anchor, one font size per line', () => {
    const block = layoutText(text, 'vertical', measure)
    expect(block.lineHeight).toBe(200)
    expect(block.box).toEqual({ x: 490, y: 860, width: 100, height: 200 })
    // Archivo Black's baseline sits winAscent / (winAscent + winDescent) down the line.
    expect(block.lines[0]?.baseline).toBeCloseTo(860 + (200 * 1035) / 1347, 3)
  })

  it('wraps inside the canvas minus the side margins and aligns each line', () => {
    const long = {
      ...text,
      text: 'aaaaaaaaaa bbbbbbbbbb',
      style: { ...text.style, align: 'left' as const }
    }
    // 1080 - 2 × 60 = 960 px fits one 10-letter word (500 px) but not two (1050 px).
    const block = layoutText({ ...long, x: 0.1 }, 'vertical', measure)
    expect(block.lines.map((l) => [l.text, l.x])).toEqual([
      ['aaaaaaaaaa', 108],
      ['bbbbbbbbbb', 108]
    ])
    const right = layoutText(
      { ...long, style: { ...long.style, align: 'right' } },
      'vertical',
      measure
    )
    expect(right.lines[0]?.x).toBe(540 - 500)
  })
})
