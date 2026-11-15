import {
  type CaptionStyle,
  type CaptionWord,
  type EditSpec,
  segmentStarts,
  type TextStyle
} from './schemas/edit'

/**
 * Auto captions, from words to what's on screen. Words are stored per source file in that
 * file's own time; these functions place them on the edit's timeline (following trims, splits
 * and moves), group them into short lines, and turn the lines into timed display events. The
 * ASS writer (render) and the preview both draw from `captionEvents`, so they agree.
 */

/** A pause longer than this starts a new caption line. */
export const LINE_GAP_SEC = 0.6
/** How long a line stays up after its last word when nothing follows right away. */
export const LINE_HOLD_SEC = 0.35

export interface TimelineWord extends CaptionWord {
  /** Which segment it plays in. */
  segment: number
  /** Its index in its source's word list (for editing it). */
  index: number
}

/** Every caption word on the edit's timeline, in order. */
export function captionWordsOnTimeline(
  spec: Pick<EditSpec, 'segments' | 'captions'>
): TimelineWord[] {
  const captions = spec.captions
  if (!captions) return []
  const bySource = new Map(captions.sources.map((s) => [s.sourcePath, s.words]))
  const starts = segmentStarts(spec)
  const out: TimelineWord[] = []
  spec.segments.forEach((segment, i) => {
    const words = bySource.get(segment.sourcePath) ?? []
    const offset = (starts[i] as number) - segment.inSec
    words.forEach((w, index) => {
      const mid = (w.startSec + w.endSec) / 2
      if (mid < segment.inSec || mid >= segment.outSec) return
      out.push({
        text: w.text,
        startSec: Math.max(segment.inSec, w.startSec) + offset,
        endSec: Math.min(segment.outSec, w.endSec) + offset,
        segment: i,
        index
      })
    })
  })
  return out
}

export interface CaptionLine {
  words: TimelineWord[]
  startSec: number
  endSec: number
}

/** Groups words into short lines: at most `maxWords`, broken at pauses and sentence ends. */
export function captionLines(words: readonly TimelineWord[], maxWords: number): CaptionLine[] {
  const lines: CaptionLine[] = []
  let current: TimelineWord[] = []
  const flush = () => {
    const first = current[0]
    const last = current.at(-1)
    if (first && last) lines.push({ words: current, startSec: first.startSec, endSec: last.endSec })
    current = []
  }
  for (const word of words) {
    const previous = current.at(-1)
    if (
      previous &&
      (current.length >= maxWords ||
        word.startSec - previous.endSec > LINE_GAP_SEC ||
        word.segment !== previous.segment ||
        /[.!?]$/.test(previous.text))
    ) {
      flush()
    }
    current.push(word)
  }
  flush()
  return lines
}

export interface CaptionPart {
  text: string
  /** Shown in the highlight color (the word being said). */
  highlight: boolean
}

export interface CaptionEvent {
  startSec: number
  endSec: number
  parts: CaptionPart[]
  /** Scale in when it appears (the "pop" look). */
  pop: boolean
}

const shown = (text: string, style: CaptionStyle) => (style.uppercase ? text.toUpperCase() : text)

/** What the captions show and when, for the edit's caption style. */
export function captionEvents(spec: Pick<EditSpec, 'segments' | 'captions'>): CaptionEvent[] {
  const captions = spec.captions
  if (!captions?.enabled) return []
  const { style } = captions
  const lines = captionLines(captionWordsOnTimeline(spec), style.maxWords)
  const events: CaptionEvent[] = []
  lines.forEach((line, n) => {
    const nextStart = lines[n + 1]?.startSec ?? Infinity
    const lineEnd = Math.min(line.endSec + LINE_HOLD_SEC, nextStart)
    if (style.look === 'plain') {
      events.push({
        startSec: line.startSec,
        endSec: lineEnd,
        parts: [{ text: line.words.map((w) => shown(w.text, style)).join(' '), highlight: false }],
        pop: false
      })
      return
    }
    line.words.forEach((word, i) => {
      const next = line.words[i + 1]
      const startSec = i === 0 ? line.startSec : word.startSec
      const endSec = next ? next.startSec : lineEnd
      if (endSec <= startSec) return
      events.push(
        style.look === 'pop'
          ? {
              startSec,
              endSec,
              parts: [{ text: shown(word.text, style), highlight: false }],
              pop: true
            }
          : {
              startSec,
              endSec,
              parts: line.words.map((w, j) => ({ text: shown(w.text, style), highlight: j === i })),
              pop: false
            }
      )
    })
  })
  return events
}

/** The text style a caption is drawn with (centered on its line). */
export function captionTextStyle(style: CaptionStyle): TextStyle {
  return {
    font: style.font,
    size: style.size,
    color: style.color,
    outlineColor: style.outlineColor,
    outlineWidth: style.outlineWidth,
    shadow: 0,
    box: false,
    boxColor: '#000000cc',
    align: 'center'
  }
}

/**
 * Replaces the words of one caption line with new text (the Captions panel's word editing).
 * The line keeps its time; the new words share it in proportion to their length.
 */
export function rewordLine(
  words: readonly CaptionWord[],
  first: number,
  count: number,
  text: string
): CaptionWord[] {
  const old = words.slice(first, first + count)
  const start = old[0]?.startSec
  const end = old.at(-1)?.endSec
  if (start === undefined || end === undefined) return [...words]
  const tokens = text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.slice(0, 60))
  const weights = tokens.map((t) => Math.max(1, t.length))
  const total = weights.reduce((a, b) => a + b, 0)
  let at = start
  const replaced = tokens.map((t, i) => {
    const length = ((end - start) * (weights[i] as number)) / total
    const word = { text: t, startSec: at, endSec: at + length }
    at += length
    return word
  })
  return [...words.slice(0, first), ...replaced, ...words.slice(first + count)]
}
