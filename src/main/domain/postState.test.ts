import { describe, expect, it } from 'vitest'
import { POST_STATUSES, type PostStatus } from '@shared/constants/enums'
import {
  InvalidPostTransitionError,
  POST_EVENTS,
  type PostEvent,
  canTransition,
  nextPostStatus
} from './postState'

/**
 * The full specification, written out by hand: every allowed (status, event, has video id)
 * triple and where it leads. The matrix test below enumerates all 12 × 18 × 2 combinations
 * and requires the function to allow exactly these and reject everything else.
 */
const ALLOWED = `
draft                -submit_for_approval-> needs_approval  [no video]
needs_approval       -approve->             queued          [no video]
needs_approval       -approve->             queued          [video]
draft                -enqueue->             queued          [no video]
draft                -enqueue->             queued          [video]
draft                -submit_for_approval-> needs_approval  [video]
needs_approval       -to_draft->            draft           [no video]
queued               -to_draft->            draft           [no video]
failed               -to_draft->            draft           [no video]
waiting_quota        -to_draft->            draft           [no video]
needs_decision       -to_draft->            draft           [no video]
queued               -start_render->        rendering       [no video]
queued               -start_upload->        uploading       [no video]
queued               -start_upload->        uploading       [video]
rendering            -start_upload->        uploading       [no video]
rendering            -start_upload->        uploading       [video]
uploading            -upload_complete->     processing      [video]
processing           -mark_scheduled->      scheduled       [video]
processing           -mark_published->      published       [video]
scheduled            -mark_published->      published       [video]
queued               -fail->                failed          [no video]
queued               -fail->                failed          [video]
rendering            -fail->                failed          [no video]
rendering            -fail->                failed          [video]
uploading            -fail->                failed          [no video]
uploading            -fail->                failed          [video]
processing           -fail->                failed          [no video]
processing           -fail->                failed          [video]
scheduled            -fail->                failed          [no video]
scheduled            -fail->                failed          [video]
waiting_quota        -fail->                failed          [no video]
waiting_quota        -fail->                failed          [video]
queued               -quota_exhausted->     waiting_quota   [no video]
queued               -quota_exhausted->     waiting_quota   [video]
rendering            -quota_exhausted->     waiting_quota   [no video]
rendering            -quota_exhausted->     waiting_quota   [video]
uploading            -quota_exhausted->     waiting_quota   [no video]
uploading            -quota_exhausted->     waiting_quota   [video]
processing           -quota_exhausted->     waiting_quota   [no video]
processing           -quota_exhausted->     waiting_quota   [video]
failed               -retry->               queued          [no video]
failed               -retry->               queued          [video]
waiting_quota        -retry->               queued          [no video]
waiting_quota        -retry->               queued          [video]
queued               -publish_time_missed-> needs_decision  [no video]
queued               -publish_time_missed-> needs_decision  [video]
waiting_quota        -publish_time_missed-> needs_decision  [no video]
waiting_quota        -publish_time_missed-> needs_decision  [video]
failed               -publish_time_missed-> needs_decision  [no video]
failed               -publish_time_missed-> needs_decision  [video]
needs_decision       -resolve_decision->    queued          [no video]
needs_decision       -resolve_decision->    queued          [video]
rendering            -interrupted->         queued          [no video]
rendering            -interrupted->         queued          [video]
uploading            -interrupted->         queued          [no video]
uploading            -interrupted->         queued          [video]
needs_approval       -cancel->              canceled        [no video]
queued               -cancel->              canceled        [no video]
rendering            -cancel->              canceled        [no video]
uploading            -cancel->              canceled        [no video]
waiting_quota        -cancel->              canceled        [no video]
needs_decision       -cancel->              canceled        [no video]
failed               -cancel->              canceled        [no video]
processing           -keep_private->        published       [video]
scheduled            -keep_private->        published       [video]
queued               -delete_from_youtube-> canceled        [video]
processing           -delete_from_youtube-> canceled        [video]
scheduled            -delete_from_youtube-> canceled        [video]
published            -delete_from_youtube-> canceled        [video]
failed               -delete_from_youtube-> canceled        [video]
waiting_quota        -delete_from_youtube-> canceled        [video]
needs_decision       -delete_from_youtube-> canceled        [video]
`
  .trim()
  .split('\n')
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .sort()

