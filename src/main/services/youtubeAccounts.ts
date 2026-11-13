import { OAuth2Client } from 'google-auth-library'
import { nextChannelColor } from '@shared/constants/colors'
import type { PostStatus } from '@shared/constants/enums'
import { QUOTA_COSTS, type YouTubeMethod } from '@shared/constants/quota'
import {
  accountDefaultsSchema,
  type AccountView,
  type GoogleClientStatus,
  type RemovePostsAction
} from '@shared/schemas/account'
import type { AccountRow } from '../db/repos/accounts'
import { type Clock, DuplicateError, systemClock } from '../db/repos/common'
import type { Repos } from '../db/repos'
import { quotaDayFor } from '../domain/quota'
import { UserFacingError } from '../errors'
import {
  type ClientConfigStore,
  clientIdHint,
  type GoogleClientConfig
} from '../google/clientConfig'
import { isApiNotEnabled, isInvalidGrant, projectNumberFrom } from '../google/errors'
import type { LoopbackReceiver } from '../google/loopback'
import { signInWithGoogle } from '../google/oauth'
import {
  createDryRunYouTubeApi,
  createYouTubeApi,
  type PlaylistInfo,
  type VideoCategory,
  type YouTubeApi
} from '../google/youtube'
import type { SecretBox } from '../secrets/secretBox'

/**
 * Everything about connected YouTube channels: sign-in, token storage and refresh,
 * re-auth handling, removal, and cached lookups. Electron-specific pieces (browser,
 * notifications, window events) come in as dependencies so this is testable.
 */

export interface YouTubeAccountsDeps {
  repos: Repos
  secrets: SecretBox
  clientConfig: ClientConfigStore
  openExternal: (url: string) => Promise<void>
  notify: (title: string, body: string) => void
  /** Tells the renderer to refetch channels. */
  emitChanged: () => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: Clock
  /** Test hook for the loopback receiver. */
  createReceiver?: () => Promise<LoopbackReceiver>
  signInTimeoutMs?: number
  /** Test hook: how long a Dry Run upload pretends to take. */
  dryRunUploadMs?: number
}

/** Posts that haven't reached YouTube and wait on this channel. */
const PENDING_STATUSES: PostStatus[] = [
  'draft',
  'needs_approval',
  'queued',
  'waiting_quota',
  'needs_decision',
  'failed'
]
const IN_PROGRESS_STATUSES: PostStatus[] = ['rendering', 'uploading']
const CATEGORY_TTL_MS = 24 * 60 * 60 * 1000
const PLAYLIST_TTL_MS = 60 * 60 * 1000

export type YouTubeAccountsService = ReturnType<typeof createYouTubeAccountsService>

