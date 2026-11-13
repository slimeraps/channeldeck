import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostInput } from '@shared/schemas/post'
import { createStatusSyncJob, type StatusSyncJob } from '../../src/main/jobs/statusSync'
import { createUploadJob, type UploadJob } from '../../src/main/jobs/upload'
import { createMediaAccess } from '../../src/main/media/access'
import type { ProbeResult } from '../../src/main/media/ffprobe'
import { createSecretBox } from '../../src/main/secrets/secretBox'
import { createPostsService, type PostsService } from '../../src/main/services/posts'
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
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (s) => Buffer.from(s, 'utf8').reverse(),
  decryptStringAsync: async (b) => ({
    result: Buffer.from(b).reverse().toString('utf8'),
    shouldReEncrypt: false
  })
})

let t: TestDb
let dir: string
let video: string
let accountId: number
let posts: PostsService
let upload: UploadJob
let sync: StatusSyncJob
let notify: ReturnType<typeof vi.fn<(title: string, body: string) => void>>

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

beforeEach(async () => {
  Object.assign(google, createGoogleState())
  t = createTestDb()
  dir = mkdtempSync(join(tmpdir(), 'cd-sync-'))
  video = join(dir, 'clip.mp4')
  writeFileSync(video, Buffer.alloc(64 * 1024, 3))
  accountId = t.repos.accounts.create({
    channelId: 'UCdrift',
    channelTitle: 'Drift Channel',
    encRefreshToken: await secrets.encrypt('rt-initial')
  }).id

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
    logger,
    clock: t.clock,
    dryRunUploadMs: 10
  })
  const withApi = accounts.withApi
  notify = vi.fn()
  posts = createPostsService({
    repos: t.repos,
    probe: async (path): Promise<ProbeResult> => ({
      path,
      fileName: 'clip.mp4',
      sizeBytes: 64 * 1024,
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
    withApi,
    clock: t.clock
  })
  upload = createUploadJob({
    repos: t.repos,
    withApi,
    notify,
    emitChanged: vi.fn(),
    emitProgress: () => {},
    logger,
    clock: t.clock,
    backoff: { attempts: 3, baseMs: 1, maxMs: 2 },
    sleep: async () => {}
  })
  sync = createStatusSyncJob({
    repos: t.repos,
    withApi,
    notify,
    emitChanged: vi.fn(),
    logger,
    clock: t.clock
  })
})

afterEach(() => {
  t.close()
  rmSync(dir, { recursive: true, force: true })
})

