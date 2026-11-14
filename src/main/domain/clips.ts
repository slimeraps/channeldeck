import { DateTime } from 'luxon'
import { isValidTwitchLogin } from '@shared/twitchLogin'
import type { BackfillCursor } from '@shared/types/json'

/**
 * Pure clip-bank rules: time windows for Get Clips, when the daily sync is due, backfill
 * progress, and on-disk file names. No IO.
 */

export interface TimeWindow {
  /** UTC ISO, inclusive. */
  start: string
  /** UTC ISO, exclusive. */
  end: string
}

export const MAX_WINDOW_DAYS = 7
/** Get Clips returns at most ~1,000 clips per query; split any window that gets close. */
export const WINDOW_SPLIT_THRESHOLD = 900
export const SYNC_OVERLAP_DAYS = 2
const DAY_MS = 24 * 60 * 60 * 1000

const iso = (ms: number): string => new Date(ms).toISOString()

/** Splits [from, to) into consecutive windows of at most `maxDays`, oldest first. */
export function timeWindows(
  fromUtc: string,
  toUtc: string,
  maxDays = MAX_WINDOW_DAYS
): TimeWindow[] {
  const from = Date.parse(fromUtc)
  const to = Date.parse(toUtc)
  if (!(from < to)) return []
  const step = maxDays * DAY_MS
  const out: TimeWindow[] = []
  for (let start = from; start < to; start += step) {
    out.push({ start: iso(start), end: iso(Math.min(start + step, to)) })
  }
  return out
}

/** Halves a window (used when a window returns close to the ~1,000-clip cap). */
export function splitWindow(w: TimeWindow): [TimeWindow, TimeWindow] | null {
  const start = Date.parse(w.start)
  const end = Date.parse(w.end)
  // Twitch truncates times to the minute; below ~2 minutes there's nothing to split.
  if (end - start < 2 * 60_000) return null
  const mid = start + Math.floor((end - start) / 2 / 60_000) * 60_000
  return [
    { start: w.start, end: iso(mid) },
    { start: iso(mid), end: w.end }
  ]
}

/**
 * The daily sync looks back from the last successful sync minus 2 days of overlap (late
 * vod_offset values, fresher view counts), up to now. Upserting by clip id makes overlap
 * harmless.
 */
export function dailySyncRange(
  lastSyncUtc: string | null,
  now: Date,
  fallbackStartUtc: string
): TimeWindow {
  const start = lastSyncUtc
    ? Date.parse(lastSyncUtc) - SYNC_OVERLAP_DAYS * DAY_MS
    : Date.parse(fallbackStartUtc)
  return { start: iso(Math.min(start, now.getTime() - 60_000)), end: now.toISOString() }
}

/**
 * Due when the last success is over 24 h old, or today's sync time (local, "HH:mm") has
 * passed and the last success was before it.
 */
export function isDailySyncDue(
  now: Date,
  lastSyncUtc: string | null,
  syncTime: string,
  zone?: string
): boolean {
  if (!lastSyncUtc) return true
  const last = Date.parse(lastSyncUtc)
  if (now.getTime() - last >= DAY_MS) return true
  const [h = 4, m = 0] = syncTime.split(':').map(Number)
  const local = DateTime.fromJSDate(now, zone ? { zone } : {})
  const todayAt = local.set({ hour: h, minute: m, second: 0, millisecond: 0 })
  return local >= todayAt && last < todayAt.toMillis()
}

/** A new backfill from `fromUtc` to `untilUtc` (when it started), in 7-day windows. */
export function startBackfill(fromUtc: string, untilUtc: string): BackfillCursor | null {
  const windows = timeWindows(fromUtc, untilUtc)
  if (windows.length === 0) return null
  return {
    nextWindowStartUtc: fromUtc,
    endUtc: untilUtc,
    windowsDone: 0,
    windowsTotal: windows.length
  }
}

/** The next window of a backfill, or null when it's finished. */
export function nextBackfillWindow(cursor: BackfillCursor): TimeWindow | null {
  return timeWindows(cursor.nextWindowStartUtc, cursor.endUtc)[0] ?? null
}

/** Cursor after finishing `window`; null when the backfill is complete. */
export function advanceBackfill(cursor: BackfillCursor, window: TimeWindow): BackfillCursor | null {
  const next = { ...cursor, nextWindowStartUtc: window.end, windowsDone: cursor.windowsDone + 1 }
  return nextBackfillWindow(next) ? next : null
}

// ---- files ---------------------------------------------------------------------------------

/** Lowercase ASCII slug of a clip title for file names. */
export function slugify(title: string, max = 40): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'clip'
}

/** Clip ids are URL-safe already; keep only safe characters for file names anyway. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

export interface ClipNaming {
  id: string
  title: string
  createdAtUtc: string
}

/**
 * "<login>/<YYYY>/<YYYY-MM>" (UTC), relative to the clip folder. The login becomes a folder
 * name, so anything that isn't a Twitch login (e.g. "../x") is refused instead of used.
 */
export function clipFolder(login: string, createdAtUtc: string): string {
  if (!isValidTwitchLogin(login)) {
    throw new Error(`"${login}" isn't a valid Twitch login, so its clip folder can't be created.`)
  }
  const d = DateTime.fromISO(createdAtUtc, { zone: 'utc' })
  return `${login.toLowerCase()}/${d.toFormat('yyyy')}/${d.toFormat('yyyy-MM')}`
}

/** "YYYY-MM-DD_HHmmss_<id>_<slug>" (UTC). A plain name sort is oldest to newest. */
export function clipFileBase(clip: ClipNaming): string {
  const d = DateTime.fromISO(clip.createdAtUtc, { zone: 'utc' })
  return `${d.toFormat('yyyy-MM-dd_HHmmss')}_${safeId(clip.id)}_${slugify(clip.title)}`
}

export function clipVideoName(clip: ClipNaming, orientation: 'landscape' | 'portrait'): string {
  return `${clipFileBase(clip)}_${orientation}.mp4`
}

/** Wait before retrying a failed download: 5 min, 20 min, 80 min, ... capped at 1 day. */
export function downloadRetryDelayMs(attempts: number): number {
  return Math.min(DAY_MS, 5 * 60_000 * 4 ** Math.max(0, attempts - 1))
}

export const MAX_DOWNLOAD_ATTEMPTS = 5
