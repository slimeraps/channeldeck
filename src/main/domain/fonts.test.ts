import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fontBox, FONT_METRICS } from '@shared/fonts'
import { EDIT_FONTS } from '@shared/schemas/edit'

const FONTS = resolve(import.meta.dirname, '../../../resources/fonts')

/** unitsPerEm (head) and usWinAscent/usWinDescent (OS/2) straight from a .ttf file. */
function readMetrics(file: string): { unitsPerEm: number; winAscent: number; winDescent: number } {
  const data = readFileSync(join(FONTS, file))
  const tables = new Map<string, number>()
  const count = data.readUInt16BE(4)
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i
    tables.set(data.toString('latin1', at, at + 4), data.readUInt32BE(at + 8))
  }
  const head = tables.get('head') as number
  const os2 = tables.get('OS/2') as number
  return {
    unitsPerEm: data.readUInt16BE(head + 18),
    winAscent: data.readUInt16BE(os2 + 74),
    winDescent: data.readUInt16BE(os2 + 76)
  }
}

describe('FONT_METRICS', () => {
  it('matches the bundled font files', () => {
    for (const font of EDIT_FONTS) {
      const { file, ...metrics } = FONT_METRICS[font]
      expect(readMetrics(file), font).toEqual(metrics)
    }
  })

  it('sizes text the way libass does (font size = winAscent + winDescent)', () => {
    // Measured with the bundled ffmpeg at size 400: Archivo Black's cap height is 204 px.
    const box = fontBox('Archivo Black', 400)
    expect(box.emPx * 0.688).toBeCloseTo(204.3, 0)
    expect(box.lineHeight).toBe(400)
    expect(box.baseline).toBeCloseTo(307.3, 0)
  })
})
