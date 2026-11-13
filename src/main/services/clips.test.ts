import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipSearchInput } from '@shared/schemas/twitch'
import {
  createTestDb,
  seedAccount,
  seedClip,
  seedTwitchAccount,
  type TestDb
} from '../../../tests/helpers/db'
import { createMediaAccess } from '../media/access'
import { type ClipsService, createClipsService } from './clips'

let t: TestDb
let clips: ClipsService
let a: number
let b: number
let c: number

const base: ClipSearchInput = { sort: 'oldest', limit: 50, offset: 0 }
const ids = (r: { items: { id: string }[] }): string[] => r.items.map((i) => i.id)

beforeEach(() => {
  t = createTestDb()
  a = seedTwitchAccount(t.repos).id
  b = seedTwitchAccount(t.repos).id
  c = seedTwitchAccount(t.repos).id
  t.repos.twitchAccounts.update(a, { color: '#22c55e', displayName: 'Alpha' })
  t.repos.twitchAccounts.update(b, { color: '#ec4899', displayName: 'Bravo' })
  seedClip(t.repos, a, 'a1', {
    createdAtUtc: '2026-11-01T10:00:00.000Z',
    gameId: 'mw4'
  })
  seedClip(t.repos, b, 'b1', {
    createdAtUtc: '2026-11-02T10:00:00.000Z',
    gameId: 'ac',
    viewCount: 900
  })
  seedClip(t.repos, a, 'a2', { createdAtUtc: '2026-11-03T10:00:00.000Z' })
  seedClip(t.repos, c, 'c1', {
    createdAtUtc: '2026-11-04T10:00:00.000Z',
    gameId: 'ow'
  })
  t.repos.games.upsertMany([
    { id: 'mw4', name: 'MW4' },
    { id: 'ac', name: 'AC' },
    { id: 'ow', name: 'OW' }
  ])
  t.repos.clips.fillGameNames()
  clips = createClipsService({
    repos: t.repos,
    media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
    probe: vi.fn(),
    emitChanged: vi.fn(),
    emitPostsChanged: vi.fn(),
    kickJobs: vi.fn()
  })
})

afterEach(() => t.close())

describe('clip search across channels', () => {
  it('searches every channel when none are picked, sorted across all of them', () => {
    expect(ids(clips.search(base))).toEqual(['a1', 'b1', 'a2', 'c1'])
    expect(ids(clips.search({ ...base, sort: 'most_viewed' }))[0]).toBe('b1')
    expect(clips.search(base).total).toBe(4)
  })

  it('searches only the picked channels', () => {
    expect(ids(clips.search({ ...base, twitchAccountIds: [a] }))).toEqual(['a1', 'a2'])
    expect(ids(clips.search({ ...base, twitchAccountIds: [b, c] }))).toEqual(['b1', 'c1'])
  })

  it('labels each clip with its Twitch channel and color', () => {
    const [first, second] = clips.search(base).items
    expect(first).toMatchObject({ twitchAccountId: a, twitchName: 'Alpha', twitchColor: '#22c55e' })
    expect(second).toMatchObject({
      twitchAccountId: b,
      twitchName: 'Bravo',
      twitchColor: '#ec4899'
    })
  })

  it('lists games from the channels in view', () => {
    expect(clips.search(base).games.map((g) => g.name)).toEqual(['AC', 'MW4', 'OW'])
    expect(clips.search({ ...base, twitchAccountIds: [a] }).games.map((g) => g.name)).toEqual([
      'MW4'
    ])
  })

  it('adds clips as drafts starting from the horizontal file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-addclip-'))
    try {
      const landscape = join(dir, 'a1_landscape.mp4')
      const portrait = join(dir, 'a1_portrait.mp4')
      writeFileSync(landscape, 'h')
      writeFileSync(portrait, 'v')
      t.repos.clips.setDownload('a1', {
        downloadStatus: 'downloaded',
        landscapePath: landscape,
        portraitPath: portrait
      })
      const channel = seedAccount(t.repos).id
      const service = createClipsService({
        repos: t.repos,
        media: createMediaAccess({ roots: () => [], isReferenced: () => false }),
        probe: async () => {
          throw new Error('no ffprobe in this test')
        },
        emitChanged: vi.fn(),
        emitPostsChanged: vi.fn(),
        kickJobs: vi.fn()
      })
      expect(await service.addToChannel(['a1'], channel)).toEqual({ created: 1, skipped: [] })
      expect(t.repos.posts.list({})[0]).toMatchObject({ clipId: 'a1', filePath: landscape })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
