import type { Repos } from '../db/repos'
import type { ClipFromTwitch } from '../db/repos/clips'
import type { TwitchAccountRow } from '../db/repos/twitchAccounts'
import {
  advanceBackfill,
  dailySyncRange,
  isDailySyncDue,
  nextBackfillWindow,
  splitWindow,
  type TimeWindow,
  timeWindows,
  WINDOW_SPLIT_THRESHOLD
} from '../domain/clips'
import type { Helix, TwitchClip } from '../twitch/helix'
import type { JobType } from './runner'

/**
 * Pulls clips from Twitch into the bank: first a resumable backfill in 7-day windows
 * (oldest first, position saved after every window), then a daily sync from the last
 * success minus 2 days. Get Clips is ordered by views and capped at ~1,000 per query, so it
 * always works in time windows and splits any window that gets close to the cap.
 */

export interface ClipSyncDeps {
  repos: Repos
  helixFor: (accountId: number, signal?: AbortSignal) => Helix
  /** "Sync now" requests (cleared as they're picked up). */
  forceSync: Set<number>
  notify: (title: string, body: string) => void
  emitChanged: () => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: () => Date
  /** IANA zone for the daily sync time (default: the Mac's). */
  zone?: string
}

export interface ClipSyncJob extends JobType<number> {
  syncingNow(): Set<number>
}

const FAILURE_BACKOFF_MS = [5, 15, 60].map((m) => m * 60_000)

export function toClipRow(c: TwitchClip, twitchAccountId: number): ClipFromTwitch {
  return {
    id: c.id,
    twitchAccountId,
    title: c.title,
    gameId: c.game_id || null,
    creatorName: c.creator_name || null,
    viewCount: c.view_count,
    durationSec: c.duration,
    createdAtUtc: new Date(c.created_at).toISOString(),
    vodOffset: c.vod_offset ?? null,
    videoId: c.video_id || null,
    isFeatured: c.is_featured,
    url: c.url,
    thumbnailUrl: c.thumbnail_url || null
  }
}

/** Every clip in a window, following pages and splitting the window if it's crowded. */
export async function fetchWindow(
  helix: Helix,
  broadcasterId: string,
  window: TimeWindow
): Promise<TwitchClip[]> {
  const found = new Map<string, TwitchClip>()
  let after: string | undefined
  do {
    const page = await helix.getClipsPage({
      broadcasterId,
      startedAt: window.start,
      endedAt: window.end,
      ...(after ? { after } : {})
    })
    for (const clip of page.clips) found.set(clip.id, clip)
    after = page.cursor ?? undefined
  } while (after)

  if (found.size >= WINDOW_SPLIT_THRESHOLD) {
    const halves = splitWindow(window)
    if (halves) {
      for (const half of halves) {
        for (const clip of await fetchWindow(helix, broadcasterId, half)) found.set(clip.id, clip)
      }
    }
  }
  return [...found.values()]
}

