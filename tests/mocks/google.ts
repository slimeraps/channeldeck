import { http, HttpResponse } from 'msw'

/**
 * A fake Google for tests: the OAuth token and revoke endpoints and the bits of the YouTube
 * Data API ChannelDeck calls. Tests change `state` to script behaviour.
 */

export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const YT = 'https://youtube.googleapis.com/youtube/v3'

export const BOTH_SCOPES =
  'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube'

export interface FakeChannel {
  id: string
  title: string
  handle?: string
}

export interface GoogleState {
  /** Channels returned by channels.list?mine=true, keyed by access token. */
  channelsByAccessToken: Map<string, FakeChannel[]>
  /** Scope string returned by the code exchange. */
  grantedScope: string
  /** Refresh token returned by the code exchange. */
  issuedRefreshToken: string | null
  /** Refresh tokens that Google now rejects with invalid_grant. */
  deadRefreshTokens: Set<string>
  /** If set, refreshing returns this new refresh token (rotation). */
  rotateTo: string | null
  /** Access token handed out by the next code exchange / refresh. */
  nextAccessToken: string
  tokenRequests: URLSearchParams[]
  revoked: string[]
  youtubeCalls: string[]
}

export function createGoogleState(): GoogleState {
  return {
    channelsByAccessToken: new Map(),
    grantedScope: BOTH_SCOPES,
    issuedRefreshToken: 'rt-initial',
    deadRefreshTokens: new Set(),
    rotateTo: null,
    nextAccessToken: 'at-1',
    tokenRequests: [],
    revoked: [],
    youtubeCalls: []
  }
}

function bearer(request: Request): string {
  return (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
}

export function googleHandlers(state: GoogleState) {
  return [
    http.post(TOKEN_URL, async ({ request }) => {
      const form = new URLSearchParams(await request.text())
      state.tokenRequests.push(form)
      const grant = form.get('grant_type')
      if (grant === 'authorization_code') {
        if (form.get('code') !== 'good-code' || !form.get('code_verifier')) {
          return HttpResponse.json({ error: 'invalid_grant' }, { status: 400 })
        }
        return HttpResponse.json({
          access_token: state.nextAccessToken,
          expires_in: 3599,
          token_type: 'Bearer',
          scope: state.grantedScope,
          ...(state.issuedRefreshToken ? { refresh_token: state.issuedRefreshToken } : {})
        })
      }
      if (grant === 'refresh_token') {
        const rt = form.get('refresh_token') ?? ''
        if (state.deadRefreshTokens.has(rt)) {
          return HttpResponse.json(
            { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
            { status: 400 }
          )
        }
        return HttpResponse.json({
          access_token: state.nextAccessToken,
          expires_in: 3599,
          token_type: 'Bearer',
          scope: state.grantedScope,
          ...(state.rotateTo ? { refresh_token: state.rotateTo } : {})
        })
      }
      return HttpResponse.json({ error: 'unsupported_grant_type' }, { status: 400 })
    }),

    http.post(REVOKE_URL, ({ request }) => {
      const token = new URL(request.url).searchParams.get('token') ?? ''
      state.revoked.push(token)
      return HttpResponse.json({})
    }),

    http.get(`${YT}/channels`, ({ request }) => {
      state.youtubeCalls.push('channels.list')
      const url = new URL(request.url)
      if (url.searchParams.get('mine') !== 'true') {
        return HttpResponse.json(
          { error: { code: 400, message: 'mine required' } },
          { status: 400 }
        )
      }
      const channels = state.channelsByAccessToken.get(bearer(request)) ?? []
      return HttpResponse.json({
        items: channels.map((c) => ({
          id: c.id,
          snippet: {
            title: c.title,
            customUrl: c.handle ?? null,
            thumbnails: { default: { url: `https://yt3.ggpht.com/${c.id}.jpg` } }
          },
          contentDetails: { relatedPlaylists: { uploads: `UU${c.id.slice(2)}` } }
        }))
      })
    }),

    http.get(`${YT}/videoCategories`, () => {
      state.youtubeCalls.push('videoCategories.list')
      return HttpResponse.json({
        items: [
          { id: '2', snippet: { title: 'Autos & Vehicles', assignable: true } },
          { id: '20', snippet: { title: 'Gaming', assignable: true } },
          { id: '18', snippet: { title: 'Short Movies', assignable: false } }
        ]
      })
    }),

    http.get(`${YT}/playlists`, ({ request }) => {
      state.youtubeCalls.push('playlists.list')
      const page = new URL(request.url).searchParams.get('pageToken')
      return HttpResponse.json(
        page === 'p2'
          ? {
              items: [
                {
                  id: 'PL2',
                  snippet: { title: 'Track days' },
                  contentDetails: { itemCount: 4 },
                  status: { privacyStatus: 'public' }
                }
              ]
            }
          : {
              items: [
                {
                  id: 'PL1',
                  snippet: { title: 'MW4 Day N' },
                  contentDetails: { itemCount: 8 },
                  status: { privacyStatus: 'public' }
                }
              ],
              nextPageToken: 'p2'
            }
      )
    })
  ]
}
