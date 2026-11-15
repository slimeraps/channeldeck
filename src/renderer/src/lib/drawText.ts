import { captionEvents, captionTextStyle } from '@shared/captions'
import { fontBox } from '@shared/fonts'
import { CANVAS_SIZES } from '@shared/geometry'
import type { EditSpec, EditText } from '@shared/schemas/edit'
import { boxPadding, layoutText } from '@shared/textLayout'

/**
 * Draws the edit's text layers on the preview the way libass draws them in the render
 * (main/domain/ass.ts): same fonts, same sizes and line layout (shared/textLayout.ts), a drop
 * shadow, then either an outline or a box, then the letters. Fade and pop are animated.
 */

/** Matches the BackColour of every text style in the ASS file. */
const SHADOW_COLOR = '#00000099'

export interface TextHit {
  id: string
  /** Bounding box in output pixels (1080×1920 for a vertical canvas). */
  box: { x: number; y: number; width: number; height: number }
}

/** Opacity and scale of a text at `t` (fade: 0.25 s in and out; pop: overshoot over 0.2 s). */
export function textAnimation(text: EditText, t: number): { alpha: number; scale: number } {
  const since = t - text.startSec
  const until = text.endSec - t
  if (text.animation === 'fade') {
    return { alpha: Math.max(0, Math.min(1, since / 0.25, until / 0.25)), scale: 1 }
  }
  if (text.animation === 'pop') {
    const ms = since * 1000
    const scale =
      ms < 120 ? 0.7 + (1.12 - 0.7) * (ms / 120) : ms < 200 ? 1.12 - 0.12 * ((ms - 120) / 80) : 1
    return { alpha: 1, scale }
  }
  return { alpha: 1, scale: 1 }
}

/**
 * Draws the texts on screen at output time `t` (variables already filled) and returns where
 * each one is, for hit testing. The context's canvas can be any size: everything is laid out
 * in output pixels and scaled to it.
 */
export function drawTexts(
  ctx: CanvasRenderingContext2D,
  spec: EditSpec,
  texts: readonly EditText[],
  t: number
): TextHit[] {
  const size = CANVAS_SIZES[spec.canvas]
  const k = ctx.canvas.width / size.width
  const hits: TextHit[] = []
  for (const text of texts) {
    if (t < text.startSec || t >= text.endSec) continue
    const { style } = text
    ctx.save()
    ctx.scale(k, k)
    const metrics = fontBox(style.font, style.size)
    ctx.font = `${metrics.emPx}px "${style.font}"`
    const block = layoutText(text, spec.canvas, (s) => ctx.measureText(s).width)
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    const { alpha, scale } = textAnimation(text, t)
    const ax = text.x * size.width
    const ay = text.y * size.height
    ctx.globalAlpha = alpha
    ctx.translate(ax, ay)
    ctx.scale(scale, scale)
    ctx.translate(-ax, -ay)

    const pad = boxPadding(style.size)
    const drawShape = (dx: number, dy: number, color: string | null): void => {
      for (const line of block.lines) {
        const top = line.baseline - metrics.baseline
        if (style.box) {
          ctx.fillStyle = color ?? style.boxColor
          ctx.fillRect(
            line.x - pad + dx,
            top - pad + dy,
            line.width + 2 * pad,
            block.lineHeight + 2 * pad
          )
        } else if (style.outlineWidth > 0) {
          ctx.strokeStyle = color ?? style.outlineColor
          ctx.lineWidth = style.outlineWidth * 2
          ctx.strokeText(line.text, line.x + dx, line.baseline + dy)
        }
        if (color) {
          ctx.fillStyle = color
          ctx.fillText(line.text, line.x + dx, line.baseline + dy)
        }
      }
    }
    if (style.shadow > 0) drawShape(style.shadow, style.shadow, SHADOW_COLOR)
    drawShape(0, 0, null)
    ctx.fillStyle = style.color
    for (const line of block.lines) ctx.fillText(line.text, line.x, line.baseline)
    ctx.restore()
    hits.push({ id: text.id, box: block.box })
  }
  return hits
}

/**
 * Draws the auto captions on screen at `t` (from the same events the render uses), centered
 * on the caption line: the outline of the whole line, then each word in its color.
 */
export function drawCaptions(ctx: CanvasRenderingContext2D, spec: EditSpec, t: number): void {
  const style = spec.captions?.style
  if (!style) return
  const event = captionEvents(spec).find((e) => t >= e.startSec && t < e.endSec)
  if (!event) return
  const size = CANVAS_SIZES[spec.canvas]
  const k = ctx.canvas.width / size.width
  const textStyle = captionTextStyle(style)
  const metrics = fontBox(textStyle.font, textStyle.size)
  const full = event.parts.map((p) => p.text).join(' ')
  ctx.save()
  ctx.scale(k, k)
  ctx.font = `${metrics.emPx}px "${textStyle.font}"`
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const block = layoutText(
    { text: full, x: 0.5, y: style.y, style: textStyle },
    spec.canvas,
    (s) => ctx.measureText(s).width
  )
  if (event.pop) {
    const { scale } = textAnimation(
      { animation: 'pop', startSec: event.startSec, endSec: event.endSec } as EditText,
      t
    )
    const ax = size.width / 2
    const ay = style.y * size.height
    ctx.translate(ax, ay)
    ctx.scale(scale, scale)
    ctx.translate(-ax, -ay)
  }
  if (style.outlineWidth > 0) {
    ctx.strokeStyle = style.outlineColor
    ctx.lineWidth = style.outlineWidth * 2
    for (const line of block.lines) ctx.strokeText(line.text, line.x, line.baseline)
  }
  // Walk the parts across the wrapped lines, word by word, coloring the spoken one.
  const queue = event.parts.flatMap((p) =>
    p.text.split(' ').map((word) => ({ word, highlight: p.highlight }))
  )
  for (const line of block.lines) {
    let x = line.x
    for (const word of line.text.split(' ')) {
      const part = queue.shift()
      ctx.fillStyle = part?.highlight ? style.highlightColor : style.color
      ctx.fillText(word, x, line.baseline)
      x += ctx.measureText(`${word} `).width
    }
  }
  ctx.restore()
}
