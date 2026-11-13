import type { PostStatus, VisibilityMode } from '@shared/constants/enums'

export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  needs_approval: 'Needs approval',
  queued: 'Queued',
  rendering: 'Rendering',
  uploading: 'Uploading',
  processing: 'Processing',
  scheduled: 'Scheduled',
  published: 'Published',
  needs_decision: 'Needs decision',
  failed: 'Failed',
  waiting_quota: 'Waiting for quota',
  canceled: 'Canceled'
}

/** Tailwind classes for the status badge. */
export const STATUS_TONES: Record<PostStatus, string> = {
  draft: 'border-zinc-600 text-zinc-300',
  needs_approval: 'border-amber-500/50 text-amber-300',
  queued: 'border-sky-500/50 text-sky-300',
  rendering: 'border-indigo-500/50 text-indigo-300',
  uploading: 'border-indigo-500/50 text-indigo-300',
  processing: 'border-violet-500/50 text-violet-300',
  scheduled: 'border-emerald-500/50 text-emerald-300',
  published: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
  needs_decision: 'border-amber-500 bg-amber-500/15 text-amber-300',
  failed: 'border-red-500 bg-red-500/15 text-red-300',
  waiting_quota: 'border-amber-500/50 text-amber-300',
  canceled: 'border-zinc-700 text-zinc-500'
}

export const VISIBILITY_LABELS: Record<VisibilityMode, string> = {
  schedule: 'Schedule',
  public: 'Public now',
  unlisted: 'Unlisted now',
  private: 'Private'
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