function describeEdge(
  from: PostStatus,
  event: PostEvent,
  hasVideoId: boolean,
  to: PostStatus
): string {
  return `${from} -${event}-> ${to} [${hasVideoId ? 'video' : 'no video'}]`
}

describe('nextPostStatus', () => {
  it('allows exactly the specified transitions and rejects every other combination', () => {
    const actual: string[] = []
    for (const from of POST_STATUSES) {
      for (const event of POST_EVENTS) {
        for (const hasVideoId of [false, true]) {
          if (canTransition(from, event, { hasVideoId })) {
            actual.push(
              describeEdge(from, event, hasVideoId, nextPostStatus(from, event, { hasVideoId }))
            )
          } else {
            expect(() => nextPostStatus(from, event, { hasVideoId })).toThrow(
              InvalidPostTransitionError
            )
          }
        }
      }
    }
    expect(actual.sort()).toEqual(ALLOWED)
  })

  it('walks the scheduled happy path', () => {
    const steps: [PostEvent, boolean][] = [
      ['enqueue', false],
      ['start_upload', false],
      ['upload_complete', true],
      ['mark_scheduled', true],
      ['mark_published', true]
    ]
    let status: PostStatus = 'draft'
    const seen: PostStatus[] = [status]
    for (const [event, hasVideoId] of steps) {
      status = nextPostStatus(status, event, { hasVideoId })
      seen.push(status)
    }
    expect(seen).toEqual(['draft', 'queued', 'uploading', 'processing', 'scheduled', 'published'])
  })

  it('walks the Review-mode autopost path with a render step', () => {
    let status: PostStatus = 'needs_approval'
    status = nextPostStatus(status, 'approve', { hasVideoId: false })
    status = nextPostStatus(status, 'start_render', { hasVideoId: false })
    status = nextPostStatus(status, 'start_upload', { hasVideoId: false })
    expect(status).toBe('uploading')
  })

  it('resumes a half-finished post after quota resets without allowing a second insert path to draft', () => {
    // Insert succeeded, thumbnail step hit quotaExceeded.
    let status = nextPostStatus('processing', 'quota_exhausted', { hasVideoId: true })
    expect(status).toBe('waiting_quota')
    status = nextPostStatus(status, 'retry', { hasVideoId: true })
    expect(status).toBe('queued')
    // It's on YouTube now, so it can't silently go back to being a draft or be "canceled".
    expect(canTransition(status, 'to_draft', { hasVideoId: true })).toBe(false)
    expect(canTransition(status, 'cancel', { hasVideoId: true })).toBe(false)
    expect(canTransition(status, 'delete_from_youtube', { hasVideoId: true })).toBe(true)
  })

  it('never leaves canceled', () => {
    for (const event of POST_EVENTS) {
      for (const hasVideoId of [false, true]) {
        expect(canTransition('canceled', event, { hasVideoId }), event).toBe(false)
      }
    }
  })

  it('only leaves published by deleting from YouTube', () => {
    const exits = POST_EVENTS.filter((event) =>
      canTransition('published', event, { hasVideoId: true })
    )
    expect(exits).toEqual(['delete_from_youtube'])
  })

  it('can reach every status from an initial status', () => {
    const reached = new Set<PostStatus>(['draft', 'needs_approval', 'queued'])
    let grew = true
    while (grew) {
      grew = false
      for (const from of [...reached]) {
        for (const event of POST_EVENTS) {
          for (const hasVideoId of [false, true]) {
            if (!canTransition(from, event, { hasVideoId })) continue
            const to = nextPostStatus(from, event, { hasVideoId })
            if (!reached.has(to)) {
              reached.add(to)
              grew = true
            }
          }
        }
      }
    }
    expect([...reached].sort()).toEqual([...POST_STATUSES].sort())
  })

  it('explains why a transition is invalid', () => {
    expect(() => nextPostStatus('draft', 'mark_published', { hasVideoId: false })).toThrow(
      "Can't mark_published a post that is draft"
    )
    expect(() => nextPostStatus('scheduled', 'cancel', { hasVideoId: true })).toThrow(
      /allowed only from/
    )
    expect(() => nextPostStatus('queued', 'cancel', { hasVideoId: true })).toThrow(
      /already on YouTube/
    )
  })
})
