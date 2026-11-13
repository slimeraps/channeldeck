import { describe, expect, it } from 'vitest'
import { classifyGoogleError, YouTubeHttpError } from './errors'

const apiError = (status: number, reason: string, message = 'msg') => ({
  message,
  response: { status, data: { error: { code: status, message, errors: [{ reason, message }] } } }
})

describe('classifyGoogleError', () => {
  it('waits for quota instead of retrying', () => {
    expect(classifyGoogleError(apiError(403, 'quotaExceeded')).kind).toBe('quota')
    const upload = classifyGoogleError(
      new YouTubeHttpError(400, { error: { errors: [{ reason: 'uploadLimitExceeded' }] } })
    )
    expect(upload).toMatchObject({ kind: 'quota', reason: 'uploadLimitExceeded' })
    expect(upload.message).toMatch(/midnight Pacific/)
  })

  it('flags dead sign-ins', () => {
    expect(
      classifyGoogleError({
        message: 'invalid_grant',
        response: { status: 400, data: { error: 'invalid_grant' } }
      }).kind
    ).toBe('auth')
  })

  it('retries network errors, 5xx, 429 and rate limits', () => {
    const cases: unknown[] = [
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }),
      new YouTubeHttpError(503, null),
      new YouTubeHttpError(500, { error: { message: 'Backend Error' } }),
      apiError(429, 'userRateLimitExceeded'),
      apiError(403, 'rateLimitExceeded')
    ]
    for (const e of cases) expect(classifyGoogleError(e).kind, String(e)).toBe('retryable')
  })

  it('honours Retry-After', () => {
    expect(classifyGoogleError(new YouTubeHttpError(503, null, '30')).retryAfterMs).toBe(30_000)
  })

  it('gives plain messages for the named YouTube errors and does not retry them', () => {
    for (const reason of [
      'invalidPublishAt',
      'invalidTitle',
      'invalidDescription',
      'invalidCategoryId',
      'youtubeSignupRequired',
      'forbidden'
    ]) {
      const c = classifyGoogleError(apiError(400, reason))
      expect(c.kind, reason).toBe('fatal')
      expect(c.message, reason).not.toBe('msg')
    }
    expect(classifyGoogleError(apiError(403, 'forbidden')).message).toMatch(/thumbnails/)
  })

  it('treats unknown 4xx as fatal with the raw message', () => {
    expect(classifyGoogleError(apiError(400, 'somethingNew', 'Weird thing'))).toMatchObject({
      kind: 'fatal',
      message: 'Weird thing'
    })
  })
})
