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

/** The first `reason` from a YouTube API error body, e.g. "quotaExceeded". */
export function googleErrorReason(error: unknown): string | null {
  const e = asGaxios(error)
  if (!e) return null
  const fromErrors = e.errors?.[0]?.reason
  if (fromErrors) return fromErrors
  const data = e.response?.data as { error?: { errors?: { reason?: string }[] } } | undefined
  return data?.error?.errors?.[0]?.reason ?? null
}
