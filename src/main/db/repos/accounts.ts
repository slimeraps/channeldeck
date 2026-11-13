import { asc, eq, isNull } from 'drizzle-orm'
import type { TokenStatus } from '@shared/constants/enums'
import type { Db } from '../client'
import { accounts } from '../schema'
import { type Clock, DuplicateError, isoNow, isUniqueViolation, NotFoundError } from './common'

/** A YouTube channel row. `encRefreshToken` is ciphertext; never send it to the renderer. */
export type AccountRow = typeof accounts.$inferSelect
export type NewAccount = Omit<typeof accounts.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
export type AccountPatch = Partial<Omit<NewAccount, 'channelId'>>

export interface AccountsRepo {
  create(input: NewAccount): AccountRow
  get(id: number): AccountRow | undefined
  require(id: number): AccountRow
  getByChannelId(channelId: string): AccountRow | undefined
  /** Connected channels; removed (archived) ones only with includeRemoved. */
  list(options?: { includeRemoved?: boolean }): AccountRow[]
  update(id: number, patch: AccountPatch): AccountRow
  setTokenStatus(id: number, status: TokenStatus): AccountRow
  /** Hides a channel that still has post history: clears its token and disables it. */
  archive(id: number): AccountRow
  /** Deletes the row. Fails (foreign key) if any post still references the channel. */
  remove(id: number): void
}

export function createAccountsRepo(db: Db, clock: Clock): AccountsRepo {
  const repo: AccountsRepo = {
    create(input) {
      try {
        const now = isoNow(clock)
        return db
          .insert(accounts)
          .values({ ...input, createdAt: now, updatedAt: now })
          .returning()
          .get()
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DuplicateError(`The channel ${input.channelTitle} is already connected.`)
        }
        throw error
      }
    },

    get: (id) => db.select().from(accounts).where(eq(accounts.id, id)).get(),

    require(id) {
      const row = repo.get(id)
      if (!row) throw new NotFoundError('YouTube channel', id)
      return row
    },

    getByChannelId: (channelId) =>
      db.select().from(accounts).where(eq(accounts.channelId, channelId)).get(),

    list: ({ includeRemoved = false } = {}) =>
      db
        .select()
        .from(accounts)
        .where(includeRemoved ? undefined : isNull(accounts.removedAt))
        .orderBy(asc(accounts.createdAt), asc(accounts.id))
        .all(),

    update(id, patch) {
      const row = db
        .update(accounts)
        .set({ ...patch, updatedAt: isoNow(clock) })
        .where(eq(accounts.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError('YouTube channel', id)
      return row
    },

    setTokenStatus: (id, status) => repo.update(id, { tokenStatus: status }),

    archive: (id) =>
      repo.update(id, {
        removedAt: isoNow(clock),
        encRefreshToken: null,
        enabled: false,
        tokenStatus: 'needs_reauth'
      }),

    remove(id) {
      db.delete(accounts).where(eq(accounts.id, id)).run()
    }
  }
  return repo
}
