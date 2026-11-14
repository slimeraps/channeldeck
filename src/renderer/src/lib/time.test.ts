import { describe, expect, it } from 'vitest'
import { formatRelative, formatSlot } from './time'

const now = new Date('2026-11-12T12:00:00Z')

describe('formatRelative', () => {
  it('describes future times', () => {
    expect(formatRelative('2026-11-12T15:20:00Z', now)).toBe('in 3h 20m')
    expect(formatRelative('2026-11-12T12:45:00Z', now)).toBe('in 45m')
    expect(formatRelative('2026-11-14T16:00:00Z', now)).toBe('in 2d 4h')
    expect(formatRelative('2026-11-13T12:00:00Z', now)).toBe('in 1d')
    expect(formatRelative('2026-11-12T12:00:20Z', now)).toBe('in less than a minute')
  })

  it('describes past times', () => {
    expect(formatRelative('2026-11-12T11:55:00Z', now)).toBe('5m ago')
    expect(formatRelative('2026-11-12T11:59:50Z', now)).toBe('just now')
  })
})

describe('formatSlot', () => {
  it('shows a stored 24-hour slot on the 12-hour clock', () => {
    expect(formatSlot('00:00')).toBe('12:00 AM')
    expect(formatSlot('12:00')).toBe('12:00 PM')
    expect(formatSlot('18:30')).toBe('6:30 PM')
  })

  it('leaves anything it cannot read as it is', () => {
    expect(formatSlot('soon')).toBe('soon')
  })
})
