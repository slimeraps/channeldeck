import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_FOLDER } from '../../../tests/helpers/db'
import { openDatabase } from './client'

const EXPECTED_TABLES = [
  'accounts',
  'autopost_rules',
  'clips',
  'event_log',
  'games',
  'layout_presets',
  'post_steps',
  'posts',
  'quota_usage',
  'series',
  'settings',
  'templates',
  'twitch_accounts'
]

const dirs: string[] = []
function tempDbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'channeldeck-db-'))
  dirs.push(dir)
  return join(dir, 'channeldeck.db')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('creates every table on a fresh database', () => {
    const { sqlite, close } = openDatabase({
      file: ':memory:',
      migrationsFolder: MIGRATIONS_FOLDER
    })
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
      )
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(EXPECTED_TABLES)
    close()
  })

  it('is idempotent: reopening applies nothing twice and keeps data', () => {
    const file = tempDbFile()
    const first = openDatabase({ file, migrationsFolder: MIGRATIONS_FOLDER })
    first.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES ('dryRun', 'true')").run()
    const applied = first.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()
    first.close()

    const second = openDatabase({ file, migrationsFolder: MIGRATIONS_FOLDER })
    expect(second.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual(
      applied
    )
    expect(
      second.sqlite.prepare("SELECT value_json FROM settings WHERE key = 'dryRun'").get()
    ).toEqual({
      value_json: 'true'
    })
    second.close()
  })

  it('turns on WAL and foreign keys', () => {
    const { sqlite, close } = openDatabase({
      file: tempDbFile(),
      migrationsFolder: MIGRATIONS_FOLDER
    })
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    close()
  })

  it('enforces foreign keys', () => {
    const { sqlite, close } = openDatabase({
      file: ':memory:',
      migrationsFolder: MIGRATIONS_FOLDER
    })
    expect(() =>
      sqlite.prepare("INSERT INTO posts (id, account_id, status) VALUES ('p1', 999, 'draft')").run()
    ).toThrow(/FOREIGN KEY/)
    close()
  })

  it('fails loudly when the migrations folder is missing', () => {
    expect(() =>
      openDatabase({ file: ':memory:', migrationsFolder: join(tmpdir(), 'no-such-migrations') })
    ).toThrow()
  })
})
