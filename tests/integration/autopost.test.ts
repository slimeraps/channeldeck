import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuleInput } from '@shared/schemas/autopost'
import { createUploadJob } from '../../src/main/jobs/upload'
import { createMediaAccess } from '../../src/main/media/access'
import type { ProbeResult } from '../../src/main/media/ffprobe'
import { createSecretBox } from '../../src/main/secrets/secretBox'
import { type AutopostService, createAutopostService } from '../../src/main/services/autopost'
import { createPostsService } from '../../src/main/services/posts'
import { createYouTubeAccountsService } from '../../src/main/services/youtubeAccounts'
import { createTestDb, seedAccount, seedClip, seedTwitchAccount, type TestDb } from '../helpers/db'

const ZONE = 'America/Chicago'
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
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
let channelId: number
let twitchId: number
let autopost: AutopostService
let notify: ReturnType<typeof vi.fn<(title: string, body: string) => void>>

/** Fake ffprobe: portrait files are 9:16, everything else 16:9. */
async function probe(path: string): Promise<ProbeResult> {
  const portrait = path.includes('portrait') || path.includes('_renders')
  return {
    path,
    fileName: path.split('/').pop() ?? '',
    sizeBytes: 1234,
    mtimeMs: 1,
    durationSec: 30,
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
    videoCodec: 'h264',
    aspectRatio: portrait ? '9:16' : '16:9',
    isShort: portrait,
    isLong: false
  }
}

/** A downloaded clip with real (tiny) files. Clip i is i days after Oct 1. */
function bankClip(
  i: number,
  o: { portrait?: boolean; views?: number; game?: string; twitch?: number } = {}
): string {
  const id = `clip${String(i).padStart(2, '0')}`
  const account = o.twitch ?? twitchId
  seedClip(t.repos, account, id, {
    title: `Big play ${i}`,
    createdAtUtc: new Date(Date.UTC(2026, 9, 1 + i, 20)).toISOString(),
    viewCount: o.views ?? 10,
    gameId: o.game ?? 'mw4',
    durationSec: 30
  })
  const landscape = join(dir, `${id}_landscape.mp4`)
  writeFileSync(landscape, 'x')
  let portrait: string | null = null
  if (o.portrait) {
    portrait = join(dir, `${id}_portrait.mp4`)
    writeFileSync(portrait, 'x')
  }
  t.repos.clips.setDownload(id, {
    downloadStatus: 'downloaded',
    landscapePath: landscape,
    portraitPath: portrait,
    fileSize: 1
  })
  return id
}

function rule(o: Partial<RuleInput> = {}): RuleInput {
  return {
    name: 'MW4 Shorts',
    youtubeAccountId: channelId,
    twitchAccountIds: [twitchId],
    slots: ['09:00', '12:00', '15:00', '18:00'],
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    pickOrder: 'oldest',
    filters: {},
    format: 'short',
    layoutPresetId: null,
    titleTpl: '{{clip_title}} #{{n}}',
    descriptionTpl: 'Clipped by {{clipper}}',
    tags: ['mw4'],
    categoryId: '20',
    playlistId: null,
    madeForKids: false,
    mode: 'review',
    lookaheadDays: 3,
    enabled: true,
    nextNumber: 1,
    ...o
  }
}

beforeEach(() => {
  t = createTestDb() // clock: Thu 2026-11-12 12:00 UTC = 06:00 in Chicago
  dir = mkdtempSync(join(tmpdir(), 'cd-autopost-'))
  t.repos.settings.update({ clipsRoot: dir })
  channelId = seedAccount(t.repos, {
    channelTitle: 'Helmsy Shorts',
    defaultsJson: { descriptionFooter: 'Follow for more' }
  }).id
  twitchId = seedTwitchAccount(t.repos).id
  notify = vi.fn()
  autopost = createAutopostService({
    repos: t.repos,
    probe,
    media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
    notify,
    emitPostsChanged: vi.fn(),
    logger,
    clock: t.clock,
    zone: ZONE
  })
})

afterEach(() => {
  t.close()
  rmSync(dir, { recursive: true, force: true })
})

const rulePosts = (ruleId: number) =>
  t.repos.posts
    .list({ ruleId })
    .filter((p) => p.status !== 'canceled')
    .sort((a, b) => (a.publishAtUtc ?? '').localeCompare(b.publishAtUtc ?? ''))

