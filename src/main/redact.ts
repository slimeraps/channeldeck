/**
 * Scrubs secrets from anything about to be logged. Pure: no Electron, no IO.
 *
 * Covers object keys (access_token, refreshToken, client_secret, Authorization, ...),
 * `key=value` pairs in URLs and form bodies, JSON-ish `"key": "value"` text, and
 * `Bearer <token>` / `Basic <creds>` headers inside strings. Errors keep their name but
 * their message and stack are scrubbed too.
 */

export const REDACTED = '[REDACTED]'

const SECRET_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'code',
  'code_verifier',
  'authorization',
  'password',
  'token',
  'device_code',
  'enc_refresh_token'
])

/** Normalizes `refreshToken`, `Refresh-Token`, `REFRESH_TOKEN` to `refresh_token`. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normalizeKey(key))
}

const KEY_ALTERNATION =
  'access_token|refresh_token|id_token|client_secret|code_verifier|device_code|code|password'

// key=value in query strings and form bodies (stops at &, whitespace, quote or end).
const QUERY_PAIR = new RegExp(`(\\b(?:${KEY_ALTERNATION})=)[^&\\s"'#]+`, 'gi')
// "key": "value" or 'key':'value' in JSON-ish text.
const JSON_PAIR = new RegExp(
  `((["'])(?:${KEY_ALTERNATION}|accessToken|refreshToken|idToken|clientSecret|authorization)\\2\\s*:\\s*)(["'])(?:(?!\\3).)*\\3`,
  'gi'
)
const AUTH_HEADER = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/g

export function redactString(input: string): string {
  return input
    .replace(AUTH_HEADER, `$1 ${REDACTED}`)
    .replace(QUERY_PAIR, `$1${REDACTED}`)
    .replace(JSON_PAIR, `$1"${REDACTED}"`)
}

export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (value instanceof Error) {
    const copy = new Error(redactString(value.message))
    copy.name = value.name
    copy.stack = value.stack ? redactString(value.stack) : undefined
    return copy
  }

  if (Array.isArray(value)) return value.map((item) => redact(item, seen))

  if (value instanceof Date) return value

  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSecretKey(key) ? REDACTED : redact(inner, seen)
  }
  return out
}
