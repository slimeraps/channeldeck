import { randomBytes } from 'node:crypto'
import { UserFacingError } from '../errors'
import { type LoopbackReceiver, startLoopbackReceiver } from '../google/loopback'
import { abortableSleep } from '../jobs/retry'

/**
 * Twitch OAuth (https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/, checked
 * 2026-11-12). Primary: Authorization Code with a Confidential app (refresh tokens don't
 * expire). Fallback with no client secret: Device Code (public client; refresh tokens are
 * one-time use and expire 30 days after they're issued).
 */

export const TWITCH_ID = 'https://id.twitch.tv/oauth2'
export const TWITCH_REDIRECT_PORT = 17563
export const TWITCH_REDIRECT_PATH = '/twitch/callback'
export const TWITCH_REDIRECT_URI = `http://localhost:${TWITCH_REDIRECT_PORT}${TWITCH_REDIRECT_PATH}`

/** Broadcaster signs in for their own channel; an editor signs in to manage someone else's. */
export const SCOPE_FOR = {
  broadcaster: 'channel:manage:clips',
  editor: 'editor:manage:clips'
} as const
export type ConnectMode = keyof typeof SCOPE_FOR

export interface TwitchTokens {
  accessToken: string
  refreshToken: string
  expiresInSec: number
  scopes: string[]
}

export class TwitchAuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'TwitchAuthError'
    this.status = status
  }
}

type Fetch = typeof fetch

async function postForm(
  doFetch: Fetch,
  path: string,
  form: Record<string, string>
): Promise<Response> {
  return doFetch(`${TWITCH_ID}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string[] | string
}

function toTokens(body: unknown): TwitchTokens {
  const json = body as TokenResponse
  if (!json?.access_token || !json.refresh_token) {
    throw new UserFacingError('Twitch did not return a usable sign-in token. Try connecting again.')
  }
  const scopes = Array.isArray(json.scope) ? json.scope : json.scope ? json.scope.split(' ') : []
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSec: json.expires_in,
    scopes
  }
}

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  return body?.message ?? `HTTP ${res.status}`
}

export function authorizeUrl(args: { clientId: string; scope: string; state: string }): string {
  const url = new URL(`${TWITCH_ID}/authorize`)
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('redirect_uri', TWITCH_REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', args.scope)
  url.searchParams.set('state', args.state)
  // Always show the Twitch consent screen, so you can see which account is signing in.
  url.searchParams.set('force_verify', 'true')
  return url.toString()
}

export async function signInWithCode(args: {
  clientId: string
  clientSecret: string
  scope: string
  openExternal: (url: string) => Promise<void>
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: Fetch
  createReceiver?: () => Promise<LoopbackReceiver>
}): Promise<TwitchTokens> {
  const doFetch = args.fetchImpl ?? fetch
  const receiver = await (
    args.createReceiver ??
    (() =>
      startLoopbackReceiver({
        port: TWITCH_REDIRECT_PORT,
        path: TWITCH_REDIRECT_PATH,
        host: 'localhost',
        provider: 'Twitch'
      }))
  )()
  try {
    const state = randomBytes(24).toString('hex')
    await args.openExternal(authorizeUrl({ clientId: args.clientId, scope: args.scope, state }))
    const code = await receiver.waitForCode(state, {
      timeoutMs: args.timeoutMs ?? 5 * 60_000,
      ...(args.signal ? { signal: args.signal } : {})
    })
    const res = await postForm(doFetch, '/token', {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: TWITCH_REDIRECT_URI
    })
    if (!res.ok) {
      const message = await errorMessage(res)
      throw new UserFacingError(
        /invalid client secret/i.test(message)
          ? 'Twitch rejected the Client Secret. Copy it again from the Twitch developer console (Manage → New Secret) into Settings.'
          : `Twitch sign-in failed: ${message}`
      )
    }
    return toTokens(await res.json())
  } finally {
    receiver.close()
  }
}

export interface DeviceCodeStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAtMs: number
  intervalSec: number
}

export async function startDeviceFlow(args: {
  clientId: string
  scope: string
  fetchImpl?: Fetch
  now?: () => number
}): Promise<DeviceCodeStart> {
  const res = await postForm(args.fetchImpl ?? fetch, '/device', {
    client_id: args.clientId,
    scopes: args.scope
  })
  if (!res.ok)
    throw new UserFacingError(`Twitch device sign-in could not start: ${await errorMessage(res)}`)
  const json = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresAtMs: (args.now ?? Date.now)() + json.expires_in * 1000,
    intervalSec: Math.max(1, json.interval)
  }
}

/** Polls until the user finishes on twitch.tv/activate, the code expires, or it's canceled. */
export async function pollDeviceFlow(args: {
  clientId: string
  scope: string
  start: DeviceCodeStart
  signal?: AbortSignal
  fetchImpl?: Fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}): Promise<TwitchTokens> {
  const doFetch = args.fetchImpl ?? fetch
  const sleep = args.sleep ?? abortableSleep
  const now = args.now ?? Date.now
  let interval = args.start.intervalSec
  while (now() < args.start.expiresAtMs) {
    await sleep(interval * 1000, args.signal)
    const res = await postForm(doFetch, '/token', {
      client_id: args.clientId,
      scopes: args.scope,
      device_code: args.start.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
    if (res.ok) return toTokens(await res.json())
    const message = await errorMessage(res)
    if (/authorization_pending/i.test(message)) continue
    if (/slow_down/i.test(message)) {
      interval += 5
      continue
    }
    if (/invalid device code|expired/i.test(message)) break
    throw new UserFacingError(`Twitch sign-in failed: ${message}`)
  }
  throw new UserFacingError('The Twitch sign-in code expired. Click Connect again for a new one.')
}

export async function refreshTwitchToken(args: {
  clientId: string
  clientSecret: string | null
  refreshToken: string
  fetchImpl?: Fetch
}): Promise<TwitchTokens> {
  const form: Record<string, string> = {
    client_id: args.clientId,
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken
  }
  if (args.clientSecret) form['client_secret'] = args.clientSecret
  const res = await postForm(args.fetchImpl ?? fetch, '/token', form)
  if (!res.ok) throw new TwitchAuthError(res.status, await errorMessage(res))
  return toTokens(await res.json())
}

export interface ValidatedToken {
  userId: string
  login: string
  scopes: string[]
  expiresInSec: number
}

export async function validateTwitchToken(
  accessToken: string,
  fetchImpl?: Fetch
): Promise<ValidatedToken> {
  const res = await (fetchImpl ?? fetch)(`${TWITCH_ID}/validate`, {
    headers: { Authorization: `OAuth ${accessToken}` }
  })
  if (!res.ok) throw new TwitchAuthError(res.status, await errorMessage(res))
  const json = (await res.json()) as {
    user_id: string
    login: string
    scopes?: string[]
    expires_in: number
  }
  return {
    userId: json.user_id,
    login: json.login,
    scopes: json.scopes ?? [],
    expiresInSec: json.expires_in
  }
}

export async function revokeTwitchToken(
  clientId: string,
  token: string,
  fetchImpl?: Fetch
): Promise<void> {
  const res = await postForm(fetchImpl ?? fetch, '/revoke', { client_id: clientId, token })
  if (!res.ok) throw new TwitchAuthError(res.status, await errorMessage(res))
}
