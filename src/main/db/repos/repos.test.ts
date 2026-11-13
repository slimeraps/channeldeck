import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestDb,
  seedAccount,
  seedClip,
  seedTwitchAccount,
  type TestDb
} from '../../../../tests/helpers/db'
import { DuplicateError } from './common'

let t: TestDb
beforeEach(() => {
  t = createTestDb()
})
afterEach(() => t.close())

describe('accounts', () => {
  it('rejects a channel that is already connected', () => {
    seedAccount(t.repos, { channelId: 'UC_same', channelTitle: 'Drift Channel' })
    expect(() =>
      seedAccount(t.repos, { channelId: 'UC_same', channelTitle: 'Drift Channel' })
    ).toThrow(new DuplicateError('The channel Drift Channel is already connected.'))
  })

  it('stores the refresh token as a blob and tracks token status', () => {
    const cipher = Buffer.from([0x01, 0xff, 0x00, 0x7a])
    const account = seedAccount(t.repos, { encRefreshToken: cipher })
    expect(Buffer.compare(t.repos.accounts.require(account.id).encRefreshToken!, cipher)).toBe(0)
    expect(account.tokenStatus).toBe('ok')
    expect(t.repos.accounts.setTokenStatus(account.id, 'needs_reauth').tokenStatus).toBe(
      'needs_reauth'
    )
  })

  it('keeps per-channel defaults as JSON', () => {
    const account = seedAccount(t.repos, {
      defaultsJson: { categoryId: '20', tags: ['drift'], madeForKids: false }
    })
    expect(t.repos.accounts.require(account.id).defaultsJson).toEqual({
      categoryId: '20',
      tags: ['drift'],
      madeForKids: false
    })
  })
})

describe('twitch accounts', () => {
  it('rejects a duplicate broadcaster and saves backfill progress', () => {
    const acc = seedTwitchAccount(t.repos)
    expect(() =>
      t.repos.twitchAccounts.create({
        broadcasterId: acc.broadcasterId,
        login: 'x',
        displayName: 'X',
        editorId: '1'
      })
    ).toThrow(DuplicateError)

    const cursor = {
      nextWindowStartUtc: '2024-01-08T00:00:00Z',
      endUtc: '2026-01-01T00:00:00Z',
      windowsDone: 1,
      windowsTotal: 100
    }
    expect(t.repos.twitchAccounts.setBackfillCursor(acc.id, cursor).backfillCursorJson).toEqual(
      cursor
    )
    expect(t.repos.twitchAccounts.setBackfillCursor(acc.id, null).backfillCursorJson).toBeNull()
  })
})

describe('clips', () => {
  it('upserts by clip id: new clips are inserted, existing ones refreshed', () => {
    const twitch = seedTwitchAccount(t.repos)
    seedClip(t.repos, twitch.id, 'A', { viewCount: 5 })
    t.repos.clips.updateLocal('A', { downloadStatus: 'downloaded', landscapePath: '/clips/a.mp4' })
    t.repos.clips.setHidden(['A'], true)

    const base = t.repos.clips.get('A')!
    const result = t.repos.clips.upsertMany([
      { ...base, viewCount: 50, vodOffset: 120, title: 'Renamed' },
      { ...base, id: 'B', createdAtUtc: '2026-10-01T00:00:00Z' }
    ])
    expect(result).toEqual({ inserted: 1, updated: 1 })

    const a = t.repos.clips.get('A')!
    expect(a.viewCount).toBe(50)
    expect(a.vodOffset).toBe(120)
    expect(a.title).toBe('Renamed')
    // Our own fields survive the overlap re-sync.
    expect(a.downloadStatus).toBe('downloaded')
    expect(a.landscapePath).toBe('/clips/a.mp4')
    expect(a.hidden).toBe(true)
  })

  it('lists oldest first by default, or newest / most viewed', () => {
    const twitch = seedTwitchAccount(t.repos)
    seedClip(t.repos, twitch.id, 'mid', { createdAtUtc: '2026-05-01T00:00:00Z', viewCount: 1 })
    seedClip(t.repos, twitch.id, 'old', { createdAtUtc: '2025-01-01T00:00:00Z', viewCount: 500 })
    seedClip(t.repos, twitch.id, 'new', { createdAtUtc: '2026-11-01T00:00:00Z', viewCount: 20 })

    const ids = (order?: 'oldest' | 'newest' | 'most_viewed') =>
      t.repos.clips.listForAccount(twitch.id, order).map((c) => c.id)
    expect(ids()).toEqual(['old', 'mid', 'new'])
    expect(ids('newest')).toEqual(['new', 'mid', 'old'])
    expect(ids('most_viewed')).toEqual(['old', 'new', 'mid'])
    expect(t.repos.clips.countForAccount(twitch.id)).toBe(3)
  })

  it('fills game names from the games cache', () => {
    const twitch = seedTwitchAccount(t.repos)
    t.repos.games.upsertMany([{ id: '1234', name: 'MechWarrior 4' }])
    seedClip(t.repos, twitch.id, 'G', { gameId: '1234' })
    expect(t.repos.clips.get('G')!.gameName).toBe('MechWarrior 4')
    expect(t.repos.games.missing(['1234', '999'])).toEqual(['999'])
  })
})

