import type { TwitchAccountView, TwitchConfig } from '@shared/schemas/twitch'
import type { Repos } from '../db/repos'
import { type Clock, DuplicateError, systemClock } from '../db/repos/common'
import type { TwitchAccountRow } from '../db/repos/twitchAccounts'
import { nextChannelColor } from '@shared/constants/colors'
import { startBackfill } from '../domain/clips'
import { UserFacingError } from '../errors'
import type { LoopbackReceiver } from '../google/loopback'
import type { SecretBox } from '../secrets/secretBox'
import { createHelix, type Helix, TwitchHttpError } from '../twitch/helix'
import {
  type ConnectMode,
  pollDeviceFlow,
  refreshTwitchToken,
  revokeTwitchToken,
  SCOPE_FOR,
  signInWithCode,
  startDeviceFlow,
  TWITCH_REDIRECT_URI,
  TwitchAuthError,
  type TwitchTokens,
  validateTwitchToken
} from '../twitch/oauth'

/**
 * Connected Twitch channels: sign-in (Authorization Code with a Confidential app, or Device
 * Code without a secret), token refresh with rotation, re-auth handling, and a Helix client
 * per account. Electron pieces come in as dependencies.
 */

export interface TwitchAccountsDeps {
  repos: Repos
  secrets: SecretBox
  openExternal: (url: string) => Promise<void>
  notify: (title: string, body: string) => void
  emitChanged: () => void
  /** Shows the Device Code to type at twitch.tv/activate. */
  emitDeviceCode: (info: {
    userCode: string
    verificationUri: string
    expiresAtUtc: string
  }) => void
  kickJobs?: () => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: Clock
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  createReceiver?: () => Promise<LoopbackReceiver>
  /** Which accounts are syncing right now (from the job runner). */
  isSyncing?: (accountId: number) => boolean
}

const SECRET_NAME = 'twitchClientSecret'

export type TwitchAccountsService = ReturnType<typeof createTwitchAccountsService>

