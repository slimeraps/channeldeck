import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClipDownloadJob } from '../../src/main/jobs/clipDownload'
import { createClipSyncJob, type ClipSyncJob } from '../../src/main/jobs/clipSync'
import { createSecretBox } from '../../src/main/secrets/secretBox'
import {
  createTwitchAccountsService,
  type TwitchAccountsService
} from '../../src/main/services/twitchAccounts'
import { createTestDb, type TestDb } from '../helpers/db'
import { createTwitchState, makeClips, twitchHandlers } from '../mocks/twitch'

const twitch = createTwitchState()
const server = setupServer(...twitchHandlers(twitch))

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }))
afterAll(() => server.close())

const secrets = createSecretBox({
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (s) => Buffer.from(s, 'utf8').reverse(),
  decryptStringAsync: async (b) => ({
    result: Buffer.from(b).reverse().toString('utf8'),
    shouldReEncrypt: false
  })
})

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

let t: TestDb
let dir: string
let notify: ReturnType<typeof vi.fn<(title: string, body: string) => void>>
let deviceCodes: { userCode: string }[]
let sleeps: number[]
let service: TwitchAccountsService
let sync: ClipSyncJob

/** Stands in for the loopback receiver: the browser "comes back" with a good code. */
const fakeReceiver = async () => ({
  redirectUri: 'http://localhost:17563/twitch/callback',
  waitForCode: async () => 'good-code',
  close: () => {}
})

const fastSleep = async (ms: number) => {
  sleeps.push(ms)
}

function makeService(): TwitchAccountsService {
  return createTwitchAccountsService({
    repos: t.repos,
    secrets,
    openExternal: async () => {},
    notify,
    emitChanged: vi.fn(),
    emitDeviceCode: (info) => deviceCodes.push(info),
    logger,
    clock: t.clock,
    sleep: fastSleep,
    createReceiver: fakeReceiver
  })
}

function makeSync(svc: TwitchAccountsService): ClipSyncJob {
  return createClipSyncJob({
    repos: t.repos,
    helixFor: svc.helixFor,
    forceSync: svc.forceSync,
    notify,
    emitChanged: vi.fn(),
    logger,
    clock: t.clock,
    zone: 'America/Chicago'
  })
}

const run = (job: { run(id: number, s: AbortSignal): Promise<void> }, id: number) =>
  job.run(id, new AbortController().signal)

beforeEach(async () => {
  Object.assign(twitch, createTwitchState())
  t = createTestDb()
  dir = mkdtempSync(join(tmpdir(), 'cd-clips-'))
  t.repos.settings.update({ clipsRoot: dir })
  notify = vi.fn()
  deviceCodes = []
  sleeps = []
  service = makeService()
  await service.setConfig({ clientId: 'cid', clientSecret: 'shh-secret' })
  sync = makeSync(service)
})