describe('planner', () => {
  it('fills 3 days × 4 slots with the oldest clips, as posts awaiting approval', async () => {
    for (let i = 0; i < 20; i++) bankClip(i, { portrait: true })
    const { id } = autopost.save(rule())

    expect(autopost.rulesWithWork(t.clock())).toEqual([id])
    expect(await autopost.planRule(id)).toEqual({ created: 12, unfilled: 0 })

    const posts = rulePosts(id)
    expect(posts.map((p) => p.publishAtUtc)).toEqual([
      '2026-11-12T15:00:00.000Z', // Thu 09:00 CST
      '2026-11-12T18:00:00.000Z',
      '2026-11-12T21:00:00.000Z',
      '2026-11-13T00:00:00.000Z', // Thu 18:00 CST
      '2026-11-13T15:00:00.000Z',
      '2026-11-13T18:00:00.000Z',
      '2026-11-13T21:00:00.000Z',
      '2026-11-14T00:00:00.000Z',
      '2026-11-14T15:00:00.000Z',
      '2026-11-14T18:00:00.000Z',
      '2026-11-14T21:00:00.000Z',
      '2026-11-15T00:00:00.000Z'
    ])
    expect(posts.map((p) => p.clipId)).toEqual(
      Array.from({ length: 12 }, (_, i) => `clip${String(i).padStart(2, '0')}`)
    )
    const first = posts[0]!
    expect(first).toMatchObject({
      status: 'needs_approval',
      source: 'twitch_clip',
      ruleId: id,
      accountId: channelId,
      visibilityMode: 'schedule',
      title: 'Big play 0 #1',
      description: 'Clipped by clipper\n\nFollow for more',
      tagsJson: ['mw4'],
      categoryId: '20',
      madeForKids: false,
      isShort: true,
      renderJson: null,
      filePath: join(dir, 'clip00_portrait.mp4'),
      // Upload starts 24 h before publishing, but never before now.
      uploadAfterUtc: '2026-11-12T12:00:00.000Z'
    })
    expect(posts[11]?.title).toBe('Big play 11 #12')
    expect(posts[11]?.uploadAfterUtc).toBe('2026-11-14T00:00:00.000Z')
    expect(t.repos.autopostRules.require(id).nextNumber).toBe(13)
    expect(notify).toHaveBeenCalledWith(
      '12 autoposts to review',
      '"MW4 Shorts": approve them in the queue.'
    )

    // Nothing left to do until time moves on.
    expect(autopost.rulesWithWork(t.clock())).toEqual([])
    expect(await autopost.planRule(id)).toEqual({ created: 0, unfilled: 0 })

    // You approve them; a day later the next day's four slots open up. (Unapproved ones
    // would have expired and gone back to the bank.)
    expect(autopost.approveAll(id)).toEqual({ approved: 12 })
    t.clock.advance(86_400_000)
    expect(await autopost.planRule(id)).toMatchObject({ created: 4 })
    expect(
      rulePosts(id)
        .map((p) => p.clipId)
        .slice(-4)
    ).toEqual(['clip12', 'clip13', 'clip14', 'clip15'])
  })

  it('never uses a clip twice on the same channel, across rules and manual posts', async () => {
    for (let i = 0; i < 6; i++) bankClip(i, { portrait: true })
    // clip00 is already a manual draft on this channel.
    t.repos.posts.create({
      accountId: channelId,
      status: 'draft',
      source: 'twitch_clip',
      clipId: 'clip00'
    })
    const a = autopost.save(rule({ name: 'A', slots: ['09:00'], lookaheadDays: 2 }))
    const b = autopost.save(rule({ name: 'B', slots: ['18:00'], lookaheadDays: 2 }))
    await autopost.planRule(a.id)
    await autopost.planRule(b.id)

    const used = [...rulePosts(a.id), ...rulePosts(b.id)].map((p) => p.clipId)
    expect(used.sort()).toEqual(['clip01', 'clip02', 'clip03', 'clip04'])

    // Another channel may use the same clips.
    const other = seedAccount(t.repos).id
    const c = autopost.save(rule({ name: 'C', youtubeAccountId: other, slots: ['09:00'] }))
    await autopost.planRule(c.id)
    expect(rulePosts(c.id)[0]?.clipId).toBe('clip00')
  })

  it('applies filters and pick order', async () => {
    bankClip(0, { views: 900, game: 'ac' })
    bankClip(1, { views: 50 })
    bankClip(2, { views: 700 })
    bankClip(3, { views: 300 })
    bankClip(4, { views: 700 })
    t.repos.clips.setHidden(['clip04'], true)
    const { id } = autopost.save(
      rule({
        slots: ['12:00'],
        lookaheadDays: 3,
        pickOrder: 'most_viewed',
        filters: { gameIds: ['mw4'], minViews: 100 },
        format: 'regular'
      })
    )
    expect(await autopost.planRule(id)).toEqual({ created: 2, unfilled: 1 })
    expect(rulePosts(id).map((p) => p.clipId)).toEqual(['clip02', 'clip03'])
    // Regular format uses the landscape file as-is.
    expect(rulePosts(id)[0]).toMatchObject({ isShort: false, renderJson: null, width: 1920 })
  })

  it('queues directly in Auto mode', async () => {
    bankClip(0, { portrait: true })
    const { id } = autopost.save(rule({ mode: 'auto', slots: ['18:00'], lookaheadDays: 1 }))
    await autopost.planRule(id)
    expect(rulePosts(id)[0]?.status).toBe('queued')
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('to review'), expect.anything())
  })

  it('plans a vertical render with the rule layout when a clip has no portrait file', async () => {
    bankClip(0)
    const preset = t.repos.layoutPresets.create({
      twitchAccountId: twitchId,
      name: 'Cam top right',
      kind: 'facecam_split',
      cropsJson: {
        facecam: { x: 1440, y: 0, width: 480, height: 270 },
        gameplay: { x: 420, y: 0, width: 1080, height: 1080 }
      }
    })
    const { id } = autopost.save(
      rule({ slots: ['18:00'], lookaheadDays: 1, layoutPresetId: preset.id })
    )
    await autopost.planRule(id)
    expect(rulePosts(id)[0]).toMatchObject({
      filePath: join(dir, '_renders', `clip00_${preset.id}.mp4`),
      fileSize: null,
      width: 1080,
      height: 1920,
      isShort: true,
      renderJson: {
        sourcePath: join(dir, 'clip00_landscape.mp4'),
        kind: 'facecam_split',
        presetId: preset.id
      }
    })
  })

  it('refills an unscheduled slot with a different clip and never picks the skipped one again', async () => {
    for (let i = 0; i < 3; i++) bankClip(i, { portrait: true })
    const posts = createPostsService({
      repos: t.repos,
      probe,
      media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
      emitChanged: vi.fn(),
      clock: t.clock
    })
    const { id } = autopost.save(rule({ slots: ['18:00'], lookaheadDays: 1 }))
    await autopost.planRule(id)
    const first = rulePosts(id)[0]!
    expect(first.clipId).toBe('clip00')

    posts.cancel(first.id)
    expect(t.repos.autopostRules.require(id).skippedClipIdsJson).toEqual(['clip00'])
    await autopost.planRule(id)
    expect(rulePosts(id).map((p) => p.clipId)).toEqual(['clip01'])
  })

  it('leaves slots empty when the bank runs out, notifying once a day', async () => {
    bankClip(0, { portrait: true })
    const { id } = autopost.save(rule({ slots: ['09:00', '18:00'], lookaheadDays: 2 }))
    expect(await autopost.planRule(id)).toEqual({ created: 1, unfilled: 3 })
    expect(notify).toHaveBeenCalledWith('Out of clips', expect.stringContaining('3 upcoming slots'))
    expect(t.repos.eventLog.recent({ kind: 'autopost.bank_empty' })).toHaveLength(1)

    // Backs off instead of retrying every tick, and doesn't notify again the same day.
    expect(autopost.rulesWithWork(t.clock())).toEqual([])
    t.clock.advance(11 * 60_000)
    expect(autopost.rulesWithWork(t.clock())).toEqual([id])
    await autopost.planRule(id)
    expect(notify.mock.calls.filter(([title]) => title === 'Out of clips')).toHaveLength(1)

    // New clips arrive: the next run fills the gaps.
    bankClip(1, { portrait: true })
    bankClip(2, { portrait: true })
    t.clock.advance(11 * 60_000)
    expect(await autopost.planRule(id)).toMatchObject({ created: 2 })
  })

  it('drops autoposts not approved before their publish time, without blacklisting the clip', async () => {
    bankClip(0, { portrait: true })
    const { id } = autopost.save(rule({ slots: ['09:00'], lookaheadDays: 1 }))
    await autopost.planRule(id)
    const post = rulePosts(id)[0]!
    t.clock.set('2026-11-12T14:55:00.000Z') // 5 minutes before 09:00 CST
    expect(autopost.rulesWithWork(t.clock())).toEqual([id])
    await autopost.planRule(id)
    expect(t.repos.posts.require(post.id)).toMatchObject({
      status: 'canceled',
      lastError: 'Not approved before its publish time'
    })
    expect(t.repos.autopostRules.require(id).skippedClipIdsJson).toEqual([])
  })

  it('approves one or all of a rule’s autoposts', async () => {
    for (let i = 0; i < 4; i++) bankClip(i, { portrait: true })
    const posts = createPostsService({
      repos: t.repos,
      probe,
      media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
      emitChanged: vi.fn(),
      clock: t.clock
    })
    const { id } = autopost.save(rule({ slots: ['18:00'], lookaheadDays: 3 }))
    await autopost.planRule(id)
    const [one] = rulePosts(id)
    expect(posts.approve(one!.id).status).toBe('queued')
    expect(() => posts.approve(one!.id)).toThrow(/not waiting for approval/)
    expect(autopost.approveAll(id)).toEqual({ approved: 2 })
    expect(rulePosts(id).every((p) => p.status === 'queued')).toBe(true)
    expect(autopost.list()[0]).toMatchObject({ pendingApproval: 0, upcoming: 3 })
  })

  it('skips rules whose channel is off or needs re-auth', async () => {
    bankClip(0, { portrait: true })
    const { id } = autopost.save(rule())
    t.repos.accounts.update(channelId, { tokenStatus: 'needs_reauth' })
    expect(autopost.rulesWithWork(t.clock())).toEqual([])
    expect(await autopost.planRule(id)).toEqual({ created: 0, unfilled: 0 })
    expect(autopost.list()[0]?.blockedReason).toMatch(/sign in again/)
  })

  it('deletes a rule and optionally cancels its upcoming autoposts', async () => {
    for (let i = 0; i < 3; i++) bankClip(i, { portrait: true })
    const { id } = autopost.save(rule({ slots: ['18:00'], lookaheadDays: 3 }))
    await autopost.planRule(id)
    const ids = rulePosts(id).map((p) => p.id)
    expect(autopost.remove(id, true)).toEqual({ canceled: 3 })
    expect(ids.map((p) => t.repos.posts.require(p).status)).toEqual([
      'canceled',
      'canceled',
      'canceled'
    ])
    expect(t.repos.autopostRules.get(id)).toBeUndefined()
  })
})

