import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestDb,
  seedAccount,
  seedClip,
  seedTwitchAccount,
  type TestDb
} from '../../../../tests/helpers/db'
import { InvalidPostTransitionError } from '../../domain/postState'
import { DuplicateError } from './common'
import type { PostPatch } from './posts'

let t: TestDb
beforeEach(() => {
  t = createTestDb()
})
afterEach(() => t.close())

function newPost(
  accountId: number,
  extra: Partial<Parameters<TestDb['repos']['posts']['create']>[0]> = {}
) {
  return t.repos.posts.create({
    accountId,
    status: 'queued',
    title: 'MW4 Day 9',
    visibilityMode: 'schedule',
    publishAtUtc: '2026-11-13T17:00:00.000Z',
    ...extra
  })
}

describe('postsRepo.transition', () => {
  it('moves a post through the scheduled path and logs each change', () => {
    const account = seedAccount(t.repos)
    const post = newPost(account.id)
    const { posts } = t.repos

    posts.transition(post.id, 'start_upload')
    t.clock.advance(60_000)
    const processing = posts.transition(post.id, 'upload_complete', {
      patch: { youtubeVideoId: 'vid123', uploadProgress: 1 }
    })
    expect(processing.status).toBe('processing')
    expect(processing.youtubeVideoId).toBe('vid123')
    expect(processing.updatedAt).toBe('2026-11-12T12:01:00.000Z')

    posts.transition(post.id, 'mark_scheduled')
    expect(posts.require(post.id).status).toBe('scheduled')

    const log = t.repos.eventLog.recent({ postId: post.id, kind: 'post.status' })
    expect(log.map((e) => e.message).reverse()).toEqual([
      'queued → uploading (start_upload)',
      'uploading → processing (upload_complete)',
      'processing → scheduled (mark_scheduled)'
    ])
    expect(t.repos.eventLog.recent({ postId: post.id, kind: 'post.created' })).toHaveLength(1)
  })

  it('rejects an invalid transition and leaves the post unchanged', () => {
    const post = newPost(seedAccount(t.repos).id)
    expect(() => t.repos.posts.transition(post.id, 'mark_published')).toThrow(
      InvalidPostTransitionError
    )
    expect(t.repos.posts.require(post.id).status).toBe('queued')
    expect(t.repos.eventLog.recent({ postId: post.id, kind: 'post.status' })).toHaveLength(0)
  })

  it('judges the video-id guard after applying the patch', () => {
    const post = newPost(seedAccount(t.repos).id)
    t.repos.posts.transition(post.id, 'start_upload')
    // Without a video id, upload_complete is not allowed...
    expect(() => t.repos.posts.transition(post.id, 'upload_complete')).toThrow(/no YouTube video/)
    // ...with the id in the same write, it is.
    expect(
      t.repos.posts.transition(post.id, 'upload_complete', { patch: { youtubeVideoId: 'v1' } })
        .status
    ).toBe('processing')
  })

  it('is the only way to change status', () => {
    const post = newPost(seedAccount(t.repos).id)
    const sneaky = { status: 'published' } as unknown as PostPatch
    expect(() => t.repos.posts.update(post.id, sneaky)).toThrow(/transition/)
    expect(() => t.repos.posts.transition(post.id, 'start_upload', { patch: sneaky })).toThrow(
      /transition/
    )
    expect(t.repos.posts.require(post.id).status).toBe('queued')
  })
})

