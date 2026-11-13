import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostInput } from '@shared/schemas/post'
import { createUploadJob, type UploadJob } from '../../src/main/jobs/upload'
import type { ProbeResult } from '../../src/main/media/ffprobe'
import { createMediaAccess } from '../../src/main/media/access'
import { createSecretBox } from '../../src/main/secrets/secretBox'
import { createPostsService } from '../../src/main/services/posts'
import { createYouTubeAccountsService } from '../../src/main/services/youtubeAccounts'
import { createTestDb, type TestDb } from '../helpers/db'
import { createGoogleState, googleHandlers } from '../mocks/google'

const google = createGoogleState()
const server = setupServer(...googleHandlers(google))

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'bypass' })
  server.events.on('request:start', ({ request }) => {
    if (/googleapis\.com|accounts\.google\.com/.test(new URL(request.url).hostname)) {
      google.allGoogleRequests.push(`${request.method} ${request.url}`)
    }
  })
})
afterAll(() => server.close())

const secrets = createSecretBox({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8')
})

const VIDEO_BYTES = 256 * 1024
const noSleep = async (): Promise<void> => {}
const fastBackoff = { attempts: 5, baseMs: 1, maxMs: 2 }

let t: TestDb
let dir: string
let videoPath: string
let thumbPath: string
let job: UploadJob
let notify: ReturnType<typeof vi.fn<(title: string, body: string) => void>>
let progress: [string, number, number][]
let accountId: number
let posts: ReturnType<typeof createPostsService>

function setup(): void {
  const accounts = createYouTubeAccountsService({
    repos: t.repos,
    secrets,
    clientConfig: {
      load: () => ({ clientId: 'x.apps.googleusercontent.com', clientSecret: 's', projectId: 'p' }),
      save: () => {
        throw new Error('unused')
      },
      remove: () => {}
    },
    openExternal: async () => {},
    notify: vi.fn(),
    emitChanged: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    clock: t.clock,
    dryRunUploadMs: 20
  })
  notify = vi.fn()
  progress = []
  job = createUploadJob({
    repos: t.repos,
    withApi: (id, fn) => accounts.withApi(id, fn),
    notify,
    emitChanged: vi.fn(),
    emitProgress: (postId, sent, total) => progress.push([postId, sent, total]),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    clock: t.clock,
    backoff: fastBackoff,
    sleep: noSleep
  })
  posts = createPostsService({
    repos: t.repos,
    probe: async (path): Promise<ProbeResult> => ({
      path,
      fileName: 'clip.mp4',
      sizeBytes: VIDEO_BYTES,
      mtimeMs: 1,
      durationSec: 30,
      width: 1080,
      height: 1920,
      videoCodec: 'h264',
      aspectRatio: '9:16',
      isShort: true,
      isLong: false
    }),
    media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
    emitChanged: vi.fn(),
    clock: t.clock
  })
}

function input(o: Partial<PostInput> = {}): PostInput {
  return {
    accountId,
    filePath: videoPath,
    title: 'MW4 Day 9',
    description: 'Day 9',
    tags: ['mw4'],
    categoryId: '20',
    playlistId: 'PL1',
    thumbnailPath: thumbPath,
    madeForKids: false,
    notifySubscribers: false,
    license: 'youtube',
    embeddable: true,
    defaultLanguage: null,
    defaultAudioLanguage: null,
    syntheticMedia: false,
    visibilityMode: 'schedule',
    publishAtUtc: '2026-11-13T10:00:00.000Z',
    missedPolicy: 'ask',
    ...o
  }
}

async function queue(o: Partial<PostInput> = {}): Promise<string> {
  const item = await posts.save({ input: input(o), mode: 'queue' })
  return item.id
}

/** Runs everything the job would pick up right now, like one runner tick. */
async function tick(): Promise<string[]> {
  const ids = job.findWork(t.clock())
  for (const id of ids) await job.run(id, new AbortController().signal)
  return ids
}

beforeEach(() => {
  Object.assign(google, createGoogleState())
  t = createTestDb()
  dir = mkdtempSync(join(tmpdir(), 'cd-upload-'))
  videoPath = join(dir, 'clip.mp4')
  thumbPath = join(dir, 'thumb.jpg')
  writeFileSync(videoPath, Buffer.alloc(VIDEO_BYTES, 7))
  writeFileSync(thumbPath, Buffer.alloc(2048, 1))
  accountId = t.repos.accounts.create({
    channelId: 'UCdrift',
    channelTitle: 'Drift Channel',
    encRefreshToken: secrets.encrypt('rt-initial')
  }).id
  setup()
})