describe('swap clip', () => {
  it('swaps an autopost’s clip in the same slot and skips the old clip', async () => {
    for (let i = 0; i < 4; i++) bankClip(i, { portrait: true })
    const { id } = autopost.save(rule({ slots: ['18:00'], lookaheadDays: 1 }))
    await autopost.planRule(id)
    const original = rulePosts(id)[0]!
    expect(original.clipId).toBe('clip00')

    const options = autopost.swapCandidates(original.id)
    expect(options.map((c) => c.id)).toEqual(['clip01', 'clip02', 'clip03'])

    const swapped = await autopost.swapClip(original.id, 'clip02')
    expect(t.repos.posts.require(original.id).status).toBe('canceled')
    const fresh = t.repos.posts.require(swapped.postId)
    expect(fresh).toMatchObject({
      clipId: 'clip02',
      ruleId: id,
      publishAtUtc: original.publishAtUtc,
      status: 'needs_approval'
    })
    expect(t.repos.autopostRules.require(id).skippedClipIdsJson).toEqual(['clip00'])
    // The planner sees the slot as filled.
    expect(await autopost.planRule(id)).toEqual({ created: 0, unfilled: 0 })
    // Without a choice, the next clip in pick order is used.
    expect((await autopost.swapClip(fresh.id)).title).toBe('Big play 1 #3')
  })

  it('refuses after upload, for manual posts, and when nothing else fits', async () => {
    bankClip(0, { portrait: true })
    const { id } = autopost.save(rule({ slots: ['18:00'], lookaheadDays: 1 }))
    await autopost.planRule(id)
    const post = rulePosts(id)[0]!
    await expect(autopost.swapClip(post.id)).rejects.toThrow(/no other clips/)
    t.repos.posts.update(post.id, { youtubeVideoId: 'vid1' })
    expect(() => autopost.swapCandidates(post.id)).toThrow(/only change before upload/)
    const manual = t.repos.posts.create({ accountId: channelId, status: 'draft', source: 'manual' })
    expect(() => autopost.swapCandidates(manual.id)).toThrow(/Only autoposts/)
  })
})

