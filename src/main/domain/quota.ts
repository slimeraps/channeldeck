import { DateTime } from 'luxon'
import {
  DAILY_UNITS,
  DAILY_UPLOAD_CALLS,
  QUOTA_COSTS,
  QUOTA_TIME_ZONE,
  type YouTubeMethod
} from '@shared/constants/quota'
import type { QuotaBucket } from '@shared/constants/enums'

/** The Pacific-time calendar day ("YYYY-MM-DD") a call at `at` counts against. */
export function quotaDayFor(at: Date): string {
  const day = DateTime.fromJSDate(at, { zone: QUOTA_TIME_ZONE }).toISODate()
  if (!day) throw new Error(`Invalid date: ${String(at)}`)
  return day
}

/** The next midnight Pacific after `at`, as a UTC Date (when quota resets). */
export function nextQuotaReset(at: Date): Date {
  return DateTime.fromJSDate(at, { zone: QUOTA_TIME_ZONE })
    .plus({ days: 1 })
    .startOf('day')
    .toJSDate()
}

export function quotaCost(method: YouTubeMethod): { bucket: QuotaBucket; cost: number } {
  return QUOTA_COSTS[method]
}

// ---- forecast --------------------------------------------------------------------------------

export interface ForecastRule {
  slots: readonly string[]
  weekdays: readonly number[]
  /** Each autopost also adds the video to a playlist (50 units). */
  playlist: boolean
}

export interface ForecastPost {
  /** When the upload is expected to start (upload_after, or now if that's past). */
  uploadAtUtc: string
  thumbnail: boolean
  playlist: boolean
}

export interface QuotaDayForecast {
  day: string
  uploads: number
  units: number
  overUploads: boolean
  overUnits: boolean
}

/** Status sync and list calls: a small daily allowance on top of the per-upload costs. */
const BACKGROUND_UNITS = 200

/**
 * Expected quota use per Pacific day for the next `days` days: uploads already queued
 * (manual posts) plus every slot of every enabled rule. Rule slots count whether or not
 * the planner has filled them yet, so don't pass rule-made posts in `posts`.
 */
export function forecastQuota(args: {
  now: Date
  days: number
  leadMs: number
  zone: string
  rules: readonly ForecastRule[]
  posts: readonly ForecastPost[]
  slotsBetween: (rule: ForecastRule, from: Date, to: Date, zone: string) => string[]
}): QuotaDayForecast[] {
  const { now } = args
  const end = new Date(now.getTime() + args.days * 86_400_000)
  const byDay = new Map<string, { uploads: number; units: number }>()
  for (let i = 0; i < args.days; i++) {
    byDay.set(quotaDayFor(new Date(now.getTime() + i * 86_400_000)), { uploads: 0, units: 0 })
  }
  const add = (uploadAt: number, extraUnits: number): void => {
    const entry = byDay.get(quotaDayFor(new Date(Math.max(now.getTime(), uploadAt))))
    if (!entry) return
    entry.uploads += 1
    entry.units += extraUnits
  }
  const unitsFor = (thumbnail: boolean, playlist: boolean): number =>
    (thumbnail ? QUOTA_COSTS['thumbnails.set'].cost : 0) +
    (playlist ? QUOTA_COSTS['playlistItems.insert'].cost : 0)

  for (const post of args.posts)
    add(Date.parse(post.uploadAtUtc), unitsFor(post.thumbnail, post.playlist))
  for (const rule of args.rules) {
    // Slots a bit past the window still upload inside it (lead time).
    const slots = args.slotsBetween(rule, now, new Date(end.getTime() + args.leadMs), args.zone)
    for (const slot of slots) add(Date.parse(slot) - args.leadMs, unitsFor(false, rule.playlist))
  }
  return [...byDay.entries()].map(([day, { uploads, units }]) => {
    const total = units + BACKGROUND_UNITS
    return {
      day,
      uploads,
      units: total,
      overUploads: uploads > DAILY_UPLOAD_CALLS,
      overUnits: total > DAILY_UNITS
    }
  })
}
