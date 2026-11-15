import type { EditFont } from './schemas/edit'

/**
 * Metrics of the bundled fonts (resources/fonts), read from their OS/2 and head tables, so the
 * editor's preview lays text out exactly as libass does in the render.
 *
 * libass sizes a font so that winAscent + winDescent equals the style's font size (the
 * "font height", VSFilter's rule), not the em. Measured against the bundled ffmpeg at size
 * 400: cap heights 204 / 198 / 215 px and positions matched these numbers to the pixel.
 */
export interface FontMetrics {
  file: string
  unitsPerEm: number
  winAscent: number
  winDescent: number
}

export const FONT_METRICS: Record<EditFont, FontMetrics> = {
  'Archivo Black': {
    file: 'ArchivoBlack-Regular.ttf',
    unitsPerEm: 1000,
    winAscent: 1035,
    winDescent: 312
  },
  Anton: { file: 'Anton-Regular.ttf', unitsPerEm: 2048, winAscent: 2876, winDescent: 674 },
  'Bebas Neue': {
    file: 'BebasNeue-Regular.ttf',
    unitsPerEm: 1000,
    winAscent: 950,
    winDescent: 350
  }
}

/**
 * For a style font size (ASS Fontsize, in canvas pixels): the CSS/canvas em size, the height of
 * one line, and how far below the top of a line its baseline sits.
 */
export function fontBox(
  font: EditFont,
  size: number
): { emPx: number; lineHeight: number; baseline: number } {
  const m = FONT_METRICS[font]
  const height = m.winAscent + m.winDescent
  return {
    emPx: (size * m.unitsPerEm) / height,
    lineHeight: size,
    baseline: (size * m.winAscent) / height
  }
}
