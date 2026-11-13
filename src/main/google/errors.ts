/**
 * Recognizing and classifying Google API / OAuth errors. Works on gaxios errors (from the
 * googleapis client) and on YouTubeHttpError (from our own resumable upload).
 */

interface GaxiosLikeError {
  message?: string
  status?: number
  code?: string | number
  name?: string
  response?: { status?: number; data?: unknown }
  errors?: { reason?: string; message?: string }[]
  cause?: unknown
}

function asGaxios(error: unknown): GaxiosLikeError | null {
  return typeof error === 'object' && error !== null ? (error as GaxiosLikeError) : null
}

/** An HTTP error from a raw YouTube request (resumable upload). */
export class YouTubeHttpError extends Error {
  readonly status: number
  readonly reason: string | null
  readonly retryAfterMs: number | null

  constructor(status: number, body: unknown, retryAfterHeader: string | null = null) {
    const parsed = body as { error?: { message?: string; errors?: { reason?: string }[] } } | null
    const message = parsed?.error?.message ?? `YouTube returned HTTP ${status}`
    super(message)
    this.name = 'YouTubeHttpError'
    this.status = status
    this.reason = parsed?.error?.errors?.[0]?.reason ?? null
    const seconds = retryAfterHeader ? Number(retryAfterHeader) : NaN
    this.retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : null
  }
}

/** The refresh token was revoked, expired (e.g. 7-day Testing mode), or is otherwise dead. */
export function isInvalidGrant(error: unknown): boolean {
  const e = asGaxios(error)
  if (!e) return false
  const data = e.response?.data
  if (data && typeof data === 'object' && (data as { error?: unknown }).error === 'invalid_grant') {
    return true
  }
  return typeof e.message === 'string' && /\binvalid_grant\b/.test(e.message)
}

/**
 * The YouTube Data API isn't enabled in the Google Cloud project (403 accessNotConfigured /
 * SERVICE_DISABLED). Sign-in still succeeds in this case; the first API call fails.
 */
export function isApiNotEnabled(error: unknown): boolean {
  const reason = googleErrorReason(error)
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') return true
  const message = asGaxios(error)?.message ?? ''
  return /has not been used in project|is disabled\. Enable it|SERVICE_DISABLED/.test(message)
}

/** The Google Cloud project number mentioned in an "API not enabled" error, if any. */
export function projectNumberFrom(error: unknown): string | null {
  const message = asGaxios(error)?.message ?? ''
  return /project (\d{6,})/.exec(message)?.[1] ?? null
}

/** The first `reason` from a YouTube API error body, e.g. "quotaExceeded". */
export function googleErrorReason(error: unknown): string | null {
  if (error instanceof YouTubeHttpError) return error.reason
  const e = asGaxios(error)
  if (!e) return null
  const fromErrors = e.errors?.[0]?.reason
  if (fromErrors) return fromErrors
  const data = e.response?.data as { error?: { errors?: { reason?: string }[] } } | undefined
  return data?.error?.errors?.[0]?.reason ?? null
}

function httpStatus(error: unknown): number | null {
  if (error instanceof YouTubeHttpError) return error.status
  const e = asGaxios(error)
  const status =
    e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : undefined)
  return typeof status === 'number' ? status : null
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
])

function isNetworkError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = asGaxios(current)
    if (!e) return false
    if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return true
    if (e.name === 'TimeoutError') return true
    if (typeof e.message === 'string' && /fetch failed|socket hang up|network/i.test(e.message)) {
      return true
    }
    current = e.cause
  }
  return false
}

export type ErrorKind =
  /** Try again with backoff (network, 5xx, rate limiting). */
  | 'retryable'
  /** Daily quota or upload limit: wait until midnight Pacific, don't retry now. */
  | 'quota'
  /** Sign-in is dead: mark the channel "Needs re-auth". */
  | 'auth'
  /** Won't succeed by retrying; needs a change from Cody. */
  | 'fatal'

