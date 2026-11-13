import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lte,
  ne,
  or,
  type SQL,
  sql
} from 'drizzle-orm'
import type { PickOrder } from '@shared/constants/enums'
import type { Db } from '../client'
import { clips, games, posts } from '../schema'
import { type Clock, isoNow } from './common'

export type ClipRow = typeof clips.$inferSelect

/** Fields that come from Twitch's Get Clips. Download state, paths and `hidden` are ours. */
export interface ClipFromTwitch {
  id: string
  twitchAccountId: number
  title: string
  gameId: string | null
  creatorName: string | null
  viewCount: number
  durationSec: number
  createdAtUtc: string
  vodOffset: number | null
  videoId: string | null
  isFeatured: boolean
  url: string
  thumbnailUrl: string | null
}

export type ClipLocalPatch = Partial<
  Pick<
    ClipRow,
    | 'landscapePath'
    | 'portraitPath'
    | 'thumbPath'
    | 'fileSize'
    | 'downloadStatus'
    | 'hidden'
    | 'gameName'
  >
>

export interface ClipSearch {
  twitchAccountId: number
  sort: PickOrder
  gameId?: string
  minDurationSec?: number
  maxDurationSec?: number
  minViews?: number
  featuredOnly?: boolean
  posted?: 'posted' | 'unposted'
  /** UTC ISO bounds on created_at. */
  fromUtc?: string
  toUtc?: string
  titleSearch?: string
  includeHidden?: boolean
  limit: number
  offset: number
}

export interface ClipStats {
  total: number
  downloaded: number
  pendingDownloads: number
  failedDownloads: number
  bytesOnDisk: number
}

export interface UpsertResult {
  inserted: number
  updated: number
}

export interface ClipsRepo {
  /** Insert new clips, refresh Twitch fields (views, vod offset...) on existing ones. */
  upsertMany(items: ClipFromTwitch[]): UpsertResult
  get(id: string): ClipRow | undefined
  listForAccount(twitchAccountId: number, order?: PickOrder): ClipRow[]
  updateLocal(id: string, patch: ClipLocalPatch): void
  setHidden(ids: string[], hidden: boolean): void
  countForAccount(twitchAccountId: number): number
  search(query: ClipSearch): { items: ClipRow[]; total: number }
  gamesForAccount(twitchAccountId: number): { id: string; name: string }[]
  stats(twitchAccountId: number): ClipStats
  /** Clips that should download now: pending, or failed and past their retry time. */
  dueDownloads(
    twitchAccountId: number,
    nowUtc: string,
    maxAttempts: number,
    limit: number
  ): ClipRow[]
  hasDueDownloads(twitchAccountId: number, nowUtc: string, maxAttempts: number): boolean
  setDownload(
    id: string,
    patch: Partial<
      Pick<
        ClipRow,
        | 'downloadStatus'
        | 'downloadAttempts'
        | 'downloadError'
        | 'downloadRetryAfterUtc'
        | 'landscapePath'
        | 'portraitPath'
        | 'thumbPath'
        | 'fileSize'
      >
    >
  ): void
  /** Ids that a non-canceled post uses. */
  referencedIds(ids: string[]): Set<string>
  deleteUnreferenced(twitchAccountId: number): number
  fillGameNames(): void
  /** Downloaded, visible clips of these Twitch accounts: what autopost rules pick from. */
  bankFor(twitchAccountIds: number[]): ClipRow[]
}

