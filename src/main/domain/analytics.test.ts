import { describe, expect, it } from 'vitest'
import { analyticsDates, combineReports, tableRows, toDaily, toTotals } from './analytics'

describe('analyticsDates', () => {
  it('counts Pacific days ending today', () => {
    // 2026-11-13 06:00Z is still Nov 12 in Los Angeles.
    expect(analyticsDates(new Date('2026-11-13T06:00:00Z'), 7)).toEqual({
      startDate: '2026-11-06',
      endDate: '2026-11-12'
    })
    expect(analyticsDates(new Date('2026-11-13T09:00:00Z'), 28)).toEqual({
      startDate: '2026-10-17',
      endDate: '2026-11-13'
    })
  })
})

describe('tableRows / toTotals', () => {
  it('maps columns to names and reads numbers', () => {
    const rows = tableRows({
      columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'likes' }],
      rows: [[120, 300.5, 7]]
    })
    expect(rows).toEqual([{ views: 120, estimatedMinutesWatched: 300.5, likes: 7 }])
    expect(toTotals(rows[0])).toEqual({
      views: 120,
      minutesWatched: 300.5,
      averageViewDuration: 0,
      subscribersGained: 0,
      subscribersLost: 0,
      likes: 7
    })
  })

  it('treats a missing table as empty and missing totals as zero', () => {
    expect(tableRows({})).toEqual([])
    expect(toTotals(undefined).views).toBe(0)
  })
})

describe('toDaily', () => {
  const header = [
    { name: 'day' },
    { name: 'views' },
    { name: 'estimatedMinutesWatched' },
    { name: 'subscribersGained' },
    { name: 'subscribersLost' }
  ]

  it('fills quiet days with zero up to the last day YouTube has, and stops there', () => {
    const rows = tableRows({
      columnHeaders: header,
      rows: [
        ['2026-11-03', 5, 10, 2, 1],
        ['2026-11-01', 3, 6, 0, 0]
      ]
    })
    const { daily, lastDataDate } = toDaily(rows, '2026-11-01')
    expect(lastDataDate).toBe('2026-11-03')
    expect(daily).toEqual([
      { date: '2026-11-01', views: 3, minutesWatched: 6, subscribersNet: 0 },
      { date: '2026-11-02', views: 0, minutesWatched: 0, subscribersNet: 0 },
      { date: '2026-11-03', views: 5, minutesWatched: 10, subscribersNet: 1 }
    ])
  })

  it('returns nothing when YouTube has no rows yet', () => {
    expect(toDaily([], '2026-11-01')).toEqual({ daily: [], lastDataDate: null })
  })
})

describe('combineReports (All channels)', () => {
  const video = (accountId: number, videoId: string, views: number) => ({
    videoId,
    accountId,
    title: videoId,
    postId: null,
    views,
    minutesWatched: views,
    averageViewDuration: 60,
    likes: 1,
    subscribersGained: 0
  })

  it('adds counts, weights the average view by views, sums days and re-ranks videos', () => {
    const a = {
      totals: {
        views: 100,
        minutesWatched: 100, // 60 s average
        averageViewDuration: 60,
        subscribersGained: 5,
        subscribersLost: 1,
        likes: 10
      },
      daily: [
        { date: '2026-11-01', views: 40, minutesWatched: 40, subscribersNet: 2 },
        { date: '2026-11-02', views: 60, minutesWatched: 60, subscribersNet: 2 }
      ],
      lastDataDate: '2026-11-02',
      topVideos: [video(1, 'a1', 70), video(1, 'a2', 30)]
    }
    const b = {
      totals: {
        views: 300,
        minutesWatched: 100, // 20 s average
        averageViewDuration: 20,
        subscribersGained: 3,
        subscribersLost: 0,
        likes: 5
      },
      daily: [
        { date: '2026-11-02', views: 200, minutesWatched: 50, subscribersNet: 1 },
        { date: '2026-11-03', views: 100, minutesWatched: 50, subscribersNet: 2 }
      ],
      lastDataDate: '2026-11-03',
      topVideos: [video(2, 'b1', 250), video(2, 'b2', 50)]
    }
    const all = combineReports([a, b], 3)
    expect(all.totals).toEqual({
      views: 400,
      minutesWatched: 200,
      averageViewDuration: 30, // 200 min × 60 ÷ 400 views, not the plain mean of 60 and 20
      subscribersGained: 8,
      subscribersLost: 1,
      likes: 15
    })
    expect(all.daily).toEqual([
      { date: '2026-11-01', views: 40, minutesWatched: 40, subscribersNet: 2 },
      { date: '2026-11-02', views: 260, minutesWatched: 110, subscribersNet: 3 },
      { date: '2026-11-03', views: 100, minutesWatched: 50, subscribersNet: 2 }
    ])
    expect(all.lastDataDate).toBe('2026-11-03')
    expect(all.topVideos.map((v) => [v.accountId, v.videoId])).toEqual([
      [2, 'b1'],
      [1, 'a1'],
      [2, 'b2']
    ])
  })

  it('is empty and zero with no channels', () => {
    const all = combineReports([], 10)
    expect(all.totals.views).toBe(0)
    expect(all.totals.averageViewDuration).toBe(0)
    expect(all.daily).toEqual([])
    expect(all.lastDataDate).toBeNull()
  })
})