afterEach(() => {
  t.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('upload engine', () => {
  it('uploads a scheduled post through insert → thumbnail → playlist', async () => {
    const id = await queue()
    // Lead time: publish 2026-11-13T10:00Z, 24h lead → ready since 10:00 (clock is 12:00Z).
    expect(await tick()).toEqual([id])

    const post = t.repos.posts.require(id)
    expect(post.status).toBe('processing')
    expect(post.youtubeVideoId).toBe('vid1')
    expect(post.uploadProgress).toBe(1)

    // What YouTube received.
    expect(google.uploadStarts).toHaveLength(1)
    const start = google.uploadStarts[0]!
    expect(start.query).toMatchObject({
      uploadType: 'resumable',
      part: 'snippet,status',
      notifySubscribers: 'false'
    })
    expect(start.size).toBe(VIDEO_BYTES)
    expect(start.resource).toEqual({
      snippet: { title: 'MW4 Day 9', description: 'Day 9', categoryId: '20', tags: ['mw4'] },
      status: {
        privacyStatus: 'private',
        publishAt: '2026-11-13T10:00:00Z',
        selfDeclaredMadeForKids: false,
        license: 'youtube',
        embeddable: true,
        containsSyntheticMedia: false
      }
    })
    expect(google.received.get('s1')).toBe(VIDEO_BYTES)
    expect(google.thumbnails).toEqual([{ videoId: 'vid1', bytes: 2048 }])
    expect(google.playlistInserts).toEqual([{ playlistId: 'PL1', videoId: 'vid1' }])

    expect(t.repos.postSteps.list(id).map((s) => [s.step, s.status])).toEqual([
      ['insert', 'done'],
      ['thumbnail', 'done'],
      ['playlist', 'done']
    ])
    // Quota: 1 upload call; thumbnail 50 + playlist 50 (plus 0 list calls here).
    expect(t.repos.quota.totalsForDay('2026-11-12')).toEqual({ uploadCalls: 1, units: 100 })
    expect(progress.at(-1)).toEqual([id, VIDEO_BYTES, VIDEO_BYTES])
    expect(notify).toHaveBeenCalledWith(
      'Uploaded: MW4 Day 9',
      expect.stringContaining('Drift Channel')
    )
    // Done: the next tick finds nothing to do.
    expect(await tick()).toEqual([])
  })

  it('resumes after the connection drops mid-upload instead of starting over', async () => {
    google.dropPutsAfterBytes = { count: 1, bytes: 100_000 }
    const id = await queue()
    await tick()
    expect(t.repos.posts.require(id).status).toBe('processing')
    expect(google.uploadStarts).toHaveLength(1) // same session
    expect(google.received.get('s1')).toBe(VIDEO_BYTES)
  })

  it('starts a new session if the old one expired during the interruption', async () => {
    google.dropPutsAfterBytes = { count: 1, bytes: 100_000 }
    google.expireSessionOnDrop = true
    const id = await queue()
    await tick()
    expect(t.repos.posts.require(id).status).toBe('processing')
    expect(google.uploadStarts).toHaveLength(2) // second session after the 404
    expect(google.received.get('s2')).toBe(VIDEO_BYTES)
  })

  it('retries only the thumbnail step when it hits a 5xx', async () => {
    google.thumbnailErrors = [{ status: 503, reason: 'backendError' }]
    const id = await queue()
    await tick()
    expect(google.uploadStarts).toHaveLength(1) // video inserted once
    expect(google.thumbnails).toHaveLength(1)
    expect(t.repos.posts.require(id).status).toBe('processing')
    expect(t.repos.postSteps.list(id).find((s) => s.step === 'thumbnail')?.attempts).toBe(1)
  })

  it('skips the thumbnail (without failing the video) when the channel is not verified', async () => {
    google.thumbnailErrors = [{ status: 403, reason: 'forbidden' }]
    const id = await queue()
    await tick()
    const post = t.repos.posts.require(id)
    expect(post.status).toBe('processing')
    expect(post.lastError).toMatch(/Thumbnail not set/)
    expect(t.repos.postSteps.list(id).map((s) => s.status)).toEqual(['done', 'skipped', 'done'])
  })

  it('waits for the Pacific midnight reset on quotaExceeded and pauses the queue', async () => {
    google.failStartWith = { status: 403, reason: 'quotaExceeded' }
    const first = await queue()
    const second = await queue({ title: 'Day 10' })
    await tick()

    const post = t.repos.posts.require(first)
    expect(post.status).toBe('waiting_quota')
    // Clock 2026-11-12T12:00Z (04:00 PST) → next midnight Pacific = 2026-11-13T08:00Z.
    expect(post.retryAfterUtc).toBe('2026-11-13T08:00:00.000Z')
    expect(job.pausedUntil()?.toISOString()).toBe('2026-11-13T08:00:00.000Z')
    expect(t.repos.posts.require(second).status).toBe('queued') // not burned
    expect(await tick()).toEqual([])

    // After the reset, both go out.
    t.clock.set('2026-11-13T08:01:00.000Z')
    await tick()
    expect(t.repos.posts.require(first).status).toBe('processing')
    expect(t.repos.posts.require(second).status).toBe('processing')
  })

  it('restarts cleanly after a quit mid-upload, and never inserts twice', async () => {
    const id = await queue()
    // Simulate a quit during the upload: status uploading, insert step running.
    t.repos.posts.transition(id, 'start_upload')
    t.repos.postSteps.ensure(id, ['insert', 'thumbnail', 'playlist'])
    t.repos.postSteps.set(id, 'insert', 'running')
    setup() // "relaunch"
    expect(job.recoverInterrupted()).toBe(1)
    expect(t.repos.posts.require(id).status).toBe('queued')
    expect(t.repos.postSteps.list(id)[0]?.status).toBe('pending')
    await tick()
    expect(t.repos.posts.require(id).status).toBe('processing')
    expect(google.uploadStarts).toHaveLength(1)
  })

  it('after a quit between steps, finishes the remaining steps without a second insert', async () => {
    google.thumbnailErrors = [
      { status: 503, reason: 'backendError' },
      { status: 503, reason: 'backendError' },
      { status: 503, reason: 'backendError' },
      { status: 503, reason: 'backendError' },
      { status: 503, reason: 'backendError' }
    ]
    const id = await queue()
    await tick()
    // 5 failures exhausted the thumbnail retries → failed, but the video id is saved.
    expect(t.repos.posts.require(id)).toMatchObject({ status: 'failed', youtubeVideoId: 'vid1' })

    posts.retry(id)
    await tick()
    expect(t.repos.posts.require(id).status).toBe('processing')
    expect(google.uploadStarts).toHaveLength(1) // no second video
    expect(google.thumbnails).toHaveLength(1)
  })

  it('Dry Run makes zero calls to Google and logs the payloads', async () => {
    t.repos.settings.update({ dryRun: true })
    const id = await queue()
    google.allGoogleRequests.length = 0
    await tick()

    const post = t.repos.posts.require(id)
    expect(post.status).toBe('processing')
    expect(post.youtubeVideoId).toMatch(/^DRYRUN-/)
    expect(google.allGoogleRequests).toEqual([])
    const logged = t.repos.eventLog.recent({ kind: 'dryrun.call' }).map((e) => e.message)
    expect(logged).toEqual([
      'Dry Run: would call playlistItems.insert',
      'Dry Run: would call thumbnails.set',
      'Dry Run: would call videos.insert (resumable)'
    ])
    // Dry Run calls don't count against real quota.
    expect(t.repos.quota.totalsForDay('2026-11-12')).toEqual({ uploadCalls: 0, units: 0 })
  })

  it('fails with "File missing" if the file was deleted or changed', async () => {
    const id = await queue()
    writeFileSync(videoPath, Buffer.alloc(10))
    await tick()
    const post = t.repos.posts.require(id)
    expect(post.status).toBe('failed')
    expect(post.lastError).toMatch(/^File missing/)
    expect(google.uploadStarts).toHaveLength(0)
  })

  it('follows the missed-time policy when the publish time already passed', async () => {
    const ask = await queue({ publishAtUtc: '2026-11-12T13:00:00.000Z' })
    const now = await queue({
      publishAtUtc: '2026-11-12T13:00:00.000Z',
      missedPolicy: 'publish_now',
      title: 'Go'
    })
    t.clock.set('2026-11-12T14:00:00.000Z')
    await tick()
    expect(t.repos.posts.require(ask).status).toBe('needs_decision')
    const published = t.repos.posts.require(now)
    expect(published.status).toBe('processing')
    expect(google.uploadStarts.at(-1)?.resource['status']).toMatchObject({
      privacyStatus: 'public'
    })
    expect(google.uploadStarts.at(-1)?.resource['status']).not.toHaveProperty('publishAt')
  })

  it('puts the post back and pauses the channel when the sign-in expired', async () => {
    google.deadRefreshTokens.add('rt-initial')
    const id = await queue()
    await tick()
    expect(t.repos.accounts.require(accountId).tokenStatus).toBe('needs_reauth')
    expect(t.repos.posts.require(id).status).toBe('queued')
    // Paused: not picked up again until Reconnect.
    expect(await tick()).toEqual([])
  })

  it('flags a public upload that YouTube locked as private, without retrying', async () => {
    google.forcePrivacy = 'private'
    const id = await queue({ visibilityMode: 'public', publishAtUtc: null })
    await tick()
    const post = t.repos.posts.require(id)
    expect(post.status).toBe('processing')
    expect(post.lastError).toMatch(/compliance audit/)
    expect(google.uploadStarts).toHaveLength(1)
  })

  it('does not upload before the lead time', async () => {
    await queue({ publishAtUtc: '2026-11-20T17:00:00.000Z' })
    expect(await tick()).toEqual([])
  })
})
