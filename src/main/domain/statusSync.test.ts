import { describe, expect, it } from 'vitest'
import {
  batchIds,
  buildStatusUpdate,
  decideSync,
  type PostForSync,
  syncIntervalMs
} from './statusSync'

const scheduled = (o: Partial<PostForSync> = {}): PostForSync => ({
  status: 'processing',
  visibilityMode: 'schedule',
  publishAtUtc: '2026-11-14T05:00:00.000Z',
  title: 'MW4 Day 9',
  ...o
})

const video = (status: Record<string, string>, processingStatus?: string) => ({
  id: 'v1',
  status,
  ...(processingStatus ? { processingDetails: { processingStatus } } : {})
})

describe('decideSync', () => {
  it('waits while YouTube is still processing', () => {
    expect(
      decideSync(
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
      decideSync(
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
    const d = decideSync(
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
      decideSync(
        scheduled({ visibilityMode: 'public', publishAtUtc: null }),
        video({ uploadStatus: 'uploaded', privacyStatus: 'public' })
      )
    ).toEqual({ kind: 'none' })
    expect(
      decideSync(
        scheduled({ visibilityMode: 'unlisted', publishAtUtc: null }),
        video({ uploadStatus: 'processed', privacyStatus: 'unlisted' })
      )
    ).toMatchObject({ event: 'mark_published', notice: { title: 'Live (unlisted)' } })
  })

  it('finishes Private uploads once processed', () => {
    expect(
      decideSync(
        scheduled({ visibilityMode: 'private', publishAtUtc: null }),
        video({ uploadStatus: 'processed', privacyStatus: 'private' })
      )
    ).toMatchObject({ event: 'mark_published' })
  })

  it('reports rejections and processing failures with the reason in plain words', () => {
    const rejected = decideSync(
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

    const failed = decideSync(
      scheduled(),
      video({ uploadStatus: 'failed', failureReason: 'codec' })
    )
    expect(failed.kind === 'transition' && failed.patch?.lastError).toMatch(/unsupported codec/)

    const procFailed = decideSync(scheduled(), video({ uploadStatus: 'uploaded' }, 'failed'))
    expect(procFailed).toMatchObject({ event: 'fail' })
  })

  it('notices videos deleted on YouTube', () => {
    expect(decideSync(scheduled({ status: 'scheduled' }), null)).toMatchObject({
      event: 'delete_from_youtube'
    })
    expect(decideSync(scheduled(), video({ uploadStatus: 'deleted' }))).toMatchObject({
      event: 'delete_from_youtube'
    })
  })

  it('picks up a publish time changed in YouTube Studio', () => {
    expect(
      decideSync(
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
      decideSync(
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
      decideSync(
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
