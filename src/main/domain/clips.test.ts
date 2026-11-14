import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  advanceBackfill,
  clipFileBase,
  clipFolder,
  clipVideoName,
  dailySyncRange,
  downloadRetryDelayMs,
  isDailySyncDue,
  nextBackfillWindow,
  slugify,
  splitWindow,
  startBackfill,
  timeWindows
} from './clips'

describe('timeWindows', () => {
  it('splits a range into 7-day windows, oldest first, ending exactly at the end', () => {
    const w = timeWindows('2026-01-01T00:00:00.000Z', '2026-01-20T12:00:00.000Z')
    expect(w).toEqual([
      { start: '2026-01-01T00:00:00.000Z', end: '2026-01-08T00:00:00.000Z' },
      { start: '2026-01-08T00:00:00.000Z', end: '2026-01-15T00:00:00.000Z' },
      { start: '2026-01-15T00:00:00.000Z', end: '2026-01-20T12:00:00.000Z' }
    ])
  })

  it('returns nothing for an empty or backwards range', () => {
    expect(timeWindows('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).toEqual([])
    expect(timeWindows('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toEqual([])
  })

  it('halves a crowded window on a minute boundary', () => {
    expect(
      splitWindow({ start: '2026-01-01T00:00:00.000Z', end: '2026-01-08T00:00:00.000Z' })
    ).toEqual([
      { start: '2026-01-01T00:00:00.000Z', end: '2026-01-04T12:00:00.000Z' },
      { start: '2026-01-04T12:00:00.000Z', end: '2026-01-08T00:00:00.000Z' }
    ])
    expect(
      splitWindow({ start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T00:01:00.000Z' })
    ).toBeNull()
  })
})

describe('daily sync', () => {
  const now = new Date('2026-11-12T12:00:00.000Z')

  it('looks back 2 days before the last successful sync', () => {
    expect(dailySyncRange('2026-11-11T11:00:00.000Z', now, '2020-01-01T00:00:00.000Z')).toEqual({
      start: '2026-11-09T11:00:00.000Z',
      end: '2026-11-12T12:00:00.000Z'
    })
  })

  it('uses the fallback start when it never synced', () => {
    expect(dailySyncRange(null, now, '2026-11-01T00:00:00.000Z').start).toBe(
      '2026-11-01T00:00:00.000Z'
    )
  })

  it('is due when the last sync is over 24 h old', () => {
    expect(isDailySyncDue(now, '2026-11-11T11:59:00.000Z', '04:00', 'America/Los_Angeles')).toBe(
      true
    )
    expect(isDailySyncDue(now, null, '04:00')).toBe(true)
  })

  it("is due once today's sync time has passed, and not again until tomorrow", () => {
    const zone = 'America/Los_Angeles' // now = 04:00 PST
    // Last sync yesterday 05:00 PST (13:00Z); today's 04:00 has just passed → due.
    expect(isDailySyncDue(now, '2026-11-11T13:00:00.000Z', '04:00', zone)).toBe(true)
    // Synced at 04:00 today already → not due.
    expect(isDailySyncDue(now, '2026-11-12T12:00:00.000Z', '04:00', zone)).toBe(false)
    // Sync time later today (09:00) not reached, last sync recent → not due.
    expect(isDailySyncDue(now, '2026-11-11T18:00:00.000Z', '09:00', zone)).toBe(false)
  })
})

describe('backfill', () => {
  it('walks 7-day windows and can resume from the saved cursor', () => {
    let cursor = startBackfill('2026-01-01T00:00:00.000Z', '2026-01-22T00:00:00.000Z')
    expect(cursor).toMatchObject({ windowsDone: 0, windowsTotal: 3 })
    const seen: string[] = []
    while (cursor) {
      const w = nextBackfillWindow(cursor)
      if (!w) break
      seen.push(w.start)
      // Simulate a quit after each window: the cursor is all that survives.
      cursor = advanceBackfill(JSON.parse(JSON.stringify(cursor)), w)
    }
    expect(seen).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-08T00:00:00.000Z',
      '2026-01-15T00:00:00.000Z'
    ])
    expect(cursor).toBeNull()
  })

  it('has nothing to do when the start is in the future', () => {
    expect(startBackfill('2027-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBeNull()
  })
})

describe('clip files', () => {
  const clip = {
    id: 'RepletePluckyHyena-I_2GH',
    title: 'Insane 360 drift! 🔥 (MW4 Day 9)',
    createdAtUtc: '2026-10-26T03:04:05Z'
  }

  it('names files so a Finder name sort is oldest to newest', () => {
    expect(clipFolder('Helmsyy', clip.createdAtUtc)).toBe('helmsyy/2026/2026-10')
    expect(clipFileBase(clip)).toBe(
      '2026-10-26_030405_RepletePluckyHyena-I_2GH_insane-360-drift-mw4-day-9'
    )
    expect(clipVideoName(clip, 'portrait')).toMatch(/_portrait\.mp4$/)

    const names = [
      { id: 'b', title: 'x', createdAtUtc: '2026-10-26T03:04:05Z' },
      { id: 'a', title: 'x', createdAtUtc: '2025-12-31T23:59:59Z' },
      { id: 'c', title: 'x', createdAtUtc: '2026-10-26T03:04:06Z' }
    ].map(clipFileBase)
    expect([...names].sort()).toEqual([names[1], names[0], names[2]])
  })

  it('slugifies titles safely', () => {
    expect(slugify('Café   CRASH!!')).toBe('cafe-crash')
    expect(slugify('🔥🔥🔥')).toBe('clip')
    expect(slugify('a'.repeat(80)).length).toBe(40)
  })

  it('backs off retries', () => {
    expect([1, 2, 3].map(downloadRetryDelayMs)).toEqual([300_000, 1_200_000, 4_800_000])
    expect(downloadRetryDelayMs(10)).toBe(86_400_000)
  })
})

describe('clipFolder with a bad login', () => {
  const when = '2026-10-26T03:04:05Z'
  const hostile = [
    '../x',
    '../../x',
    '..',
    '.',
    'a/b',
    'a\b',
    '/etc',
    'C:\temp',
    '',
    'a'.repeat(26),
    'has space',
    'a\u0000b',
    'ünïcode'
  ]

  it('refuses a login that is not a Twitch login', () => {
    for (const login of hostile) {
      expect(() => clipFolder(login, when), JSON.stringify(login)).toThrow(/Twitch/)
    }
  })

  it('never leaves the clips folder for any login it accepts', () => {
    for (const login of ['Helmsyy', 'streamer_1', 'a', 'x'.repeat(25), '__', '0']) {
      const folder = clipFolder(login, when)
      const inside = posix.relative('/clips', posix.join('/clips', folder))
      expect(inside.startsWith('..'), folder).toBe(false)
      expect(folder.split('/')[0]).toBe(login.toLowerCase())
    }
  })
})
