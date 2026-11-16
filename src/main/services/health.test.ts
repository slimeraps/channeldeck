import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOWNLOAD_STATUSES, POST_STATUSES } from '@shared/constants/enums'
import { healthSnapshotSchema } from '@shared/schemas/health'
import {
  createTestDb,
  seedAccount,
  seedClip,
  seedTwitchAccount,
  type TestDb
} from '../../../tests/helpers/db'
import { buildHealthSnapshot, sanitizeEventMessage } from './health'

let t: TestDb
beforeEach(() => {
  t = createTestDb()
})
afterEach(() => t.close())

function snapshot(extra: { jobsPaused?: boolean; dbFileBytes?: number | null } = {}) {
  return buildHealthSnapshot({
    repos: t.repos,
    now: t.clock(),
    app: { version: '2.0.0', electron: '41.0.0', platform: 'darwin' },
    schemaVersion: 13,
    dbFileBytes: 4096,
    jobsPaused: false,
    ...extra
  })
}

function newPost(accountId: number, title = 'MW4 Day 9') {
  return t.repos.posts.create({
    accountId,
    status: 'queued',
    title,
    visibilityMode: 'schedule',
    publishAtUtc: '2026-11-13T17:00:00.000Z'
  })
}

describe('buildHealthSnapshot', () => {
  it('reports every status with zeros on a fresh database, and matches the schema', () => {
    const s = snapshot()
    expect(healthSnapshotSchema.parse(s)).toEqual(s)
    expect(Object.keys(s.posts).sort()).toEqual([...POST_STATUSES].sort())
    expect(Object.values(s.posts).every((n) => n === 0)).toBe(true)
    expect(Object.keys(s.clips).sort()).toEqual([...DOWNLOAD_STATUSES].sort())
    expect(Object.values(s.clips).every((n) => n === 0)).toBe(true)
    expect(s).toMatchObject({
      generatedAtUtc: '2026-11-12T12:00:00.000Z',
      app: { version: '2.0.0', electron: '41.0.0', platform: 'darwin', schemaVersion: 13 },
      dryRun: false,
      channels: [],
      dryRunCalls: 0,
      jobs: { state: 'running' }
    })
  })

  it('counts posts and clips by status', () => {
    const account = seedAccount(t.repos)
    newPost(account.id, 'One')
    const two = newPost(account.id, 'Two')
    t.repos.posts.transition(two.id, 'start_upload')
    const twitch = seedTwitchAccount(t.repos)
    seedClip(t.repos, twitch.id, 'c1')
    seedClip(t.repos, twitch.id, 'c2')
    t.repos.clips.setDownload('c2', { downloadStatus: 'downloaded' })

    const s = snapshot()
    expect(s.posts).toMatchObject({ queued: 1, uploading: 1, draft: 0 })
    expect(s.clips).toMatchObject({ pending: 1, downloaded: 1, failed: 0 })
  })

  it('lists channels by name and token status only, never secrets', () => {
    const youtube = seedAccount(t.repos, {
      channelTitle: 'Drift Channel',
      encRefreshToken: Buffer.from('SUPER-SECRET-REFRESH-TOKEN')
    })
    t.repos.accounts.setTokenStatus(youtube.id, 'needs_reauth')
    const twitch = seedTwitchAccount(t.repos)
    t.repos.settings.setSecret('twitchClientSecret', Buffer.from('TWITCH-CLIENT-SECRET'))
    t.repos.settings.update({ twitchClientId: 'public-client-id' })

    const s = snapshot()
    expect(s.channels).toEqual([
      { platform: 'youtube', name: 'Drift Channel', tokenStatus: 'needs_reauth' },
      { platform: 'twitch', name: twitch.displayName, tokenStatus: 'ok' }
    ])
    const text = JSON.stringify(s)
    for (const secret of ['SUPER-SECRET', 'TWITCH-CLIENT-SECRET', 'secret.', 'public-client-id']) {
      expect(text).not.toContain(secret)
    }
  })

  it('reports quota with the Pacific reset, Dry Run, the job state and the Dry Run call count', () => {
    t.repos.settings.update({ dryRun: true })
    t.repos.eventLog.write({ kind: 'dryrun.call', message: 'Dry Run: would call videos.insert' })
    t.repos.eventLog.write({ kind: 'dryrun.call', message: 'Dry Run: would call videos.update' })
    t.repos.eventLog.write({ kind: 'app.start', message: 'started' })

    const s = snapshot({ jobsPaused: true })
    expect(s.dryRun).toBe(true)
    expect(s.dryRunCalls).toBe(2)
    expect(s.jobs).toEqual({ state: 'paused' })
    // 12:00Z on Nov 12 is 04:00 Pacific, so quota resets at the next Pacific midnight.
    expect(s.quota).toMatchObject({
      day: '2026-11-12',
      uploadCalls: 0,
      units: 0,
      resetsAtUtc: '2026-11-13T08:00:00.000Z'
    })
  })

  it('returns the latest 50 events, newest first, without their data payloads', () => {
    for (let i = 0; i < 60; i += 1) {
      t.clock.advance(1000)
      t.repos.eventLog.write({
        kind: 'test.event',
        message: `event ${i}`,
        data: { file: '/Users/me/Movies/secret.mp4' }
      })
    }
    const s = snapshot()
    expect(s.events).toHaveLength(50)
    expect(s.events[0]?.message).toBe('event 59')
    expect(s.events.at(-1)?.message).toBe('event 10')
    expect(Object.keys(s.events[0]!).sort()).toEqual(['atUtc', 'id', 'kind', 'level', 'message'])
    expect(JSON.stringify(s)).not.toContain('secret.mp4')
  })

  it('hides file paths and redacts secrets in event messages', () => {
    t.repos.eventLog.write({
      kind: 'x',
      message: 'Could not read /Users/me/Movies/ChannelDeck/Clips/a.mp4 with code=abc123'
    })
    const [event] = snapshot().events
    expect(event?.message).toBe('Could not read [path] with code=[REDACTED]')
  })

  // The two title tests below are defensive. No writer currently puts a post title in an event
  // message (post.status carries only a short reason), but the sanitizer must still cope if one
  // ever does. The fixtures use the real post.status shape: "<from> → <to> (<event>): <reason>".
  it('shows post titles only while Hide post titles is off', () => {
    const account = seedAccount(t.repos)
    const post = newPost(account.id, 'Secret Giveaway')
    t.repos.eventLog.write({
      kind: 'post.status',
      message: 'queued → failed (upload): Secret Giveaway could not be sent',
      postId: post.id
    })
    expect(snapshot().events[0]?.message).toBe(
      'queued → failed (upload): Secret Giveaway could not be sent'
    )

    t.repos.settings.update({ hidePostTitles: true })
    expect(snapshot().events[0]?.message).toBe(
      'queued → failed (upload): a video could not be sent'
    )
  })

  it('turns a quoted title into "a video" when its post no longer exists', () => {
    const account = seedAccount(t.repos)
    const draft = t.repos.posts.create({
      accountId: account.id,
      status: 'draft',
      title: 'Deleted Draft Title',
      visibilityMode: 'private'
    })
    t.repos.eventLog.write({
      kind: 'post.status',
      message: 'queued → failed (upload): "Deleted Draft Title" failed; “Other Gone Title” too',
      postId: draft.id
    })
    t.repos.posts.deleteDraft(draft.id)
    expect(t.repos.posts.get(draft.id)).toBeUndefined()

    t.repos.settings.update({ hidePostTitles: true })
    const [event] = snapshot().events
    expect(event?.message).toBe('queued → failed (upload): a video failed; a video too')
    expect(JSON.stringify(snapshot())).not.toContain('Gone Title')
    expect(JSON.stringify(snapshot())).not.toContain('Deleted Draft Title')
  })

  it('does not write anything', () => {
    const before = t.repos.eventLog.recent({ limit: 1000 }).length
    snapshot()
    expect(t.repos.eventLog.recent({ limit: 1000 })).toHaveLength(before)
  })
})

describe('sanitizeEventMessage', () => {
  it('leaves ordinary text and short slashes alone', () => {
    expect(
      sanitizeEventMessage('queued → uploading (start_upload) and/or 1 / 2', hide(false))
    ).toBe('queued → uploading (start_upload) and/or 1 / 2')
  })

  it('replaces titles that contain regex characters', () => {
    expect(
      sanitizeEventMessage('Posted C++ (clip) [1]', {
        hideTitles: true,
        titles: ['C++ (clip) [1]']
      })
    ).toBe('Posted a video')
  })
})

function hide(hideTitles: boolean) {
  return { hideTitles, titles: [] as string[] }
}
