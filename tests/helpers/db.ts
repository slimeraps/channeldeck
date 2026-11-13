import { resolve } from 'node:path'
import { defaultSettings } from '@shared/schemas/settings'
import { openDatabase, type OpenedDatabase } from '../../src/main/db/client'
import { createRepos, type Repos } from '../../src/main/db/repos'
import type { Clock } from '../../src/main/db/repos/common'

export const MIGRATIONS_FOLDER = resolve(__dirname, '../../drizzle')

/** A clock tests can move. Starts at 2026-11-12T12:00:00Z. */
export function manualClock(start = '2026-11-12T12:00:00.000Z'): Clock & {
  set(iso: string): void
  advance(ms: number): void
} {
  let current = new Date(start)
  const clock = (() => new Date(current)) as Clock & {
    set(iso: string): void
    advance(ms: number): void
  }
  clock.set = (iso) => {
    current = new Date(iso)
  }
  clock.advance = (ms) => {
    current = new Date(current.getTime() + ms)
  }
  return clock
}

export interface TestDb extends OpenedDatabase {
  repos: Repos
  clock: ReturnType<typeof manualClock>
}

/** Fresh in-memory database with every migration applied, plus repositories. */
export function createTestDb(): TestDb {
  const opened = openDatabase({ file: ':memory:', migrationsFolder: MIGRATIONS_FOLDER })
  const clock = manualClock()
  const repos = createRepos(opened.db, {
    defaults: defaultSettings({ homeDir: '/Users/test' }),
    clock
  })
  return { ...opened, repos, clock }
}

let channelCounter = 0

/** Inserts a YouTube channel with sensible defaults. */
export function seedAccount(
  repos: Repos,
  overrides: Partial<Parameters<Repos['accounts']['create']>[0]> = {}
) {
  channelCounter += 1
  return repos.accounts.create({
    channelId: `UC_test_${channelCounter}`,
    channelTitle: `Test Channel ${channelCounter}`,
    ...overrides
  })
}

let twitchCounter = 0

export function seedTwitchAccount(repos: Repos) {
  twitchCounter += 1
  return repos.twitchAccounts.create({
    broadcasterId: `${100000 + twitchCounter}`,
    login: `streamer${twitchCounter}`,
    displayName: `Streamer${twitchCounter}`,
    editorId: `${100000 + twitchCounter}`
  })
}

export function seedClip(
  repos: Repos,
  twitchAccountId: number,
  id: string,
  overrides: Partial<Parameters<Repos['clips']['upsertMany']>[0][number]> = {}
) {
  repos.clips.upsertMany([
    {
      id,
      twitchAccountId,
      title: `Clip ${id}`,
      gameId: null,
      creatorName: 'clipper',
      viewCount: 10,
      durationSec: 30,
      createdAtUtc: '2026-11-01T20:00:00Z',
      vodOffset: null,
      videoId: null,
      isFeatured: false,
      url: `https://clips.twitch.tv/${id}`,
      thumbnailUrl: null,
      ...overrides
    }
  ])
  return repos.clips.get(id)!
}
