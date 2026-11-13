import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, seedClip, seedTwitchAccount, type TestDb } from '../../../tests/helpers/db'
import { createGoogleState, type GoogleState, googleHandlers } from '../../../tests/mocks/google'
import { DuplicateError } from '../db/repos/common'
import type { ClientConfigStore, GoogleClientConfig } from '../google/clientConfig'
import { createSecretBox, type SafeStorageLike } from '../secrets/secretBox'
import { createYouTubeAccountsService, type YouTubeAccountsService } from './youtubeAccounts'

// --- fakes ---------------------------------------------------------------------------------

const google = createGoogleState()
const server = setupServer(...googleHandlers(google))

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }))
afterAll(() => server.close())

function fakeStorage(): SafeStorageLike {
  const xor = (b: Buffer): Buffer => Buffer.from(b.map((x) => x ^ 0x5a))
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => xor(Buffer.from(s, 'utf8')),
    decryptString: (b) => xor(b).toString('utf8')
  }
}

const CONFIG: GoogleClientConfig = {
  clientId: '1234567890-abc.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-test',
  projectId: 'channeldeck-test'
}

function memoryClientConfig(initial: GoogleClientConfig | null = CONFIG): ClientConfigStore {
  let config = initial
  return {
    load: () => config,
    save: () => {
      throw new Error('not used')
    },
    remove: () => {
      config = null
    }
  }
}

type BrowserBehaviour = 'approve' | 'deny' | 'wrong-state-then-approve' | 'ignore'

/** Plays the user's browser: checks the auth URL, then hits the loopback redirect. */
function fakeBrowser(state: { behaviour: BrowserBehaviour; lastUrl: URL | null }) {
  return async (raw: string): Promise<void> => {
    const url = new URL(raw)
    state.lastUrl = url
    const redirect = url.searchParams.get('redirect_uri') ?? ''
    const oauthState = url.searchParams.get('state') ?? ''
    const hit = (query: string): Promise<Response> => fetch(`${redirect}/?${query}`)
    // Run after openExternal returns, like a real browser would.
    setTimeout(() => {
      void (async () => {
        if (state.behaviour === 'ignore') return
        if (state.behaviour === 'deny') {
          await hit(`error=access_denied&state=${oauthState}`)
          return
        }
        if (state.behaviour === 'wrong-state-then-approve') {
          const bad = await hit(`code=good-code&state=not-the-state`)
          expect(bad.status).toBe(400)
        }
        const ok = await hit(`code=good-code&state=${oauthState}&scope=x`)
        expect(ok.status).toBe(200)
      })()
    }, 5)
  }
}

let t: TestDb
let service: YouTubeAccountsService
let browser: { behaviour: BrowserBehaviour; lastUrl: URL | null }
let notify: ReturnType<typeof vi.fn<(title: string, body: string) => void>>
let emitChanged: ReturnType<typeof vi.fn<() => void>>
const secrets = createSecretBox(fakeStorage())

function resetGoogle(g: GoogleState): void {
  Object.assign(g, createGoogleState())
}

beforeEach(() => {
  resetGoogle(google)
  google.channelsByAccessToken.set('at-1', [
    { id: 'UCdrift', title: 'Drift Channel', handle: '@drift' }
  ])
  t = createTestDb()
  browser = { behaviour: 'approve', lastUrl: null }
  notify = vi.fn()
  emitChanged = vi.fn()
  service = createYouTubeAccountsService({
    repos: t.repos,
    secrets,
    clientConfig: memoryClientConfig(),
    openExternal: fakeBrowser(browser),
    notify,
    emitChanged,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    clock: t.clock,
    signInTimeoutMs: 2000
  })
})

afterEach(() => t.close())

// --- tests ---------------------------------------------------------------------------------

