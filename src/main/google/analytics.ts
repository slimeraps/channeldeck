import type { OAuth2Client } from 'google-auth-library'
import type { AnalyticsTable } from '../domain/analytics'

/**
 * YouTube Analytics API v2 `reports.query`, called through the channel's OAuth client
 * (google-auth-library adds the token and refreshes it). This API has its own quota in the
 * Google Cloud project, separate from the Data API's 10,000 units, so these calls are not
 * recorded in `quota_usage`. Read-only, so Dry Run uses the real API too.
 * Docs: https://developers.google.com/youtube/analytics/reference/reports/query
 */

export const ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports'

export interface AnalyticsQuery {
  startDate: string
  endDate: string
  metrics: readonly string[]
  dimensions?: readonly string[]
  sort?: string
  maxResults?: number
}

export interface AnalyticsApi {
  query(q: AnalyticsQuery): Promise<AnalyticsTable>
}

export function createAnalyticsApi(auth: OAuth2Client): AnalyticsApi {
  return {
    async query(q) {
      const params: Record<string, string | number> = {
        ids: 'channel==MINE',
        startDate: q.startDate,
        endDate: q.endDate,
        metrics: q.metrics.join(',')
      }
      if (q.dimensions?.length) params['dimensions'] = q.dimensions.join(',')
      if (q.sort) params['sort'] = q.sort
      if (q.maxResults) params['maxResults'] = q.maxResults
      const res = await auth.request<AnalyticsTable>({ url: ANALYTICS_URL, method: 'GET', params })
      return res.data
    }
  }
}