export function createClipSyncJob(deps: ClipSyncDeps): ClipSyncJob {
  const { repos, logger } = deps
  const clock = deps.clock ?? (() => new Date())
  const failures = new Map<number, { count: number; retryAt: number }>()
  const active = new Set<number>()

  function ready(a: TwitchAccountRow): boolean {
    return a.syncEnabled && a.tokenStatus === 'ok'
  }

  async function resolveGames(helix: Helix, gameIds: (string | null)[]): Promise<void> {
    const missing = repos.games.missing(gameIds.filter((g): g is string => Boolean(g)))
    if (missing.length === 0) return
    try {
      const found = await helix.getGames(missing)
      repos.games.upsertMany(
        found.map((g) => ({ id: g.id, name: g.name, boxArtUrl: g.box_art_url }))
      )
      repos.clips.fillGameNames()
    } catch (error) {
      logger.warn('[clips] could not look up game names (will retry next sync)', error)
    }
  }

  async function syncWindow(account: TwitchAccountRow, helix: Helix, window: TimeWindow) {
    const fetched = await fetchWindow(helix, account.broadcasterId, window)
    const result = repos.clips.upsertMany(fetched.map((c) => toClipRow(c, account.id)))
    await resolveGames(
      helix,
      fetched.map((c) => c.game_id)
    )
    return result
  }

  async function runBackfill(
    account: TwitchAccountRow,
    helix: Helix,
    signal: AbortSignal
  ): Promise<void> {
    let cursor = account.backfillCursorJson
    let inserted = 0
    while (cursor && !signal.aborted) {
      const window = nextBackfillWindow(cursor)
      if (!window) {
        cursor = null
        break
      }
      inserted += (await syncWindow(account, helix, window)).inserted
      cursor = advanceBackfill(cursor, window)
      // Saved after every window, so a quit resumes from here.
      repos.twitchAccounts.setBackfillCursor(account.id, cursor)
      deps.emitChanged()
    }
    if (!cursor) {
      // Backfill done: the daily sync carries on from where it stopped.
      const end = account.backfillCursorJson?.endUtc ?? clock().toISOString()
      repos.twitchAccounts.markSynced(account.id, end)
      const total = repos.clips.countForAccount(account.id)
      repos.eventLog.write({
        kind: 'clips.backfill_done',
        message: `Backfill finished: ${total} clips`,
        twitchAccountId: account.id
      })
      deps.notify(
        'Clip backfill finished',
        `${account.displayName}: ${total} clips are in the bank.`
      )
      logger.info(`[clips] backfill done for ${account.login} (+${inserted})`)
    }
  }

  async function runDaily(
    account: TwitchAccountRow,
    helix: Helix,
    signal: AbortSignal
  ): Promise<void> {
    const startedAt = clock()
    const fallback =
      account.backfillFromUtc ?? new Date(startedAt.getTime() - 7 * 86_400_000).toISOString()
    const range = dailySyncRange(account.lastSyncUtc, startedAt, fallback)
    let inserted = 0
    let updated = 0
    for (const window of timeWindows(range.start, range.end)) {
      if (signal.aborted) return
      const r = await syncWindow(account, helix, window)
      inserted += r.inserted
      updated += r.updated
    }
    repos.twitchAccounts.markSynced(account.id, startedAt.toISOString())
    repos.eventLog.write({
      kind: 'clips.sync',
      message: `Clip sync: ${inserted} new, ${updated} refreshed`,
      twitchAccountId: account.id,
      data: { inserted, updated, from: range.start, to: range.end }
    })
    if (inserted > 0) {
      deps.notify(
        `${inserted} new clip${inserted === 1 ? '' : 's'}`,
        `${account.displayName}: added to the clip bank.`
      )
    }
    logger.info(`[clips] ${account.login}: ${inserted} new, ${updated} refreshed`)
  }

  return {
    name: 'clip-sync',
    concurrency: () => 2,
    key: (id) => String(id),
    syncingNow: () => new Set(active),

    findWork(now) {
      const syncTime = repos.settings.getKey('dailySyncTime')
      return repos.twitchAccounts
        .list()
        .filter((a) => {
          if (!ready(a)) return false
          const failure = failures.get(a.id)
          const forced = deps.forceSync.has(a.id)
          if (failure && failure.retryAt > now.getTime() && !forced) return false
          return (
            Boolean(a.backfillCursorJson) ||
            forced ||
            isDailySyncDue(now, a.lastSyncUtc, syncTime, deps.zone)
          )
        })
        .map((a) => a.id)
    },

    async run(accountId, signal) {
      const account = repos.twitchAccounts.get(accountId)
      if (!account || !ready(account)) return
      const forced = deps.forceSync.delete(accountId)
      active.add(accountId)
      deps.emitChanged()
      try {
        const helix = deps.helixFor(accountId, signal)
        if (account.backfillCursorJson) await runBackfill(account, helix, signal)
        else await runDaily(account, helix, signal)
        failures.delete(accountId)
      } catch (error) {
        if (signal.aborted) return
        const count = (failures.get(accountId)?.count ?? 0) + 1
        const wait =
          FAILURE_BACKOFF_MS[Math.min(count, FAILURE_BACKOFF_MS.length) - 1] ?? 60 * 60_000
        failures.set(accountId, { count, retryAt: clock().getTime() + wait })
        const message = error instanceof Error ? error.message : String(error)
        repos.eventLog.write({
          kind: 'clips.sync_failed',
          level: 'warn',
          message,
          twitchAccountId: accountId
        })
        logger.warn(
          `[clips] sync for ${account.login} failed (retry in ${wait / 60_000} min)`,
          error
        )
        if (forced) deps.notify('Clip sync failed', `${account.displayName}: ${message}`)
      } finally {
        active.delete(accountId)
        deps.emitChanged()
      }
    }
  }
}
