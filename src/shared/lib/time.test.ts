import { describe, expect, it } from 'vitest'
import { defaultPublishAt, localToUtcIso, toYouTubePublishAt, utcIsoToLocalParts } from './time'

const LA = 'America/Los_Angeles'
const NY = 'America/New_York'

describe('localToUtcIso', () => {
  it('converts local wall-clock time to UTC', () => {
    expect(localToUtcIso({ date: '2026-11-13', time: '09:00' }, LA)).toBe(
      '2026-11-13T17:00:00.000Z'
    )
    expect(localToUtcIso({ date: '2026-07-04', time: '21:00' }, NY)).toBe(
      '2026-07-05T01:00:00.000Z'
    )
  })

  it('moves a time skipped by spring-forward to the next valid time', () => {
    // Mar 8, 2026: 02:00 → 03:00 in Los Angeles. 02:30 doesn't exist.
    expect(localToUtcIso({ date: '2026-03-08', time: '02:30' }, LA)).toBe(
      '2026-03-08T10:30:00.000Z'
    )
  })

  it('picks the first of the two 01:30s when clocks fall back', () => {
    // Nov 1, 2026: 01:00–02:00 happens twice; first is PDT (UTC-7).
    expect(localToUtcIso({ date: '2026-11-01', time: '01:30' }, LA)).toBe(
      '2026-11-01T08:30:00.000Z'
    )
  })

  it('returns null for garbage', () => {
    expect(localToUtcIso({ date: '2026-13-40', time: '09:00' }, LA)).toBeNull()
    expect(localToUtcIso({ date: '', time: '' }, LA)).toBeNull()
  })
})

describe('utcIsoToLocalParts', () => {
  it('round-trips with localToUtcIso', () => {
    const parts = { date: '2026-12-24', time: '18:45' }
    const iso = localToUtcIso(parts, LA)
    expect(iso).not.toBeNull()
    expect(utcIsoToLocalParts(iso!, LA)).toEqual(parts)
  })

  it('shows the local date when UTC is already tomorrow', () => {
    expect(utcIsoToLocalParts('2026-11-14T03:00:00.000Z', LA)).toEqual({
      date: '2026-11-13',
      time: '19:00'
    })
  })
})

describe('toYouTubePublishAt', () => {
  it('formats RFC 3339 UTC with seconds precision', () => {
    expect(toYouTubePublishAt('2026-11-13T17:00:00.000Z')).toBe('2026-11-13T17:00:00Z')
    expect(toYouTubePublishAt('2026-11-13T17:00:59.987Z')).toBe('2026-11-13T17:00:59Z')
  })

  it('rejects invalid input', () => {
    expect(() => toYouTubePublishAt('tomorrow')).toThrow(/Invalid publish time/)
  })
})

describe('defaultPublishAt', () => {
  it('is tomorrow, on the hour, in the future', () => {
    const now = new Date('2026-11-12T12:34:56Z')
    const iso = defaultPublishAt(now)
    expect(Date.parse(iso)).toBeGreaterThan(now.getTime() + 24 * 3600_000)
    expect(iso).toMatch(/T\d{2}:00:00\.000Z$/)
  })
})
