import { describe, expect, it } from 'vitest'
import { DEFAULT_CAPTION_STYLE, DEFAULT_TEXT_STYLE, type EditText } from '@shared/schemas/edit'
import { assColor, assText, assTime, buildAss } from './ass'

const text = (o: Partial<EditText> = {}): EditText => ({
  id: 't',
  text: 'Hello',
  startSec: 1.234,
  endSec: 3,
  x: 0.5,
  y: 0.25,
  style: DEFAULT_TEXT_STYLE,
  animation: 'none',
  ...o
})

describe('assColor', () => {
  it('turns #RRGGBB into opaque &H00BBGGRR', () => {
    expect(assColor('#ffa6c9')).toBe('&H00C9A6FF')
  })
  it('inverts the alpha of #RRGGBBAA', () => {
    expect(assColor('#000000cc')).toBe('&H33000000')
    expect(assColor('#00000000')).toBe('&HFF000000')
  })
})

describe('assTime', () => {
  it('formats centiseconds', () => {
    expect(assTime(0)).toBe('0:00:00.00')
    expect(assTime(1.234)).toBe('0:00:01.23')
    expect(assTime(3725.5)).toBe('1:02:05.50')
  })
})

describe('assText', () => {
  it('keeps braces and backslashes from becoming ASS codes, and breaks lines', () => {
    expect(assText('a{\\b}c')).toBe('a(\\​b)c')
    expect(assText('one\ntwo\r\nthree')).toBe('one\\Ntwo\\Nthree')
    expect(assText('no \\N here')).toBe('no \\​N here')
  })
})

describe('buildAss', () => {
  it('sets the canvas size and places each text at its anchor', () => {
    const ass = buildAss('vertical', [text()])
    expect(ass).toContain('PlayResX: 1080\nPlayResY: 1920')
    expect(ass).toContain(
      'Dialogue: 10,0:00:01.23,0:00:03.00,T0,,0,0,0,,{\\an5\\pos(540,480)}Hello'
    )
  })

  it('writes an outline style, or a box style when the text has a box', () => {
    const ass = buildAss('horizontal', [
      text(),
      text({ style: { ...DEFAULT_TEXT_STYLE, box: true, boxColor: '#ffa6c9', align: 'left' } })
    ])
    // Outline: BorderStyle 1 with the outline width; box: BorderStyle 3 in the box color.
    expect(ass).toMatch(
      /Style: T0,Archivo Black,96,&H00FFFFFF,&H00FFFFFF,&H00000000,[^\n]*,1,8,0,5,60,60,0,1/
    )
    expect(ass).toMatch(
      /Style: T1,Archivo Black,96,&H00FFFFFF,&H00FFFFFF,&H00C9A6FF,[^\n]*,3,17,0,4,60,60,0,1/
    )
    expect(ass).toContain('{\\an4\\pos(960,270)}')
  })

  it('adds fade and pop effects', () => {
    expect(buildAss('square', [text({ animation: 'fade' })])).toContain('\\fad(250,250)')
    expect(buildAss('square', [text({ animation: 'pop' })])).toContain(
      '\\fscx70\\fscy70\\t(0,120,\\fscx112\\fscy112)'
    )
  })

  it('writes captions under the text, coloring the spoken word', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, y: 0.5 }
    const ass = buildAss('vertical', [text()], {
      style,
      events: [
        {
          startSec: 1,
          endSec: 1.5,
          parts: [
            { text: 'NO', highlight: true },
            { text: 'WAY', highlight: false }
          ],
          pop: false
        },
        { startSec: 2, endSec: 2.4, parts: [{ text: 'BRO', highlight: false }], pop: true }
      ]
    })
    expect(ass).toMatch(/Style: Captions,Archivo Black,78,/)
    expect(ass).toContain(
      'Dialogue: 0,0:00:01.00,0:00:01.50,Captions,,0,0,0,,{\\an5\\pos(540,960)}{\\c&HC9A6FF&\\1a&H00&}NO{\\c&HFFFFFF&\\1a&H00&} WAY'
    )
    expect(ass).toContain('{\\an5\\pos(540,960)\\fscx70\\fscy70')
    // Text layers are drawn above the captions.
    expect(ass).toContain('Dialogue: 10,')
  })
})
