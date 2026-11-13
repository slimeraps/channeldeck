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