export function createClipsRepo(db: Db, clock: Clock): ClipsRepo {
  return {
    upsertMany(items) {
      if (items.length === 0) return { inserted: 0, updated: 0 }
      const now = isoNow(clock)
      return db.transaction((tx) => {
        const existing = new Set(
          tx
            .select({ id: clips.id })
            .from(clips)
            .where(
              inArray(
                clips.id,
                items.map((c) => c.id)
              )
            )
            .all()
            .map((r) => r.id)
        )
        for (const item of items) {
          tx.insert(clips)
            .values({ ...item, firstSeenUtc: now, updatedAt: now })
            .onConflictDoUpdate({
              target: clips.id,
              set: {
                title: sql`excluded.title`,
                gameId: sql`excluded.game_id`,
                creatorName: sql`excluded.creator_name`,
                viewCount: sql`excluded.view_count`,
                durationSec: sql`excluded.duration_sec`,
                vodOffset: sql`excluded.vod_offset`,
                videoId: sql`excluded.video_id`,
                isFeatured: sql`excluded.is_featured`,
                url: sql`excluded.url`,
                thumbnailUrl: sql`excluded.thumbnail_url`,
                updatedAt: now
              }
            })
            .run()
        }
        // Fill game names we already know.
        tx.run(sql`
          UPDATE ${clips} SET game_name = (SELECT ${games.name} FROM ${games} WHERE ${games.id} = ${clips.gameId})
          WHERE ${clips.gameName} IS NULL AND ${clips.gameId} IS NOT NULL
        `)
        const inserted = items.filter((c) => !existing.has(c.id)).length
        return { inserted, updated: items.length - inserted }
      })
    },

    get: (id) => db.select().from(clips).where(eq(clips.id, id)).get(),

    listForAccount(twitchAccountId, order = 'oldest') {
      const orderBy =
        order === 'newest'
          ? [desc(clips.createdAtUtc), desc(clips.id)]
          : order === 'most_viewed'
            ? [desc(clips.viewCount), asc(clips.createdAtUtc)]
            : [asc(clips.createdAtUtc), asc(clips.id)]
      return db
        .select()
        .from(clips)
        .where(eq(clips.twitchAccountId, twitchAccountId))
        .orderBy(...orderBy)
        .all()
    },

    updateLocal(id, patch) {
      db.update(clips)
        .set({ ...patch, updatedAt: isoNow(clock) })
        .where(eq(clips.id, id))
        .run()
    },

    setHidden(ids, hidden) {
      if (ids.length === 0) return
      db.update(clips)
        .set({ hidden, updatedAt: isoNow(clock) })
        .where(and(inArray(clips.id, ids)))
        .run()
    },

    search(q) {
      const filters: SQL[] = [eq(clips.twitchAccountId, q.twitchAccountId)]
      if (!q.includeHidden) filters.push(eq(clips.hidden, false))
      if (q.gameId) filters.push(eq(clips.gameId, q.gameId))
      if (q.minDurationSec !== undefined) filters.push(gte(clips.durationSec, q.minDurationSec))
      if (q.maxDurationSec !== undefined) filters.push(lte(clips.durationSec, q.maxDurationSec))
      if (q.minViews !== undefined) filters.push(gte(clips.viewCount, q.minViews))
      if (q.featuredOnly) filters.push(eq(clips.isFeatured, true))
      if (q.fromUtc) filters.push(gte(clips.createdAtUtc, q.fromUtc))
      if (q.toUtc) filters.push(lte(clips.createdAtUtc, q.toUtc))
      if (q.titleSearch?.trim())
        filters.push(like(clips.title, `%${q.titleSearch.trim().replace(/[%_]/g, '')}%`))
      const used = sql`EXISTS (SELECT 1 FROM ${posts} WHERE ${posts.clipId} = ${clips.id} AND ${posts.status} <> 'canceled')`
      if (q.posted === 'posted') filters.push(used)
      if (q.posted === 'unposted') filters.push(sql`NOT ${used}`)
      const where = and(...filters)

      const orderBy =
        q.sort === 'newest'
          ? [desc(clips.createdAtUtc), desc(clips.id)]
          : q.sort === 'most_viewed'
            ? [desc(clips.viewCount), asc(clips.createdAtUtc)]
            : [asc(clips.createdAtUtc), asc(clips.id)]
      const items = db
        .select()
        .from(clips)
        .where(where)
        .orderBy(...orderBy)
        .limit(q.limit)
        .offset(q.offset)
        .all()
      const total =
        db
          .select({ n: sql<number>`count(*)` })
          .from(clips)
          .where(where)
          .get()?.n ?? 0
      return { items, total }
    },

    gamesForAccount(twitchAccountId) {
      return db
        .selectDistinct({ id: clips.gameId, name: clips.gameName })
        .from(clips)
        .where(
          and(
            eq(clips.twitchAccountId, twitchAccountId),
            sql`${clips.gameId} IS NOT NULL AND ${clips.gameId} <> ''`
          )
        )
        .all()
        .map((g) => ({ id: g.id as string, name: g.name ?? `Game ${g.id}` }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    stats(twitchAccountId) {
      const row = db
        .select({
          total: sql<number>`count(*)`,
          downloaded: sql<number>`sum(case when ${clips.downloadStatus} = 'downloaded' then 1 else 0 end)`,
          pending: sql<number>`sum(case when ${clips.downloadStatus} in ('pending', 'downloading') then 1 else 0 end)`,
          failed: sql<number>`sum(case when ${clips.downloadStatus} = 'failed' then 1 else 0 end)`,
          bytes: sql<number>`sum(case when ${clips.downloadStatus} = 'downloaded' then coalesce(${clips.fileSize}, 0) else 0 end)`
        })
        .from(clips)
        .where(eq(clips.twitchAccountId, twitchAccountId))
        .get()
      return {
        total: row?.total ?? 0,
        downloaded: row?.downloaded ?? 0,
        pendingDownloads: row?.pending ?? 0,
        failedDownloads: row?.failed ?? 0,
        bytesOnDisk: row?.bytes ?? 0
      }
    },

    dueDownloads(twitchAccountId, nowUtc, maxAttempts, limit) {
      return db
        .select()
        .from(clips)
        .where(
          and(
            eq(clips.twitchAccountId, twitchAccountId),
            or(
              eq(clips.downloadStatus, 'pending'),
              and(
                eq(clips.downloadStatus, 'failed'),
                sql`${clips.downloadAttempts} < ${maxAttempts}`,
                or(isNull(clips.downloadRetryAfterUtc), lte(clips.downloadRetryAfterUtc, nowUtc))
              )
            )
          )
        )
        .orderBy(asc(clips.createdAtUtc))
        .limit(limit)
        .all()
    },

    hasDueDownloads(twitchAccountId, nowUtc, maxAttempts) {
      return this.dueDownloads(twitchAccountId, nowUtc, maxAttempts, 1).length > 0
    },

    setDownload(id, patch) {
      db.update(clips)
        .set({ ...patch, updatedAt: isoNow(clock) })
        .where(eq(clips.id, id))
        .run()
    },

    referencedIds(ids) {
      if (ids.length === 0) return new Set()
      return new Set(
        db
          .selectDistinct({ id: posts.clipId })
          .from(posts)
          .where(and(inArray(posts.clipId, ids), ne(posts.status, 'canceled')))
          .all()
          .map((r) => r.id as string)
      )
    },

    deleteUnreferenced(twitchAccountId) {
      return db
        .delete(clips)
        .where(
          and(
            eq(clips.twitchAccountId, twitchAccountId),
            sql`NOT EXISTS (SELECT 1 FROM ${posts} WHERE ${posts.clipId} = ${clips.id})`
          )
        )
        .run().changes
    },

    fillGameNames() {
      db.run(sql`
        UPDATE ${clips} SET game_name = (SELECT ${games.name} FROM ${games} WHERE ${games.id} = ${clips.gameId})
        WHERE ${clips.gameName} IS NULL AND ${clips.gameId} IS NOT NULL
      `)
    },

    bankFor(twitchAccountIds) {
      if (twitchAccountIds.length === 0) return []
      return db
        .select()
        .from(clips)
        .where(
          and(
            inArray(clips.twitchAccountId, twitchAccountIds),
            eq(clips.downloadStatus, 'downloaded'),
            eq(clips.hidden, false)
          )
        )
        .all()
    },

    countForAccount(twitchAccountId) {
      const row = db
        .select({ n: sql<number>`count(*)` })
        .from(clips)
        .where(eq(clips.twitchAccountId, twitchAccountId))
        .get()
      return row?.n ?? 0
    }
  }
}
