import { describe, expect, it } from 'vitest'
import { QUOTA_COSTS } from '@shared/constants/quota'
import { forecastQuota, nextQuotaReset, quotaCost, quotaDayFor } from './quota'
import { slotsBetween } from './slots'

describe('quotaDayFor', () => {
  it('uses the Pacific calendar day, not UTC', () => {
    // 07:59 UTC on Nov 12 is still Nov 11 in Los Angeles (PST, UTC-8).
    expect(quotaDayFor(new Date('2026-11-12T07:59:00Z'))).toBe('2026-11-11')
    expect(quotaDayFor(new Date('2026-11-12T08:00:00Z'))).toBe('2026-11-12')
  })

  it('follows daylight saving time (PDT, UTC-7)', () => {
    expect(quotaDayFor(new Date('2026-07-01T06:59:00Z'))).toBe('2026-06-30')
    expect(quotaDayFor(new Date('2026-07-01T07:00:00Z'))).toBe('2026-07-01')
  })
})

describe('nextQuotaReset', () => {
  it('returns the next midnight Pacific in UTC', () => {
    expect(nextQuotaReset(new Date('2026-11-12T20:00:00Z')).toISOString()).toBe(
      '2026-11-13T08:00:00.000Z'
    )
    expect(nextQuotaReset(new Date('2026-07-01T20:00:00Z')).toISOString()).toBe(
      '2026-07-02T07:00:00.000Z'
    )
  })

  it('handles the night clocks fall back (Nov 1, 2026)', () => {
    // 23:00 PDT on Oct 31 → midnight PDT Nov 1 = 07:00 UTC.
    expect(nextQuotaReset(new Date('2026-11-01T06:00:00Z')).toISOString()).toBe(
      '2026-11-01T07:00:00.000Z'
    )
    // Just after that midnight, the next reset is midnight PST Nov 2 = 08:00 UTC.
    expect(nextQuotaReset(new Date('2026-11-01T07:30:00Z')).toISOString()).toBe(
      '2026-11-02T08:00:00.000Z'
    )
  })
})

describe('quota costs', () => {
  it('match the YouTube quota table', () => {
    expect(quotaCost('videos.insert')).toEqual({ bucket: 'upload', cost: 1 })
    expect(quotaCost('channels.list')).toEqual({ bucket: 'units', cost: 1 })
    for (const method of [
      'videos.update',
      'videos.delete',
      'thumbnails.set',
      'playlistItems.insert'
    ] as const) {
      expect(QUOTA_COSTS[method]).toEqual({ bucket: 'units', cost: 50 })
    }
  })
})

describe('forecastQuota', () => {
  const now = new Date('2026-11-12T18:00:00Z') // 10:00 Pacific
  const base = {
    now,
    days: 3,
    leadMs: 24 * 3600_000,
    zone: 'America/Chicago',
    slotsBetween
  }

  it('counts every rule slot on the Pacific day its upload starts', () => {
    const out = forecastQuota({
      ...base,
      rules: [{ slots: ['09:00', '18:00'], weekdays: [1, 2, 3, 4, 5, 6, 7], playlist: true }],
      posts: []
    })
    expect(out.map((d) => d.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14'])
    // Slots inside the lead time upload today; each later day uploads tomorrow's two slots.
    expect(out.map((d) => d.uploads)).toEqual([3, 2, 2])
    expect(out[1]).toMatchObject({ units: 2 * 50 + 200, overUploads: false, overUnits: false })
  })

  it('adds queued manual posts and flags days over the limits', () => {
    const posts = Array.from({ length: 101 }, () => ({
      uploadAtUtc: '2026-11-13T20:00:00.000Z',
      thumbnail: true,
      playlist: true
    }))
    const out = forecastQuota({ ...base, rules: [], posts })
    expect(out[1]).toMatchObject({ uploads: 101, overUploads: true, overUnits: true })
    expect(out[0]).toMatchObject({ uploads: 0, units: 200 })
  })

  it('counts past upload times as today', () => {
    const out = forecastQuota({
      ...base,
      rules: [],
      posts: [{ uploadAtUtc: '2026-11-01T00:00:00.000Z', thumbnail: false, playlist: false }]
    })
    expect(out[0]?.uploads).toBe(1)
  })
})
