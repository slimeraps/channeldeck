import { http, HttpResponse } from 'msw'

/**
 * A fake Twitch for tests: the id.twitch.tv OAuth endpoints and the Helix endpoints the clip
 * bank uses. It behaves like the real API where it matters: Get Clips is ordered by views
 * and capped at 1,000 results per query, pages of `first` with a cursor, rate-limit headers.
 */

export const ID = 'https://id.twitch.tv/oauth2'
export const HELIX_URL = 'https://api.twitch.tv/helix'
export const CDN = 'https://clips-cdn.test'

export interface FakeClip {
  id: string
  broadcaster_id: string
  title: string
  view_count: number
  created_at: string
  duration: number
  game_id: string
  creator_name: string
  is_featured: boolean
  vod_offset: number | null
  /** Download availability. */
  landscape: boolean
  portrait: boolean
  /** Left out of Get Clips Download entirely (no access / deleted). */
  omitFromDownloads?: boolean
}

export interface TwitchState {
  users: {
    id: string
    login: string
    display_name: string
    profile_image_url: string
    created_at: string
  }[]
  games: Map<string, string>
  clips: FakeClip[]
  /** user id → broadcaster ids they're an editor of. */
  editors: Map<string, string[]>
  /** refresh token → user id (rotates on each refresh). */
  refreshTokens: Map<string, string>
  /** access token → user id. */
  accessTokens: Map<string, { userId: string; scopes: string[] }>
  nextToken: number
  /** Respond 429 to the next N helix calls. */
  rateLimitNext: number
  /** Who the next authorization-code sign-in belongs to, and what it grants. */
  codeGrant: { userId: string; scopes: string[] }
  /** Device flow: polls answered "authorization_pending" before success. */
  devicePendingPolls: number
  clipQueries: { started_at: string; ended_at: string; after: string | null }[]
  downloadRequests: string[][]
  requests: string[]
}

export function createTwitchState(): TwitchState {
  return {
    users: [
      {
        id: '1001',
        login: 'helmsyy',
        display_name: 'Helmsy',
        profile_image_url: 'https://static-cdn.jtvnw.net/jtv_user_pictures/helmsy.png',
        created_at: '2026-10-01T00:00:00Z'
      },
      {
        id: '2002',
        login: 'otherstreamer',
        display_name: 'OtherStreamer',
        profile_image_url: '',
        created_at: '2025-01-01T00:00:00Z'
      }
    ],
    games: new Map([
      ['111', 'MechWarrior 4'],
      ['222', 'Assetto Corsa']
    ]),
    clips: [],
    editors: new Map(),
    refreshTokens: new Map(),
    accessTokens: new Map(),
    nextToken: 1,
    rateLimitNext: 0,
    codeGrant: { userId: '1001', scopes: ['channel:manage:clips'] },
    devicePendingPolls: 1,
    clipQueries: [],
    downloadRequests: [],
    requests: []
  }
}

/** Mints a token pair for a user (what a successful sign-in would give). */
export function issueTokens(state: TwitchState, userId: string, scopes: string[]) {
  const n = state.nextToken++
  const access = `at-${n}`
  const refresh = `rt-${n}`
  state.accessTokens.set(access, { userId, scopes })
  state.refreshTokens.set(refresh, userId)
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 14400,
    scope: scopes,
    token_type: 'bearer'
  }
}

/** Generates `count` clips spread evenly between two dates. */
export function makeClips(
  broadcasterId: string,
  count: number,
  fromIso: string,
  toIso: string,
  prefix = 'clip'
): FakeClip[] {
  const from = Date.parse(fromIso)
  const span = Date.parse(toIso) - from
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    broadcaster_id: broadcasterId,
    title: `Clip ${prefix} ${i}`,
    view_count: (i * 37) % 500,
    created_at: new Date(Math.floor((from + (span * i) / count) / 1000) * 1000)
      .toISOString()
      .replace('.000Z', 'Z'),
    duration: 15 + (i % 45),
    game_id: i % 2 ? '111' : '222',
    creator_name: 'clipperdude',
    is_featured: i % 10 === 0,
    vod_offset: null,
    landscape: true,
    portrait: i % 3 === 0
  }))
}