describe('adding a channel', () => {
  it('signs in with PKCE on a loopback port and stores one encrypted account per channel', async () => {
    const [view] = await service.addChannel()

    const url = browser.lastUrl
    expect(url?.origin).toBe('https://accounts.google.com')
    expect(url?.searchParams.get('access_type')).toBe('offline')
    expect(url?.searchParams.get('prompt')).toContain('consent')
    expect(url?.searchParams.get('prompt')).toContain('select_account')
    expect(url?.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url?.searchParams.get('code_challenge')).toBeTruthy()
    expect(url?.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(url?.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload'
    ])

    // The code exchange sent the PKCE verifier.
    expect(google.tokenRequests[0]?.get('code_verifier')).toBeTruthy()

    expect(view).toMatchObject({
      channelId: 'UCdrift',
      channelTitle: 'Drift Channel',
      channelHandle: '@drift',
      tokenStatus: 'ok',
      enabled: true
    })
    expect(view).not.toHaveProperty('encRefreshToken')

    const row = t.repos.accounts.getByChannelId('UCdrift')
    expect(row?.encRefreshToken).toBeInstanceOf(Buffer)
    expect(row?.encRefreshToken?.toString('utf8')).not.toContain('rt-initial')
    expect(secrets.decrypt(row!.encRefreshToken!)).toBe('rt-initial')

    // channels.list was logged against today's Pacific quota day.
    expect(t.repos.quota.totalsForDay('2026-11-12')).toEqual({ uploadCalls: 0, units: 1 })
    expect(emitChanged).toHaveBeenCalled()
  })

  it('rejects a channel that is already connected', async () => {
    await service.addChannel()
    await expect(service.addChannel()).rejects.toThrow(DuplicateError)
    expect(t.repos.accounts.list()).toHaveLength(1)
  })

  it('gives each new channel its own calendar color', async () => {
    await service.addChannel()
    google.nextAccessToken = 'at-2'
    google.channelsByAccessToken.set('at-2', [{ id: 'UCgaming', title: 'Gaming Channel' }])
    await service.addChannel()
    const colors = t.repos.accounts.list().map((a) => a.color)
    expect(new Set(colors).size).toBe(2)
  })

  it('explains when the Google account has no channel', async () => {
    google.channelsByAccessToken.set('at-1', [])
    await expect(service.addChannel()).rejects.toThrow(/doesn't have a YouTube channel/)
    expect(t.repos.accounts.list()).toHaveLength(0)
  })

  it('requires both YouTube scopes', async () => {
    google.grantedScope = 'https://www.googleapis.com/auth/youtube'
    await expect(service.addChannel()).rejects.toThrow(/both YouTube permissions/)
  })

  it('handles the user declining in the browser', async () => {
    browser.behaviour = 'deny'
    await expect(service.addChannel()).rejects.toThrow(/declined access/)
  })

  it('ignores a callback with the wrong state and keeps waiting for the real one', async () => {
    browser.behaviour = 'wrong-state-then-approve'
    await expect(service.addChannel()).resolves.toHaveLength(1)
  })

  it('can be canceled while waiting for the browser', async () => {
    browser.behaviour = 'ignore'
    const pending = service.addChannel()
    await vi.waitFor(() => expect(browser.lastUrl).not.toBeNull())
    expect(service.cancelSignIn()).toBe(true)
    await expect(pending).rejects.toThrow(/canceled/)
    expect(service.cancelSignIn()).toBe(false)
  })

  it('refuses to start without an imported client file', async () => {
    const svc = createYouTubeAccountsService({
      repos: t.repos,
      secrets,
      clientConfig: memoryClientConfig(null),
      openExternal: fakeBrowser(browser),
      notify,
      emitChanged,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await expect(svc.addChannel()).rejects.toThrow(/Import your Google client file/)
    expect(svc.getClientStatus()).toMatchObject({ configured: false })
  })
})

describe('expired sign-ins', () => {
  it('marks the channel "needs re-auth" on invalid_grant, notifies once, and stops calling Google', async () => {
    const [view] = await service.addChannel()
    google.deadRefreshTokens.add('rt-initial')

    await expect(service.refreshInfo(view!.id)).rejects.toThrow(/expired or was revoked/)

    const row = t.repos.accounts.require(view!.id)
    expect(row.tokenStatus).toBe('needs_reauth')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe('YouTube sign-in needed')
    expect(t.repos.eventLog.recent({ kind: 'account.needs_reauth' })).toHaveLength(1)

    // Paused: further calls fail fast without touching the network.
    const callsBefore = google.tokenRequests.length
    await expect(service.refreshInfo(view!.id)).rejects.toThrow(/Click Reconnect/)
    expect(google.tokenRequests.length).toBe(callsBefore)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('reconnect stores a fresh token and clears the flag', async () => {
    const [view] = await service.addChannel()
    t.repos.accounts.setTokenStatus(view!.id, 'needs_reauth')
    google.issuedRefreshToken = 'rt-fresh'

    const updated = await service.reconnect(view!.id)
    expect(updated.tokenStatus).toBe('ok')
    expect(secrets.decrypt(t.repos.accounts.require(view!.id).encRefreshToken!)).toBe('rt-fresh')
  })

  it('reconnect refuses when you pick a different channel in Google', async () => {
    const [view] = await service.addChannel()
    google.nextAccessToken = 'at-other'
    google.issuedRefreshToken = 'rt-other'
    google.channelsByAccessToken.set('at-other', [{ id: 'UCgaming', title: 'Gaming Channel' }])

    await expect(service.reconnect(view!.id)).rejects.toThrow(/but this is Drift Channel/)
    expect(secrets.decrypt(t.repos.accounts.require(view!.id).encRefreshToken!)).toBe('rt-initial')
  })

  it('keeps the newest refresh token when Google rotates it', async () => {
    const [view] = await service.addChannel()
    google.rotateTo = 'rt-rotated'
    await service.refreshInfo(view!.id)
    expect(secrets.decrypt(t.repos.accounts.require(view!.id).encRefreshToken!)).toBe('rt-rotated')
  })
})

describe('removing a channel', () => {
  it('revokes the token and deletes a channel with no posts', async () => {
    const [view] = await service.addChannel()
    const result = await service.remove({ accountId: view!.id, postsAction: 'cancel' })
    expect(result).toEqual({ revoked: true, archived: false, postsAffected: 0 })
    expect(google.revoked).toEqual(['rt-initial'])
    expect(t.repos.accounts.get(view!.id)).toBeUndefined()
  })

  it('cancels pending posts and archives a channel that has history', async () => {
    const [view] = await service.addChannel()
    const draft = t.repos.posts.create({ accountId: view!.id, status: 'draft' })
    const queued = t.repos.posts.create({ accountId: view!.id, status: 'queued' })

    const result = await service.remove({ accountId: view!.id, postsAction: 'cancel' })
    expect(result).toMatchObject({ archived: true, postsAffected: 2 })
    expect(t.repos.posts.get(draft.id)).toBeUndefined()
    expect(t.repos.posts.require(queued.id).status).toBe('canceled')

    const archived = t.repos.accounts.require(view!.id)
    expect(archived.removedAt).not.toBeNull()
    expect(archived.encRefreshToken).toBeNull()
    expect(service.list()).toHaveLength(0)

    // Adding the channel again brings the same row back.
    const [again] = await service.addChannel()
    expect(again?.id).toBe(view!.id)
    expect(t.repos.accounts.require(view!.id).removedAt).toBeNull()
  })

  it('keeps pending posts as drafts when asked', async () => {
    const [view] = await service.addChannel()
    const queued = t.repos.posts.create({ accountId: view!.id, status: 'queued' })
    await service.remove({ accountId: view!.id, postsAction: 'drafts' })
    expect(t.repos.posts.require(queued.id).status).toBe('draft')
  })

  it('moves pending posts to another channel, but not if a clip would be posted twice', async () => {
    const [drift] = await service.addChannel()
    google.nextAccessToken = 'at-2'
    google.issuedRefreshToken = 'rt-2'
    google.channelsByAccessToken.set('at-2', [{ id: 'UCgaming', title: 'Gaming Channel' }])
    const [gaming] = await service.addChannel()

    const clip = seedClip(t.repos, seedTwitchAccount(t.repos).id, 'SharedClip')
    t.repos.posts.create({
      accountId: drift!.id,
      status: 'queued',
      source: 'twitch_clip',
      clipId: clip.id
    })
    t.repos.posts.create({
      accountId: gaming!.id,
      status: 'queued',
      source: 'twitch_clip',
      clipId: clip.id
    })
    const plain = t.repos.posts.create({ accountId: drift!.id, status: 'queued' })

    await expect(
      service.remove({ accountId: drift!.id, postsAction: 'move', moveToAccountId: gaming!.id })
    ).rejects.toThrow(DuplicateError)
    // Nothing moved, nothing revoked.
    expect(t.repos.posts.require(plain.id).accountId).toBe(drift!.id)
    expect(google.revoked).toEqual([])
  })

  it('still removes the channel if Google already revoked access', async () => {
    const [view] = await service.addChannel()
    server.use(
      http.post('https://oauth2.googleapis.com/revoke', () =>
        HttpResponse.json({ error: 'invalid_token' }, { status: 400 })
      )
    )
    const result = await service.remove({ accountId: view!.id, postsAction: 'cancel' })
    expect(result.revoked).toBe(false)
    expect(t.repos.accounts.get(view!.id)).toBeUndefined()
    server.resetHandlers()
  })
})

describe('cached lookups', () => {
  it('returns assignable categories and all playlist pages, cached', async () => {
    const [view] = await service.addChannel()
    const categories = await service.categories(view!.id)
    expect(categories.map((c) => c.title)).toEqual(['Autos & Vehicles', 'Gaming'])
    await service.categories(view!.id)
    expect(google.youtubeCalls.filter((c) => c === 'videoCategories.list')).toHaveLength(1)

    const playlists = await service.playlists(view!.id)
    expect(playlists.map((p) => p.title)).toEqual(['MW4 Day N', 'Track days'])
    await service.playlists(view!.id)
    expect(google.youtubeCalls.filter((c) => c === 'playlists.list')).toHaveLength(2)
    await service.playlists(view!.id, true)
    expect(google.youtubeCalls.filter((c) => c === 'playlists.list')).toHaveLength(4)
  })
})
