import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

/**
 * Opening the database. No Electron imports, so tests can open an in-memory or temp-file
 * database with the same code path the app uses.
 */

export type Db = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  db: Db
  sqlite: Database.Database
  close: () => void
}

export interface OpenDatabaseOptions {
  /** File path, or ':memory:' for tests. */
  file: string
  /** Folder holding drizzle-kit's generated SQL and meta/_journal.json. */
  migrationsFolder: string
}

export function openDatabase({ file, migrationsFolder }: OpenDatabaseOptions): OpenedDatabase {
  const sqlite = new Database(file)
  try {
    // WAL: readers don't block the writer (job runner + UI queries at the same time).
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = NORMAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    const db = drizzle(sqlite, { schema })
    // Applies any migrations not yet recorded in __drizzle_migrations. Safe to run on every start.
    migrate(db, { migrationsFolder })

    return { db, sqlite, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
