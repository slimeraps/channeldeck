import { http, HttpResponse } from 'msw'

/**
 * A fake Google for tests: the OAuth token and revoke endpoints and the bits of the YouTube
 * Data API ChannelDeck calls. Tests change `state` to script behaviour.
 */

export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const YT = 'https://youtube.googleapis.com/youtube/v3'
export const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos'
export const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos/session'
export const THUMBNAILS = 'https://youtube.googleapis.com/upload/youtube/v3/thumbnails/set'

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
  /** Every request to a Google host (Dry Run asserts this stays empty). */
  allGoogleRequests: string[]
  // --- uploads ---
  /** Metadata sent when each resumable session started. */
  uploadStarts: { resource: Record<string, unknown>; query: Record<string, string>; size: number }[]
  /** Bytes received per session id. */
  received: Map<string, number>
  /** Reason for an error on the next session start (e.g. quotaExceeded). */
  failStartWith: { status: number; reason: string } | null
  /** Make the next N body PUTs die after receiving this many bytes (simulated drop). */
  dropPutsAfterBytes: { count: number; bytes: number } | null
  /** When a PUT is dropped, also expire the session (status queries then get 404). */
  expireSessionOnDrop: boolean
  /** privacyStatus YouTube reports back (default: what was requested). */
  forcePrivacy: string | null
  nextVideoId: number
  thumbnails: { videoId: string; bytes: number }[]
  /** Errors to return for the next thumbnail calls, in order. */
  thumbnailErrors: { status: number; reason: string }[]
  playlistInserts: { playlistId: string; videoId: string }[]
  // --- videos on "YouTube" (for list / update / delete) ---
  videos: Map<
    string,
    { status: Record<string, unknown>; processingDetails: Record<string, unknown> }
  >
  /** Ids asked for in each videos.list call. */
  videosListCalls: string[][]
  videoUpdates: { id: string; status: Record<string, unknown> }[]
  videoDeletes: string[]
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
    youtubeCalls: [],
    allGoogleRequests: [],
    uploadStarts: [],
    received: new Map(),
    failStartWith: null,
    dropPutsAfterBytes: null,
    expireSessionOnDrop: false,
    forcePrivacy: null,
    nextVideoId: 1,
    thumbnails: [],
    thumbnailErrors: [],
    playlistInserts: [],
    videos: new Map(),
    videosListCalls: [],
    videoUpdates: [],
    videoDeletes: []
  }
}

