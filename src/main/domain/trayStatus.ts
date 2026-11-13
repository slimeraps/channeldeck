import { DateTime } from 'luxon'
import type { PostStatus, VisibilityMode } from '@shared/constants/enums'

/** What the menu bar icon shows: how many posts are on their way, and the next publish. */

/** Posts that are on their way to YouTube (or waiting on you). */
export const PENDING_STATUSES: PostStatus[] = [
  'needs_approval',
  'queued',
  'rendering',
  'uploading',
  'processing',
  'scheduled',
  'waiting_quota',
  'needs_decision',
  'failed'
]

export interface TrayPost {
  status: PostStatus
  visibilityMode: VisibilityMode
  publishAtUtc: string | null
  title: string
}

export interface TrayStatus {
  pending: number
  needsYou: number
  next: { title: string; atUtc: string } | null
}

export function trayStatus(posts: readonly TrayPost[], now: Date): TrayStatus {
  const pending = posts.filter((p) => PENDING_STATUSES.includes(p.status))
  const iso = now.toISOString()
  const next = pending
    .filter((p) => p.visibilityMode === 'schedule' && p.publishAtUtc && p.publishAtUtc > iso)
    .sort((a, b) => (a.publishAtUtc as string).localeCompare(b.publishAtUtc as string))[0]
  return {
    pending: pending.length,
    needsYou: pending.filter((p) =>
      (['needs_approval', 'needs_decision', 'failed'] as PostStatus[]).includes(p.status)
    ).length,
    next: next ? { title: next.title, atUtc: next.publishAtUtc as string } : null
  }
}

/** "Fri 18:00 (in 2h 5m)" in the Mac's zone. */
export function formatNext(atUtc: string, now: Date, zone: string): string {
  const at = DateTime.fromISO(atUtc, { zone })
  const mins = Math.max(0, Math.round((at.toMillis() - now.getTime()) / 60_000))
  const rel =
    mins < 60
      ? `${mins}m`
      : mins < 48 * 60
        ? `${Math.floor(mins / 60)}h ${mins % 60}m`
        : `${Math.round(mins / 1440)}d`
  return `${at.setLocale('en-US').toFormat('ccc HH:mm')} (in ${rel})`
}
