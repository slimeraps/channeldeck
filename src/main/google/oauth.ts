import { randomBytes } from 'node:crypto'
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import { UserFacingError } from '../errors'
import type { GoogleClientConfig } from './clientConfig'
import { type LoopbackReceiver, startLoopbackReceiver } from './loopback'

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube'
] as const

export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export interface SignInDeps {
  config: GoogleClientConfig
  /** Opens the URL in the system browser (shell.openExternal in the app). */
  openExternal: (url: string) => Promise<void>
  signal?: AbortSignal
  timeoutMs?: number
  createReceiver?: () => Promise<LoopbackReceiver>
}

export interface SignInResult {
  /** An authorized client (access token set) for calling channels.list right away. */
  client: OAuth2Client
  refreshToken: string
}

/**
 * Google's OAuth flow for installed apps: loopback redirect on 127.0.0.1 (random port),
 * PKCE S256, system browser, access_type=offline + prompt=consent so a refresh token is
 * always returned. `select_account` makes Google show the account / brand-account picker
 * every time, which is how a second channel gets added.
 */
export async function signInWithGoogle({
  config,
  openExternal,
  signal,
  timeoutMs = SIGN_IN_TIMEOUT_MS,
  createReceiver = startLoopbackReceiver
}: SignInDeps): Promise<SignInResult> {
  const receiver = await createReceiver()
  try {
    const client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: receiver.redirectUri
    })
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
    if (!codeChallenge) throw new Error('PKCE code challenge was not generated')
    const state = randomBytes(24).toString('hex')

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account consent',
      scope: [...YOUTUBE_SCOPES],
      code_challenge_method: CodeChallengeMethod.S256,
      code_challenge: codeChallenge,
      state
    })

    await openExternal(authUrl)
    const code = await receiver.waitForCode(state, { timeoutMs, signal })

    const { tokens } = await client.getToken({
      code,
      codeVerifier,
      redirect_uri: receiver.redirectUri
    })

    const granted = new Set((tokens.scope ?? '').split(/\s+/).filter(Boolean))
    const missing = YOUTUBE_SCOPES.filter((scope) => !granted.has(scope))
    if (missing.length > 0) {
      throw new UserFacingError(
        'ChannelDeck needs both YouTube permissions (manage your YouTube account, and upload videos). Click Add channel again and leave both boxes ticked.'
      )
    }
    if (!tokens.refresh_token) {
      throw new UserFacingError(
        "Google didn't return a long-lived sign-in token. Click Add channel again; if it keeps happening, remove ChannelDeck's access at myaccount.google.com/permissions first."
      )
    }

    client.setCredentials(tokens)
    return { client, refreshToken: tokens.refresh_token }
  } finally {
    receiver.close()
  }
}
