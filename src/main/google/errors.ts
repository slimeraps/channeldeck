/**
 * Recognizing Google API / OAuth errors. Phase 4 grows this into the full classifier
 * (quotaExceeded, uploadLimitExceeded, invalidPublishAt, ...).
 */

interface GaxiosLikeError {
  message?: string
  status?: number
  code?: string | number
  response?: { status?: number; data?: unknown }
  errors?: { reason?: string; message?: string }[]
}

function asGaxios(error: unknown): GaxiosLikeError | null {
  return typeof error === 'object' && error !== null ? (error as GaxiosLikeError) : null
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
  const e = asGaxios(error)
  if (!e) return null
  const fromErrors = e.errors?.[0]?.reason
  if (fromErrors) return fromErrors
  const data = e.response?.data as { error?: { errors?: { reason?: string }[] } } | undefined
  return data?.error?.errors?.[0]?.reason ?? null
}
