import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../client'
import { autopostRules, games, layoutPresets, series, templates } from '../schema'
import { type Clock, isoNow, NotFoundError } from './common'

/**
 * Smaller aggregates: games cache, layout presets, autopost rules, templates and series.
 * Their behaviour (planner, crop editor, template rendering) lands in later phases; these
 * are the storage operations they build on.
 */

// --- Games -----------------------------------------------------------------------------

export type GameRow = typeof games.$inferSelect

export interface GamesRepo {
  upsertMany(items: { id: string; name: string; boxArtUrl?: string | null }[]): void
  namesFor(ids: string[]): Map<string, string>
  missing(ids: string[]): string[]
}

export function createGamesRepo(db: Db, clock: Clock): GamesRepo {
  const repo: GamesRepo = {
    upsertMany(items) {
      const now = isoNow(clock)
      db.transaction((tx) => {
        for (const item of items) {
          tx.insert(games)
            .values({
              id: item.id,
              name: item.name,
              boxArtUrl: item.boxArtUrl ?? null,
              updatedAt: now
            })
            .onConflictDoUpdate({
              target: games.id,
              set: {
                name: sql`excluded.name`,
                boxArtUrl: sql`excluded.box_art_url`,
                updatedAt: now
              }
            })
            .run()
        }
      })
    },
    namesFor(ids) {
      if (ids.length === 0) return new Map()
      const rows = db.select().from(games).where(inArray(games.id, ids)).all()
      return new Map(rows.map((r) => [r.id, r.name]))
    },
    missing(ids) {
      const known = repo.namesFor(ids)
      return [...new Set(ids)].filter((id) => !known.has(id))
    }
  }
  return repo
}

// --- Generic CRUD for the rest ------------------------------------------------------------

export interface CrudRepo<Row, Insert> {
  create(input: Insert): Row
  get(id: number): Row | undefined
  require(id: number): Row
  list(): Row[]
  update(id: number, patch: Partial<Insert>): Row
  remove(id: number): void
}

type WithTimestamps = { createdAt?: string; updatedAt?: string }

function createCrud<
  T extends typeof layoutPresets | typeof autopostRules | typeof templates | typeof series
>(
  db: Db,
  clock: Clock,
  table: T,
  label: string
): CrudRepo<T['$inferSelect'], Omit<T['$inferInsert'], 'id' | 'createdAt' | 'updatedAt'>> {
  // Drizzle's generic table types don't narrow well across a union; the casts below are
  // limited to this helper and every public method is typed by the caller's table.
  type Row = T['$inferSelect']
  type Insert = Omit<T['$inferInsert'], 'id' | 'createdAt' | 'updatedAt'>
  const t = table as typeof templates
  const repo: CrudRepo<Row, Insert> = {
    create(input) {
      const now = isoNow(clock)
      const values = { ...input, createdAt: now, updatedAt: now } as WithTimestamps
      return db
        .insert(t)
        .values(values as typeof templates.$inferInsert)
        .returning()
        .get() as Row
    },
    get: (id) => db.select().from(t).where(eq(t.id, id)).get() as Row | undefined,
    require(id) {
      const row = repo.get(id)
      if (!row) throw new NotFoundError(label, id)
      return row
    },
    list: () => db.select().from(t).orderBy(asc(t.id)).all() as Row[],
    update(id, patch) {
      const row = db
        .update(t)
        .set({ ...(patch as Partial<typeof templates.$inferInsert>), updatedAt: isoNow(clock) })
        .where(eq(t.id, id))
        .returning()
        .get()
      if (!row) throw new NotFoundError(label, id)
      return row as Row
    },
    remove(id) {
      db.delete(t).where(eq(t.id, id)).run()
    }
  }
  return repo
}

export type LayoutPresetRow = typeof layoutPresets.$inferSelect
export type AutopostRuleRow = typeof autopostRules.$inferSelect
export type TemplateRow = typeof templates.$inferSelect
export type SeriesRow = typeof series.$inferSelect

export const createLayoutPresetsRepo = (db: Db, clock: Clock) =>
  createCrud(db, clock, layoutPresets, 'Layout preset')
export interface AutopostRulesRepo extends CrudRepo<
  AutopostRuleRow,
  Omit<typeof autopostRules.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
> {
  /** Atomically returns the rule's next {{n}} and advances it. */
  takeNextNumber(id: number): number
  /** Remembers a clip the rule must not pick again. */
  addSkipped(id: number, clipId: string): void
}

export function createAutopostRulesRepo(db: Db, clock: Clock): AutopostRulesRepo {
  const crud = createCrud(db, clock, autopostRules, 'Autopost rule')
  return {
    ...crud,
    takeNextNumber(id) {
      const row = db
        .update(autopostRules)
        .set({ nextNumber: sql`${autopostRules.nextNumber} + 1`, updatedAt: isoNow(clock) })
        .where(eq(autopostRules.id, id))
        .returning({ next: autopostRules.nextNumber })
        .get()
      if (!row) throw new NotFoundError('Autopost rule', id)
      return row.next - 1
    },
    addSkipped(id, clipId) {
      db.transaction((tx) => {
        const rule = tx.select().from(autopostRules).where(eq(autopostRules.id, id)).get()
        if (!rule || rule.skippedClipIdsJson.includes(clipId)) return
        tx.update(autopostRules)
          .set({
            skippedClipIdsJson: [...rule.skippedClipIdsJson, clipId],
            updatedAt: isoNow(clock)
          })
          .where(eq(autopostRules.id, id))
          .run()
      })
    }
  }
}
export const createTemplatesRepo = (db: Db, clock: Clock) =>
  createCrud(db, clock, templates, 'Template')

export interface SeriesRepo extends CrudRepo<
  SeriesRow,
  Omit<typeof series.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
> {
  /** Atomically returns the series' next number and advances the counter. */
  takeNextNumber(id: number): number
}

export function createSeriesRepo(db: Db, clock: Clock): SeriesRepo {
  const crud = createCrud(db, clock, series, 'Series')
  return {
    ...crud,
    takeNextNumber(id) {
      const row = db
        .update(series)
        .set({ nextNumber: sql`${series.nextNumber} + 1`, updatedAt: isoNow(clock) })
        .where(eq(series.id, id))
        .returning({ next: series.nextNumber })
        .get()
      if (!row) throw new NotFoundError('Series', id)
      return row.next - 1
    }
  }
}
