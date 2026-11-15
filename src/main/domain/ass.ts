import type { CanvasKind } from '@shared/geometry'
import { CANVAS_SIZES } from '@shared/geometry'
import { captionTextStyle, type CaptionEvent } from '@shared/captions'
import type { CaptionStyle, EditText, TextStyle } from '@shared/schemas/edit'
import { boxPadding, TEXT_SIDE_MARGIN } from '@shared/textLayout'

/**
 * Text layers as an ASS subtitle script, rendered onto the video by libass (ffmpeg's `ass`
 * filter) with the fonts bundled in resources/fonts. ASS gives us outlines, boxes, shadows,
 * exact placement and timed effects, and captions (later) use the same file.
 *
 * Placement: each text's (x, y) is its anchor on the canvas, as fractions. The anchor is the
 * middle of the text block vertically and its left edge, center or right edge depending on
 * the alignment. The editor's preview uses the same rule.
 */

/** Horizontal room kept free at each side; long text wraps inside it (same as the preview). */
export const TEXT_MARGIN = TEXT_SIDE_MARGIN

/** "#RRGGBB" or "#RRGGBBAA" → ASS "&HAABBGGRR" (ASS alpha: 00 = opaque, FF = invisible). */
export function assColor(hex: string): string {
  const h = hex.replace('#', '')
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255
  const assAlpha = (255 - alpha).toString(16).padStart(2, '0')
  return `&H${assAlpha}${b}${g}${r}`.toUpperCase()
}

/** Seconds → "h:mm:ss.cc" (ASS uses centiseconds). */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100))
  const h = Math.floor(cs / 360_000)
  const m = Math.floor((cs % 360_000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  const two = (n: number) => String(n).padStart(2, '0')
  return `${h}:${two(m)}:${two(s)}.${two(c)}`
}

/**
 * Makes typed text safe inside a Dialogue line: braces would start an override block, and a
 * backslash could form an escape like \N, so braces become parentheses and a zero-width
 * space follows each backslash. Line breaks become ASS line breaks.
 */
export function assText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\​')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\n/g, '\\N')
}

/** Numpad alignment: middle row, left / center / right. */
const ALIGN: Record<TextStyle['align'], number> = { left: 4, center: 5, right: 6 }

function styleLine(name: string, style: TextStyle): string {
  const boxed = style.box
  const fields = [
    name,
    style.font,
    style.size,
    assColor(style.color),
    assColor(style.color),
    // A box (BorderStyle 3) is drawn in OutlineColour, padded by the Outline width.
    assColor(boxed ? style.boxColor : style.outlineColor),
    assColor('#00000099'),
    0, // bold: the bundled fonts are already heavy
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    boxed ? 3 : 1,
    boxed ? boxPadding(style.size) : style.outlineWidth,
    style.shadow,
    ALIGN[style.align],
    TEXT_MARGIN,
    TEXT_MARGIN,
    0,
    1
  ]
  return `Style: ${fields.join(',')}`
}

/** Starts small, overshoots, settles: 0.2 s. */
const POP = '\\fscx70\\fscy70\\t(0,120,\\fscx112\\fscy112)\\t(120,200,\\fscx100\\fscy100)'

function effects(text: EditText): string {
  switch (text.animation) {
    case 'fade':
      return '\\fad(250,250)'
    case 'pop':
      return POP
    default:
      return ''
  }
}

/** "#RRGGBB[AA]" as an inline color override (\\c) plus its alpha (\\1a). */
function inlineColor(hex: string): string {
  const full = assColor(hex) // &HAABBGGRR
  return `\\c&H${full.slice(4)}&\\1a&H${full.slice(2, 4)}&`
}

/** One caption line: the spoken word in the highlight color, the rest in the line color. */
function captionText(event: CaptionEvent, style: CaptionStyle): string {
  return event.parts
    .map((part) =>
      part.highlight
        ? `{${inlineColor(style.highlightColor)}}${assText(part.text)}{${inlineColor(style.color)}}`
        : assText(part.text)
    )
    .join(' ')
}

/**
 * The whole .ass file for these text layers on this canvas, plus auto captions (drawn under
 * the text layers).
 */
export function buildAss(
  canvas: CanvasKind,
  texts: readonly EditText[],
  captions?: { events: readonly CaptionEvent[]; style: CaptionStyle }
): string {
  const { width, height } = CANVAS_SIZES[canvas]
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    // Greedy word wrap, which the editor's preview reproduces (shared/textLayout.ts).
    'WrapStyle: 1',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...texts.map((t, i) => styleLine(`T${i}`, t.style)),
    ...(captions ? [styleLine('Captions', captionTextStyle(captions.style))] : []),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  if (captions) {
    const y = Math.round(captions.style.y * height)
    for (const event of captions.events) {
      const pop = event.pop ? POP : ''
      lines.push(
        `Dialogue: 0,${assTime(event.startSec)},${assTime(event.endSec)},Captions,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${y})${pop}}${captionText(event, captions.style)}`
      )
    }
  }
  // Text layers sit above the captions (higher layer).
  texts.forEach((t, i) => {
    const x = Math.round(t.x * width)
    const y = Math.round(t.y * height)
    const overrides = `{\\an${ALIGN[t.style.align]}\\pos(${x},${y})${effects(t)}}`
    lines.push(
      `Dialogue: ${10 + i},${assTime(t.startSec)},${assTime(t.endSec)},T${i},,0,0,0,,${overrides}${assText(t.text)}`
    )
  })
  return `${lines.join('\n')}\n`
}
