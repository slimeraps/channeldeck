import { DateTime } from 'luxon'
import { QUOTA_COSTS, QUOTA_TIME_ZONE, type YouTubeMethod } from '@shared/constants/quota'
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
