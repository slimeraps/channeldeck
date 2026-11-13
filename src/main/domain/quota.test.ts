import { describe, expect, it } from 'vitest'
import { QUOTA_COSTS } from '@shared/constants/quota'
import { nextQuotaReset, quotaCost, quotaDayFor } from './quota'

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