function bearer(request: Request): string {
  return (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
}

const apiError = (status: number, reason: string) =>
  HttpResponse.json(
    { error: { code: status, message: reason, errors: [{ reason, message: reason }] } },
    { status }
  )

export function googleHandlers(state: GoogleState) {
  return [
    // --- resumable video upload ---
    http.post(UPLOAD, async ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('uploadType') !== 'resumable') return apiError(400, 'badRequest')
      if (state.failStartWith) {
        const { status, reason } = state.failStartWith
        state.failStartWith = null
        return apiError(status, reason)
      }
      const size = Number(request.headers.get('x-upload-content-length'))
      state.uploadStarts.push({
        resource: (await request.json()) as Record<string, unknown>,
        query: Object.fromEntries(url.searchParams),
        size
      })
      const id = `s${state.uploadStarts.length}`
      state.received.set(id, 0)
      return new HttpResponse(null, {
        status: 200,
        headers: { Location: `${SESSION}/${id}?size=${size}` }
      })
    }),

    http.put(`${SESSION}/:id`, async ({ request, params }) => {
      const id = String(params['id'])
      const size = Number(new URL(request.url).searchParams.get('size'))
      if (!state.received.has(id)) return new HttpResponse(null, { status: 404 })
      const have = state.received.get(id) ?? 0
      const range = request.headers.get('content-range')

      // Status query: "bytes */SIZE"
      if (range?.startsWith('bytes */')) {
        if (have >= size) return finish()
        return new HttpResponse(null, {
          status: 308,
          headers: have > 0 ? { Range: `bytes=0-${have - 1}` } : {}
        })
      }

      const start = range ? Number(/bytes (\d+)-/.exec(range)?.[1]) : 0
      if (start !== have) return apiError(400, 'badContentRange')
      const body = new Uint8Array(await request.arrayBuffer())
      if (state.dropPutsAfterBytes && state.dropPutsAfterBytes.count > 0) {
        state.dropPutsAfterBytes.count -= 1
        state.received.set(id, have + Math.min(body.byteLength, state.dropPutsAfterBytes.bytes))
        if (state.expireSessionOnDrop) state.received.delete(id)
        return new HttpResponse(null, { status: 503 })
      }
      state.received.set(id, have + body.byteLength)
      if (have + body.byteLength < size) return new HttpResponse(null, { status: 308 })
      return finish()

      function finish(): Response {
        const started = state.uploadStarts[Number(id.slice(1)) - 1]
        const status = (started?.resource['status'] ?? {}) as Record<string, unknown>
        const videoId = `vid${state.nextVideoId++}`
        state.videos.set(videoId, {
          status: {
            ...status,
            privacyStatus: state.forcePrivacy ?? status['privacyStatus'],
            uploadStatus: 'uploaded',
            license: status['license'] ?? 'youtube',
            embeddable: status['embeddable'] ?? true,
            publicStatsViewable: true,
            madeForKids: status['selfDeclaredMadeForKids'] ?? false
          },
          processingDetails: { processingStatus: 'processing' }
        })
        return HttpResponse.json(
          {
            id: videoId,
            status: {
              ...status,
              privacyStatus: state.forcePrivacy ?? status['privacyStatus'],
              uploadStatus: 'uploaded'
            }
          },
          { status: 201 }
        )
      }
    }),

    // --- thumbnails.set (media upload through googleapis) ---
    http.post(THUMBNAILS, async ({ request }) => {
      const failure = state.thumbnailErrors.shift()
      if (failure) return apiError(failure.status, failure.reason)
      const videoId = new URL(request.url).searchParams.get('videoId') ?? ''
      state.thumbnails.push({ videoId, bytes: (await request.arrayBuffer()).byteLength })
      return HttpResponse.json({ items: [{ default: { url: 'https://i.ytimg.com/x.jpg' } }] })
    }),

    // --- videos.list / videos.update / videos.delete ---
    http.get(`${YT}/videos`, ({ request }) => {
      const url = new URL(request.url)
      const ids = url.searchParams
        .getAll('id')
        .flatMap((v) => v.split(','))
        .filter(Boolean)
      const parts = url.searchParams.getAll('part').flatMap((v) => v.split(','))
      state.videosListCalls.push(ids)
      if (ids.length > 50) return apiError(400, 'tooManyIds')
      return HttpResponse.json({
        items: ids
          .filter((id) => state.videos.has(id))
          .map((id) => {
            const v = state.videos.get(id)!
            return {
              id,
              ...(parts.includes('status') ? { status: v.status } : {}),
              ...(parts.includes('processingDetails')
                ? { processingDetails: v.processingDetails }
                : {})
            }
          })
      })
    }),

    http.put(`${YT}/videos`, async ({ request }) => {
      const part = new URL(request.url).searchParams.getAll('part').join(',')
      const body = (await request.json()) as { id: string; status: Record<string, unknown> }
      if (!state.videos.has(body.id)) return apiError(404, 'videoNotFound')
      if (part !== 'status') return apiError(400, 'unexpectedPart')
      state.videoUpdates.push({ id: body.id, status: body.status })
      const v = state.videos.get(body.id)!
      // Like YouTube: the part you send replaces the mutable fields (omitted = cleared).
      const readOnly = {
        uploadStatus: v.status['uploadStatus'],
        madeForKids: v.status['madeForKids']
      }
      v.status = { ...readOnly, ...body.status }
      return HttpResponse.json({ id: body.id, status: v.status })
    }),

    http.delete(`${YT}/videos`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!state.videos.has(id)) return apiError(404, 'videoNotFound')
      state.videos.delete(id)
      state.videoDeletes.push(id)
      return new HttpResponse(null, { status: 204 })
    }),

    // --- playlistItems.insert ---
    http.post(`${YT}/playlistItems`, async ({ request }) => {
      const body = (await request.json()) as {
        snippet: { playlistId: string; resourceId: { videoId: string } }
      }
      state.playlistInserts.push({
        playlistId: body.snippet.playlistId,
        videoId: body.snippet.resourceId.videoId
      })
      return HttpResponse.json({ id: 'pli1' })
    }),

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
