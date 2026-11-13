import { DateTime } from 'luxon'

/** "Thu, Nov 13, 9:00 AM" in the Mac's local time zone. */
export function formatLocal(iso: string): string {
  return DateTime.fromISO(iso).toLocal().toFormat('ccc, LLL d, h:mm a')
}

/** "in 3h 20m", "in 2d 4h", "5m ago". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = DateTime.fromISO(iso).toMillis() - now.getTime()
  const future = diffMs >= 0
  let minutes = Math.round(Math.abs(diffMs) / 60_000)
  if (minutes < 1) return future ? 'in less than a minute' : 'just now'
  const days = Math.floor(minutes / (60 * 24))
  minutes -= days * 60 * 24
  const hours = Math.floor(minutes / 60)
  minutes -= hours * 60
  const parts =
    days > 0
      ? [`${days}d`, hours > 0 ? `${hours}h` : '']
      : [hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '']
  const text = parts.filter(Boolean).join(' ')
  return future ? `in ${text}` : `${text} ago`
}
