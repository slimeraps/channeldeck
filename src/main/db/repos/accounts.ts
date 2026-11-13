import { asc, eq } from 'drizzle-orm'
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
  list(): AccountRow[]
  update(id: number, patch: AccountPatch): AccountRow
  setTokenStatus(id: number, status: TokenStatus): AccountRow
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

    list: () => db.select().from(accounts).orderBy(asc(accounts.createdAt), asc(accounts.id)).all(),

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

    remove(id) {
      db.delete(accounts).where(eq(accounts.id, id)).run()
    }
  }
  return repo
}