describe('never post the same clip twice to the same channel', () => {
  it('rejects a second active post for the same clip and channel', () => {
    const account = seedAccount(t.repos)
    const twitch = seedTwitchAccount(t.repos)
    const clip = seedClip(t.repos, twitch.id, 'ClipOne')
    newPost(account.id, { source: 'twitch_clip', clipId: clip.id })

    expect(() => newPost(account.id, { source: 'twitch_clip', clipId: clip.id })).toThrow(
      DuplicateError
    )
  })

  it('allows the same clip on a different channel', () => {
    const twitch = seedTwitchAccount(t.repos)
    const clip = seedClip(t.repos, twitch.id, 'ClipTwo')
    newPost(seedAccount(t.repos).id, { source: 'twitch_clip', clipId: clip.id })
    expect(() =>
      newPost(seedAccount(t.repos).id, { source: 'twitch_clip', clipId: clip.id })
    ).not.toThrow()
  })

  it('frees the clip again once the post is canceled before upload', () => {
    const account = seedAccount(t.repos)
    const clip = seedClip(t.repos, seedTwitchAccount(t.repos).id, 'ClipThree')
    const first = newPost(account.id, { source: 'twitch_clip', clipId: clip.id })
    t.repos.posts.transition(first.id, 'cancel')

    const second = newPost(account.id, { source: 'twitch_clip', clipId: clip.id })
    expect(second.clipId).toBe(clip.id)
    // ...but un-canceling is impossible, so the first can never come back as a duplicate.
    expect(() => t.repos.posts.transition(first.id, 'retry')).toThrow(InvalidPostTransitionError)
  })

  it('still counts published posts', () => {
    const account = seedAccount(t.repos)
    const clip = seedClip(t.repos, seedTwitchAccount(t.repos).id, 'ClipFour')
    const post = newPost(account.id, { source: 'twitch_clip', clipId: clip.id })
    t.repos.posts.transition(post.id, 'start_upload')
    t.repos.posts.transition(post.id, 'upload_complete', { patch: { youtubeVideoId: 'v4' } })
    t.repos.posts.transition(post.id, 'mark_published')

    expect(() => newPost(account.id, { source: 'twitch_clip', clipId: clip.id })).toThrow(
      DuplicateError
    )
  })

  it('blocks swapping another active post onto a clip that is taken', () => {
    const account = seedAccount(t.repos)
    const twitch = seedTwitchAccount(t.repos)
    const a = seedClip(t.repos, twitch.id, 'ClipA')
    const b = seedClip(t.repos, twitch.id, 'ClipB')
    newPost(account.id, { source: 'twitch_clip', clipId: a.id })
    const other = newPost(account.id, { source: 'twitch_clip', clipId: b.id })
    expect(() => t.repos.posts.update(other.id, { clipId: a.id })).toThrow(DuplicateError)
  })
})

describe('posts housekeeping', () => {
  it('never stores the same YouTube video id on two posts', () => {
    const account = seedAccount(t.repos)
    const a = newPost(account.id)
    const b = newPost(account.id)
    t.repos.posts.update(a.id, { youtubeVideoId: 'same' })
    expect(() => t.repos.posts.update(b.id, { youtubeVideoId: 'same' })).toThrow()
  })

  it('deletes drafts only', () => {
    const account = seedAccount(t.repos)
    const draft = newPost(account.id, { status: 'draft' })
    const queued = newPost(account.id)
    t.repos.posts.deleteDraft(draft.id)
    expect(t.repos.posts.get(draft.id)).toBeUndefined()
    expect(() => t.repos.posts.deleteDraft(queued.id)).toThrow(/Only drafts/)
  })

  it('filters and sorts by publish time', () => {
    const a = seedAccount(t.repos)
    const b = seedAccount(t.repos)
    newPost(a.id, { publishAtUtc: '2026-11-15T10:00:00.000Z', title: 'later' })
    newPost(a.id, { publishAtUtc: '2026-11-14T10:00:00.000Z', title: 'sooner' })
    newPost(b.id, { status: 'draft', title: 'other channel draft' })

    expect(t.repos.posts.list({ accountId: a.id }).map((p) => p.title)).toEqual(['sooner', 'later'])
    expect(t.repos.posts.list({ statuses: ['draft'] }).map((p) => p.title)).toEqual([
      'other channel draft'
    ])
  })
})
