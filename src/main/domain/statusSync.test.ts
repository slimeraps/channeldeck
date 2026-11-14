import { describe, expect, it } from 'vitest'
import {
  batchIds,
  buildStatusUpdate,
  decideSync,
  MISSING_CONFIRM_MS,
  type PostForSync,
  syncIntervalMs
} from './statusSync'

const scheduled = (o: Partial<PostForSync> = {}): PostForSync => ({
  status: 'processing',
  visibilityMode: 'schedule',
  publishAtUtc: '2026-11-14T05:00:00.000Z',
  title: 'MW4 Day 9',
  missingSinceUtc: null,
  ...o
})

const NOW = '2026-11-13T12:00:00.000Z'
const decide = (post: PostForSync, v: Parameters<typeof decideSync>[1]) => decideSync(post, v, NOW)

const video = (status: Record<string, string>, processingStatus?: string) => ({
  id: 'v1',
  status,
  ...(processingStatus ? { processingDetails: { processingStatus } } : {})
})

describe('decideSync', () => {
  it('waits while YouTube is still processing', () => {
    expect(
      decide(
        scheduled(),
        video({
          uploadStatus: 'uploaded',
          privacyStatus: 'private',
          publishAt: '2026-11-14T05:00:00Z'
        })
      )
    ).toEqual({
      kind: 'none'
    })
  })

  it('moves a processed scheduled video to Scheduled', () => {
    expect(
      decide(
        scheduled(),
        video({
          uploadStatus: 'processed',
          privacyStatus: 'private',
          publishAt: '2026-11-14T05:00:00Z'
        })
      )
    ).toMatchObject({ kind: 'transition', event: 'mark_scheduled' })
  })

  it('moves Scheduled to Published when YouTube made it public, with a notification', () => {
    const d = decide(
      scheduled({ status: 'scheduled' }),
      video({ uploadStatus: 'processed', privacyStatus: 'public' })
    )
    expect(d).toMatchObject({
      kind: 'transition',
      event: 'mark_published',
      notice: { title: 'Published' }
    })
  })

  it('publishes Public-now and Unlisted-now uploads once processed', () => {
    expect(
      decide(
        scheduled({ visibilityMode: 'public', publishAtUtc: null }),
        video({ uploadStatus: 'uploaded', privacyStatus: 'public' })
      )
    ).toEqual({ kind: 'none' })
    expect(
      decide(
        scheduled({ visibilityMode: 'unlisted', publishAtUtc: null }),
        video({ uploadStatus: 'processed', privacyStatus: 'unlisted' })
      )
    ).toMatchObject({ event: 'mark_published', notice: { title: 'Live (unlisted)' } })
  })

  it('finishes Private uploads once processed', () => {
    expect(
      decide(
        scheduled({ visibilityMode: 'private', publishAtUtc: null }),
        video({ uploadStatus: 'processed', privacyStatus: 'private' })
      )
    ).toMatchObject({ event: 'mark_published' })
  })

  it('reports rejections and processing failures with the reason in plain words', () => {
    const rejected = decide(
      scheduled(),
      video({ uploadStatus: 'rejected', rejectionReason: 'copyright', privacyStatus: 'private' })
    )
    expect(rejected).toMatchObject({
      kind: 'transition',
      event: 'fail',
      notice: { title: 'Video rejected' }
    })
    expect(rejected.kind === 'transition' && rejected.patch?.lastError).toBe(
      'YouTube rejected this video because of a copyright issue.'
    )

    const failed = decide(scheduled(), video({ uploadStatus: 'failed', failureReason: 'codec' }))
    expect(failed.kind === 'transition' && failed.patch?.lastError).toMatch(/unsupported codec/)

    const procFailed = decide(scheduled(), video({ uploadStatus: 'uploaded' }, 'failed'))
    expect(procFailed).toMatchObject({ event: 'fail' })
  })

  it('counts a video YouTube reports as deleted at once', () => {
    expect(decide(scheduled(), video({ uploadStatus: 'deleted' }))).toMatchObject({
      event: 'delete_from_youtube'
    })
  })

  it('says "a video" instead of the title when titles are hidden', () => {
    const hidden = decide(
      scheduled({ hideTitle: true }),
      video({ uploadStatus: 'processed', privacyStatus: 'public' }, 'succeeded')
    )
    expect(hidden).toMatchObject({ notice: { body: 'A video is now public.' } })
    const rejected = decide(
      scheduled({ hideTitle: true }),
      video({ uploadStatus: 'rejected', rejectionReason: 'duplicate' })
    )
    expect(JSON.stringify(rejected)).not.toContain('MW4')
    expect(rejected).toMatchObject({
      notice: { body: 'YouTube rejected a video because of it duplicates another video.' }
    })
  })

  it('only notes the time when a video first goes missing from the answer', () => {
    expect(decide(scheduled({ status: 'scheduled' }), null)).toEqual({
      kind: 'patch',
      patch: { missingSinceUtc: NOW }
    })
  })

  it('waits until the video has been missing for an hour before calling it deleted', () => {
    const since = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString()
    const missing = (ms: number) => scheduled({ status: 'scheduled', missingSinceUtc: since(ms) })
    expect(decide(missing(MISSING_CONFIRM_MS - 1), null)).toEqual({ kind: 'none' })
    expect(decide(missing(MISSING_CONFIRM_MS), null)).toMatchObject({
      kind: 'transition',
      event: 'delete_from_youtube'
    })
  })

  it('forgets the missing time when the video comes back', () => {
    const back = scheduled({ status: 'scheduled', missingSinceUtc: '2026-11-13T11:30:00.000Z' })
    // Nothing else to do: just clear it.
    expect(
      decide(
        back,
        video(
          {
            uploadStatus: 'processed',
            privacyStatus: 'private',
            publishAt: '2026-11-14T05:00:00Z'
          },
          'succeeded'
        )
      )
    ).toEqual({ kind: 'patch', patch: { missingSinceUtc: null } })
    // Something else to do too: clear it in the same write.
    expect(
      decide(back, video({ uploadStatus: 'processed', privacyStatus: 'public' }, 'succeeded'))
    ).toMatchObject({ event: 'mark_published', patch: { missingSinceUtc: null } })
  })

  it('picks up a publish time changed in YouTube Studio', () => {
    expect(
      decide(
        scheduled({ status: 'scheduled' }),
        video({
          uploadStatus: 'processed',
          privacyStatus: 'private',
          publishAt: '2026-11-15T05:00:00Z'
        })
      )
    ).toEqual({ kind: 'patch', patch: { publishAtUtc: '2026-11-15T05:00:00.000Z' } })
    // Same instant, different formatting: nothing to do.
    expect(
      decide(
        scheduled({ status: 'scheduled' }),
        video({
          uploadStatus: 'processed',
          privacyStatus: 'private',
          publishAt: '2026-11-14T05:00:00Z'
        })
      )
    ).toEqual({ kind: 'none' })
  })

  it('treats a schedule removed in Studio as "kept private"', () => {
    expect(
      decide(
        scheduled({ status: 'scheduled' }),
        video({ uploadStatus: 'processed', privacyStatus: 'private' })
      )
    ).toMatchObject({
      event: 'keep_private',
      patch: { visibilityMode: 'private', publishAtUtc: null }
    })
  })
})

