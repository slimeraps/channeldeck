import { CANVAS_SIZES, type CanvasKind } from './geometry'
import { fontBox } from './fonts'
import type { EditText } from './schemas/edit'

/**
 * Where a text layer's lines go on the canvas, laid out the way libass lays out our ASS file
 * (main/domain/ass.ts): greedy word wrap (WrapStyle 1) inside the canvas width minus the side
 * margins, one line per "font size" of height, the block's middle on the anchor, and each
 * line aligned left, centered or right on the anchor's x. `measure` returns a string's width
 * at the font's em size (canvas measureText in the editor).
 */

/** Must match TEXT_MARGIN in main/domain/ass.ts (the ASS style's side margins). */
export const TEXT_SIDE_MARGIN = 60

/** Padding around a text box (ASS BorderStyle 3 draws it with the Outline width). */
export function boxPadding(size: number): number {
  return Math.max(8, Math.round(size * 0.18))
}

export interface TextLine {
  text: string
  /** Left edge and baseline, in canvas pixels. */
  x: number
  baseline: number
  width: number
}

export interface TextBlock {
  lines: TextLine[]
  /** The block's bounding box (for hit testing and the selection frame). */
  box: { x: number; y: number; width: number; height: number }
  emPx: number
  lineHeight: number
}

/** Greedy word wrap: as many words per line as fit; a single long word gets its own line. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(/ +/)
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && measure(candidate) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

export function layoutText(
  text: Pick<EditText, 'text' | 'x' | 'y' | 'style'>,
  canvas: CanvasKind,
  measure: (s: string) => number
): TextBlock {
  const size = CANVAS_SIZES[canvas]
  const { emPx, lineHeight, baseline } = fontBox(text.style.font, text.style.size)
  const maxWidth = size.width - 2 * TEXT_SIDE_MARGIN
  const strings = wrapText(text.text, maxWidth, measure)
  const ax = text.x * size.width
  const ay = text.y * size.height
  const top = ay - (strings.length * lineHeight) / 2
  const lines = strings.map((s, i) => {
    const width = measure(s)
    const x =
      text.style.align === 'left' ? ax : text.style.align === 'right' ? ax - width : ax - width / 2
    return { text: s, x, baseline: top + i * lineHeight + baseline, width }
  })
  const left = Math.min(...lines.map((l) => l.x))
  const right = Math.max(...lines.map((l) => l.x + l.width))
  return {
    lines,
    box: { x: left, y: top, width: right - left, height: strings.length * lineHeight },
    emPx,
    lineHeight
  }
}
