import type { PostStatus, VisibilityMode } from '@shared/constants/enums'
import { postLabel, sentence } from '@shared/lib/postLabel'
import { toYouTubePublishAt } from '@shared/lib/time'
import type { PostEvent } from './postState'

/**
 * Pure rules for status sync and for editing an uploaded video's status. No IO.
 * Video fields: https://developers.google.com/youtube/v3/docs/videos (checked 2026-11-12).
 */

/** What videos.list(part=status,processingDetails) tells us about one video. */
export interface YouTubeVideoState {
  id: string
  status?: {
    uploadStatus?: string | null
    failureReason?: string | null
    rejectionReason?: string | null
    privacyStatus?: string | null
    publishAt?: string | null
  }
  processingDetails?: {
    processingStatus?: string | null
    processingFailureReason?: string | null
  }
}

export interface PostForSync {
  status: PostStatus
  visibilityMode: VisibilityMode
  publishAtUtc: string | null
  title: string
  /** When videos.list first stopped returning this video (null while it's found). */
  missingSinceUtc: string | null
  /** "Hide post titles" is on: notices say "a video" instead of the title. */
  hideTitle?: boolean
}

/**
 * A video must be missing from videos.list this long (on two checks) before the post counts
 * as deleted on YouTube. One empty answer isn't proof, and marking a post deleted cancels
 * it, which frees its clip to be posted again.
 */
export const MISSING_CONFIRM_MS = 60 * 60_000

export interface SyncNotice {
  title: string
  body: string
}

export type SyncDecision =
  | { kind: 'none' }
  /** Keep our copy in step with YouTube (publishAt changed in Studio) or note a missing video. */
  | { kind: 'patch'; patch: { publishAtUtc?: string | null; missingSinceUtc?: string | null } }
  | {
      kind: 'transition'
      event: PostEvent
      reason: string
      patch?: {
        lastError?: string | null
        publishAtUtc?: string | null
        visibilityMode?: VisibilityMode
        missingSinceUtc?: string | null
      }
      notice?: SyncNotice
    }

/** Statuses status sync keeps polling. */
export const SYNCED_STATUSES: PostStatus[] = ['processing', 'scheduled']

const REJECTION_TEXT: Record<string, string> = {
  claim: 'a rights claim',
  copyright: 'a copyright issue',
  duplicate: 'it duplicates another video',
  inappropriate: 'inappropriate content',
  legal: 'a legal issue',
  length: 'it is too long for this channel',
  termsOfUse: 'a Terms of Service violation',
  trademark: 'a trademark issue',
  uploaderAccountClosed: 'the account is closed',
  uploaderAccountSuspended: 'the account is suspended'
}

