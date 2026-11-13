import type { Repos } from '../db/repos'
import type { PostRow } from '../db/repos/posts'
import {
  batchIds,
  decideSync,
  type SyncDecision,
  SYNCED_STATUSES,
  syncIntervalMs
} from '../domain/statusSync'
import { classifyGoogleError } from '../google/errors'
import type { YouTubeApi } from '../google/youtube'
import type { JobType } from './runner'

/**
 * Keeps uploaded posts in step with YouTube: Processing → Scheduled → Published, and
 * reports rejected / failed / deleted videos. Runs at launch, then every 15 minutes, or
 * every 2 minutes while something is still processing. videos.list costs 1 unit per 50 ids.
 */

export interface StatusSyncDeps {
  repos: Repos
  withApi: <T>(accountId: number, fn: (api: YouTubeApi) => Promise<T>) => Promise<T>
  notify: (title: string, body: string) => void
  emitChanged: () => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: () => Date
}

export interface SyncSummary {
  checked: number
  changed: number
  skippedChannels: number
}

export interface StatusSyncJob extends JobType<'sync'> {
  /** Run a sync right away (the queue's "Check status now"). */
  syncNow(): Promise<SyncSummary>
}

export function createStatusSyncJob(deps: StatusSyncDeps): StatusSyncJob {
  const { repos, logger } = deps
  const clock = deps.clock ?? (() => new Date())
  let lastRunAt: number | null = null
  let inFlight: Promise<SyncSummary> | null = null

  function syncedPosts(): PostRow[] {
    return repos.posts.list({ statuses: SYNCED_STATUSES }).filter((p) => p.youtubeVideoId)
  }

  function apply(post: PostRow, decision: SyncDecision): boolean {
    try {
      if (decision.kind === 'none') return false
      if (decision.kind === 'patch') {
        repos.posts.update(post.id, decision.patch)
        return true
      }
      repos.posts.transition(post.id, decision.event, {
        ...(decision.patch ? { patch: decision.patch } : {}),
        reason: decision.reason
      })
      if (decision.notice) deps.notify(decision.notice.title, decision.notice.body)
      return true
    } catch (error) {
      // The post moved on (e.g. you deleted it) while we were asking YouTube.
      logger.warn(`[status] could not apply ${decision.kind} to ${post.id}`, error)
      return false
    }
  }

  /** Dry Run videos never reached YouTube; walk them through the same states locally. */
  function dryRunDecision(post: PostRow, now: Date): SyncDecision {
    const future = post.publishAtUtc !== null && post.publishAtUtc > now.toISOString()
    if (post.status === 'processing') {
      return post.visibilityMode === 'schedule' && future
        ? { kind: 'transition', event: 'mark_scheduled', reason: 'Dry Run' }
        : { kind: 'transition', event: 'mark_published', reason: 'Dry Run' }
    }
    if (post.status === 'scheduled' && !future) {
      return {
        kind: 'transition',
        event: 'mark_published',
        reason: 'Dry Run publish time reached',
        notice: { title: 'Published (Dry Run)', body: `"${post.title}" would be public now.` }
      }
    }
    return { kind: 'none' }
  }

  async function syncOnce(): Promise<SyncSummary> {
    const now = clock()
    const summary: SyncSummary = { checked: 0, changed: 0, skippedChannels: 0 }
    const posts = syncedPosts()

    const byAccount = new Map<number, PostRow[]>()
    for (const post of posts) {
      if (post.youtubeVideoId?.startsWith('DRYRUN-')) {
        summary.checked += 1
        if (apply(post, dryRunDecision(post, now))) summary.changed += 1
        continue
      }
      const list = byAccount.get(post.accountId) ?? []
      list.push(post)
      byAccount.set(post.accountId, list)
    }

    for (const [accountId, accountPosts] of byAccount) {
      const account = repos.accounts.get(accountId)
      if (!account || account.removedAt || account.tokenStatus !== 'ok') {
        summary.skippedChannels += 1
        continue
      }
      for (const batch of batchIds(accountPosts)) {
        const ids = batch.map((p) => p.youtubeVideoId as string)
        let videos
        try {
          videos = await deps.withApi(accountId, (api) => api.videosStatus(ids))
        } catch (error) {
          const c = classifyGoogleError((error as { cause?: unknown }).cause ?? error)
          logger.warn(`[status] ${account.channelTitle}: videos.list failed (${c.kind})`, c.message)
          if (c.kind === 'quota') return finish(summary)
          summary.skippedChannels += 1
          break
        }
        const found = new Map(videos.map((v) => [v.id, v]))
        for (const post of batch) {
          summary.checked += 1
          const decision = decideSync(post, found.get(post.youtubeVideoId as string) ?? null)
          if (apply(post, decision)) summary.changed += 1
        }
      }
    }
    return finish(summary)
  }

  function finish(summary: SyncSummary): SyncSummary {
    lastRunAt = clock().getTime()
    if (summary.changed > 0) deps.emitChanged()
    if (summary.checked > 0) {
      logger.info(`[status] checked ${summary.checked}, changed ${summary.changed}`)
    }
    return summary
  }

  function runShared(): Promise<SyncSummary> {
    inFlight ??= syncOnce().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    name: 'status-sync',
    concurrency: () => 1,
    key: () => 'sync',

    findWork(now) {
      const posts = syncedPosts()
      if (posts.length === 0) return []
      const anyProcessing = posts.some((p) => p.status === 'processing')
      if (lastRunAt !== null && now.getTime() - lastRunAt < syncIntervalMs(anyProcessing)) return []
      return ['sync']
    },

    async run() {
      await runShared()
    },

    syncNow: runShared
  }
}
