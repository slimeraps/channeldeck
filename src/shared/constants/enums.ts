/**
 * Enum values shared by the database schema, zod schemas and the UI.
 * Keep this file free of imports: drizzle-kit loads it when generating migrations.
 */

export const POST_STATUSES = [
  'draft',
  'needs_approval',
  'queued',
  'rendering',
  'uploading',
  'processing',
  'scheduled',
  'published',
  'needs_decision',
  'failed',
  'waiting_quota',
  'canceled'
] as const
export type PostStatus = (typeof POST_STATUSES)[number]

/** Statuses a post may be created in. Everything after that goes through nextPostStatus(). */
export const INITIAL_POST_STATUSES = ['draft', 'needs_approval', 'queued'] as const
export type InitialPostStatus = (typeof INITIAL_POST_STATUSES)[number]

export const POST_SOURCES = ['manual', 'twitch_clip'] as const
export type PostSource = (typeof POST_SOURCES)[number]

/** Schedule = private + publishAt (YouTube flips it public). The rest apply on upload. */
export const VISIBILITY_MODES = ['schedule', 'public', 'unlisted', 'private'] as const
export type VisibilityMode = (typeof VISIBILITY_MODES)[number]

/** What to do when the publish time passes before the upload finishes. */
export const MISSED_POLICIES = ['publish_now', 'ask'] as const
export type MissedPolicy = (typeof MISSED_POLICIES)[number]

export const LICENSES = ['youtube', 'creativeCommon'] as const
export type License = (typeof LICENSES)[number]

export const POST_STEPS = ['render', 'insert', 'thumbnail', 'playlist'] as const
export type PostStepName = (typeof POST_STEPS)[number]

export const STEP_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

export const TOKEN_STATUSES = ['ok', 'needs_reauth'] as const
export type TokenStatus = (typeof TOKEN_STATUSES)[number]

/** Twitch sign-in flow used for an account (decision 1 in PLAN.md). */
export const TWITCH_AUTH_FLOWS = ['auth_code', 'device_code'] as const
export type TwitchAuthFlow = (typeof TWITCH_AUTH_FLOWS)[number]

export const DOWNLOAD_STATUSES = [
  'pending',
  'downloading',
  'downloaded',
  'failed',
  'not_downloadable'
] as const
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number]

export const LAYOUT_KINDS = ['blur_fill', 'center_crop', 'facecam_split'] as const
export type LayoutKind = (typeof LAYOUT_KINDS)[number]

export const PICK_ORDERS = ['oldest', 'newest', 'most_viewed'] as const
export type PickOrder = (typeof PICK_ORDERS)[number]

export const AUTOPOST_FORMATS = ['short', 'regular'] as const
export type AutopostFormat = (typeof AUTOPOST_FORMATS)[number]

export const AUTOPOST_MODES = ['review', 'auto'] as const
export type AutopostMode = (typeof AUTOPOST_MODES)[number]

/** YouTube quota buckets: videos.insert has its own; everything else shares units. */
export const QUOTA_BUCKETS = ['upload', 'units'] as const
export type QuotaBucket = (typeof QUOTA_BUCKETS)[number]

export const EVENT_LEVELS = ['info', 'warn', 'error'] as const
export type EventLevel = (typeof EVENT_LEVELS)[number]