export function createYouTubeAccountsService(deps: YouTubeAccountsDeps) {
  const { repos, secrets, clientConfig, logger } = deps
  const clock = deps.clock ?? systemClock

  const authClients = new Map<number, OAuth2Client>()
  let pendingSignIn: AbortController | null = null
  const categoryCache = new Map<string, { at: number; items: VideoCategory[] }>()
  const playlistCache = new Map<number, { at: number; items: PlaylistInfo[] }>()

  // ---- helpers ------------------------------------------------------------------------

  function requireConfig(): GoogleClientConfig {
    let config: GoogleClientConfig | null
    try {
      config = clientConfig.load()
    } catch (error) {
      throw new UserFacingError(
        `The imported Google client file can't be read. Import it again in Settings. (${error instanceof Error ? error.message : String(error)})`
      )
    }
    if (!config) {
      throw new UserFacingError(
        'Import your Google client file first (Channels page or Settings → Import Google client file).'
      )
    }
    return config
  }

  function recordCall(method: YouTubeMethod, accountId: number | null, dryRun = false): void {
    const { bucket, cost } = QUOTA_COSTS[method]
    repos.quota.record({ quotaDay: quotaDayFor(clock()), bucket, cost, method, accountId, dryRun })
  }

  function requireActiveAccount(accountId: number): AccountRow {
    const account = repos.accounts.require(accountId)
    if (account.removedAt) throw new UserFacingError(`${account.channelTitle} has been removed.`)
    return account
  }

  function toView(account: AccountRow): AccountView {
    const now = clock().toISOString()
    const posts = repos.posts.list({ accountId: account.id })
    const pending = posts.filter(
      (p) => PENDING_STATUSES.includes(p.status) || IN_PROGRESS_STATUSES.includes(p.status)
    )
    const scheduled = posts.filter((p) => p.status === 'scheduled')
    const next = [...pending, ...scheduled]
      .map((p) => p.publishAtUtc)
      .filter((t): t is string => t !== null && t > now)
      .sort()[0]
    const defaults = accountDefaultsSchema.safeParse(account.defaultsJson)
    return {
      id: account.id,
      channelId: account.channelId,
      channelTitle: account.channelTitle,
      channelHandle: account.channelHandle,
      avatarUrl: account.avatarUrl,
      color: account.color,
      tokenStatus: account.tokenStatus,
      enabled: account.enabled,
      defaults: defaults.success ? defaults.data : {},
      createdAt: account.createdAt,
      counts: {
        pending: pending.filter((p) => p.status !== 'draft').length,
        scheduled: scheduled.length
      },
      nextPublishAtUtc: next ?? null
    }
  }

  /** An authorized client for a stored channel. Refreshed tokens are re-encrypted and saved. */
  async function authClientFor(account: AccountRow): Promise<OAuth2Client> {
    const cached = authClients.get(account.id)
    if (cached) return cached
    if (!account.encRefreshToken) {
      throw new UserFacingError(`${account.channelTitle} has no saved sign-in. Click Reconnect.`)
    }
    const config = requireConfig()
    const refreshToken = await secrets.decrypt(account.encRefreshToken, (fresh) =>
      repos.accounts.update(account.id, { encRefreshToken: fresh })
    )
    const client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret
    })
    client.setCredentials({ refresh_token: refreshToken })
    client.on('tokens', (tokens) => {
      // Google may rotate the refresh token; keep the newest one. Access tokens stay in memory.
      if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
        const rotated = tokens.refresh_token
        void secrets
          .encrypt(rotated)
          .then((enc) => {
            repos.accounts.update(account.id, { encRefreshToken: enc })
            logger.info(`[google] stored a rotated refresh token for account ${account.id}`)
          })
          .catch((error: unknown) =>
            logger.error('[google] could not store a rotated token', error)
          )
      }
    })
    authClients.set(account.id, client)
    return client
  }

  function markNeedsReauth(account: AccountRow): void {
    if (account.tokenStatus === 'needs_reauth') return
    repos.accounts.setTokenStatus(account.id, 'needs_reauth')
    authClients.delete(account.id)
    repos.eventLog.write({
      kind: 'account.needs_reauth',
      level: 'warn',
      message: `${account.channelTitle}: Google sign-in expired or was revoked`,
      accountId: account.id
    })
    logger.warn(`[google] account ${account.id} needs re-auth (invalid_grant)`)
    deps.notify(
      'YouTube sign-in needed',
      `${account.channelTitle} needs you to sign in again. Its uploads are paused until you click Reconnect.`
    )
    deps.emitChanged()
  }

  /** Turns Google setup problems into messages Cody can act on; rethrows anything else. */
  function explainSetupError(error: unknown): never {
    if (isApiNotEnabled(error)) {
      const project = projectNumberFrom(error)
      throw new UserFacingError(
        `The YouTube Data API v3 is turned off in your Google Cloud project${project ? ` (${project})` : ''}. ` +
          'In Google Cloud Console go to APIs & Services → Library, open "YouTube Data API v3", click Enable, wait a minute, then try again.',
        { cause: error }
      )
    }
    throw error
  }

  async function explained<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (error) {
      explainSetupError(error)
    }
  }

  /** Runs `fn` with an API client for the channel; turns invalid_grant into "needs re-auth". */
  async function withApi<T>(accountId: number, fn: (api: YouTubeApi) => Promise<T>): Promise<T> {
    const account = requireActiveAccount(accountId)
    if (account.tokenStatus === 'needs_reauth') {
      throw new UserFacingError(
        `${account.channelTitle} needs you to sign in again. Click Reconnect.`
      )
    }
    const realApi = async (): Promise<YouTubeApi> =>
      createYouTubeApi({
        auth: await authClientFor(account),
        recordCall: (method) => recordCall(method, account.id)
      })
    const api = repos.settings.getKey('dryRun')
      ? createDryRunYouTubeApi({
          // Read-only lookups still use the real API; writes are only logged.
          reads: {
            channelsMine: async () => (await realApi()).channelsMine(),
            videoCategories: async (r, hl) => (await realApi()).videoCategories(r, hl),
            playlistsMine: async () => (await realApi()).playlistsMine(),
            videosStatus: async (ids) => (await realApi()).videosStatus(ids),
            videoStatusPart: async (id) => (await realApi()).videoStatusPart(id)
          },
          recordCall: (method) => recordCall(method, account.id, true),
          log: (message, payload) => {
            logger.info(`[dry-run] ${account.channelTitle}: would call ${message}`, payload)
            repos.eventLog.write({
              kind: 'dryrun.call',
              message: `Dry Run: would call ${message}`,
              accountId: account.id,
              data: payload
            })
          },
          ...(deps.dryRunUploadMs !== undefined ? { uploadMs: deps.dryRunUploadMs } : {})
        })
      : await realApi()
    try {
      return await fn(api)
    } catch (error) {
      if (isInvalidGrant(error)) {
        markNeedsReauth(account)
        throw new UserFacingError(
          `${account.channelTitle}'s Google sign-in has expired or was revoked. Click Reconnect to sign in again.`,
          { cause: error }
        )
      }
      explainSetupError(error)
    }
  }

  async function runSignIn(): Promise<{ client: OAuth2Client; refreshToken: string }> {
    const config = requireConfig()
    if (pendingSignIn) {
      throw new UserFacingError(
        'A Google sign-in is already open in your browser. Finish or cancel it first.'
      )
    }
    const controller = new AbortController()
    pendingSignIn = controller
    try {
      return await signInWithGoogle({
        config,
        openExternal: deps.openExternal,
        signal: controller.signal,
        ...(deps.createReceiver ? { createReceiver: deps.createReceiver } : {}),
        ...(deps.signInTimeoutMs ? { timeoutMs: deps.signInTimeoutMs } : {})
      })
    } finally {
      if (pendingSignIn === controller) pendingSignIn = null
    }
  }

  // ---- public API ---------------------------------------------------------------------

  const service = {
    getClientStatus(): GoogleClientStatus {
      try {
        const config = clientConfig.load()
        return config
          ? {
              configured: true,
              projectId: config.projectId,
              clientIdHint: clientIdHint(config.clientId),
              problem: null
            }
          : { configured: false, projectId: null, clientIdHint: null, problem: null }
      } catch (error) {
        return {
          configured: false,
          projectId: null,
          clientIdHint: null,
          problem: error instanceof Error ? error.message : String(error)
        }
      }
    },

    importClientFile(text: string): GoogleClientStatus {
      const config = clientConfig.save(text)
      // A different client invalidates cached auth clients built from the old one.
      authClients.clear()
      repos.eventLog.write({
        kind: 'google.client_imported',
        message: `Imported Google client for project ${config.projectId ?? 'unknown'}`
      })
      return {
        configured: true,
        projectId: config.projectId,
        clientIdHint: clientIdHint(config.clientId),
        problem: null
      }
    },

    list(): AccountView[] {
      return repos.accounts.list().map(toView)
    },

    async addChannel(): Promise<AccountView[]> {
      const { client, refreshToken } = await runSignIn()
      const api = createYouTubeApi({ auth: client, recordCall: (m) => recordCall(m, null) })
      const channels = await explained(() => api.channelsMine())
      if (channels.length === 0) {
        throw new UserFacingError(
          "That Google account doesn't have a YouTube channel. Pick a different account or brand account, or create a channel on youtube.com first."
        )
      }

      const encrypted = await secrets.encrypt(refreshToken)
      const added: AccountRow[] = []
      const duplicates: string[] = []
      for (const channel of channels) {
        const existing = repos.accounts.getByChannelId(channel.channelId)
        if (existing && !existing.removedAt) {
          duplicates.push(channel.title)
          continue
        }
        const fields = {
          channelTitle: channel.title,
          channelHandle: channel.handle,
          avatarUrl: channel.avatarUrl,
          encRefreshToken: encrypted,
          tokenStatus: 'ok' as const,
          enabled: true
        }
        if (existing) {
          // Previously removed channel with history: bring it back.
          added.push(repos.accounts.update(existing.id, { ...fields, removedAt: null }))
        } else {
          const used = repos.accounts.list({ includeRemoved: true }).map((a) => a.color)
          added.push(
            repos.accounts.create({
              channelId: channel.channelId,
              color: nextChannelColor(used),
              ...fields
            })
          )
        }
      }

      if (added.length === 0) {
        throw new DuplicateError(
          `${duplicates.join(', ')} is already connected. If it needs a fresh sign-in, use Reconnect on it instead.`
        )
      }
      for (const account of added) {
        repos.eventLog.write({
          kind: 'account.added',
          message: `Connected ${account.channelTitle}`,
          accountId: account.id
        })
      }
      deps.emitChanged()
      return added.map(toView)
    },

    async reconnect(accountId: number): Promise<AccountView> {
      const account = requireActiveAccount(accountId)
      const { client, refreshToken } = await runSignIn()
      const api = createYouTubeApi({ auth: client, recordCall: (m) => recordCall(m, account.id) })
      const channels = await explained(() => api.channelsMine())
      const match = channels.find((c) => c.channelId === account.channelId)
      if (!match) {
        const got = channels.map((c) => c.title).join(', ') || 'an account with no channel'
        throw new UserFacingError(
          `You signed in as ${got}, but this is ${account.channelTitle}. Click Reconnect again and pick ${account.channelTitle} in Google's account picker.`
        )
      }
      authClients.delete(account.id)
      const updated = repos.accounts.update(account.id, {
        encRefreshToken: await secrets.encrypt(refreshToken),
        tokenStatus: 'ok',
        channelTitle: match.title,
        channelHandle: match.handle,
        avatarUrl: match.avatarUrl
      })
      repos.eventLog.write({
        kind: 'account.reconnected',
        message: `Reconnected ${updated.channelTitle}`,
        accountId: updated.id
      })
      deps.emitChanged()
      return toView(updated)
    },

    cancelSignIn(): boolean {
      if (!pendingSignIn) return false
      pendingSignIn.abort()
      return true
    },

    update(input: {
      accountId: number
      color?: string
      enabled?: boolean
      defaults?: AccountView['defaults']
    }): AccountView {
      requireActiveAccount(input.accountId)
      const updated = repos.accounts.update(input.accountId, {
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.defaults !== undefined ? { defaultsJson: input.defaults } : {})
      })
      deps.emitChanged()
      return toView(updated)
    },

    async refreshInfo(accountId: number): Promise<AccountView> {
      const channels = await withApi(accountId, (api) => api.channelsMine())
      const account = repos.accounts.require(accountId)
      const match = channels.find((c) => c.channelId === account.channelId)
      if (!match) return toView(account)
      return toView(
        repos.accounts.update(accountId, {
          channelTitle: match.title,
          channelHandle: match.handle,
          avatarUrl: match.avatarUrl
        })
      )
    },

    /** Checks every connected channel's sign-in (1 quota unit each). Used at startup. */
    async checkAll(): Promise<void> {
      for (const account of repos.accounts.list()) {
        if (!account.enabled || account.tokenStatus !== 'ok') continue
        try {
          await service.refreshInfo(account.id)
        } catch (error) {
          logger.warn(`[google] startup check for account ${account.id} failed`, error)
        }
      }
    },

    removalPreview(accountId: number) {
      const account = requireActiveAccount(accountId)
      const posts = repos.posts.list({ accountId })
      return {
        pendingPosts: posts.filter((p) => PENDING_STATUSES.includes(p.status) && !p.youtubeVideoId)
          .length,
        inProgress: posts.filter((p) => IN_PROGRESS_STATUSES.includes(p.status)).length,
        onYouTube: posts.filter((p) => p.youtubeVideoId && p.status !== 'canceled').length,
        moveTargets: repos.accounts
          .list()
          .filter((a) => a.id !== account.id)
          .map((a) => ({ id: a.id, title: a.channelTitle }))
      }
    },

    async remove(input: {
      accountId: number
      postsAction: RemovePostsAction
      moveToAccountId?: number
    }): Promise<{ revoked: boolean; archived: boolean; postsAffected: number }> {
      const account = requireActiveAccount(input.accountId)
      const posts = repos.posts.list({ accountId: account.id })

      if (posts.some((p) => IN_PROGRESS_STATUSES.includes(p.status))) {
        throw new UserFacingError(
          `An upload for ${account.channelTitle} is in progress. Wait for it to finish (or cancel it) before removing the channel.`
        )
      }

      const pending = posts.filter((p) => PENDING_STATUSES.includes(p.status) && !p.youtubeVideoId)

      if (input.postsAction === 'move') {
        const target = input.moveToAccountId ? repos.accounts.get(input.moveToAccountId) : undefined
        if (!target || target.removedAt || target.id === account.id) {
          throw new UserFacingError('Pick another connected channel to move the posts to.')
        }
        // Check the never-twice rule up front so nothing moves if any clip would clash.
        const targetClips = new Set(
          repos.posts
            .list({ accountId: target.id })
            .filter((p) => p.status !== 'canceled' && p.clipId)
            .map((p) => p.clipId)
        )
        const clash = pending.find((p) => p.clipId && targetClips.has(p.clipId))
        if (clash) {
          throw new DuplicateError(
            `"${clash.title}" uses a clip that's already queued or posted on ${target.channelTitle}. Cancel that post first, or choose a different option.`
          )
        }
        for (const post of pending) repos.posts.update(post.id, { accountId: target.id })
      } else if (input.postsAction === 'cancel') {
        for (const post of pending) {
          if (post.status === 'draft') repos.posts.deleteDraft(post.id)
          else
            repos.posts.transition(post.id, 'cancel', {
              reason: `channel ${account.channelTitle} removed`
            })
        }
      } else {
        for (const post of pending) {
          if (post.status !== 'draft') {
            repos.posts.transition(post.id, 'to_draft', {
              reason: `channel ${account.channelTitle} removed`
            })
          }
        }
      }

      // Revoke the token so ChannelDeck's access to the channel ends at Google too.
      let revoked = false
      if (account.encRefreshToken) {
        try {
          const config = requireConfig()
          const client = new OAuth2Client({
            clientId: config.clientId,
            clientSecret: config.clientSecret
          })
          await client.revokeToken(await secrets.decrypt(account.encRefreshToken))
          revoked = true
        } catch (error) {
          // Already revoked/expired tokens fail here too; removal goes ahead either way.
          logger.warn(`[google] revoking token for account ${account.id} failed`, error)
        }
      }
      authClients.delete(account.id)
      playlistCache.delete(account.id)

      const stillReferenced = repos.posts.list({ accountId: account.id }).length > 0
      if (stillReferenced) repos.accounts.archive(account.id)
      else repos.accounts.remove(account.id)

      repos.eventLog.write({
        kind: 'account.removed',
        message: `Removed ${account.channelTitle} (${pending.length} pending posts: ${input.postsAction})`,
        accountId: stillReferenced ? account.id : null,
        data: { revoked, archived: stillReferenced, postsAction: input.postsAction }
      })
      deps.emitChanged()
      return { revoked, archived: stillReferenced, postsAffected: pending.length }
    },

    async categories(accountId: number): Promise<VideoCategory[]> {
      const key = 'US'
      const cached = categoryCache.get(key)
      if (cached && clock().getTime() - cached.at < CATEGORY_TTL_MS) return cached.items
      const items = await withApi(accountId, (api) => api.videoCategories(key))
      const assignable = items.filter((c) => c.assignable)
      categoryCache.set(key, { at: clock().getTime(), items: assignable })
      return assignable
    },

    async playlists(accountId: number, refresh = false): Promise<PlaylistInfo[]> {
      const cached = playlistCache.get(accountId)
      if (!refresh && cached && clock().getTime() - cached.at < PLAYLIST_TTL_MS) return cached.items
      const items = await withApi(accountId, (api) => api.playlistsMine())
      playlistCache.set(accountId, { at: clock().getTime(), items })
      return items
    },

    /** For later phases (uploads): an authorized client, with invalid_grant handling. */
    withApi
  }
  return service
}
