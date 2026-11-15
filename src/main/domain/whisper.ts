import type { CaptionWord } from '@shared/schemas/edit'

/**
 * Turns whisper.cpp's full JSON output (`whisper-cli -ojf`) into caption words. Tokens become
 * words (a token that doesn't start with a space joins the word before, like "kid" + "'s");
 * whisper's own markers ([_BEG_], [_TT_123]) are skipped; sound tags such as "(gunshots)" or
 * "[Music]" are dropped; and a line that exactly repeats the one before it (a known whisper
 * habit on game audio) is dropped. Times are seconds in the transcribed file.
 */

interface WhisperToken {
  text: string
  offsets: { from: number; to: number }
}

interface WhisperSegment {
  text: string
  tokens?: WhisperToken[]
}

export interface WhisperJson {
  transcription?: WhisperSegment[]
}

const isMarker = (text: string) => /^\[_[A-Z_]+[0-9]*\]$/.test(text.trim())

/**
 * Whisper often gives several words in a row the same start (its timing is coarse at the start
 * of a line). Spread such a run evenly up to the next word's start, so a highlighted caption
 * moves word by word instead of jumping.
 */
export function spreadBunchedWords(words: CaptionWord[]): CaptionWord[] {
  const out = words.map((w) => ({ ...w }))
  let i = 0
  while (i < out.length) {
    const start = out[i]?.startSec as number
    let j = i + 1
    while (j < out.length && Math.abs((out[j]?.startSec as number) - start) < 0.03) j++
    if (j - i > 1) {
      const until = Math.max(
        out[j]?.startSec ?? out[j - 1]?.endSec ?? start,
        start + 0.12 * (j - i)
      )
      const step = (until - start) / (j - i)
      for (let k = i; k < j; k++) {
        const word = out[k] as CaptionWord
        word.startSec = start + step * (k - i)
        word.endSec = Math.max(
          word.startSec + 0.05,
          Math.min(word.endSec, start + step * (k - i + 1))
        )
      }
    }
    i = j
  }
  return out
}

export function wordsFromWhisper(json: WhisperJson): CaptionWord[] {
  const words: CaptionWord[] = []
  let previousLine = ''
  for (const segment of json.transcription ?? []) {
    const line = segment.text.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!line || line === previousLine) continue
    previousLine = line

    // Build the words of this line from its tokens.
    const raw: { text: string; from: number; to: number }[] = []
    for (const token of segment.tokens ?? []) {
      if (isMarker(token.text)) continue
      const starts = /^\s/.test(token.text) || raw.length === 0
      const piece = token.text.trim()
      if (!piece) continue
      const last = raw.at(-1)
      if (starts || !last) raw.push({ text: piece, from: token.offsets.from, to: token.offsets.to })
      else {
        last.text += piece
        last.to = token.offsets.to
      }
    }

    // Drop sound tags: anything inside ( ) or [ ], and music notes.
    let depth = 0
    for (const word of raw) {
      const opens = (word.text.match(/[([]/g) ?? []).length
      const closes = (word.text.match(/[)\]]/g) ?? []).length
      const inside = depth > 0 || opens > 0
      depth = Math.max(0, depth + opens - closes)
      if (inside) continue
      const text = word.text.replace(/[♪♫]/g, '').trim()
      if (!text || text === '-') continue
      words.push({
        text: text.slice(0, 60),
        startSec: word.from / 1000,
        endSec: Math.max(word.to, word.from + 50) / 1000
      })
    }
  }
  return spreadBunchedWords(words)
}
