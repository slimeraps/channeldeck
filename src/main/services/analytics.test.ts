import type { OAuth2Client } from 'google-auth-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, seedAccount, type TestDb } from '../../../tests/helpers/db'
import type { AnalyticsTable } from '../domain/analytics'
import { UserFacingError } from '../errors'
import type { AnalyticsQuery } from '../google/analytics'
import type { YouTubeApi } from '../google/youtube'
import { ANALYTICS_TTL_MS, createAnalyticsService } from './analytics'

let t: TestDb
beforeEach(() => (t = createTestDb()))
afterEach(() => t.close())

const TOTALS: AnalyticsTable = {
  columnHeaders: [
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
    { name: 'averageViewDuration' },
    { name: 'subscribersGained' },
    { name: 'subscribersLost' },
    { name: 'likes' }
  ],
  rows: [[1500, 2400, 42, 30, 4, 90]]
}
const DAILY: AnalyticsTable = {
  columnHeaders: [
    { name: 'day' },
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
    { name: 'subscribersGained' },
    { name: 'subscribersLost' }
  ],
  rows: [['2026-11-08', 700, 1000, 10, 1]]
}
const TOP: AnalyticsTable = {
  columnHeaders: [
    { name: 'video' },
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
    { name: 'averageViewDuration' },
    { name: 'likes' },
    { name: 'subscribersGained' }
  ],
  rows: [
    ['vid-ours', 900, 1200, 50, 40, 12],
    ['vid-other', 300, 400, 30, 10, 2]
  ]
}

function setup(
  options: {
    query?: (q: AnalyticsQuery) => Promise<AnalyticsTable>
    failFor?: Set<number>
  } = {}
) {
  const queries: AnalyticsQuery[] = []
  const query =
    options.query ??
    (async (q: AnalyticsQuery) =>
      q.dimensions?.[0] === 'day' ? DAILY : q.dimensions?.[0] === 'video' ? TOP : TOTALS)
  const videoTitles = vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `YT ${id}`])))
  const service = createAnalyticsService({
    repos: t.repos,
    clock: t.clock,
    logger: { warn: () => {} },
    withAuth: (id, fn) =>
      options.failFor?.has(id)
        ? Promise.reject(new UserFacingError(`Channel ${id} needs you to sign in again.`))
        : fn({} as OAuth2Client),
    withApi: (_id, fn) => fn({ videoTitles } as unknown as YouTubeApi),
    createApi: () => ({
      query: (q) => {
        queries.push(q)
        return query(q)
      }
    })
  })
  return { service, queries, videoTitles }
}

describe('analytics report', () => {
  it('builds totals, days and top videos, using our own post titles first', async () => {
    const account = seedAccount(t.repos)
    const post = t.repos.posts.create({
      accountId: account.id,
      status: 'draft',
      source: 'manual',
      title: 'Our upload',
      filePath: '/Users/test/a.mp4'
    })
    t.repos.posts.update(post.id, { youtubeVideoId: 'vid-ours' })
    t.clock.set('2026-11-10T20:00:00.000Z')

    const { service, queries, videoTitles } = setup()
    const report = await service.report({ accountId: account.id, days: 7 })

    expect(queries).toHaveLength(3)
    expect(queries.every((q) => q.startDate === '2026-11-04' && q.endDate === '2026-11-10')).toBe(
      true
    )
    expect(queries.find((q) => q.dimensions?.[0] === 'video')).toMatchObject({
      sort: '-views',
      maxResults: 10
    })
    expect(report.totals).toEqual({
      views: 1500,
      minutesWatched: 2400,
      averageViewDuration: 42,
      subscribersGained: 30,
      subscribersLost: 4,
      likes: 90
    })
    expect(report.lastDataDate).toBe('2026-11-08')
    expect(report.daily).toHaveLength(5) // Nov 4 … Nov 8
    expect(report.daily.at(-1)).toEqual({
      date: '2026-11-08',
      views: 700,
      minutesWatched: 1000,
      subscribersNet: 9
    })
    expect(report.topVideos.map((v) => [v.videoId, v.title, v.postId])).toEqual([
      ['vid-ours', 'Our upload', post.id],
      ['vid-other', 'YT vid-other', null]
    ])
    // Only the video we didn't upload costs a videos.list call.
    expect(videoTitles).toHaveBeenCalledWith(['vid-other'])
  })

  it('caches for an hour unless refreshed', async () => {
    const account = seedAccount(t.repos)
    const { service, queries } = setup()
    await service.report({ accountId: account.id, days: 28 })
    await service.report({ accountId: account.id, days: 28 })
    expect(queries).toHaveLength(3)
    await service.report({ accountId: account.id, days: 28, refresh: true })
    expect(queries).toHaveLength(6)
    t.clock.advance(ANALYTICS_TTL_MS + 1)
    await service.report({ accountId: account.id, days: 28 })
    expect(queries).toHaveLength(9)
  })

  it('explains how to turn the Analytics API on', async () => {
    const account = seedAccount(t.repos)
    const disabled = Object.assign(
      new Error(
        'YouTube Analytics API has not been used in project 123456789 before or it is disabled. Enable it by visiting …'
      ),
      { response: { status: 403, data: {} } }
    )
    const { service } = setup({ query: () => Promise.reject(disabled) })
    const error = await service.report({ accountId: account.id, days: 7 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UserFacingError)
    expect((error as Error).message).toContain('YouTube Analytics API is turned off')
    expect((error as Error).message).toContain('123456789')
  })
})

describe('All channels', () => {
  it('adds every signed-in channel together and tags videos with their channel', async () => {
    const one = seedAccount(t.repos)
    const two = seedAccount(t.repos)
    seedAccount(t.repos, { enabled: false }) // switched off: not asked
    const { service, queries } = setup()
    const report = await service.report({ accountId: 'all', days: 7 })
    expect(queries).toHaveLength(6) // 3 per channel
    expect(report.accountId).toBe('all')
    expect(report.channelCount).toBe(2)
    expect(report.skipped).toEqual([])
    expect(report.totals.views).toBe(3000)
    expect(report.totals.subscribersGained).toBe(60)
    expect(report.daily.at(-1)?.views).toBe(1400)
    expect(report.topVideos.map((v) => v.accountId).sort()).toEqual(
      [one.id, one.id, two.id, two.id].sort()
    )
    expect(report.topVideos[0]?.views).toBe(900)
  })

  it('leaves out a channel that fails and says why', async () => {
    const ok = seedAccount(t.repos)
    const broken = seedAccount(t.repos, { channelTitle: 'Broken' })
    const { service } = setup({ failFor: new Set([broken.id]) })
    const report = await service.report({ accountId: 'all', days: 7 })
    expect(report.channelCount).toBe(1)
    expect(report.totals.views).toBe(1500)
    expect(report.topVideos.every((v) => v.accountId === ok.id)).toBe(true)
    expect(report.skipped).toEqual([
      {
        accountId: broken.id,
        title: 'Broken',
        reason: `Channel ${broken.id} needs you to sign in again.`
      }
    ])
  })

  it('shows the error itself when every channel fails', async () => {
    const only = seedAccount(t.repos)
    const { service } = setup({ failFor: new Set([only.id]) })
    await expect(service.report({ accountId: 'all', days: 7 })).rejects.toThrow(
      'needs you to sign in again'
    )
  })

  it('explains when there is no channel to add up', async () => {
    const { service } = setup()
    await expect(service.report({ accountId: 'all', days: 7 })).rejects.toThrow(
      'No signed-in YouTube channels'
    )
  })
})
