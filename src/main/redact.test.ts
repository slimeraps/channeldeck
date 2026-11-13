import { describe, expect, it } from 'vitest'
import { REDACTED, isSecretKey, redact, redactString } from './redact'

describe('isSecretKey', () => {
  it('matches secret keys in any casing style', () => {
    for (const key of [
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken',
      'REFRESH_TOKEN',
      'client_secret',
      'clientSecret',
      'Authorization',
      'code',
      'code_verifier',
      'enc_refresh_token'
    ]) {
      expect(isSecretKey(key), key).toBe(true)
    }
  })

  it('leaves ordinary keys alone', () => {
    for (const key of ['channel_id', 'title', 'expiry_date', 'scope', 'videoId', 'statusCode']) {
      expect(isSecretKey(key), key).toBe(false)
    }
  })
})

describe('redactString', () => {
  it('scrubs bearer tokens', () => {
    expect(redactString('Authorization: Bearer ya29.a0AfH6SMB-xyz_123')).toBe(
      `Authorization: Bearer ${REDACTED}`
    )
  })

  it('scrubs secrets in query strings and form bodies but keeps other params', () => {
    const url =
      'http://127.0.0.1:5123/callback?state=abc&code=4/0AeanS0Z&scope=youtube refresh_token=1//0gX&grant_type=refresh_token'
    const out = redactString(url)
    expect(out).toContain(`code=${REDACTED}`)
    expect(out).toContain(`refresh_token=${REDACTED}`)
    expect(out).toContain('state=abc')
    expect(out).toContain('grant_type=refresh_token')
    expect(out).not.toContain('4/0AeanS0Z')
    expect(out).not.toContain('1//0gX')
  })

  it('scrubs JSON-looking text', () => {
    const body = '{"access_token":"ya29.secret","expires_in":3599,"refresh_token":"1//secret"}'
    const out = redactString(body)
    expect(out).not.toContain('ya29.secret')
    expect(out).not.toContain('1//secret')
    expect(out).toContain('"expires_in":3599')
  })
})

describe('redact', () => {
  it('scrubs nested objects and arrays', () => {
    const input = {
      account: { channelId: 'UC123', tokens: { access_token: 'a', refresh_token: 'r' } },
      headers: { Authorization: 'Bearer abc' },
      list: [{ client_secret: 's' }, 'Bearer zzz']
    }
    expect(redact(input)).toEqual({
      account: { channelId: 'UC123', tokens: { access_token: REDACTED, refresh_token: REDACTED } },
      headers: { Authorization: REDACTED },
      list: [{ client_secret: REDACTED }, `Bearer ${REDACTED}`]
    })
  })

  it('does not mutate the input', () => {
    const input = { refresh_token: 'keep-me' }
    redact(input)
    expect(input.refresh_token).toBe('keep-me')
  })

  it('scrubs error messages and stacks', () => {
    const err = new Error('request failed: Bearer abc.def')
    const out = redact(err) as Error
    expect(out).toBeInstanceOf(Error)
    expect(out.message).toBe(`request failed: Bearer ${REDACTED}`)
    expect(out.stack ?? '').not.toContain('abc.def')
  })

  it('handles circular references and primitives', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(redact(a)).toEqual({ name: 'a', self: '[Circular]' })
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBe(null)
    expect(redact(undefined)).toBe(undefined)
  })
})
