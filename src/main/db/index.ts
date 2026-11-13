import { join } from 'node:path'
import { app } from 'electron'
import { defaultSettings } from '@shared/schemas/settings'
import { logger } from '../logger'
import { openDatabase, type OpenedDatabase } from './client'
import { createRepos, type Repos } from './repos'

export const DB_FILE_NAME = 'channeldeck.db'

let opened: OpenedDatabase | null = null
let repos: Repos | null = null

export function databasePath(): string {
  return join(app.getPath('userData'), DB_FILE_NAME)
}

/** drizzle-kit's SQL lives in ./drizzle; electron-builder copies it to Resources/drizzle. */
function migrationsFolder(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}

/** Opens ~/Library/Application Support/ChannelDeck/channeldeck.db and applies migrations. */
export function initDatabase(): Repos {
  if (repos) return repos
  const file = databasePath()
  opened = openDatabase({ file, migrationsFolder: migrationsFolder() })
  repos = createRepos(opened.db, {
    defaults: defaultSettings({ homeDir: app.getPath('home') }),
    onSettingsWarning: ({ key, message }) => logger.warn(`[settings] ${key}: ${message}`)
  })
  logger.info(`[db] opened ${file}`)
  return repos
}

export function getRepos(): Repos {
  if (!repos) throw new Error('Database not initialized; call initDatabase() first')
  return repos
}

export function closeDatabase(): void {
  if (!opened) return
  try {
    // Fold the WAL back into the main file so a quit leaves one tidy file.
    opened.sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    logger.warn('[db] checkpoint on close failed', error)
  }
  opened.close()
  opened = null
  repos = null
}
