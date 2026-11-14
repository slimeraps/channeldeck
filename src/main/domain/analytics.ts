import { DateTime } from 'luxon'
import { QUOTA_TIME_ZONE } from '@shared/constants/quota'
import type { AnalyticsDay, AnalyticsReport, AnalyticsTotals } from '@shared/schemas/analytics'

/**
 * Pure helpers for YouTube Analytics reports: date ranges (YouTube Analytics days are
 * Pacific-time days, like quota days) and turning `reports.query` tables into rows.
 */

/** The raw table `reports.query` returns. */
export interface AnalyticsTable {
  columnHeaders?: { name?: string | null }[] | null
  rows?: unknown[][] | null
}

export type AnalyticsRow = Record<string, string | number>

/** `days` Pacific days ending today: { startDate, endDate } as YYYY-MM-DD. */
export function analyticsDates(now: Date, days: number): { startDate: string; endDate: string } {
  const today = DateTime.fromJSDate(now, { zone: QUOTA_TIME_ZONE }).startOf('day')
  const startDate = today.minus({ days: days - 1 }).toISODate()
  const endDate = today.toISODate()
  if (!startDate || !endDate) throw new Error(`Invalid date: ${String(now)}`)
  return { startDate, endDate }
}

/** Turns the column/row table into objects keyed by column name. */
export function tableRows(table: AnalyticsTable): AnalyticsRow[] {
  const names = (table.columnHeaders ?? []).map((h) => h.name ?? '')
  return (table.rows ?? []).map((row) => {
    const out: AnalyticsRow = {}
    names.forEach((name, i) => {
      const value = row[i]
      out[name] = typeof value === 'number' || typeof value === 'string' ? value : 0
    })
    return out
  })
}

export function num(row: AnalyticsRow | undefined, key: string): number {
  const value = row?.[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function toTotals(row: AnalyticsRow | undefined): AnalyticsTotals {
  return {
    views: num(row, 'views'),
    minutesWatched: num(row, 'estimatedMinutesWatched'),
    averageViewDuration: num(row, 'averageViewDuration'),
    subscribersGained: num(row, 'subscribersGained'),
    subscribersLost: num(row, 'subscribersLost'),
    likes: num(row, 'likes')
  }
}

/**
 * One entry per day from `startDate` to the last day YouTube returned. Days inside that span
 * with no row had no activity (zero). Days after it aren't processed yet, so they're left
 * out rather than shown as zero.
 */
export function toDaily(
  rows: AnalyticsRow[],
  startDate: string
): { daily: AnalyticsDay[]; lastDataDate: string | null } {
  const byDate = new Map<string, AnalyticsRow>()
  for (const row of rows) {
    if (typeof row['day'] === 'string') byDate.set(row['day'], row)
  }
  const dates = [...byDate.keys()].sort()
  const last = dates.at(-1)
  if (!last) return { daily: [], lastDataDate: null }

  const daily: AnalyticsDay[] = []
  let day = DateTime.fromISO(startDate, { zone: 'UTC' })
  const end = DateTime.fromISO(last, { zone: 'UTC' })
  while (day <= end) {
    const date = day.toISODate() as string
    const row = byDate.get(date)
    daily.push({
      date,
      views: num(row, 'views'),
      minutesWatched: num(row, 'estimatedMinutesWatched'),
      subscribersNet: num(row, 'subscribersGained') - num(row, 'subscribersLost')
    })
    day = day.plus({ days: 1 })
  }
  return { daily, lastDataDate: last }
}

/**
 * Adds several channels' reports into one ("All channels"). Counts add up; the average view
 * duration is weighted by views (total watch time ÷ total views); days are summed by date;
 * top videos are merged and re-ranked by views.
 */
export function combineReports(
  reports: readonly AnalyticsReportCore[],
  topCount: number
): AnalyticsReportCore {
  const totals: AnalyticsTotals = {
    views: 0,
    minutesWatched: 0,
    averageViewDuration: 0,
    subscribersGained: 0,
    subscribersLost: 0,
    likes: 0
  }
  for (const r of reports) {
    totals.views += r.totals.views
    totals.minutesWatched += r.totals.minutesWatched
    totals.subscribersGained += r.totals.subscribersGained
    totals.subscribersLost += r.totals.subscribersLost
    totals.likes += r.totals.likes
  }
  totals.averageViewDuration = totals.views > 0 ? (totals.minutesWatched * 60) / totals.views : 0

  const byDate = new Map<string, AnalyticsDay>()
  for (const r of reports) {
    for (const d of r.daily) {
      const sum = byDate.get(d.date) ?? {
        date: d.date,
        views: 0,
        minutesWatched: 0,
        subscribersNet: 0
      }
      sum.views += d.views
      sum.minutesWatched += d.minutesWatched
      sum.subscribersNet += d.subscribersNet
      byDate.set(d.date, sum)
    }
  }
  const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const lastDataDate = daily.at(-1)?.date ?? null

  const topVideos = reports
    .flatMap((r) => r.topVideos)
    .sort((a, b) => b.views - a.views)
    .slice(0, topCount)

  return { totals, daily, lastDataDate, topVideos }
}

export type AnalyticsReportCore = Pick<
  AnalyticsReport,
  'totals' | 'daily' | 'lastDataDate' | 'topVideos'
>
