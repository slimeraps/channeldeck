import { describe, expect, it } from 'vitest'
import { nextOffsetFromRange } from './resumableUpload'

describe('nextOffsetFromRange', () => {
  it('resumes after the last byte YouTube has', () => {
    expect(nextOffsetFromRange('bytes=0-999999')).toBe(1_000_000)
    expect(nextOffsetFromRange('bytes=0-0')).toBe(1)
  })

  it('starts from zero when nothing arrived', () => {
    expect(nextOffsetFromRange(null)).toBe(0)
    expect(nextOffsetFromRange('garbage')).toBe(0)
  })
})