describe('preview and forecast', () => {
  it('previews the next slots with rendered titles', async () => {
    bankClip(0)
    bankClip(1, { portrait: true })
    const p = autopost.preview({ ...rule({ slots: ['18:00'], lookaheadDays: 3 }) })
    expect(p.eligibleClips).toBe(2)
    expect(p.slots.map((s) => s.clip?.renderedTitle ?? null)).toEqual([
      'Big play 0 #1',
      'Big play 1 #2',
      null
    ])
    expect(p.slots[0]?.clip?.needsRender).toBe(true)
    expect(p.slots[1]?.clip?.needsRender).toBe(false)
  })

  it('counts enabled rules in the quota forecast', () => {
    autopost.save(rule({ slots: ['09:00', '18:00'], playlistId: 'PL1' }))
    const days = autopost.forecast()
    expect(days).toHaveLength(7)
    expect(days[1]).toMatchObject({ uploads: 2, units: 2 * 50 + 200, overUploads: false })
  })
})

describe('render then upload', () => {
  it('renders before uploading and records the rendered file', async () => {
    bankClip(0)
    t.repos.accounts.update(channelId, { encRefreshToken: await secrets.encrypt('rt') })
    t.repos.settings.update({ dryRun: true })
    const { id } = autopost.save(rule({ mode: 'auto', slots: ['18:00'], lookaheadDays: 1 }))
    await autopost.planRule(id)
    const post = rulePosts(id)[0]!

    const youtube = createYouTubeAccountsService({
      repos: t.repos,
      secrets,
      clientConfig: {
        load: () => ({
          clientId: 'x.apps.googleusercontent.com',
          clientSecret: 's',
          projectId: 'p'
        }),
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
      dryRunUploadMs: 5
    })
    const renderVideo = vi.fn(async (p: { filePath: string | null }) => {
      mkdirSync(join(dir, '_renders'), { recursive: true })
      writeFileSync(p.filePath as string, Buffer.alloc(2048))
      return {
        sizeBytes: 2048,
        mtimeMs: 2,
        durationSec: 29.9,
        width: 1080,
        height: 1920,
        isShort: true
      }
    })
    const statuses: string[] = []
    const upload = createUploadJob({
      repos: t.repos,
      withApi: (accountId, fn) => youtube.withApi(accountId, fn),
      notify: vi.fn(),
      emitChanged: () => statuses.push(t.repos.posts.require(post.id).status),
      emitProgress: vi.fn(),
      logger,
      clock: t.clock,
      renderVideo
    })
    expect(upload.findWork(t.clock())).toEqual([post.id])
    await upload.run(post.id, new AbortController().signal)

    expect(renderVideo).toHaveBeenCalledTimes(1)
    expect(statuses).toContain('rendering')
    expect(t.repos.posts.require(post.id)).toMatchObject({
      status: 'processing',
      fileSize: 2048,
      durationSec: 29.9
    })
    expect(t.repos.postSteps.list(post.id).map((s) => [s.step, s.status])).toEqual([
      ['render', 'done'],
      ['insert', 'done']
    ])
  })

  it('fails with a clear message when the render fails', async () => {
    bankClip(0)
    const { id } = autopost.save(rule({ mode: 'auto', slots: ['18:00'], lookaheadDays: 1 }))
    await autopost.planRule(id)
    const post = rulePosts(id)[0]!
    const upload = createUploadJob({
      repos: t.repos,
      withApi: () => Promise.reject(new Error('should not upload')),
      notify: vi.fn(),
      emitChanged: vi.fn(),
      emitProgress: vi.fn(),
      logger,
      clock: t.clock,
      renderVideo: () => Promise.reject(new Error('ffmpeg exited with code 1: bad crop'))
    })
    await upload.run(post.id, new AbortController().signal)
    expect(t.repos.posts.require(post.id)).toMatchObject({
      status: 'failed',
      lastError: 'Vertical render failed: ffmpeg exited with code 1: bad crop'
    })
  })
})
