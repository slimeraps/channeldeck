import { DateTime } from 'luxon'

/**
 * Autopost slots: "HH:mm" times on chosen weekdays, in a local IANA zone, turned into UTC
 * instants. DST-safe by rule (PLAN.md):
 *  - a time that doesn't exist (spring forward, e.g. 02:30) moves to the next valid minute
 *    (03:00);
 *  - a time that happens twice (fall back, e.g. 01:30) uses the first occurrence.
 * Luxon on its own does neither (it shifts gap times by the gap length and picks the
 * second occurrence of a repeated time), so this resolves wall-clock times itself.
 */

const MINUTE = 60_000

function wallMatches(utcMs: number, zone: string, wall: DateTime): boolean {
  const local = DateTime.fromMillis(utcMs, { zone })
  return (
    local.year === wall.year &&
    local.month === wall.month &&
    local.day === wall.day &&
    local.hour === wall.hour &&
    local.minute === wall.minute
  )
}

/** Every UTC instant that shows this wall-clock time in the zone (0, 1 or 2 of them). */
function instantsFor(wall: DateTime, zone: string): number[] {
  // The wall time read as if it were UTC; real instants are this minus the zone's offset.
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const offsets = new Set<number>()
  for (const probe of [naive - 86_400_000, naive, naive + 86_400_000]) {
    offsets.add(DateTime.fromMillis(probe, { zone }).offset)
  }
  return [...offsets]
    .map((offsetMin) => naive - offsetMin * MINUTE)
    .filter((utc) => wallMatches(utc, zone, wall))
    .sort((a, b) => a - b)
}

/** "HH:mm" on a local date → UTC Date, applying the DST rules above. */
export function resolveLocalTime(isoDate: string, time: string, zone: string): Date {
  const [h, m] = time.split(':').map(Number)
  let wall = DateTime.fromISO(isoDate, { zone: 'utc' }).set({
    hour: h ?? 0,
    minute: m ?? 0,
    second: 0,
    millisecond: 0
  })
  // Gaps are at most a few hours; step a minute at a time to the first time that exists.
  for (let i = 0; i <= 24 * 60; i++) {
    const found = instantsFor(wall, zone)
    if (found.length > 0) return new Date(found[0] as number)
    wall = wall.plus({ minutes: 1 })
  }
  throw new Error(`No valid local time for ${isoDate} ${time} in ${zone}`)
}

export interface SlotRule {
  /** "HH:mm" local times. */
  slots: readonly string[]
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  weekdays: readonly number[]
}

/**
 * Slot instants (UTC ISO strings) in (from, to], in order, without duplicates. Dates are
 * walked in the local zone, so a slot belongs to the weekday it falls on locally.
 */
export function slotsBetween(rule: SlotRule, from: Date, to: Date, zone: string): string[] {
  if (rule.slots.length === 0 || rule.weekdays.length === 0) return []
  const out = new Set<string>()
  // Start a day early so a slot just after `from` on the previous local date isn't missed.
  let day = DateTime.fromJSDate(from, { zone }).startOf('day').minus({ days: 1 })
  const lastDay = DateTime.fromJSDate(to, { zone }).startOf('day').plus({ days: 1 })
  while (day <= lastDay) {
    if (rule.weekdays.includes(day.weekday)) {
      const isoDate = day.toISODate() as string
      for (const time of rule.slots) {
        const at = resolveLocalTime(isoDate, time, zone)
        if (at > from && at <= to) out.add(at.toISOString())
      }
    }
    day = day.plus({ days: 1 })
  }
  return [...out].sort()
}

/** Slots per local day (for quota forecasts): how many uploads a rule adds on that date. */
export function slotsOnDate(rule: SlotRule, isoDate: string, zone: string): number {
  const day = DateTime.fromISO(isoDate, { zone })
  if (!rule.weekdays.includes(day.weekday)) return 0
  return new Set(rule.slots).size
}

/** Times must be "HH:mm"; returns them sorted and de-duplicated. */
export function normalizeSlots(slots: readonly string[]): string[] {
  return [...new Set(slots.filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)))].sort()
}
