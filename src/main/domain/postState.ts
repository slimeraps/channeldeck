import type { PostStatus } from '@shared/constants/enums'

/**
 * The post lifecycle as one pure function. Nothing else decides a post's status:
 * postsRepo.transition() calls nextPostStatus() and is the only writer of posts.status.
 *
 * Happy paths:
 *   draft → queued → (rendering →) uploading → processing → scheduled → published
 *   draft → needs_approval → queued → ...            (autoposts in Review mode)
 * Side exits from active states: failed (retryable), waiting_quota, canceled.
 * "videoId" guards keep pre-upload actions (cancel, back to draft) away from posts that
 * already exist on YouTube, which instead need keep_private or delete_from_youtube.
 */

export type PostEvent =
  | 'submit_for_approval'
  | 'approve'
  | 'enqueue'
  | 'to_draft'
  | 'start_render'
  | 'start_upload'
  | 'upload_complete'
  | 'mark_scheduled'
  | 'mark_published'
  | 'fail'
  | 'quota_exhausted'
  | 'retry'
  | 'publish_time_missed'
  | 'resolve_decision'
  | 'interrupted'
  | 'cancel'
  | 'keep_private'
  | 'delete_from_youtube'

type VideoIdGuard = 'required' | 'forbidden'

interface TransitionRule {
  from: readonly PostStatus[]
  to: PostStatus
  videoId?: VideoIdGuard
  description: string
}

export const POST_TRANSITIONS = {
  submit_for_approval: {
    from: ['draft'],
    to: 'needs_approval',
    description: 'Send a draft for review'
  },
  approve: {
    from: ['needs_approval'],
    to: 'queued',
    description: 'Approve a reviewed autopost'
  },
  enqueue: {
    from: ['draft'],
    to: 'queued',
    description: 'Add a draft to the queue'
  },
  to_draft: {
    from: ['needs_approval', 'queued', 'failed', 'waiting_quota', 'needs_decision'],
    to: 'draft',
    videoId: 'forbidden',
    description: 'Move back to drafts (only before it exists on YouTube)'
  },
  start_render: {
    from: ['queued'],
    to: 'rendering',
    videoId: 'forbidden',
    description: 'Start the vertical render step'
  },
  start_upload: {
    from: ['queued', 'rendering'],
    to: 'uploading',
    description: 'Start (or resume) the upload steps'
  },
  upload_complete: {
    from: ['uploading'],
    to: 'processing',
    videoId: 'required',
    description: 'videos.insert succeeded; YouTube is processing'
  },
  mark_scheduled: {
    from: ['processing'],
    to: 'scheduled',
    videoId: 'required',
    description: 'Processed and waiting for publishAt'
  },
  mark_published: {
    from: ['processing', 'scheduled'],
    to: 'published',
    videoId: 'required',
    description: 'Live with its final visibility'
  },
  fail: {
    from: ['queued', 'rendering', 'uploading', 'processing', 'scheduled', 'waiting_quota'],
    to: 'failed',
    description: 'Gave up after retries, or YouTube rejected the video'
  },
  quota_exhausted: {
    from: ['queued', 'rendering', 'uploading', 'processing'],
    to: 'waiting_quota',
    description: 'quotaExceeded / uploadLimitExceeded: wait for midnight Pacific'
  },
  retry: {
    from: ['failed', 'waiting_quota'],
    to: 'queued',
    description: 'Try again (resumes remaining steps if a video id exists)'
  },
  publish_time_missed: {
    from: ['queued', 'waiting_quota', 'failed'],
    to: 'needs_decision',
    description: 'Publish time passed before upload and the policy is "ask me"'
  },
  resolve_decision: {
    from: ['needs_decision'],
    to: 'queued',
    description: 'You chose publish now or a new time'
  },
  interrupted: {
    from: ['rendering', 'uploading'],
    to: 'queued',
    description: 'The app quit mid-job; restart cleanly on next launch'
  },
  cancel: {
    from: [
      'needs_approval',
      'queued',
      'rendering',
      'uploading',
      'waiting_quota',
      'needs_decision',
      'failed'
    ],
    to: 'canceled',
    videoId: 'forbidden',
    description: 'Unschedule before upload; the clip returns to the bank'
  },
  keep_private: {
    from: ['processing', 'scheduled'],
    to: 'published',
    videoId: 'required',
    description: 'Clear publishAt and leave the uploaded video private'
  },
  delete_from_youtube: {
    from: [
      'queued',
      'processing',
      'scheduled',
      'published',
      'failed',
      'waiting_quota',
      'needs_decision'
    ],
    to: 'canceled',
    videoId: 'required',
    description: 'videos.delete succeeded'
  }
} as const satisfies Record<PostEvent, TransitionRule>

export const POST_EVENTS = Object.keys(POST_TRANSITIONS) as PostEvent[]

export interface TransitionContext {
  /** Whether the post already has a YouTube video id (after this transition's patch). */
  hasVideoId: boolean
}

export class InvalidPostTransitionError extends Error {
  readonly from: PostStatus
  readonly event: PostEvent

  constructor(from: PostStatus, event: PostEvent, reason: string) {
    super(`Can't ${event} a post that is ${from}: ${reason}`)
    this.name = 'InvalidPostTransitionError'
    this.from = from
    this.event = event
  }
}

function check(
  current: PostStatus,
  event: PostEvent,
  ctx: TransitionContext
): { ok: true; to: PostStatus } | { ok: false; reason: string } {
  const rule: TransitionRule = POST_TRANSITIONS[event]
  if (!rule.from.includes(current)) {
    return { ok: false, reason: `allowed only from ${rule.from.join(', ')}` }
  }
  if (rule.videoId === 'required' && !ctx.hasVideoId) {
    return { ok: false, reason: 'the post has no YouTube video yet' }
  }
  if (rule.videoId === 'forbidden' && ctx.hasVideoId) {
    return { ok: false, reason: 'the post is already on YouTube' }
  }
  return { ok: true, to: rule.to }
}

/** Returns the next status, or throws InvalidPostTransitionError. */
export function nextPostStatus(
  current: PostStatus,
  event: PostEvent,
  ctx: TransitionContext
): PostStatus {
  const result = check(current, event, ctx)
  if (!result.ok) throw new InvalidPostTransitionError(current, event, result.reason)
  return result.to
}

export function canTransition(
  current: PostStatus,
  event: PostEvent,
  ctx: TransitionContext
): boolean {
  return check(current, event, ctx).ok
}

/** Statuses where the upload pipeline may pick the post up. */
export const UPLOADABLE_STATUSES = ['queued'] as const satisfies readonly PostStatus[]

/** Statuses that status sync keeps polling YouTube for. */
export const SYNCING_STATUSES = ['processing', 'scheduled'] as const satisfies readonly PostStatus[]
