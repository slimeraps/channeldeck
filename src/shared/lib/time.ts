import { DateTime } from 'luxon'

/**
 * Time helpers shared by main and renderer. Everything is stored as UTC ISO; the editor
 * works in the Mac's local zone (or an explicit IANA zone, for tests).
 */

export interface LocalParts {
  /** "YYYY-MM-DD" */
  date: string
  /** "HH:mm" (24-hour) */
  time: string
}

/**
 * Local date + time in `zone` → UTC ISO ("…Z"). Times that don't exist (the hour skipped
 * when clocks spring forward) move forward to the next valid time, like a wall clock would.
 */
export function localToUtcIso(parts: LocalParts, zone?: string): string | null {
  const dt = DateTime.fromISO(`${parts.date}T${parts.time}`, zone ? { zone } : {})
  if (!dt.isValid) return null
  // When clocks fall back, a wall time happens twice. Use the first occurrence.
  const candidates = dt.getPossibleOffsets()
  const earliest = candidates.reduce((a, b) => (b.toMillis() < a.toMillis() ? b : a), dt)
  return earliest.toUTC().toISO({ suppressMilliseconds: false }) ?? null
}

export function utcIsoToLocalParts(iso: string, zone?: string): LocalParts {
  const base = DateTime.fromISO(iso, { zone: 'utc' })
  const dt = zone ? base.setZone(zone) : base.toLocal()
  return { date: dt.toFormat('yyyy-MM-dd'), time: dt.toFormat('HH:mm') }
}

/** status.publishAt for YouTube: ISO 8601 / RFC 3339 in UTC, seconds precision. */
export function toYouTubePublishAt(iso: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' })
  if (!dt.isValid) throw new Error(`Invalid publish time: ${iso}`)
  return (
    dt
      .startOf('second')
      .toISO({ suppressMilliseconds: true, includeOffset: true })
      ?.replace('+00:00', 'Z') ?? iso
  )
}

/** A sensible default publish time: tomorrow at the next whole hour from now. */
export function defaultPublishAt(now: Date = new Date()): string {
  const dt = DateTime.fromJSDate(now).plus({ days: 1, hours: 1 }).startOf('hour')
  return dt.toUTC().toISO() ?? now.toISOString()
}
