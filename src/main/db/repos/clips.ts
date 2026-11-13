import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { PickOrder } from '@shared/constants/enums'
import type { Db } from '../client'
import { clips, games } from '../schema'
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
