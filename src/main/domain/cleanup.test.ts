import { describe, expect, it } from 'vitest'
import { type CleanupClip, type CleanupPost, filesToClean } from './cleanup'

const now = new Date('2026-11-20T12:00:00Z')
const clip = (id: string, o: Partial<CleanupClip> = {}): CleanupClip => ({
  id,
  downloadStatus: 'downloaded',
  landscapePath: `/c/${id}_landscape.mp4`,
  portraitPath: null,
  ...o
})
const post = (o: Partial<CleanupPost>): CleanupPost => ({
  clipId: null,
  status: 'published',
  publishAtUtc: '2026-11-10T12:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z',
  filePath: null,
  rendered: false,
  renderSourcePath: null,
  ...o
})

describe('filesToClean', () => {
  it('cleans clips whose posts are all published at least N days ago', () => {
    const out = filesToClean({
      clips: [
        clip('old'),
        clip('recent'),
        clip('unposted'),
        clip('stillQueued'),
        clip('gone', { downloadStatus: 'deleted' })
      ],
      posts: [
        post({ clipId: 'old' }),
        post({ clipId: 'recent', publishAtUtc: '2026-11-18T12:00:00.000Z' }),
        post({ clipId: 'stillQueued' }),
        post({ clipId: 'stillQueued', status: 'queued', publishAtUtc: '2026-11-25T12:00:00.000Z' }),
        post({ clipId: 'gone' })
      ],
      now,
      days: 7
    })
    expect(out.clipIds).toEqual(['old'])
  })

  it('uses the newest publish when a clip went to several channels', () => {
    const posts = [
      post({ clipId: 'a', publishAtUtc: '2026-11-01T00:00:00.000Z' }),
      post({ clipId: 'a', publishAtUtc: '2026-11-19T00:00:00.000Z' }),
      post({ clipId: 'a', status: 'canceled', publishAtUtc: null })
    ]
    expect(filesToClean({ clips: [clip('a')], posts, now, days: 7 }).clipIds).toEqual([])
    expect(filesToClean({ clips: [clip('a')], posts, now, days: 1 }).clipIds).toEqual(['a'])
  })

  it('cleans published renders not used by an unfinished post', () => {
    const out = filesToClean({
      clips: [],
      posts: [
        post({ rendered: true, filePath: '/r/a_1.mp4' }),
        post({ rendered: true, filePath: '/r/b_1.mp4' }),
        post({ rendered: true, filePath: '/r/b_1.mp4', status: 'queued' }),
        post({ rendered: true, filePath: '/r/c_1.mp4', publishAtUtc: '2026-11-19T00:00:00.000Z' }),
        post({ rendered: false, filePath: '/c/x.mp4' })
      ],
      now,
      days: 7
    })
    expect(out.renderPaths).toEqual(['/r/a_1.mp4'])
  })
})

describe('filesToClean: files an unfinished post still needs', () => {
  const posted = [post({ clipId: 'a' })]

  it('keeps a posted clip whose file a draft or queued post points at directly', () => {
    const c = clip('a')
    for (const status of ['draft', 'queued', 'uploading'] as const) {
      const out = filesToClean({
        clips: [c],
        posts: [...posted, post({ status, filePath: c.landscapePath, publishAtUtc: null })],
        now,
        days: 7
      })
      expect(out.clipIds).toEqual([])
    }
  })

  it('keeps a posted clip that an unfinished post renders from', () => {
    const c = clip('a', { portraitPath: '/c/a_portrait.mp4' })
    const unfinished = post({
      status: 'queued',
      rendered: true,
      filePath: '/r/a_blur_fill_1234abcd.mp4',
      renderSourcePath: c.landscapePath
    })
    const out = filesToClean({ clips: [c], posts: [...posted, unfinished], now, days: 7 })
    expect(out.clipIds).toEqual([])
    // ...and the portrait file is protected the same way.
    const viaPortrait = { ...unfinished, renderSourcePath: c.portraitPath }
    expect(
      filesToClean({ clips: [c], posts: [...posted, viaPortrait], now, days: 7 }).clipIds
    ).toEqual([])
  })

  it('still cleans the clip once that post is finished', () => {
    const c = clip('a')
    const done = post({
      status: 'canceled',
      filePath: c.landscapePath,
      renderSourcePath: c.landscapePath
    })
    expect(filesToClean({ clips: [c], posts: [...posted, done], now, days: 7 }).clipIds).toEqual([
      'a'
    ])
  })

  it('keeps a published render while an unfinished post renders from the same source', () => {
    const out = filesToClean({
      clips: [],
      posts: [
        post({
          rendered: true,
          filePath: '/r/a_blur_fill_1.mp4',
          renderSourcePath: '/c/a_landscape.mp4'
        }),
        post({
          rendered: true,
          status: 'draft',
          filePath: '/r/a_facecam_split_2.mp4',
          renderSourcePath: '/c/a_landscape.mp4'
        }),
        post({
          rendered: true,
          filePath: '/r/b_blur_fill_3.mp4',
          renderSourcePath: '/c/b_landscape.mp4'
        })
      ],
      now,
      days: 7
    })
    expect(out.renderPaths).toEqual(['/r/b_blur_fill_3.mp4'])
  })
})