export interface ClassifiedError {
  kind: ErrorKind
  reason: string | null
  /** Written for Cody; shown in the queue and notifications. */
  message: string
  retryAfterMs: number | null
}

/** Plain-language messages for the YouTube errors the brief names. */
const FATAL_MESSAGES: Record<string, string> = {
  invalidPublishAt: 'YouTube rejected the publish time. Pick a time in the future and try again.',
  invalidTitle: 'YouTube rejected the title. Check it is 1–100 characters with no < or >.',
  invalidDescription:
    'YouTube rejected the description. Check it is under 5000 bytes with no < or >.',
  invalidTags: 'YouTube rejected the tags. Shorten them (500 characters total) and remove < or >.',
  invalidCategoryId: 'YouTube rejected the category. Pick a category again in the editor.',
  invalidVideoMetadata:
    'YouTube rejected the video details. Check the title, description and tags.',
  defaultLanguageNotSet:
    'YouTube needs a default language for this video. Set one under More options.',
  youtubeSignupRequired:
    'This Google account has no YouTube channel. Reconnect the channel and pick the account that owns it.',
  forbiddenLicenseSetting:
    'YouTube does not allow that license for this video. Choose Standard YouTube.',
  forbiddenPrivacySetting: 'YouTube does not allow that visibility for this video.',
  forbidden:
    'YouTube refused the request. For thumbnails this usually means the channel is not verified for custom thumbnails (verify it at youtube.com/verify).',
  accessNotConfigured:
    'The YouTube Data API v3 is turned off in your Google Cloud project. Enable it in Google Cloud Console and try again.',
  mediaBodyRequired: 'The upload contained no video data. Check the file and try again.'
}

const QUOTA_REASONS = new Set(['quotaExceeded', 'uploadLimitExceeded', 'dailyLimitExceeded'])
const RETRYABLE_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'backendError',
  'internalError'
])

export function classifyGoogleError(error: unknown): ClassifiedError {
  const reason = googleErrorReason(error)
  const status = httpStatus(error)
  const retryAfterMs = error instanceof YouTubeHttpError ? error.retryAfterMs : null
  const raw = asGaxios(error)?.message ?? String(error)

  if (isInvalidGrant(error)) {
    return {
      kind: 'auth',
      reason: 'invalid_grant',
      message: 'The Google sign-in for this channel expired or was revoked. Click Reconnect.',
      retryAfterMs
    }
  }
  if (reason && QUOTA_REASONS.has(reason)) {
    return {
      kind: 'quota',
      reason,
      message:
        reason === 'uploadLimitExceeded'
          ? "This channel hit YouTube's daily upload limit. ChannelDeck will try again after midnight Pacific."
          : "Today's YouTube API quota is used up. ChannelDeck will try again after midnight Pacific.",
      retryAfterMs
    }
  }
  if (isApiNotEnabled(error)) {
    return {
      kind: 'fatal',
      reason: 'accessNotConfigured',
      message: FATAL_MESSAGES['accessNotConfigured'] ?? raw,
      retryAfterMs
    }
  }
  if (reason && FATAL_MESSAGES[reason]) {
    return { kind: 'fatal', reason, message: FATAL_MESSAGES[reason], retryAfterMs }
  }
  if ((reason && RETRYABLE_REASONS.has(reason)) || isNetworkError(error)) {
    return { kind: 'retryable', reason, message: `Network or YouTube hiccup: ${raw}`, retryAfterMs }
  }
  if (status !== null && (status >= 500 || status === 429 || status === 408)) {
    return {
      kind: 'retryable',
      reason,
      message: `YouTube is having trouble (HTTP ${status}).`,
      retryAfterMs
    }
  }
  if (status === 401) {
    // Usually an expired access token; the auth client refreshes it on the next attempt.
    return {
      kind: 'retryable',
      reason,
      message: 'YouTube asked to sign in again; retrying.',
      retryAfterMs
    }
  }
  return { kind: 'fatal', reason, message: raw || 'Unknown error from YouTube.', retryAfterMs }
}