function bearerUser(
  state: TwitchState,
  request: Request
): { userId: string; scopes: string[] } | null {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  return state.accessTokens.get(token) ?? null
}

const rateHeaders = {
  'Ratelimit-Limit': '800',
  'Ratelimit-Remaining': '799',
  'Ratelimit-Reset': '0'
}

export function twitchHandlers(state: TwitchState) {
  const helixGuard = (request: Request): Response | { userId: string; scopes: string[] } => {
    state.requests.push(new URL(request.url).pathname)
    if (!request.headers.get('client-id'))
      return HttpResponse.json({ message: 'Client-Id required' }, { status: 400 })
    if (state.rateLimitNext > 0) {
      state.rateLimitNext -= 1
      return HttpResponse.json(
        { message: 'Too Many Requests' },
        {
          status: 429,
          headers: {
            'Ratelimit-Remaining': '0',
            'Ratelimit-Reset': String(Math.floor(Date.now() / 1000) + 1)
          }
        }
      )
    }
    const who = bearerUser(state, request)
    if (!who) return HttpResponse.json({ message: 'Invalid OAuth token' }, { status: 401 })
    return who
  }

  return [
    // ---- OAuth ----
    http.post(`${ID}/token`, async ({ request }) => {
      const form = new URLSearchParams(await request.text())
      const grant = form.get('grant_type')
      if (grant === 'authorization_code') {
        if (form.get('code') !== 'good-code')
          return HttpResponse.json({ message: 'Invalid authorization code' }, { status: 400 })
        if (!form.get('client_secret'))
          return HttpResponse.json({ message: 'missing client secret' }, { status: 400 })
        return HttpResponse.json(issueTokens(state, state.codeGrant.userId, state.codeGrant.scopes))
      }
      if (grant === 'refresh_token') {
        const old = form.get('refresh_token') ?? ''
        const userId = state.refreshTokens.get(old)
        if (!userId)
          return HttpResponse.json(
            { status: 400, message: 'Invalid refresh token' },
            { status: 400 }
          )
        state.refreshTokens.delete(old) // rotate: old one is used up
        const scopes =
          [...state.accessTokens.values()].find((t) => t.userId === userId)?.scopes ?? []
        return HttpResponse.json(issueTokens(state, userId, scopes))
      }
      if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (state.devicePendingPolls > 0) {
          state.devicePendingPolls -= 1
          return HttpResponse.json(
            { status: 400, message: 'authorization_pending' },
            { status: 400 }
          )
        }
        const scopes = (form.get('scopes') ?? '').split(' ')
        return HttpResponse.json(issueTokens(state, '1001', scopes))
      }
      return HttpResponse.json({ message: 'unsupported grant' }, { status: 400 })
    }),

    http.post(`${ID}/device`, async ({ request }) => {
      const form = new URLSearchParams(await request.text())
      if (!form.get('client_id'))
        return HttpResponse.json({ message: 'missing client id' }, { status: 400 })
      return HttpResponse.json({
        device_code: 'dev-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH',
        expires_in: 1800,
        interval: 5
      })
    }),

    http.get(`${ID}/validate`, ({ request }) => {
      const token = (request.headers.get('authorization') ?? '').replace(/^OAuth\s+/i, '')
      const info = state.accessTokens.get(token)
      if (!info)
        return HttpResponse.json({ status: 401, message: 'invalid access token' }, { status: 401 })
      const user = state.users.find((u) => u.id === info.userId)
      return HttpResponse.json({
        client_id: 'cid',
        login: user?.login,
        scopes: info.scopes,
        user_id: info.userId,
        expires_in: 14000
      })
    }),

    http.post(`${ID}/revoke`, () => new HttpResponse(null, { status: 200 })),

    // ---- Helix ----
    http.get(`${HELIX_URL}/users`, ({ request }) => {
      const g = helixGuard(request)
      if (g instanceof Response) return g
      const url = new URL(request.url)
      const ids = url.searchParams.getAll('id')
      const logins = url.searchParams.getAll('login')
      return HttpResponse.json(
        { data: state.users.filter((u) => ids.includes(u.id) || logins.includes(u.login)) },
        { headers: rateHeaders }
      )
    }),

    http.get(`${HELIX_URL}/games`, ({ request }) => {
      const g = helixGuard(request)
      if (g instanceof Response) return g
      const ids = new URL(request.url).searchParams.getAll('id')
      return HttpResponse.json(
        {
          data: ids
            .filter((id) => state.games.has(id))
            .map((id) => ({ id, name: state.games.get(id), box_art_url: '' }))
        },
        { headers: rateHeaders }
      )
    }),

    http.get(`${HELIX_URL}/clips`, ({ request }) => {
      const g = helixGuard(request)
      if (g instanceof Response) return g
      const url = new URL(request.url)
      const broadcaster = url.searchParams.get('broadcaster_id')
      const started = url.searchParams.get('started_at') ?? ''
      const ended = url.searchParams.get('ended_at') ?? ''
      const after = url.searchParams.get('after')
      const first = Number(url.searchParams.get('first') ?? 20)
      state.clipQueries.push({ started_at: started, ended_at: ended, after })
      // Real API: ordered by views (desc), and only ~1,000 results per query in total.
      const matching = state.clips
        .filter((c) => {
          const at = Date.parse(c.created_at)
          return (
            c.broadcaster_id === broadcaster && at >= Date.parse(started) && at < Date.parse(ended)
          )
        })
        .sort((a, b) => b.view_count - a.view_count || a.id.localeCompare(b.id))
        .slice(0, 1000)
      const offset = after ? Number(after) : 0
      const page = matching.slice(offset, offset + first)
      const next = offset + first < matching.length ? String(offset + first) : null
      return HttpResponse.json(
        {
          data: page.map((c) => ({
            id: c.id,
            url: `https://clips.twitch.tv/${c.id}`,
            embed_url: '',
            broadcaster_id: c.broadcaster_id,
            broadcaster_name: '',
            creator_id: '9',
            creator_name: c.creator_name,
            video_id: '',
            game_id: c.game_id,
            language: 'en',
            title: c.title,
            view_count: c.view_count,
            created_at: c.created_at,
            thumbnail_url: `${CDN}/thumbs/${c.id}.jpg`,
            duration: c.duration,
            vod_offset: c.vod_offset,
            is_featured: c.is_featured
          })),
          pagination: next ? { cursor: next } : {}
        },
        { headers: rateHeaders }
      )
    }),

    http.get(`${HELIX_URL}/clips/downloads`, ({ request }) => {
      const g = helixGuard(request)
      if (g instanceof Response) return g
      const url = new URL(request.url)
      const editorId = url.searchParams.get('editor_id') ?? ''
      const broadcasterId = url.searchParams.get('broadcaster_id') ?? ''
      const ids = url.searchParams.getAll('clip_id')
      state.downloadRequests.push(ids)
      if (editorId !== g.userId)
        return HttpResponse.json({ message: 'editor_id must match the token' }, { status: 400 })
      const isEditor =
        editorId === broadcasterId || (state.editors.get(editorId) ?? []).includes(broadcasterId)
      if (!isEditor) return HttpResponse.json({ message: 'user is not an editor' }, { status: 403 })
      return HttpResponse.json(
        {
          data: state.clips
            .filter(
              (c) =>
                ids.includes(c.id) && c.broadcaster_id === broadcasterId && !c.omitFromDownloads
            )
            .map((c) => ({
              clip_id: c.id,
              landscape_download_url: c.landscape ? `${CDN}/files/${c.id}-landscape.mp4` : null,
              portrait_download_url: c.portrait ? `${CDN}/files/${c.id}-portrait.mp4` : null
            }))
        },
        { headers: rateHeaders }
      )
    }),

    // ---- CDN ----
    http.get(
      `${CDN}/files/:name`,
      ({ params }) =>
        new HttpResponse(Buffer.from(`fake mp4 bytes for ${String(params['name'])}`), {
          headers: { 'Content-Type': 'video/mp4' }
        })
    ),
    http.get(
      `${CDN}/thumbs/:name`,
      () =>
        new HttpResponse(Buffer.from([0xff, 0xd8, 0xff]), {
          headers: { 'Content-Type': 'image/jpeg' }
        })
    )
  ]
}