describe('post steps', () => {
  it('creates steps once, counts attempts, and resets unfinished ones', () => {
    const post = t.repos.posts.create({ accountId: seedAccount(t.repos).id, status: 'queued' })
    t.repos.postSteps.ensure(post.id, ['insert', 'thumbnail', 'playlist'])
    const steps = t.repos.postSteps.ensure(post.id, ['render', 'insert', 'thumbnail', 'playlist'])
    expect(steps.map((s) => s.step)).toEqual(['render', 'insert', 'thumbnail', 'playlist'])

    t.repos.postSteps.set(post.id, 'insert', 'running')
    t.repos.postSteps.set(post.id, 'insert', 'failed', 'ECONNRESET')
    t.repos.postSteps.set(post.id, 'insert', 'running')
    t.repos.postSteps.set(post.id, 'insert', 'done', null)
    t.repos.postSteps.set(post.id, 'thumbnail', 'running')
    t.repos.postSteps.resetUnfinished(post.id)

    const byStep = Object.fromEntries(t.repos.postSteps.list(post.id).map((s) => [s.step, s]))
    expect(byStep.insert).toMatchObject({ status: 'done', attempts: 2, lastError: null })
    expect(byStep.thumbnail).toMatchObject({ status: 'pending', attempts: 1 })
  })
})

describe('quota usage', () => {
  it('totals each bucket per Pacific day and ignores Dry Run calls', () => {
    const q = t.repos.quota
    q.record({ quotaDay: '2026-11-12', bucket: 'upload', method: 'videos.insert', cost: 1 })
    q.record({ quotaDay: '2026-11-12', bucket: 'upload', method: 'videos.insert', cost: 1 })
    q.record({ quotaDay: '2026-11-12', bucket: 'units', method: 'thumbnails.set', cost: 50 })
    q.record({ quotaDay: '2026-11-12', bucket: 'units', method: 'videos.list', cost: 1 })
    q.record({
      quotaDay: '2026-11-12',
      bucket: 'units',
      method: 'videos.update',
      cost: 50,
      dryRun: true
    })
    q.record({ quotaDay: '2026-11-11', bucket: 'units', method: 'videos.list', cost: 1 })

    expect(q.totalsForDay('2026-11-12')).toEqual({ uploadCalls: 2, units: 51 })
    expect(q.totalsForDay('2026-11-13')).toEqual({ uploadCalls: 0, units: 0 })
  })
})

describe('series and templates', () => {
  it('hands out series numbers in order', () => {
    const template = t.repos.templates.create({ name: 'MW4', titleTpl: 'MW4 Day {{n}}' })
    const s = t.repos.series.create({ name: 'MW4 Day N', templateId: template.id, nextNumber: 9 })
    expect(t.repos.series.takeNextNumber(s.id)).toBe(9)
    expect(t.repos.series.takeNextNumber(s.id)).toBe(10)
    expect(t.repos.series.require(s.id).nextNumber).toBe(11)
  })
})

describe('event log', () => {
  it('redacts secrets before storing', () => {
    const row = t.repos.eventLog.write({
      kind: 'auth.refresh',
      message: 'refreshed with Bearer ya29.secret',
      data: { refresh_token: '1//secret', channelId: 'UC1' }
    })
    expect(row.message).toBe('refreshed with Bearer [REDACTED]')
    expect(row.dataJson).toEqual({ refresh_token: '[REDACTED]', channelId: 'UC1' })
  })
})
