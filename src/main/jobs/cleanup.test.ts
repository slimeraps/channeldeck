import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  createTestDb,
  seedAccount,
  seedClip,
  seedTwitchAccount,
  type TestDb
} from '../../../tests/helpers/db'
import type { CreatePostInput } from '../db/repos/posts'
import { createCleanupJob } from './cleanup'

let t: TestDb
/** The clip folder (Settings → clipsRoot) for the test. */
let dir: string
/** A folder next to it that is NOT the clip folder (e.g. the user's own videos). */
let elsewhere: string
let warn: Mock<(...a: unknown[]) => void>
beforeEach(() => {
  t = createTestDb() // 2026-11-12T12:00Z
  const base = mkdtempSync(join(tmpdir(), 'cd-cleanup-'))
  dir = join(base, 'Clips')
  elsewhere = join(base, 'MyVideos')
  mkdirSync(join(dir, 'streamer1', '2026'), { recursive: true })
  mkdirSync(join(dir, '_renders'), { recursive: true })
  mkdirSync(elsewhere)
  t.repos.settings.update({ clipsRoot: dir })
  warn = vi.fn<(...a: unknown[]) => void>()
})
afterEach(() => {
  t.close()
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

function file(path: string): string {
  writeFileSync(path, Buffer.alloc(1000))
  return path
}
const clipFile = (name: string): string => file(join(dir, 'streamer1', '2026', name))

function makeJob(): ReturnType<typeof createCleanupJob> {
  return createCleanupJob({
    repos: t.repos,
    emitChanged: vi.fn(),
    logger: { info: vi.fn(), warn, error: vi.fn() },
    clock: t.clock
  })
}

/** Published posts can only come from transitions; build them the way uploads do. */
function publish(post: Omit<CreatePostInput, 'status'>, videoId: string): void {
  const p = t.repos.posts.create({ ...post, status: 'queued' })
  for (const e of ['start_upload', 'upload_complete', 'mark_scheduled', 'mark_published'] as const)
    t.repos.posts.transition(
      p.id,
      e,
      e === 'upload_complete' ? { patch: { youtubeVideoId: videoId } } : {}
    )
}

function downloadedClip(id: string, path: string, extra: { thumb?: string } = {}): void {
  seedClip(t.repos, twitchId, id)
  t.repos.clips.setDownload(id, {
    downloadStatus: 'downloaded',
    landscapePath: path,
    ...(extra.thumb ? { thumbPath: extra.thumb } : {}),
    fileSize: 1000
  })
}

let channel: number
let twitchId: number
beforeEach(() => {
  channel = seedAccount(t.repos).id
  twitchId = seedTwitchAccount(t.repos).id
})

const OLD = '2026-11-01T12:00:00.000Z'
const FRESH = '2026-11-10T12:00:00.000Z'

describe('cleanup job', () => {
  it('does nothing while the setting is off', async () => {
    const job = makeJob()
    expect(job.findWork(t.clock())).toEqual([])
    expect(await job.runNow()).toEqual({ clips: 0, renders: 0, bytes: 0 })
  })

  it('deletes the files of clips posted long enough ago, keeping the thumbnail', async () => {
    t.repos.settings.update({ deleteLocalAfterPostingDays: 7 })
    const thumb = clipFile('old.jpg')
    const oldFile = clipFile('old_landscape.mp4')
    const freshFile = clipFile('fresh_landscape.mp4')
    const neverPosted = clipFile('unposted_landscape.mp4')
    downloadedClip('old', oldFile, { thumb })
    downloadedClip('fresh', freshFile)
    downloadedClip('unposted', neverPosted)
    publish({ accountId: channel, source: 'twitch_clip', clipId: 'old', publishAtUtc: OLD }, 'v-1')
    publish(
      { accountId: channel, source: 'twitch_clip', clipId: 'fresh', publishAtUtc: FRESH },
      'v-2'
    )
    const render = file(join(dir, '_renders', 'old_blur_fill_1234abcd.mp4'))
    publish(
      {
        accountId: channel,
        source: 'manual',
        filePath: render,
        renderJson: { sourcePath: oldFile, kind: 'blur_fill', crops: {}, presetId: null },
        publishAtUtc: OLD
      },
      'v-r'
    )

    const job = makeJob()
    expect(job.findWork(t.clock())).toEqual(['cleanup'])
    expect(await job.runNow()).toEqual({ clips: 1, renders: 1, bytes: 2000 })
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(render)).toBe(false)
    expect(existsSync(thumb)).toBe(true)
    expect(existsSync(freshFile)).toBe(true)
    expect(existsSync(neverPosted)).toBe(true)
    expect(t.repos.clips.get('old')).toMatchObject({
      downloadStatus: 'deleted',
      landscapePath: null
    })
    expect(t.repos.clips.get('fresh')?.downloadStatus).toBe('downloaded')
    expect(t.repos.clips.get('unposted')?.downloadStatus).toBe('downloaded')
    // Hourly: not again right away.
    expect(job.findWork(t.clock())).toEqual([])
  })

  it('does not stop at a file that is already gone', async () => {
    t.repos.settings.update({ deleteLocalAfterPostingDays: 7 })
    const gone = join(dir, 'streamer1', '2026', 'gone_landscape.mp4') // user deleted it by hand
    const there = clipFile('there_landscape.mp4')
    downloadedClip('gone', gone)
    downloadedClip('there', there)
    publish({ accountId: channel, source: 'twitch_clip', clipId: 'gone', publishAtUtc: OLD }, 'v-1')
    publish(
      { accountId: channel, source: 'twitch_clip', clipId: 'there', publishAtUtc: OLD },
      'v-2'
    )

    expect(await makeJob().runNow()).toMatchObject({ clips: 2, bytes: 1000 })
    expect(existsSync(there)).toBe(false)
    expect(t.repos.clips.get('gone')?.downloadStatus).toBe('deleted')
    expect(t.repos.clips.get('there')?.downloadStatus).toBe('deleted')
  })

  it('never deletes a file outside the clip folder, even if the database points at it', async () => {
    t.repos.settings.update({ deleteLocalAfterPostingDays: 7 })
    const mine = file(join(elsewhere, 'my_own_video.mp4'))
    downloadedClip('stray', mine)
    publish(
      { accountId: channel, source: 'twitch_clip', clipId: 'stray', publishAtUtc: OLD },
      'v-1'
    )
    // A render that claims to live in the clip folder root rather than _renders, and one elsewhere.
    const notInRenders = clipFile('not_a_render.mp4')
    const farRender = file(join(elsewhere, 'far_render.mp4'))
    for (const [path, id] of [
      [notInRenders, 'v-2'],
      [farRender, 'v-3']
    ] as const)
      publish(
        {
          accountId: channel,
          source: 'manual',
          filePath: path,
          renderJson: { sourcePath: path, kind: 'blur_fill', crops: {}, presetId: null },
          publishAtUtc: OLD
        },
        id
      )

    const result = await makeJob().runNow()
    expect(result).toEqual({ clips: 0, renders: 0, bytes: 0 })
    expect(existsSync(mine)).toBe(true)
    expect(existsSync(notInRenders)).toBe(true)
    expect(existsSync(farRender)).toBe(true)
    // The clip is left as it was, and the refusal is logged.
    expect(t.repos.clips.get('stray')).toMatchObject({
      downloadStatus: 'downloaded',
      landscapePath: mine
    })
    expect(warn).toHaveBeenCalled()
  })

  it('cannot be redirected out of the clip folder through a linked subfolder', async (ctx) => {
    t.repos.settings.update({ deleteLocalAfterPostingDays: 7 })
    const target = file(join(elsewhere, 'precious.mp4'))
    const link = join(dir, 'streamer1', 'shortcut')
    try {
      symlinkSync(elsewhere, link, 'junction') // 'junction' needs no admin rights on Windows
    } catch {
      ctx.skip() // this machine can't create links
    }
    expect(realpathSync(link)).toBe(realpathSync(elsewhere))
    // Looks like it is inside the clip folder, really it is the file in `elsewhere`.
    downloadedClip('sneaky', join(link, 'precious.mp4'))
    publish(
      { accountId: channel, source: 'twitch_clip', clipId: 'sneaky', publishAtUtc: OLD },
      'v-1'
    )

    expect(await makeJob().runNow()).toEqual({ clips: 0, renders: 0, bytes: 0 })
    expect(existsSync(target)).toBe(true)
    expect(t.repos.clips.get('sneaky')?.downloadStatus).toBe('downloaded')
  })

  it('keeps a posted clip that a draft still uses, directly or as the source of its render', async () => {
    t.repos.settings.update({ deleteLocalAfterPostingDays: 7 })
    const direct = clipFile('direct_landscape.mp4')
    const source = clipFile('source_landscape.mp4')
    downloadedClip('direct', direct)
    downloadedClip('source', source)
    publish(
      { accountId: channel, source: 'twitch_clip', clipId: 'direct', publishAtUtc: OLD },
      'v-1'
    )
    publish(
      { accountId: channel, source: 'twitch_clip', clipId: 'source', publishAtUtc: OLD },
      'v-2'
    )
    // A manual draft that picked the same video file (no clip id), and a draft vertical render of the other.
    t.repos.posts.create({
      accountId: channel,
      status: 'draft',
      source: 'manual',
      filePath: direct
    })
    t.repos.posts.create({
      accountId: channel,
      status: 'draft',
      source: 'manual',
      filePath: join(dir, '_renders', 'source_blur_fill_9999aaaa.mp4'),
      renderJson: { sourcePath: source, kind: 'blur_fill', crops: {}, presetId: null }
    })

    expect(await makeJob().runNow()).toEqual({ clips: 0, renders: 0, bytes: 0 })
    expect(existsSync(direct)).toBe(true)
    expect(existsSync(source)).toBe(true)
  })
})
