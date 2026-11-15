import { describe, expect, it } from 'vitest'
import { wordsFromWhisper } from './whisper'

const token = (text: string, from: number, to: number) => ({ text, offsets: { from, to } })

describe('wordsFromWhisper', () => {
  it('joins tokens into words with their times and skips markers', () => {
    const words = wordsFromWhisper({
      transcription: [
        {
          text: " This kid's just pushing",
          tokens: [
            token('[_BEG_]', 0, 0),
            token(' This', 0, 290),
            token(' kid', 290, 510),
            token("'s", 510, 650),
            token(' just', 650, 880),
            token(' pushing', 990, 1450),
            token('[_TT_100]', 2000, 2000)
          ]
        }
      ]
    })
    expect(words).toEqual([
      { text: 'This', startSec: 0, endSec: 0.29 },
      { text: "kid's", startSec: 0.29, endSec: 0.65 },
      { text: 'just', startSec: 0.65, endSec: 0.88 },
      { text: 'pushing', startSec: 0.99, endSec: 1.45 }
    ])
  })

  it('drops sound tags and a line that repeats the one before', () => {
    const words = wordsFromWhisper({
      transcription: [
        {
          text: ' (gunshots) - No way',
          tokens: [
            token(' (', 0, 100),
            token('gun', 100, 200),
            token('shots', 200, 300),
            token(')', 300, 350),
            token(' -', 350, 400),
            token(' No', 400, 600),
            token(' way', 600, 900)
          ]
        },
        {
          text: ' [Music]',
          tokens: [token(' [', 1000, 1100), token('Music', 1100, 1300), token(']', 1300, 1400)]
        },
        { text: ' Nice ♪', tokens: [token(' Nice', 2000, 2300), token(' ♪', 2300, 2400)] },
        { text: ' Nice ♪', tokens: [token(' Nice', 3000, 3300), token(' ♪', 3300, 3400)] }
      ]
    })
    expect(words.map((w) => w.text)).toEqual(['No', 'way', 'Nice'])
  })

  it('spreads words that whisper gave the same start', () => {
    const words = wordsFromWhisper({
      transcription: [
        {
          text: ' No way bro, these',
          tokens: [
            token(' No', 1000, 1100),
            token(' way', 1000, 1300),
            token(' bro,', 1010, 1500),
            token(' these', 1600, 1800)
          ]
        }
      ]
    })
    expect(words.map((w) => Number(w.startSec.toFixed(2)))).toEqual([1, 1.2, 1.4, 1.6])
    expect(words.every((w) => w.endSec > w.startSec)).toBe(true)
  })
})
