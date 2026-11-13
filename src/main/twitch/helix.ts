import { abortableSleep } from '../jobs/retry'

/**
 * A small typed client for the Twitch Helix endpoints ChannelDeck uses.
 * https://dev.twitch.tv/docs/api/reference (checked 2026-11-12)
 *
 * Every call sends Client-Id and a Bearer user token. Rate limits: reads Ratelimit-Remaining
 * / Ratelimit-Reset (epoch seconds), waits before the bucket empties, and waits until the
 * reset on 429. A 401 refreshes the token once; 5xx retries with backoff.
 */

export const HELIX = 'https://api.twitch.tv/helix'

export class TwitchHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'TwitchHttpError'
    this.status = status
  }
}

export interface TwitchUser {
  id: string
  login: string
  display_name: string
  profile_image_url: string
  created_at: string
}

export interface TwitchGame {
  id: string
  name: string
  box_art_url: string
}

export interface TwitchClip {
  id: string
  url: string
  embed_url: string
  broadcaster_id: string
  broadcaster_name: string
  creator_id: string
  creator_name: string
  video_id: string
  game_id: string
  language: string
  title: string
  view_count: number
  created_at: string
  thumbnail_url: string
  duration: number
  vod_offset: number | null
  is_featured: boolean
}

export interface ClipDownloadUrls {
  clip_id: string
  landscape_download_url: string | null
  portrait_download_url: string | null
}

export interface HelixDeps {
  clientId: string
  /** Current access token; `forceRefresh` after a 401. */
  getToken: (forceRefresh: boolean) => Promise<string>
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  signal?: AbortSignal
}

export interface Helix {
  getUsers(query: { ids?: string[]; logins?: string[] }): Promise<TwitchUser[]>
  getGames(ids: string[]): Promise<TwitchGame[]>
  /** One page of clips for a broadcaster in [startedAt, endedAt). */
  getClipsPage(query: {
    broadcasterId: string
    startedAt: string
    endedAt: string
    after?: string
  }): Promise<{ clips: TwitchClip[]; cursor: string | null }>
  getClipDownloads(query: {
    editorId: string
    broadcasterId: string
    clipIds: string[]
  }): Promise<ClipDownloadUrls[]>
}

const MAX_ATTEMPTS = 5

export function createHelix(deps: HelixDeps): Helix {
  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? abortableSleep
  const now = deps.now ?? (() => Date.now())
  let remaining: number | null = null
  let resetAtMs: number | null = null

  async function request<T>(path: string, params: [string, string][]): Promise<T> {
    const url = new URL(`${HELIX}${path}`)
    for (const [k, v] of params) url.searchParams.append(k, v)

    let forceRefresh = false
    for (let attempt = 1; ; attempt++) {
      // Nearly out of points: wait for the bucket to refill instead of getting a 429.
      if (remaining !== null && remaining <= 1 && resetAtMs !== null && resetAtMs > now()) {
        await sleep(resetAtMs - now() + 250, deps.signal)
      }
      const token = await deps.getToken(forceRefresh)
      let res: Response
      try {
        res = await doFetch(url, {
          headers: { 'Client-Id': deps.clientId, Authorization: `Bearer ${token}` },
          signal: deps.signal ?? null
        })
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || deps.signal?.aborted) throw error
        await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)), deps.signal)
        continue
      }

      const rem = res.headers.get('ratelimit-remaining')
      const reset = res.headers.get('ratelimit-reset')
      if (rem !== null) remaining = Number(rem)
      if (reset !== null) resetAtMs = Number(reset) * 1000

      if (res.ok) return (await res.json()) as T

      const body = (await res.json().catch(() => null)) as { message?: string } | null
      const message = body?.message ?? `Twitch returned HTTP ${res.status}`

      if (res.status === 401 && !forceRefresh) {
        forceRefresh = true
        continue
      }
      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        const wait =
          resetAtMs !== null && resetAtMs > now() ? resetAtMs - now() + 250 : 2000 * attempt
        await sleep(wait, deps.signal)
        continue
      }
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)), deps.signal)
        continue
      }
      throw new TwitchHttpError(res.status, message)
    }
  }

  return {
    async getUsers({ ids = [], logins = [] }) {
      if (ids.length + logins.length === 0) return []
      const params: [string, string][] = [
        ...ids.map((id): [string, string] => ['id', id]),
        ...logins.map((l): [string, string] => ['login', l.toLowerCase()])
      ]
      return (await request<{ data: TwitchUser[] }>('/users', params)).data
    },

    async getGames(ids) {
      const unique = [...new Set(ids.filter(Boolean))]
      const out: TwitchGame[] = []
      for (let i = 0; i < unique.length; i += 100) {
        const batch = unique.slice(i, i + 100)
        out.push(
          ...(
            await request<{ data: TwitchGame[] }>(
              '/games',
              batch.map((id) => ['id', id])
            )
          ).data
        )
      }
      return out
    },

    async getClipsPage({ broadcasterId, startedAt, endedAt, after }) {
      const params: [string, string][] = [
        ['broadcaster_id', broadcasterId],
        ['started_at', startedAt],
        ['ended_at', endedAt],
        ['first', '100']
      ]
      if (after) params.push(['after', after])
      const res = await request<{ data: TwitchClip[]; pagination?: { cursor?: string } }>(
        '/clips',
        params
      )
      return { clips: res.data, cursor: res.pagination?.cursor || null }
    },

    async getClipDownloads({ editorId, broadcasterId, clipIds }) {
      if (clipIds.length === 0) return []
      if (clipIds.length > 10) throw new Error('Get Clips Download takes at most 10 clip ids')
      const params: [string, string][] = [
        ['editor_id', editorId],
        ['broadcaster_id', broadcasterId],
        ...clipIds.map((id): [string, string] => ['clip_id', id])
      ]
      return (await request<{ data: ClipDownloadUrls[] }>('/clips/downloads', params)).data
    }
  }
}