afterEach(() => {
  t.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('connecting Twitch', () => {
  it('signs in as the broadcaster and starts a backfill from channel creation', async () => {
    const view = await service.connect({ mode: 'broadcaster', backfillFromUtc: null })
    expect(view).toMatchObject({ login: 'helmsyy', viaEditor: false, authFlow: 'auth_code' })
    expect(view.backfill?.windowsTotal).toBe(7) // 2026-10-01 → 2026-11-12 in 7-day windows

    const row = t.repos.twitchAccounts.require(view.id)
    // Only ciphertext is stored, never the token itself.
    expect(row.encRefreshToken).not.toBeNull()
    expect(Buffer.from(row.encRefreshToken!).toString('utf8')).not.toContain('rt-1')
    expect(await secrets.decrypt(row.encRefreshToken!)).toBe('rt-1')
    // The client secret is stored encrypted, and the config never returns it.
    expect(service.getConfig()).toEqual({
      clientId: 'cid',
      hasSecret: true,
      redirectUri: 'http://localhost:17563/twitch/callback'
    })
  })

  it('refuses a second connection of the same channel', async () => {
    await service.connect({ mode: 'broadcaster', backfillFromUtc: null })
    await expect(service.connect({ mode: 'broadcaster', backfillFromUtc: null })).rejects.toThrow(
      /already connected/
    )
  })

  it('checks editor access with a 403 from Get Clips Download', async () => {
    twitch.codeGrant = { userId: '1001', scopes: ['editor:manage:clips'] }
    await expect(
      service.connect({ mode: 'editor', channelLogin: 'otherstreamer', backfillFromUtc: null })
    ).rejects.toThrow(/isn’t an editor of OtherStreamer/)
    expect(t.repos.twitchAccounts.list()).toHaveLength(0)

    twitch.editors.set('1001', ['2002'])
    const view = await service.connect({
      mode: 'editor',
      channelLogin: 'OtherStreamer',
      backfillFromUtc: '2026-11-01T00:00:00Z'
    })
    expect(view).toMatchObject({ login: 'otherstreamer', viaEditor: true })
    expect(t.repos.twitchAccounts.require(view.id).editorId).toBe('1001')
  })

  it('gives each new channel the next unused color, and lets you change it', async () => {
    const first = await service.connect({ mode: 'broadcaster', backfillFromUtc: null })
    twitch.codeGrant = { userId: '1001', scopes: ['editor:manage:clips'] }
    twitch.editors.set('1001', ['2002'])
    const second = await service.connect({
      mode: 'editor',
      channelLogin: 'otherstreamer',
      backfillFromUtc: null
    })
    expect([first.color, second.color]).toEqual(['#6366f1', '#f97316'])
    expect(service.update(first.id, { color: '#ef4444' }).color).toBe('#ef4444')
    expect(service.list().map((a) => a.color)).toEqual(['#ef4444', '#f97316'])
  })

  it('rejects a sign-in that did not grant the clip scope', async () => {
    twitch.codeGrant = { userId: '1001', scopes: ['user:read:email'] }
    await expect(service.connect({ mode: 'broadcaster', backfillFromUtc: null })).rejects.toThrow(
      /didn’t grant clip access/
    )
  })

  it('falls back to the Device Code flow without a client secret', async () => {
    await service.setConfig({ clientId: 'cid', clientSecret: null })
    twitch.devicePendingPolls = 2
    const view = await service.connect({ mode: 'broadcaster', backfillFromUtc: null })
    expect(view.authFlow).toBe('device_code')
    expect(deviceCodes).toEqual([expect.objectContaining({ userCode: 'ABCD-EFGH' })])
    expect(sleeps.filter((ms) => ms === 5000)).toHaveLength(3) // two pending polls + success
  })
})

describe('backfill and daily sync', () => {
  it('backfills week by week, resumes after a failure, then hands over to the daily sync', async () => {
    twitch.clips = makeClips('1001', 60, '2026-10-01T00:00:00Z', '2026-11-12T00:00:00Z')
    const { id } = await service.connect({ mode: 'broadcaster', backfillFromUtc: null })

    // Week 1 works, then Twitch keeps answering 429 until the request gives up.
    let calls = 0
    server.events.on('request:start', function failSecondWindow({ request }) {
      if (new URL(request.url).pathname === '/helix/clips' && ++calls === 2) {
        twitch.rateLimitNext = 5
        server.events.removeListener('request:start', failSecondWindow)
      }
    })
    await run(sync, id)
    let row = t.repos.twitchAccounts.require(id)
    expect(row.backfillCursorJson).toMatchObject({ windowsDone: 1, windowsTotal: 7 })
    expect(row.lastSyncUtc).toBeNull()
    const afterWeek1 = t.repos.clips.countForAccount(id)
    expect(afterWeek1).toBeGreaterThan(0)
    expect(t.repos.eventLog.recent({ limit: 10 })[0]?.kind).toBe('clips.sync_failed')
    // Backing off: not picked up again until the retry time.
    expect(sync.findWork(t.clock())).toEqual([])

    // A fresh start (quit and relaunch) resumes at week 2.
    twitch.clipQueries = []
    sync = makeSync(service)
    await run(sync, id)
    expect(twitch.clipQueries[0]?.started_at).toBe('2026-10-08T00:00:00.000Z')
    row = t.repos.twitchAccounts.require(id)
    expect(row.backfillCursorJson).toBeNull()
    expect(row.lastSyncUtc).toBe('2026-11-12T12:00:00.000Z')
    expect(t.repos.clips.countForAccount(id)).toBe(60)
    expect(notify).toHaveBeenCalledWith(
      'Clip backfill finished',
      'Helmsy: 60 clips are in the bank.'
    )

    // Game names were looked up once and filled in.
    const clip = t.repos.clips.get('clip1')!
    expect(clip.gameName).toBe('MechWarrior 4')

    // Next day: two new clips, and an old one gained views. The window overlaps by 2 days.
    t.clock.set('2026-11-13T12:00:00.000Z')
    twitch.clips.push(
      ...makeClips('1001', 2, '2026-11-13T01:00:00Z', '2026-11-13T02:00:00Z', 'new')
      // The overlap re-reads the newest clips.
    )
    const recent = twitch.clips.find((c) => c.id === 'clip59')!
    recent.view_count = 9999
    twitch.clipQueries = []
    service.syncNow(id)
    expect(sync.findWork(t.clock())).toEqual([id])
    await run(sync, id)
    expect(twitch.clipQueries[0]?.started_at).toBe('2026-11-10T12:00:00.000Z')
    expect(t.repos.clips.countForAccount(id)).toBe(62)
    expect(t.repos.clips.get('clip59')?.viewCount).toBe(9999)
    expect(notify).toHaveBeenCalledWith('2 new clips', 'Helmsy: added to the clip bank.')
  })

  it('splits a crowded window so the ~1,000 result cap never hides clips', async () => {
    twitch.clips = makeClips('1001', 1500, '2026-11-06T00:00:00Z', '2026-11-12T00:00:00Z')
    const { id } = await service.connect({
      mode: 'broadcaster',
      backfillFromUtc: '2026-11-05T12:00:00Z'
    })
    await run(sync, id)
    expect(t.repos.clips.countForAccount(id)).toBe(1500)
    // The full window hit the cap; it was then fetched again in smaller pieces.
    const windows = new Set(twitch.clipQueries.map((q) => `${q.started_at}|${q.ended_at}`))
    expect(windows.size).toBeGreaterThan(1)
    // Pages of 100.
    expect(twitch.clipQueries.filter((q) => q.after).length).toBeGreaterThan(10)
  })

  it('waits out a 429 using Ratelimit-Reset and carries on', async () => {
    twitch.clips = makeClips('1001', 5, '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z')
    const { id } = await service.connect({
      mode: 'broadcaster',
      backfillFromUtc: '2026-11-09T00:00:00Z'
    })
    twitch.rateLimitNext = 2
    await run(sync, id)
    expect(t.repos.clips.countForAccount(id)).toBe(5)
    expect(sleeps.some((ms) => ms > 0 && ms <= 1500)).toBe(true)
  })
})

describe('tokens', () => {
  it('refreshes with rotation and keeps the newest refresh token', async () => {
    const { id } = await service.connect({ mode: 'broadcaster', backfillFromUtc: null })
    // A relaunch has no cached access token, so the first Helix call refreshes.
    const relaunched = makeService()
    await relaunched.accessToken(id)
    const row = t.repos.twitchAccounts.require(id)
    expect(await secrets.decrypt(row.encRefreshToken!)).toBe('rt-2')
    expect(twitch.refreshTokens.has('rt-1')).toBe(false)
    // And again: rt-2 is used, rt-3 saved.
    await makeService().accessToken(id)
    expect(await secrets.decrypt(t.repos.twitchAccounts.require(id).encRefreshToken!)).toBe('rt-3')
  })

  it('marks the account for re-auth when the refresh token is dead, and pauses sync', async () => {
    const { id } = await service.connect({ mode: 'broadcaster', backfillFromUtc: null })
    twitch.refreshTokens.clear() // revoked on twitch.tv
    const relaunched = makeService()
    const job = makeSync(relaunched)
    await run(job, id)
    expect(t.repos.twitchAccounts.require(id).tokenStatus).toBe('needs_reauth')
    expect(notify).toHaveBeenCalledWith('Twitch sign-in needed', expect.stringContaining('Helmsy'))
    expect(job.findWork(t.clock())).toEqual([])

    // Reconnect restores it.
    const view = await relaunched.reconnect(id)
    expect(view.tokenStatus).toBe('ok')
    expect(job.findWork(t.clock())).toEqual([id])
  })
})

describe('downloads', () => {
  it('downloads files with the naming scheme, sidecar and thumbnail', async () => {
    twitch.clips = makeClips('1001', 4, '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z')
    twitch.clips[2]!.omitFromDownloads = true
    twitch.clips[1]!.landscape = false // clip1: no landscape, no portrait → nothing to download
    const { id } = await service.connect({
      mode: 'broadcaster',
      backfillFromUtc: '2026-11-09T00:00:00Z'
    })
    await run(sync, id)

    const verifyVideo = vi.fn(async (path: string) => {
      if (path.includes('clip3')) throw new Error('moov atom not found')
    })
    const download = createClipDownloadJob({
      repos: t.repos,
      helixFor: service.helixFor,
      verifyVideo,
      emitChanged: vi.fn(),
      logger,
      clock: t.clock,
      sleep: fastSleep
    })
    expect(download.findWork(t.clock())).toEqual([id])
    await run(download, id)

    // clip0: landscape + portrait (index divisible by 3).
    const c0 = t.repos.clips.get('clip0')!
    expect(c0.downloadStatus).toBe('downloaded')
    const folder = join(dir, 'helmsyy', '2026', '2026-11')
    expect(c0.landscapePath).toBe(join(folder, '2026-11-10_000000_clip0_clip-clip-0_landscape.mp4'))
    expect(c0.portraitPath).toBe(join(folder, '2026-11-10_000000_clip0_clip-clip-0_portrait.mp4'))
    expect(existsSync(c0.landscapePath!)).toBe(true)
    expect(existsSync(`${c0.landscapePath!}.part`)).toBe(false)
    expect(c0.thumbPath).toBe(join(folder, '2026-11-10_000000_clip0_clip-clip-0.jpg'))
    expect(c0.fileSize).toBeGreaterThan(0)
    const sidecar = JSON.parse(
      readFileSync(join(folder, '2026-11-10_000000_clip0_clip-clip-0.json'), 'utf8')
    ) as { clip: { id: string; gameName: string; broadcaster: { login: string } } }
    expect(sidecar.clip).toMatchObject({
      id: 'clip0',
      gameName: 'Assetto Corsa',
      broadcaster: { login: 'helmsyy' }
    })

    // clip1: Twitch returned null for both URLs.
    expect(t.repos.clips.get('clip1')).toMatchObject({ downloadStatus: 'not_downloadable' })
    // clip2: left out of the response entirely.
    expect(t.repos.clips.get('clip2')).toMatchObject({ downloadStatus: 'not_downloadable' })
    // clip3: downloaded but not a playable video → failed, retried later, .part removed.
    const c3 = t.repos.clips.get('clip3')!
    expect(c3).toMatchObject({ downloadStatus: 'failed', downloadAttempts: 1 })
    expect(c3.downloadError).toMatch(/isn't a playable video/)
    expect(c3.downloadRetryAfterUtc).toBe('2026-11-12T12:05:00.000Z')
    expect(existsSync(join(folder, '2026-11-10_180000_clip3_clip-clip-3_landscape.mp4.part'))).toBe(
      false
    )

    // Nothing is due until the retry time; then clip3 is tried again with fresh links.
    expect(download.findWork(t.clock())).toEqual([])
    t.clock.advance(5 * 60_000)
    verifyVideo.mockResolvedValue(undefined)
    twitch.downloadRequests = []
    await run(download, id)
    expect(twitch.downloadRequests).toEqual([['clip3']])
    expect(t.repos.clips.get('clip3')?.downloadStatus).toBe('downloaded')
  })

  it('asks for download links at most 10 clips at a time', async () => {
    twitch.clips = makeClips('1001', 25, '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z')
    const { id } = await service.connect({
      mode: 'broadcaster',
      backfillFromUtc: '2026-11-09T00:00:00Z'
    })
    await run(sync, id)
    const download = createClipDownloadJob({
      repos: t.repos,
      helixFor: service.helixFor,
      verifyVideo: async () => {},
      emitChanged: vi.fn(),
      logger,
      clock: t.clock,
      sleep: fastSleep
    })
    await run(download, id)
    expect(twitch.downloadRequests.map((r) => r.length)).toEqual([10, 10, 5])
    expect(t.repos.clips.stats(id)).toMatchObject({ total: 25, downloaded: 25 })
  })

  it('marks downloads failed with an editor message when editor access is gone', async () => {
    twitch.codeGrant = { userId: '1001', scopes: ['editor:manage:clips'] }
    twitch.editors.set('1001', ['2002'])
    twitch.clips = makeClips('2002', 3, '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z')
    const { id } = await service.connect({
      mode: 'editor',
      channelLogin: 'otherstreamer',
      backfillFromUtc: '2026-11-09T00:00:00Z'
    })
    await run(sync, id)
    twitch.editors.clear()
    const download = createClipDownloadJob({
      repos: t.repos,
      helixFor: service.helixFor,
      verifyVideo: async () => {},
      emitChanged: vi.fn(),
      logger,
      clock: t.clock,
      sleep: fastSleep
    })
    await run(download, id)
    expect(t.repos.clips.get('clip0')).toMatchObject({
      downloadStatus: 'failed',
      downloadError: expect.stringMatching(/no longer an editor of OtherStreamer/)
    })
  })
})
