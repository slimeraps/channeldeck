import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../../tests/helpers/db'
import { quotaDayFor } from '../domain/quota'
import { createStatusService } from './status'

let t: TestDb
beforeEach(() => (t = createTestDb()))
afterEach(() => t.close())

/** Records a call the way the YouTube wrapper does: day from the clock at call time. */
function callAt(iso: string, bucket: 'upload' | 'units', cost: number, dryRun = false): void {
  t.clock.set(iso)
  t.repos.quota.record({ quotaDay: quotaDayFor(t.clock()), bucket, method: 'm', cost, dryRun })
}

describe('quota meter', () => {
  it('counts today’s real calls and resets at midnight Pacific', () => {
    callAt('2026-11-12T20:00:00.000Z', 'upload', 1)
    callAt('2026-11-12T21:00:00.000Z', 'units', 50)
    callAt('2026-11-12T21:30:00.000Z', 'units', 50, true) // Dry Run doesn't count
    const status = createStatusService({ repos: t.repos, clock: t.clock })
    expect(status.quotaToday()).toEqual({
      day: '2026-11-12',
      uploadCalls: 1,
      uploadLimit: 100,
      units: 50,
      unitLimit: 10_000,
      resetsAtUtc: '2026-11-13T08:00:00.000Z'
    })
    t.clock.set('2026-11-13T08:00:00.000Z') // midnight PST
    expect(status.quotaToday()).toMatchObject({ day: '2026-11-13', uploadCalls: 0, units: 0 })
  })

  it('follows Pacific midnight across the fall-back change (a 25-hour day)', () => {
    // Sun 2026-11-01: PDT until 09:00Z, then PST. Midnight that day is 07:00Z.
    callAt('2026-11-01T06:59:00.000Z', 'units', 1) // Oct 31, 23:59 PDT
    callAt('2026-11-01T07:00:00.000Z', 'units', 10) // Nov 1, 00:00 PDT
    callAt('2026-11-02T07:59:00.000Z', 'units', 100) // Nov 1, 23:59 PST
    const status = createStatusService({ repos: t.repos, clock: t.clock })
    t.clock.set('2026-11-01T20:00:00.000Z')
    expect(status.quotaToday()).toMatchObject({
      day: '2026-11-01',
      units: 110,
      resetsAtUtc: '2026-11-02T08:00:00.000Z'
    })
  })

  it('follows Pacific midnight across the spring-forward change (a 23-hour day)', () => {
    // Sun 2026-03-08: PST until 10:00Z, then PDT. That day ends at 07:00Z on Mar 9.
    callAt('2026-03-08T08:00:00.000Z', 'upload', 1) // Mar 8, 00:00 PST
    callAt('2026-03-09T06:59:00.000Z', 'upload', 1) // Mar 8, 23:59 PDT
    callAt('2026-03-09T07:00:00.000Z', 'upload', 1) // Mar 9, 00:00 PDT
    const status = createStatusService({ repos: t.repos, clock: t.clock })
    t.clock.set('2026-03-08T12:00:00.000Z')
    expect(status.quotaToday()).toMatchObject({
      day: '2026-03-08',
      uploadCalls: 2,
      resetsAtUtc: '2026-03-09T07:00:00.000Z'
    })
  })
})

describe('storage meter', () => {
  it('lists each Twitch channel with its color and bytes on disk', () => {
    const a = t.repos.twitchAccounts.create({
      broadcasterId: '1',
      login: 'a',
      displayName: 'Alpha',
      editorId: '1',
      color: '#22c55e'
    })
    t.repos.clips.upsertMany([
      {
        id: 'c1',
        twitchAccountId: a.id,
        title: 'x',
        gameId: null,
        creatorName: null,
        viewCount: 1,
        durationSec: 10,
        createdAtUtc: '2026-11-01T00:00:00.000Z',
        vodOffset: null,
        videoId: null,
        isFeatured: false,
        url: 'u',
        thumbnailUrl: null
      }
    ])
    t.repos.clips.setDownload('c1', { downloadStatus: 'downloaded', fileSize: 4096 })
    t.repos.settings.update({ clipsRoot: '/nonexistent/channeldeck-test/clips' })
    const info = createStatusService({ repos: t.repos }).storage()
    expect(info.accounts).toEqual([
      { id: a.id, name: 'Alpha', color: '#22c55e', bytes: 4096, downloaded: 1, total: 1 }
    ])
    expect(info.rendersBytes).toBe(0)
    expect(info.freeBytes).toBeGreaterThan(0) // falls back to the nearest existing folder
  })
})
