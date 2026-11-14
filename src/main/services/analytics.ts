import type { OAuth2Client } from 'google-auth-library'
import type { AnalyticsRange, AnalyticsReport, AnalyticsTarget } from '@shared/schemas/analytics'
import { type Clock, systemClock } from '../db/repos/common'
import type { Repos } from '../db/repos'
import {
  analyticsDates,
  combineReports,
  num,
  tableRows,
  toDaily,
  toTotals
} from '../domain/analytics'
import { UserFacingError } from '../errors'
import { type AnalyticsApi, createAnalyticsApi } from '../google/analytics'
import { isApiNotEnabled, projectNumberFrom } from '../google/errors'
import type { YouTubeApi } from '../google/youtube'

/**
 * Channel analytics from the YouTube Analytics API: totals, a per-day series and the top
 * videos for the last 7/28/90 days. Three `reports.query` calls per load (Analytics quota,
 * not the Data API's), cached for an hour. Titles come from our own posts first; only the
 * rest cost one `videos.list` (1 Data API unit).
 */

export const ANALYTICS_TTL_MS = 60 * 60 * 1000
export const TOP_VIDEOS = 10

export interface AnalyticsDeps {
  repos: Repos
  withAuth: <T>(accountId: number, fn: (auth: OAuth2Client) => Promise<T>) => Promise<T>
  withApi: <T>(accountId: number, fn: (api: YouTubeApi) => Promise<T>) => Promise<T>
  logger: { warn(...a: unknown[]): void }
  clock?: Clock
  /** Test hook. */
  createApi?: (auth: OAuth2Client) => AnalyticsApi
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>

export function createAnalyticsService(deps: AnalyticsDeps) {
  const { repos, logger } = deps
  const clock = deps.clock ?? systemClock
  const createApi = deps.createApi ?? createAnalyticsApi
  const cache = new Map<string, { at: number; report: AnalyticsReport }>()

  function explain(error: unknown): never {
    if (isApiNotEnabled(error)) {
      const project = projectNumberFrom(error)
      throw new UserFacingError(
        `The YouTube Analytics API is turned off in your Google Cloud project${project ? ` (${project})` : ''}. ` +
          'In Google Cloud Console go to APIs & Services → Library, open "YouTube Analytics API", click Enable, wait a minute, then try again.',
        { cause: error }
      )
    }
    throw error
  }

  async function titlesFor(accountId: number, ids: string[]): Promise<Map<string, string>> {
    const known = new Map<string, string>()
    for (const post of repos.posts.list({ accountId })) {
      if (post.youtubeVideoId && ids.includes(post.youtubeVideoId)) {
        known.set(post.youtubeVideoId, post.title)
      }
    }
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length === 0) return known
    try {
      const fetched = await deps.withApi(accountId, (api) => api.videoTitles(missing))
      for (const [id, title] of fetched) known.set(id, title)
    } catch (error) {
      // Titles are nice to have; the report still shows video ids without them.
      logger.warn(`[analytics] title lookup for account ${accountId} failed`, error)
    }
    return known
  }

  function postIdsFor(accountId: number): Map<string, string> {
    const map = new Map<string, string>()
    for (const post of repos.posts.list({ accountId })) {
      if (post.youtubeVideoId && post.status !== 'canceled') map.set(post.youtubeVideoId, post.id)
    }
    return map
  }

  async function channelReport(
    accountId: number,
    days: AnalyticsRange,
    refresh: boolean
  ): Promise<AnalyticsReport> {
    const key = `${accountId}:${days}`
    const now = clock()
    const cached = cache.get(key)
    if (!refresh && cached && now.getTime() - cached.at < ANALYTICS_TTL_MS) {
      return cached.report
    }
    const { startDate, endDate } = analyticsDates(now, days)
    const range = { startDate, endDate }
    const [totalsTable, dailyTable, topTable] = await deps
      .withAuth(accountId, (auth) => {
        const api = createApi(auth)
        return Promise.all([
          api.query({
            ...range,
            metrics: [
              'views',
              'estimatedMinutesWatched',
              'averageViewDuration',
              'subscribersGained',
              'subscribersLost',
              'likes'
            ]
          }),
          api.query({
            ...range,
            dimensions: ['day'],
            metrics: ['views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost'],
            sort: 'day'
          }),
          api.query({
            ...range,
            dimensions: ['video'],
            metrics: [
              'views',
              'estimatedMinutesWatched',
              'averageViewDuration',
              'likes',
              'subscribersGained'
            ],
            sort: '-views',
            maxResults: TOP_VIDEOS
          })
        ])
      })
      .catch(explain)

    const { daily, lastDataDate } = toDaily(tableRows(dailyTable), startDate)
    const topRows = tableRows(topTable).filter((r) => typeof r['video'] === 'string')
    const ids = topRows.map((r) => r['video'] as string)
    const titles = await titlesFor(accountId, ids)
    const postIds = postIdsFor(accountId)

    const report: AnalyticsReport = {
      accountId,
      channelCount: 1,
      skipped: [],
      startDate,
      endDate,
      lastDataDate,
      totals: toTotals(tableRows(totalsTable)[0]),
      daily,
      topVideos: topRows.map((r) => {
        const videoId = r['video'] as string
        return {
          videoId,
          accountId,
          title: titles.get(videoId) ?? null,
          postId: postIds.get(videoId) ?? null,
          views: num(r, 'views'),
          minutesWatched: num(r, 'estimatedMinutesWatched'),
          averageViewDuration: num(r, 'averageViewDuration'),
          likes: num(r, 'likes'),
          subscribersGained: num(r, 'subscribersGained')
        }
      }),
      fetchedAt: now.toISOString()
    }
    cache.set(key, { at: now.getTime(), report })
    return report
  }

  /** Every channel that can be asked: connected, switched on, signed in. */
  function reportableChannels() {
    return repos.accounts.list().filter((a) => a.enabled && a.tokenStatus === 'ok')
  }

  return {
    async report(input: {
      accountId: AnalyticsTarget
      days: AnalyticsRange
      refresh?: boolean
    }): Promise<AnalyticsReport> {
      const refresh = input.refresh ?? false
      if (input.accountId !== 'all') return channelReport(input.accountId, input.days, refresh)

      const channels = reportableChannels()
      if (channels.length === 0) {
        throw new UserFacingError('No signed-in YouTube channels to add up. Connect one first.')
      }
      const results = await Promise.allSettled(
        channels.map((a) => channelReport(a.id, input.days, refresh))
      )
      const reports: AnalyticsReport[] = []
      const skipped: AnalyticsReport['skipped'] = []
      results.forEach((result, i) => {
        const channel = channels[i]
        if (!channel) return
        if (result.status === 'fulfilled') reports.push(result.value)
        else {
          logger.warn(`[analytics] account ${channel.id} left out of All channels`, result.reason)
          skipped.push({
            accountId: channel.id,
            title: channel.channelTitle,
            reason:
              result.reason instanceof UserFacingError
                ? result.reason.message
                : 'Failed; see the log.'
          })
        }
      })
      // Nothing worked: show the first channel's own error rather than an empty report.
      const firstFailure = results.find((r) => r.status === 'rejected')
      if (reports.length === 0 && firstFailure) throw firstFailure.reason

      const { startDate, endDate } = analyticsDates(clock(), input.days)
      return {
        accountId: 'all',
        channelCount: reports.length,
        skipped,
        startDate,
        endDate,
        ...combineReports(reports, TOP_VIDEOS),
        fetchedAt: reports.map((r) => r.fetchedAt).sort()[0] as string
      }
    }
  }
}
