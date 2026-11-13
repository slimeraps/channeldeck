import { asc, eq } from 'drizzle-orm'
import type { TokenStatus } from '@shared/constants/enums'
import type { BackfillCursor } from '@shared/types/json'
import type { Db } from '../client'
import { twitchAccounts } from '../schema'
import { type Clock, DuplicateError, isoNow, isUniqueViolation, NotFoundError } from './common'

export type TwitchAccountRow = typeof twitchAccounts.$inferSelect
export type NewTwitchAccount = Omit<typeof twitchAccounts.$inferInsert, 'id' | 'createdAt'>
export type TwitchAccountPatch = Partial<Omit<NewTwitchAccount, 'broadcasterId'>>

export interface TwitchAccountsRepo {
  create(input: NewTwitchAccount): TwitchAccountRow
  get(id: number): TwitchAccountRow | undefined
  require(id: number): TwitchAccountRow
  getByBroadcasterId(broadcasterId: string): TwitchAccountRow | undefined
  list(): TwitchAccountRow[]
  update(id: number, patch: TwitchAccountPatch): TwitchAccountRow
  setTokenStatus(id: number, status: TokenStatus): TwitchAccountRow
  /** Saves backfill progress so it resumes after a quit; null when the backfill is done. */
  setBackfillCursor(id: number, cursor: BackfillCursor | null): TwitchAccountRow
  markSynced(id: number, atUtc: string): TwitchAccountRow
  remove(id: number): void
}

export function createTwitchAccountsRepo(db: Db, clock: Clock): TwitchAccountsRepo {
  const repo: TwitchAccountsRepo = {
    create(input) {
      try {
        return db
          .insert(twitchAccounts)
          .values({ ...input, createdAt: isoNow(clock) })
          .returning()
          .get()
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateError(`The Twitch channel ${input.displayName} is already connected.`)
        }
        throw error
      }
    },

    get: (id) => db.select().from(twitchAccounts).where(eq(twitchAccounts.id, id)).get(),

    require(id) {
      const row = repo.get(id)
      if (!row) throw new NotFoundError('Twitch account', id)
      return row
    },

    getByBroadcasterId: (broadcasterId) =>
      db.select().from(twitchAccounts).where(eq(twitchAccounts.broadcasterId, broadcasterId)).get(),

    list: () =>
      db
        .select()
        .from(twitchAccounts)
        .orderBy(asc(twitchAccounts.createdAt), asc(twitchAccounts.id))
        .all(),

    update(id, patch) {
      const row = db
        .update(twitchAccounts)
        .set(patch)
        .where(eq(twitchAccounts.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError('Twitch account', id)
      return row
    },

    setTokenStatus: (id, status) => repo.update(id, { tokenStatus: status }),
    setBackfillCursor: (id, cursor) => repo.update(id, { backfillCursorJson: cursor }),
    markSynced: (id, atUtc) => repo.update(id, { lastSyncUtc: atUtc }),

    remove(id) {
      db.delete(twitchAccounts).where(eq(twitchAccounts.id, id)).run()
    }
  }
  return repo
}