describe('buildStatusUpdate', () => {
  const current = {
    uploadStatus: 'processed',
    privacyStatus: 'private',
    publishAt: '2026-11-14T05:00:00Z',
    license: 'youtube',
    embeddable: true,
    publicStatsViewable: true,
    madeForKids: false,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: false
  }

  it('reschedules by sending the whole writable status part with the new publishAt', () => {
    expect(
      buildStatusUpdate(current, { kind: 'reschedule', publishAtUtc: '2026-11-20T18:30:00.000Z' })
    ).toEqual({
      privacyStatus: 'private',
      publishAt: '2026-11-20T18:30:00Z',
      license: 'youtube',
      embeddable: true,
      publicStatsViewable: true,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: false
    })
  })

  it('keeps private by leaving publishAt out (which clears it)', () => {
    const next = buildStatusUpdate(current, { kind: 'keepPrivate' })
    expect(next).not.toHaveProperty('publishAt')
    expect(next).toMatchObject({
      privacyStatus: 'private',
      license: 'youtube',
      selfDeclaredMadeForKids: false
    })
    // Read-only fields are never sent back.
    expect(next).not.toHaveProperty('uploadStatus')
    expect(next).not.toHaveProperty('madeForKids')
  })
})

describe('helpers', () => {
  it('batches ids for videos.list (50 per call)', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`)
    expect(batchIds(ids).map((b) => b.length)).toEqual([50, 50, 20])
    expect(batchIds([])).toEqual([])
  })

  it('polls faster while something is processing', () => {
    expect(syncIntervalMs(true)).toBe(120_000)
    expect(syncIntervalMs(false)).toBe(900_000)
  })
})
