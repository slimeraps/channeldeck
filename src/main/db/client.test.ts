import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('keeps child rows when a migration rebuilds a parent table', () => {
    // A copy of the migrations folder that stops before 0002 (which rebuilds `posts`).
    const dir = mkdtempSync(join(tmpdir(), 'channeldeck-mig-'))
    dirs.push(dir)
    const partial = join(dir, 'drizzle')
    cpSync(MIGRATIONS_FOLDER, partial, { recursive: true })
    const journalPath = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
    const rebuildIndex = journal.entries.findIndex((e) => e.tag.startsWith('0002_'))
    expect(rebuildIndex).toBeGreaterThan(0)
    journal.entries = journal.entries.slice(0, rebuildIndex)
    writeFileSync(journalPath, JSON.stringify(journal))

    const file = tempDbFile()
    const old = openDatabase({ file, migrationsFolder: partial })
    old.sqlite.exec(`
      INSERT INTO accounts (id, channel_id, channel_title) VALUES (1, 'UC1', 'Drift');
      INSERT INTO posts (id, account_id, status, made_for_kids) VALUES ('p1', 1, 'queued', 0);
      INSERT INTO post_steps (post_id, step) VALUES ('p1', 'insert'), ('p1', 'thumbnail');
      INSERT INTO event_log (at_utc, kind, message, post_id) VALUES ('2026-11-12T00:00:00Z', 'post.created', 'x', 'p1');
      INSERT INTO quota_usage (at_utc, quota_day, bucket, method, cost, post_id)
        VALUES ('2026-11-12T00:00:00Z', '2026-11-12', 'units', 'videos.list', 1, 'p1');
    `)
    old.close()

    const upgraded = openDatabase({ file, migrationsFolder: MIGRATIONS_FOLDER })
    const one = (q: string): unknown => upgraded.sqlite.prepare(q).get()
    expect(one('SELECT count(*) AS n FROM post_steps')).toEqual({ n: 2 })
    expect(one('SELECT post_id FROM event_log')).toEqual({ post_id: 'p1' })
    expect(one('SELECT post_id FROM quota_usage')).toEqual({ post_id: 'p1' })
    expect(one("SELECT status, made_for_kids FROM posts WHERE id = 'p1'")).toEqual({
      status: 'queued',
      made_for_kids: 0
    })
    // The rebuilt table still has the never-twice partial index.
    expect(
      one("SELECT count(*) AS n FROM sqlite_master WHERE name = 'posts_clip_account_active_uq'")
    ).toEqual({ n: 1 })
    expect(upgraded.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    upgraded.close()
  })
  it('gives existing Twitch channels distinct colors when adding the color column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'channeldeck-mig-'))
    dirs.push(dir)
    const partial = join(dir, 'drizzle')
    cpSync(MIGRATIONS_FOLDER, partial, { recursive: true })
    const journalPath = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
    const colorIndex = journal.entries.findIndex((e) => e.tag.startsWith('0006_'))
    expect(colorIndex).toBeGreaterThan(0)
    journal.entries = journal.entries.slice(0, colorIndex)
    writeFileSync(journalPath, JSON.stringify(journal))

    const file = tempDbFile()
    const old = openDatabase({ file, migrationsFolder: partial })
    old.sqlite.exec(`
      INSERT INTO twitch_accounts (id, broadcaster_id, login, display_name, editor_id)
        VALUES (5, 'b5', 'first', 'First', 'b5'), (9, 'b9', 'second', 'Second', 'b9'),
               (12, 'b12', 'third', 'Third', 'b12');
    `)
    old.close()

    const upgraded = openDatabase({ file, migrationsFolder: MIGRATIONS_FOLDER })
    expect(
      upgraded.sqlite.prepare('SELECT login, color FROM twitch_accounts ORDER BY id').all()
    ).toEqual([
      { login: 'first', color: '#6366f1' },
      { login: 'second', color: '#f97316' },
      { login: 'third', color: '#22c55e' }
    ])
    upgraded.close()
  })
})
