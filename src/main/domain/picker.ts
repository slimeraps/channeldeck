import type { PickOrder } from '@shared/constants/enums'
import type { AutopostFilters } from '@shared/types/json'

/**
 * Which banked clips an autopost rule may use next, in the order it uses them. Pure: the
 * caller passes the bank and the clips to leave out.
 */

export interface PickableClip {
  id: string
  twitchAccountId: number
  createdAtUtc: string
  viewCount: number
  durationSec: number
  gameId: string | null
  isFeatured: boolean
  hidden: boolean
  downloadStatus: string
  landscapePath: string | null
  portraitPath: string | null
}

export interface PickRule {
  twitchAccountIds: readonly number[]
  pickOrder: PickOrder
  filters: AutopostFilters
}

/** Why a clip can't be used, or null if it can. Exported for tests and the rule preview. */
export function rejectReason(
  clip: PickableClip,
  rule: PickRule,
  excluded: ReadonlySet<string>
): string | null {
  if (!rule.twitchAccountIds.includes(clip.twitchAccountId)) return 'other channel'
  if (clip.hidden) return 'hidden'
  if (clip.downloadStatus !== 'downloaded' || (!clip.landscapePath && !clip.portraitPath))
    return 'not downloaded'
  if (excluded.has(clip.id)) return 'already used'
  const f = rule.filters
  if (f.gameIds && f.gameIds.length > 0 && (!clip.gameId || !f.gameIds.includes(clip.gameId)))
    return 'game'
  if (f.minDurationSec !== undefined && clip.durationSec < f.minDurationSec) return 'too short'
  if (f.maxDurationSec !== undefined && clip.durationSec > f.maxDurationSec) return 'too long'
  if (f.minViews !== undefined && clip.viewCount < f.minViews) return 'views'
  if (f.featuredOnly && !clip.isFeatured) return 'not featured'
  return null
}

function compare(order: PickOrder): (a: PickableClip, b: PickableClip) => number {
  const byAge = (a: PickableClip, b: PickableClip): number =>
    a.createdAtUtc.localeCompare(b.createdAtUtc) || a.id.localeCompare(b.id)
  switch (order) {
    case 'oldest':
      return byAge
    case 'newest':
      return (a, b) => byAge(b, a)
    case 'most_viewed':
      // Ties go to the older clip, so the order is stable.
      return (a, b) => b.viewCount - a.viewCount || byAge(a, b)
  }
}

/** Up to `count` clips for the rule, best first. */
export function pickClips(
  bank: readonly PickableClip[],
  rule: PickRule,
  excluded: ReadonlySet<string>,
  count: number
): PickableClip[] {
  if (count <= 0) return []
  return bank
    .filter((clip) => rejectReason(clip, rule, excluded) === null)
    .sort(compare(rule.pickOrder))
    .slice(0, count)
}