export function createTwitchAccountsService(deps: TwitchAccountsDeps) {
  const { repos, secrets, logger } = deps
  const clock = deps.clock ?? systemClock
  const accessTokens = new Map<number, { token: string; expiresAt: number }>()
  const refreshing = new Map<number, Promise<string>>()
  let pendingConnect: AbortController | null = null

  // ---- config -------------------------------------------------------------------------

  async function clientConfig(): Promise<{ clientId: string; clientSecret: string | null }> {
    const clientId = repos.settings.getKey('twitchClientId')
    if (!clientId) {
      throw new UserFacingError('Add your Twitch app’s Client ID first (Channels page → Twitch).')
    }
    const enc = repos.settings.getSecret(SECRET_NAME)
    return { clientId, clientSecret: enc ? await secrets.decrypt(enc) : null }
  }

  // ---- tokens -------------------------------------------------------------------------

  function markNeedsReauth(account: TwitchAccountRow, why: string): void {
    accessTokens.delete(account.id)
    if (account.tokenStatus === 'needs_reauth') return
    repos.twitchAccounts.setTokenStatus(account.id, 'needs_reauth')
    repos.eventLog.write({
      kind: 'twitch.needs_reauth',
      level: 'warn',
      message: `${account.displayName}: Twitch sign-in expired (${why})`,
      twitchAccountId: account.id
    })
    deps.notify(
      'Twitch sign-in needed',
      `${account.displayName} needs you to sign in again. Clip sync is paused until you click Reconnect.`
    )
    deps.emitChanged()
  }

  async function refresh(account: TwitchAccountRow): Promise<string> {
    if (!account.encRefreshToken) {
      throw new UserFacingError(
        `${account.displayName} has no saved Twitch sign-in. Click Reconnect.`
      )
    }
    const { clientId, clientSecret } = await clientConfig()
    const refreshToken = await secrets.decrypt(account.encRefreshToken)
    let tokens: TwitchTokens
    try {
      tokens = await refreshTwitchToken({
        clientId,
        clientSecret: account.authFlow === 'auth_code' ? clientSecret : null,
        refreshToken,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {})
      })
    } catch (error) {
      if (error instanceof TwitchAuthError && (error.status === 400 || error.status === 401)) {
        markNeedsReauth(account, error.message)
        throw new UserFacingError(
          `${account.displayName}'s Twitch sign-in expired or was revoked. Click Reconnect on the Channels page.`,
          { cause: error }
        )
      }
      throw error
    }
    // Refresh tokens rotate (and Device Code ones are single-use): always keep the newest.
    repos.twitchAccounts.update(account.id, {
      encRefreshToken: await secrets.encrypt(tokens.refreshToken)
    })
    accessTokens.set(account.id, {
      token: tokens.accessToken,
      expiresAt: clock().getTime() + tokens.expiresInSec * 1000
    })
    return tokens.accessToken
  }

  /** A valid access token for the account; refreshes when needed (one refresh at a time). */
  async function accessToken(accountId: number, forceRefresh = false): Promise<string> {
    const account = repos.twitchAccounts.require(accountId)
    if (account.tokenStatus === 'needs_reauth') {
      throw new UserFacingError(
        `${account.displayName} needs you to sign in to Twitch again. Click Reconnect.`
      )
    }
    const cached = accessTokens.get(accountId)
    if (!forceRefresh && cached && cached.expiresAt - 60_000 > clock().getTime())
      return cached.token
    let inflight = refreshing.get(accountId)
    if (!inflight) {
      inflight = refresh(account).finally(() => refreshing.delete(accountId))
      refreshing.set(accountId, inflight)
    }
    return inflight
  }

  function helixFor(accountId: number, signal?: AbortSignal): Helix {
    const clientId = repos.settings.getKey('twitchClientId')
    if (!clientId) throw new UserFacingError('Add your Twitch app’s Client ID first.')
    return createHelix({
      clientId,
      getToken: (force) => accessToken(accountId, force),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(signal ? { signal } : {})
    })
  }

  // ---- sign-in ------------------------------------------------------------------------

  async function obtainTokens(
    mode: ConnectMode,
    signal: AbortSignal
  ): Promise<{ tokens: TwitchTokens; flow: 'auth_code' | 'device_code' }> {
    const { clientId, clientSecret } = await clientConfig()
    const scope = SCOPE_FOR[mode]
    if (clientSecret) {
      const tokens = await signInWithCode({
        clientId,
        clientSecret,
        scope,
        openExternal: deps.openExternal,
        signal,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.createReceiver ? { createReceiver: deps.createReceiver } : {})
      })
      return { tokens, flow: 'auth_code' }
    }
    const start = await startDeviceFlow({
      clientId,
      scope,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {})
    })
    deps.emitDeviceCode({
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAtUtc: new Date(start.expiresAtMs).toISOString()
    })
    await deps.openExternal(start.verificationUri)
    const tokens = await pollDeviceFlow({
      clientId,
      scope,
      start,
      signal,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {})
    })
    return { tokens, flow: 'device_code' }
  }

  async function signIn(mode: ConnectMode, channelLogin: string | undefined) {
    if (pendingConnect)
      throw new UserFacingError('A Twitch sign-in is already open. Finish or cancel it first.')
    const controller = new AbortController()
    pendingConnect = controller
    try {
      const { tokens, flow } = await obtainTokens(mode, controller.signal)
      const who = await validateTwitchToken(tokens.accessToken, deps.fetchImpl)
      if (!who.scopes.includes(SCOPE_FOR[mode])) {
        throw new UserFacingError(
          'Twitch didn’t grant clip access. Connect again and approve the permission.'
        )
      }
      const { clientId } = await clientConfig()
      const helix = createHelix({
        clientId,
        getToken: async () => tokens.accessToken,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {})
      })
      const [broadcaster] =
        mode === 'broadcaster'
          ? await helix.getUsers({ ids: [who.userId] })
          : await helix.getUsers({ logins: [channelLogin ?? ''] })
      if (!broadcaster) {
        throw new UserFacingError(
          `There is no Twitch channel called "${channelLogin ?? who.login}".`
        )
      }
      if (mode === 'editor' && broadcaster.id !== who.userId) {
        // Asking for download links of a made-up clip: 403 if you're not an editor.
        try {
          await helix.getClipDownloads({
            editorId: who.userId,
            broadcasterId: broadcaster.id,
            clipIds: ['ChannelDeckEditorCheck']
          })
        } catch (error) {
          if (error instanceof TwitchHttpError && error.status === 403) {
            throw new UserFacingError(
              `${who.login} isn’t an editor of ${broadcaster.display_name}. Ask them to add you as an editor, or sign in as the broadcaster.`
            )
          }
          throw error
        }
      }
      return { tokens, flow, who, broadcaster }
    } finally {
      if (pendingConnect === controller) pendingConnect = null
    }
  }

  // ---- views --------------------------------------------------------------------------

  function toView(a: TwitchAccountRow): TwitchAccountView {
    return {
      id: a.id,
      broadcasterId: a.broadcasterId,
      login: a.login,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      color: a.color,
      viaEditor: a.editorId !== a.broadcasterId,
      authFlow: a.authFlow,
      tokenStatus: a.tokenStatus,
      syncEnabled: a.syncEnabled,
      lastSyncUtc: a.lastSyncUtc,
      backfillFromUtc: a.backfillFromUtc,
      backfill: a.backfillCursorJson
        ? {
            windowsDone: a.backfillCursorJson.windowsDone,
            windowsTotal: a.backfillCursorJson.windowsTotal,
            nextWindowStartUtc: a.backfillCursorJson.nextWindowStartUtc
          }
        : null,
      syncing: deps.isSyncing?.(a.id) ?? false,
      stats: repos.clips.stats(a.id)
    }
  }

  // ---- public API ---------------------------------------------------------------------

  const service = {
    accessToken,
    helixFor,

    getConfig(): TwitchConfig {
      return {
        clientId: repos.settings.getKey('twitchClientId'),
        hasSecret: repos.settings.getSecret(SECRET_NAME) !== null,
        redirectUri: TWITCH_REDIRECT_URI
      }
    },

    async setConfig(input: {
      clientId: string
      clientSecret?: string | null | undefined
    }): Promise<TwitchConfig> {
      repos.settings.update({ twitchClientId: input.clientId.trim() })
      if (input.clientSecret === null) repos.settings.setSecret(SECRET_NAME, null)
      else if (input.clientSecret)
        repos.settings.setSecret(SECRET_NAME, await secrets.encrypt(input.clientSecret))
      accessTokens.clear()
      return service.getConfig()
    },

    list(): TwitchAccountView[] {
      return repos.twitchAccounts.list().map(toView)
    },

    async connect(input: {
      mode: ConnectMode
      channelLogin?: string | undefined
      backfillFromUtc: string | null
    }): Promise<TwitchAccountView> {
      const { tokens, flow, who, broadcaster } = await signIn(input.mode, input.channelLogin)
      const existing = repos.twitchAccounts.getByBroadcasterId(broadcaster.id)
      if (existing && existing.tokenStatus === 'ok') {
        throw new DuplicateError(
          `${broadcaster.display_name} is already connected. Use Reconnect on it if needed.`
        )
      }
      const now = clock()
      const enc = await secrets.encrypt(tokens.refreshToken)
      let row: TwitchAccountRow
      if (existing) {
        row = repos.twitchAccounts.update(existing.id, {
          encRefreshToken: enc,
          tokenStatus: 'ok',
          editorId: who.userId,
          authFlow: flow,
          login: broadcaster.login,
          displayName: broadcaster.display_name,
          avatarUrl: broadcaster.profile_image_url || null
        })
      } else {
        const from = input.backfillFromUtc ?? broadcaster.created_at
        row = repos.twitchAccounts.create({
          broadcasterId: broadcaster.id,
          login: broadcaster.login,
          displayName: broadcaster.display_name,
          avatarUrl: broadcaster.profile_image_url || null,
          color: nextChannelColor(repos.twitchAccounts.list().map((a) => a.color)),
          editorId: who.userId,
          authFlow: flow,
          encRefreshToken: enc,
          tokenStatus: 'ok',
          backfillFromUtc: from,
          backfillCursorJson: startBackfill(from, now.toISOString()),
          syncEnabled: true
        })
      }
      accessTokens.set(row.id, {
        token: tokens.accessToken,
        expiresAt: now.getTime() + tokens.expiresInSec * 1000
      })
      repos.eventLog.write({
        kind: 'twitch.connected',
        message: `Connected ${row.displayName}${row.editorId !== row.broadcasterId ? ` (as editor ${who.login})` : ''}`,
        twitchAccountId: row.id
      })
      deps.emitChanged()
      deps.kickJobs?.()
      return toView(row)
    },

    async reconnect(id: number): Promise<TwitchAccountView> {
      const account = repos.twitchAccounts.require(id)
      const mode: ConnectMode =
        account.editorId === account.broadcasterId ? 'broadcaster' : 'editor'
      const { tokens, flow, who, broadcaster } = await signIn(mode, account.login)
      if (broadcaster.id !== account.broadcasterId) {
        throw new UserFacingError(
          `You signed in for ${broadcaster.display_name}, but this is ${account.displayName}.`
        )
      }
      const row = repos.twitchAccounts.update(id, {
        encRefreshToken: await secrets.encrypt(tokens.refreshToken),
        tokenStatus: 'ok',
        editorId: who.userId,
        authFlow: flow
      })
      accessTokens.set(id, {
        token: tokens.accessToken,
        expiresAt: clock().getTime() + tokens.expiresInSec * 1000
      })
      // Sync right away, past any backoff left over from the failed sign-in.
      service.forceSync.add(id)
      deps.emitChanged()
      deps.kickJobs?.()
      return toView(row)
    },

    cancelConnect(): boolean {
      if (!pendingConnect) return false
      pendingConnect.abort(new UserFacingError('Twitch sign-in canceled.'))
      return true
    },

    update(
      id: number,
      patch: { syncEnabled?: boolean | undefined; color?: string | undefined }
    ): TwitchAccountView {
      const row = repos.twitchAccounts.update(id, {
        ...(patch.syncEnabled !== undefined ? { syncEnabled: patch.syncEnabled } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {})
      })
      deps.emitChanged()
      if (patch.syncEnabled) deps.kickJobs?.()
      return toView(row)
    },

    /** Sync now: clears the last-sync time so the daily sync is due immediately. */
    syncNow(id: number): void {
      const account = repos.twitchAccounts.require(id)
      if (account.tokenStatus !== 'ok') {
        throw new UserFacingError(
          `${account.displayName} needs you to sign in to Twitch again first.`
        )
      }
      service.forceSync.add(id)
      deps.kickJobs?.()
    },

    /** Accounts whose next sync should run regardless of the schedule (read by the sync job). */
    forceSync: new Set<number>(),

    async remove(id: number): Promise<{ removedClips: number }> {
      const account = repos.twitchAccounts.require(id)
      const usedClips = repos.clips.referencedIds(
        repos.clips
          .search({
            twitchAccountId: id,
            sort: 'oldest',
            includeHidden: true,
            limit: 100_000,
            offset: 0
          })
          .items.map((c) => c.id)
      )
      if (usedClips.size > 0) {
        throw new UserFacingError(
          `${usedClips.size} of ${account.displayName}'s clips are used by posts. Delete or unschedule those posts first.`
        )
      }
      try {
        const token = accessTokens.get(id)?.token
        const { clientId } = await clientConfig()
        if (token) await revokeTwitchToken(clientId, token, deps.fetchImpl)
      } catch (error) {
        logger.warn('[twitch] revoke failed (removing anyway)', error)
      }
      const removedClips = repos.clips.deleteUnreferenced(id)
      repos.twitchAccounts.remove(id)
      accessTokens.delete(id)
      repos.eventLog.write({
        kind: 'twitch.removed',
        message: `Removed ${account.displayName} (${removedClips} clips forgotten; files kept)`
      })
      deps.emitChanged()
      return { removedClips }
    }
  }
  return service
}
