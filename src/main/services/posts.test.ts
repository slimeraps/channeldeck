import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostInput } from '@shared/schemas/post'
import { createTestDb, seedAccount, type TestDb } from '../../../tests/helpers/db'
import { UserFacingError } from '../errors'
import { createMediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { createPostsService, type PostsService } from './posts'

let t: TestDb
let dir: string
let service: PostsService
let emitChanged: ReturnType<typeof vi.fn<() => void>>
let accountId: number
let video: string

function fakeProbe(shape: Partial<ProbeResult> = {}) {
  return async (path: string): Promise<ProbeResult> => {
    if (path.includes('missing')) throw new UserFacingError(`File missing: ${path}`)
    return {
      path,
      fileName: path.split('/').pop() ?? path,
      sizeBytes: 5_000_000,
      mtimeMs: 1_700_000_000_000,
      durationSec: 42,
      width: 1080,
      height: 1920,
      videoCodec: 'h264',
      aspectRatio: '9:16',
      isShort: true,
      isLong: false,
      ...shape
    }
  }
}

function input(overrides: Partial<PostInput> = {}): PostInput {
  return {
    accountId,
    filePath: video,
    title: 'MW4 Day 9',
    description: 'Day 9',
    tags: ['mw4', ' MW4 ', 'mechwarrior'],
    categoryId: '20',
    playlistId: null,
    thumbnailPath: null,
    madeForKids: false,
    notifySubscribers: true,
    license: 'youtube',
    embeddable: true,
    defaultLanguage: ' en ',
    defaultAudioLanguage: null,
    syntheticMedia: false,
    visibilityMode: 'schedule',
    publishAtUtc: '2026-11-14T17:00:00.000Z',
    missedPolicy: 'ask',
    ...overrides
  }
}

beforeEach(() => {
  t = createTestDb()
  dir = mkdtempSync(join(tmpdir(), 'cd-posts-'))
  video = join(dir, 'day9.mp4')
  writeFileSync(video, 'fake video bytes')
  accountId = seedAccount(t.repos).id
  emitChanged = vi.fn()
  service = createPostsService({
    repos: t.repos,
    probe: fakeProbe(),
    media: createMediaAccess({
      roots: () => [],
      isReferenced: (p) => t.repos.posts.referencesFile(p)
    }),
    emitChanged,
    clock: t.clock
  })
})

afterEach(() => {
  t.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('saving posts', () => {
  it('queues a complete post with probed video facts and an upload time 24h before publish', async () => {
    const item = await service.save({ input: input(), mode: 'queue' })
    expect(item).toMatchObject({
      status: 'queued',
      title: 'MW4 Day 9',
      isShort: true,
      durationSec: 42
    })
    expect(item.videoPreviewUrl).toMatch(/^cdmedia:\/\/file\//)

    const row = t.repos.posts.require(item.id)
    expect(row.tagsJson).toEqual(['mw4', 'mechwarrior']) // normalized
    expect(row.defaultLanguage).toBe('en')
    expect(row.fileSize).toBe(5_000_000)
    expect(row.width).toBe(1080)
    expect(row.uploadAfterUtc).toBe('2026-11-13T17:00:00.000Z')
    expect(emitChanged).toHaveBeenCalled()
  })

  it('never sets an upload time in the past', async () => {
    // Publish in 2h with a 24h lead → upload right away.
    const item = await service.save({
      input: input({ publishAtUtc: '2026-11-12T14:00:00.000Z' }),
      mode: 'queue'
    })
    expect(t.repos.posts.require(item.id).uploadAfterUtc).toBe('2026-11-12T12:00:00.000Z')
  })

  it('uploads "now" posts right away and drops any stray publish time', async () => {
    const item = await service.save({
      input: input({ visibilityMode: 'unlisted', publishAtUtc: '2026-11-20T00:00:00.000Z' }),
      mode: 'queue'
    })
    const row = t.repos.posts.require(item.id)
    expect(row.publishAtUtc).toBeNull()
    expect(row.uploadAfterUtc).toBe('2026-11-12T12:00:00.000Z')
  })

  it('refuses to queue an incomplete post but saves it as a draft', async () => {
    const incomplete = input({ title: '', categoryId: null, madeForKids: null, filePath: null })
    await expect(service.save({ input: incomplete, mode: 'queue' })).rejects.toThrow(/Add a title/)
    const draft = await service.save({ input: incomplete, mode: 'draft' })
    expect(draft.status).toBe('draft')
    expect(t.repos.posts.require(draft.id).madeForKids).toBeNull()
  })

  it('rejects a past publish time when queueing', async () => {
    await expect(
      service.save({ input: input({ publishAtUtc: '2026-11-12T11:00:00.000Z' }), mode: 'queue' })
    ).rejects.toThrow(/in the past/)
  })

  it('keeps a draft whose file went missing, but will not queue it', async () => {
    const missing = join(dir, 'missing.mp4')
    await expect(
      service.save({ input: input({ filePath: missing }), mode: 'queue' })
    ).rejects.toThrow(/File missing/)
    const draft = await service.save({ input: input({ filePath: missing }), mode: 'draft' })
    expect(draft.fileMissing).toBe(true)
  })

  it('moves an edited post between draft and queued', async () => {
    const draft = await service.save({ input: input(), mode: 'draft' })
    const queued = await service.save({
      id: draft.id,
      input: input({ title: 'Day 9!' }),
      mode: 'queue'
    })
    expect(queued).toMatchObject({ status: 'queued', title: 'Day 9!' })
    const back = await service.save({ id: draft.id, input: input(), mode: 'draft' })
    expect(back.status).toBe('draft')
    const log = t.repos.eventLog
      .recent({ postId: draft.id, kind: 'post.status' })
      .map((e) => e.message)
    expect(log).toEqual(['queued → draft (to_draft): saved as draft', 'draft → queued (enqueue)'])
  })

  it('refuses a removed channel', async () => {
    t.repos.accounts.archive(accountId)
    await expect(service.save({ input: input(), mode: 'draft' })).rejects.toThrow(
      /no longer connected/
    )
  })

  it('checks thumbnails: JPG/PNG up to 2 MB', async () => {
    const big = join(dir, 'big.png')
    writeFileSync(big, Buffer.alloc(2 * 1024 * 1024 + 1))
    await expect(
      service.save({ input: input({ thumbnailPath: big }), mode: 'queue' })
    ).rejects.toThrow(/2 MB or smaller/)
    const ok = join(dir, 'thumb.jpg')
    writeFileSync(ok, Buffer.alloc(1000))
    const item = await service.save({ input: input({ thumbnailPath: ok }), mode: 'queue' })
    expect(item.thumbnailPreviewUrl).toMatch(/^cdmedia:/)
    await expect(service.inspectThumbnail(join(dir, 'x.gif'))).rejects.toThrow(/JPG or PNG/)
  })
})

describe('reading posts back', () => {
  it('returns the editor input and media for a saved post (persists across restarts)', async () => {
    const saved = await service.save({ input: input(), mode: 'queue' })
    // A brand-new service over the same database = the app after a restart.
    const fresh = createPostsService({
      repos: t.repos,
      probe: fakeProbe(),
      media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
      emitChanged: vi.fn(),
      clock: t.clock
    })
    const detail = await fresh.get(saved.id)
    expect(detail.editable).toBe(true)
    expect(detail.input).toMatchObject({
      title: 'MW4 Day 9',
      tags: ['mw4', 'mechwarrior'],
      madeForKids: false
    })
    expect(detail.media?.isShort).toBe(true)
    expect(fresh.list().map((p) => p.id)).toEqual([saved.id])
  })

  it('filters the list by status', async () => {
    await service.save({ input: input(), mode: 'queue' })
    await service.save({ input: input({ title: 'draft one' }), mode: 'draft' })
    expect(service.list({ statuses: ['draft'] }).map((p) => p.title)).toEqual(['draft one'])
  })
})

describe('row actions', () => {
  it('duplicates as a manual draft', async () => {
    const original = await service.save({ input: input(), mode: 'queue' })
    const copy = service.duplicate(original.id)
    expect(copy).toMatchObject({ status: 'draft', source: 'manual', title: 'MW4 Day 9' })
    expect(copy.id).not.toBe(original.id)
  })

  it('unschedules a queued post, but not a draft', async () => {
    const queued = await service.save({ input: input(), mode: 'queue' })
    expect(service.cancel(queued.id).status).toBe('canceled')
    const draft = await service.save({ input: input(), mode: 'draft' })
    expect(() => service.cancel(draft.id)).toThrow(/Delete the draft/)
    service.deleteDraft(draft.id)
    expect(t.repos.posts.get(draft.id)).toBeUndefined()
  })

  it('will not edit a post that is already on YouTube', async () => {
    const queued = await service.save({ input: input(), mode: 'queue' })
    t.repos.posts.transition(queued.id, 'start_upload')
    t.repos.posts.transition(queued.id, 'upload_complete', { patch: { youtubeVideoId: 'yt1' } })
    expect((await service.get(queued.id)).editable).toBe(false)
    await expect(service.save({ id: queued.id, input: input(), mode: 'queue' })).rejects.toThrow(
      /can't be edited/
    )
  })
})

describe('media access', () => {
  it('lets the renderer preview files referenced by posts', async () => {
    const access = createMediaAccess({
      roots: () => [],
      isReferenced: (p) => t.repos.posts.referencesFile(p)
    })
    expect(access.policy().isAllowedFile(video)).toBe(false)
    await service.save({ input: input(), mode: 'draft' })
    expect(access.policy().isAllowedFile(video)).toBe(true)
  })
})