const FAILURE_TEXT: Record<string, string> = {
  codec: 'an unsupported codec',
  conversion: 'a conversion error',
  emptyFile: 'the file is empty',
  invalidFile: 'the file is not a valid video',
  tooSmall: 'the file is too small',
  uploadAborted: 'the upload was aborted'
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return Date.parse(a) === Date.parse(b)
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * Decides what one post should do given what YouTube reports. `null` = video not found.
 * A video YouTube reports as deleted counts at once; one that is merely missing from the
 * answer counts only once it has stayed missing for MISSING_CONFIRM_MS.
 */
export function decideSync(
  post: PostForSync,
  video: YouTubeVideoState | null,
  nowUtc: string
): SyncDecision {
  if (!video && !post.missingSinceUtc) {
    return { kind: 'patch', patch: { missingSinceUtc: nowUtc } }
  }
  if (
    !video &&
    post.missingSinceUtc &&
    Date.parse(nowUtc) - Date.parse(post.missingSinceUtc) < MISSING_CONFIRM_MS
  ) {
    return { kind: 'none' }
  }
  const decision = decideFound(post, video)
  // The video is back: forget that it went missing.
  if (video && post.missingSinceUtc) {
    if (decision.kind === 'none') return { kind: 'patch', patch: { missingSinceUtc: null } }
    return { ...decision, patch: { ...decision.patch, missingSinceUtc: null } } as SyncDecision
  }
  return decision
}

function decideFound(post: PostForSync, video: YouTubeVideoState | null): SyncDecision {
  const label = postLabel(post.title, post.hideTitle ?? false)

  if (!video || video.status?.uploadStatus === 'deleted') {
    return {
      kind: 'transition',
      event: 'delete_from_youtube',
      reason: 'video no longer on YouTube',
      patch: {
        lastError:
          'This video no longer exists on YouTube (it may have been deleted in YouTube Studio).'
      },
      notice: {
        title: 'Video removed from YouTube',
        body: sentence(`${label} no longer exists on YouTube.`)
      }
    }
  }

  const s = video.status ?? {}
  const processing = video.processingDetails ?? {}

  if (s.uploadStatus === 'rejected') {
    const why = s.rejectionReason
      ? (REJECTION_TEXT[s.rejectionReason] ?? s.rejectionReason)
      : 'an unknown reason'
    return {
      kind: 'transition',
      event: 'fail',
      reason: `rejected: ${s.rejectionReason ?? 'unknown'}`,
      patch: { lastError: `YouTube rejected this video because of ${why}.` },
      notice: { title: 'Video rejected', body: `YouTube rejected ${label} because of ${why}.` }
    }
  }

  if (s.uploadStatus === 'failed' || processing.processingStatus === 'failed') {
    const code = s.failureReason ?? processing.processingFailureReason ?? null
    const why = code ? (FAILURE_TEXT[code] ?? code) : 'an unknown error'
    return {
      kind: 'transition',
      event: 'fail',
      reason: `processing failed: ${code ?? 'unknown'}`,
      patch: { lastError: `YouTube couldn't process this video because of ${why}.` },
      notice: {
        title: 'YouTube processing failed',
        body: sentence(`${label} failed on YouTube: ${why}.`)
      }
    }
  }

  const processed = s.uploadStatus === 'processed' || processing.processingStatus === 'succeeded'
  const privacy = s.privacyStatus

  if (privacy === 'public' || privacy === 'unlisted') {
    if (!processed) return { kind: 'none' }
    return {
      kind: 'transition',
      event: 'mark_published',
      reason: `now ${privacy}`,
      notice:
        privacy === 'public'
          ? { title: 'Published', body: sentence(`${label} is now public.`) }
          : { title: 'Live (unlisted)', body: sentence(`${label} is now unlisted.`) }
    }
  }

  // Private.
  const publishAt = isoOrNull(s.publishAt)
  if (publishAt) {
    if (post.status === 'processing' && processed) {
      return {
        kind: 'transition',
        event: 'mark_scheduled',
        reason: 'processed; waiting for publish time',
        ...(sameInstant(publishAt, post.publishAtUtc) ? {} : { patch: { publishAtUtc: publishAt } })
      }
    }
    return sameInstant(publishAt, post.publishAtUtc)
      ? { kind: 'none' }
      : { kind: 'patch', patch: { publishAtUtc: publishAt } }
  }

  if (!processed) return { kind: 'none' }
  if (post.visibilityMode === 'private') {
    return { kind: 'transition', event: 'mark_published', reason: 'processed (private)' }
  }
  if (post.visibilityMode === 'schedule') {
    // Someone cleared the schedule in YouTube Studio: it's staying private.
    return {
      kind: 'transition',
      event: 'keep_private',
      reason: 'schedule removed on YouTube',
      patch: { visibilityMode: 'private', publishAtUtc: null }
    }
  }
  return { kind: 'none' }
}

/** Status-part fields videos.update can set. Anything left out of an update is cleared. */
const WRITABLE_STATUS_FIELDS = [
  'privacyStatus',
  'publishAt',
  'license',
  'embeddable',
  'publicStatsViewable',
  'selfDeclaredMadeForKids',
  'containsSyntheticMedia'
] as const

export type StatusChange = { kind: 'reschedule'; publishAtUtc: string } | { kind: 'keepPrivate' }

/**
 * Builds the complete `status` part for videos.update from the current one (read with
 * videos.list first), so nothing else gets wiped.
 */
export function buildStatusUpdate(
  current: Record<string, unknown>,
  change: StatusChange
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const key of WRITABLE_STATUS_FIELDS) {
    if (current[key] !== undefined && current[key] !== null) next[key] = current[key]
  }
  next['privacyStatus'] = 'private'
  if (change.kind === 'reschedule') next['publishAt'] = toYouTubePublishAt(change.publishAtUtc)
  else delete next['publishAt']
  return next
}

/** Poll every 2 min while something is processing on YouTube, otherwise every 15 min. */
export function syncIntervalMs(anyProcessing: boolean): number {
  return anyProcessing ? 2 * 60_000 : 15 * 60_000
}

/** Splits ids into videos.list-sized batches (max 50 ids per call). */
export function batchIds<T>(ids: T[], size = 50): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}
