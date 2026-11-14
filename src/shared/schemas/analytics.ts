import { z } from 'zod'

/**
 * YouTube Analytics (reports.query) views. The Analytics API has its own quota, separate
 * from the Data API's 10,000 units, and the `youtube` scope we already request covers
 * non-monetary reports, so no new sign-in is needed.
 */

export const ANALYTICS_RANGES = [7, 28, 90] as const
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]

/** A channel id, or 'all' for every signed-in channel added together. */
export const analyticsTargetSchema = z.union([z.number().int().positive(), z.literal('all')])
export type AnalyticsTarget = z.infer<typeof analyticsTargetSchema>

export const analyticsInputSchema = z
  .object({
    accountId: analyticsTargetSchema,
    days: z.union([z.literal(7), z.literal(28), z.literal(90)]),
    /** Skip the one-hour cache. */
    refresh: z.boolean().default(false)
  })
  .strict()
export type AnalyticsInput = z.input<typeof analyticsInputSchema>

export const analyticsTotalsSchema = z.object({
  views: z.number(),
  minutesWatched: z.number(),
  /** Seconds. */
  averageViewDuration: z.number(),
  subscribersGained: z.number(),
  subscribersLost: z.number(),
  likes: z.number()
})
export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>

export const analyticsDaySchema = z.object({
  /** YYYY-MM-DD (YouTube reports days in Pacific time). */
  date: z.string(),
  views: z.number(),
  minutesWatched: z.number(),
  subscribersNet: z.number()
})
export type AnalyticsDay = z.infer<typeof analyticsDaySchema>

export const analyticsVideoSchema = z.object({
  videoId: z.string(),
  /** The channel the video belongs to. */
  accountId: z.number().int(),
  title: z.string().nullable(),
  /** The ChannelDeck post that uploaded it, if any. */
  postId: z.string().nullable(),
  views: z.number(),
  minutesWatched: z.number(),
  averageViewDuration: z.number(),
  likes: z.number(),
  subscribersGained: z.number()
})
export type AnalyticsVideo = z.infer<typeof analyticsVideoSchema>

export const analyticsReportSchema = z.object({
  accountId: analyticsTargetSchema,
  /** Channels added into this report (one, or every signed-in channel for 'all'). */
  channelCount: z.number().int(),
  /** Channels left out of an 'all' report, with why (e.g. needs sign-in, API error). */
  skipped: z.array(
    z.object({ accountId: z.number().int(), title: z.string(), reason: z.string() })
  ),
  startDate: z.string(),
  endDate: z.string(),
  /** Last day YouTube has data for (analytics lag a day or two), or null if none. */
  lastDataDate: z.string().nullable(),
  totals: analyticsTotalsSchema,
  daily: z.array(analyticsDaySchema),
  topVideos: z.array(analyticsVideoSchema),
  fetchedAt: z.iso.datetime()
})
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>