function input(o: Partial<PostInput> = {}): PostInput {
  return {
    accountId,
    filePath: video,
    title: 'MW4 Day 9',
    description: '',
    tags: [],
    categoryId: '20',
    playlistId: null,
    thumbnailPath: null,
    madeForKids: false,
    notifySubscribers: true,
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

/** Queue a post and upload it through the real upload job. Returns post id + video id. */
async function uploaded(o: Partial<PostInput> = {}): Promise<{ id: string; videoId: string }> {
  const { id } = await posts.save({ input: input(o), mode: 'queue' })
  await posts.uploadNow(id)
  for (const pid of upload.findWork(t.clock())) await upload.run(pid, new AbortController().signal)
  const post = t.repos.posts.require(id)
  return { id, videoId: post.youtubeVideoId as string }
}

function setOnYouTube(
  videoId: string,
  status: Record<string, unknown>,
  processingStatus?: string
): void {
  const v = google.videos.get(videoId)
  if (!v) throw new Error(`no video ${videoId}`)
  v.status = { ...v.status, ...status }
  if (processingStatus) v.processingDetails = { processingStatus }
}

describe('status sync', () => {
  it('moves a scheduled upload Processing → Scheduled → Published', async () => {
    const { id, videoId } = await uploaded()
    expect(t.repos.posts.require(id).status).toBe('processing')

    await sync.syncNow()
    expect(t.repos.posts.require(id).status).toBe('processing') // still processing on YouTube

    setOnYouTube(videoId, { uploadStatus: 'processed' }, 'succeeded')
    await sync.syncNow()
    expect(t.repos.posts.require(id).status).toBe('scheduled')

    setOnYouTube(videoId, { privacyStatus: 'public', publishAt: null })
    await sync.syncNow()
    expect(t.repos.posts.require(id).status).toBe('published')
    expect(notify).toHaveBeenCalledWith('Published', '"MW4 Day 9" is now public.')
  })

  it('asks for at most 50 ids per videos.list call (120 posts → 3 calls)', async () => {
    for (let i = 0; i < 120; i++) {
      const post = t.repos.posts.create({
        accountId,
        status: 'queued',
        title: `p${i}`,
        visibilityMode: 'private'
      })
      t.repos.posts.transition(post.id, 'start_upload')
      t.repos.posts.transition(post.id, 'upload_complete', {
        patch: { youtubeVideoId: `bulk${i}` }
      })
      google.videos.set(`bulk${i}`, {
        status: { uploadStatus: 'processed', privacyStatus: 'private' },
        processingDetails: { processingStatus: 'succeeded' }
      })
    }
    const summary = await sync.syncNow()
    expect(google.videosListCalls.map((ids) => ids.length)).toEqual([50, 50, 20])
    expect(summary).toMatchObject({ checked: 120, changed: 120 })
    expect(t.repos.posts.list({ statuses: ['published'] })).toHaveLength(120)
    expect(t.repos.quota.totalsForDay('2026-11-12').units).toBe(3)
  })

  it('reports a rejected video with the reason', async () => {
    const { id, videoId } = await uploaded()
    setOnYouTube(videoId, { uploadStatus: 'rejected', rejectionReason: 'duplicate' })
    await sync.syncNow()
    const post = t.repos.posts.require(id)
    expect(post.status).toBe('failed')
    expect(post.lastError).toBe(
      'YouTube rejected this video because of it duplicates another video.'
    )
    expect(notify).toHaveBeenCalledWith('Video rejected', expect.stringContaining('duplicates'))
  })

  it('notices a video deleted in YouTube Studio', async () => {
    const { id, videoId } = await uploaded()
    google.videos.delete(videoId)
    await sync.syncNow()
    expect(t.repos.posts.require(id).status).toBe('canceled')
  })

  it('polls every 2 minutes while processing, then every 15', async () => {
    const { videoId } = await uploaded()
    expect(sync.findWork(t.clock())).toEqual(['sync'])
    await sync.syncNow()
    expect(sync.findWork(t.clock())).toEqual([])
    t.clock.advance(2 * 60_000)
    expect(sync.findWork(t.clock())).toEqual(['sync'])

    setOnYouTube(videoId, { uploadStatus: 'processed' }, 'succeeded')
    await sync.syncNow() // → scheduled; nothing processing any more
    t.clock.advance(2 * 60_000)
    expect(sync.findWork(t.clock())).toEqual([])
    t.clock.advance(13 * 60_000)
    expect(sync.findWork(t.clock())).toEqual(['sync'])
  })

  it('walks Dry Run videos through locally without calling Google', async () => {
    t.repos.settings.update({ dryRun: true })
    const { id } = await uploaded()
    google.allGoogleRequests.length = 0
    await sync.syncNow()
    expect(t.repos.posts.require(id).status).toBe('scheduled')
    t.clock.set('2026-11-13T10:01:00.000Z')
    await sync.syncNow()
    expect(t.repos.posts.require(id).status).toBe('published')
    expect(google.allGoogleRequests).toEqual([])
  })
})

describe('changing uploaded videos', () => {
  it('reschedules on YouTube by sending the whole status part', async () => {
    const { id, videoId } = await uploaded()
    await posts.reschedule(id, '2026-11-20T18:30:00.000Z')
    expect(google.videoUpdates).toEqual([
      {
        id: videoId,
        status: {
          privacyStatus: 'private',
          publishAt: '2026-11-20T18:30:00Z',
          license: 'youtube',
          embeddable: true,
          publicStatsViewable: true,
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: false
        }
      }
    ])
    expect(t.repos.posts.require(id).publishAtUtc).toBe('2026-11-20T18:30:00.000Z')
    // videos.list (1) + videos.update (50) on top of the upload.
    expect(t.repos.quota.totalsForDay('2026-11-12')).toEqual({ uploadCalls: 1, units: 51 })
  })

  it('refuses to reschedule a video that is already public, or into the past', async () => {
    const { id, videoId } = await uploaded()
    await expect(posts.reschedule(id, '2026-11-12T11:00:00.000Z')).rejects.toThrow(/in the future/)
    setOnYouTube(videoId, { privacyStatus: 'public', publishAt: null })
    await expect(posts.reschedule(id, '2026-11-20T18:30:00.000Z')).rejects.toThrow(/already public/)
    expect(google.videoUpdates).toEqual([])
  })

  it('keeps a scheduled video private by clearing publishAt', async () => {
    const { id, videoId } = await uploaded()
    await posts.keepPrivate(id)
    expect(google.videoUpdates[0]?.status).not.toHaveProperty('publishAt')
    expect(google.videos.get(videoId)?.status).not.toHaveProperty('publishAt')
    expect(t.repos.posts.require(id)).toMatchObject({
      status: 'published',
      visibilityMode: 'private',
      publishAtUtc: null
    })
  })

  it('deletes from YouTube and cancels the post', async () => {
    const { id, videoId } = await uploaded()
    await posts.deleteFromYouTube(id)
    expect(google.videoDeletes).toEqual([videoId])
    expect(t.repos.posts.require(id).status).toBe('canceled')
  })

  it('still cancels the post if the video was already gone', async () => {
    const { id, videoId } = await uploaded()
    google.videos.delete(videoId)
    await posts.deleteFromYouTube(id)
    expect(t.repos.posts.require(id).status).toBe('canceled')
  })
})

describe('needs decision', () => {
  async function missed(): Promise<string> {
    const { id } = await posts.save({
      input: input({ publishAtUtc: '2026-11-12T13:00:00.000Z' }),
      mode: 'queue'
    })
    t.clock.set('2026-11-12T14:00:00.000Z')
    for (const pid of upload.findWork(t.clock()))
      await upload.run(pid, new AbortController().signal)
    expect(t.repos.posts.require(id).status).toBe('needs_decision')
    return id
  }

  it('publish now: uploads as public right away', async () => {
    const id = await missed()
    posts.decide(id, { action: 'publish_now' })
    expect(t.repos.posts.require(id)).toMatchObject({
      status: 'queued',
      visibilityMode: 'public',
      publishAtUtc: null
    })
    for (const pid of upload.findWork(t.clock()))
      await upload.run(pid, new AbortController().signal)
    expect(google.uploadStarts.at(-1)?.resource['status']).toMatchObject({
      privacyStatus: 'public'
    })
  })

  it('new time: back in the queue with the new schedule', async () => {
    const id = await missed()
    posts.decide(id, { action: 'reschedule', publishAtUtc: '2026-11-14T18:00:00.000Z' })
    expect(t.repos.posts.require(id)).toMatchObject({
      status: 'queued',
      visibilityMode: 'schedule',
      publishAtUtc: '2026-11-14T18:00:00.000Z',
      uploadAfterUtc: '2026-11-13T18:00:00.000Z'
    })
  })

  it('cancel: unscheduled like any pre-upload post', async () => {
    const id = await missed()
    expect(posts.cancel(id).status).toBe('canceled')
  })
})
