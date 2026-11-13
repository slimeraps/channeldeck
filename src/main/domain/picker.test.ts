import { describe, expect, it } from 'vitest'
import { type PickableClip, pickClips, type PickRule, rejectReason } from './picker'

function clip(id: string, overrides: Partial<PickableClip> = {}): PickableClip {
  return {
    id,
    twitchAccountId: 1,
    createdAtUtc: '2026-11-01T00:00:00.000Z',
    viewCount: 10,
    durationSec: 30,
    gameId: 'mw4',
    isFeatured: false,
    hidden: false,
    downloadStatus: 'downloaded',
    landscapePath: `/clips/${id}_landscape.mp4`,
    portraitPath: null,
    ...overrides
  }
}

const bank = [
  clip('b', { createdAtUtc: '2026-11-02T00:00:00.000Z', viewCount: 500 }),
  clip('a', { createdAtUtc: '2026-11-01T00:00:00.000Z', viewCount: 50 }),
  clip('c', { createdAtUtc: '2026-11-03T00:00:00.000Z', viewCount: 500 }),
  clip('d', { createdAtUtc: '2026-11-04T00:00:00.000Z', viewCount: 5 })
]
const rule: PickRule = { twitchAccountIds: [1], pickOrder: 'oldest', filters: {} }
const ids = (clips: PickableClip[]): string[] => clips.map((c) => c.id)

describe('pickClips', () => {
  it('picks oldest first by default', () => {
    expect(ids(pickClips(bank, rule, new Set(), 3))).toEqual(['a', 'b', 'c'])
  })

  it('picks newest first', () => {
    expect(ids(pickClips(bank, { ...rule, pickOrder: 'newest' }, new Set(), 2))).toEqual(['d', 'c'])
  })

  it('picks most viewed first, older clip winning a tie', () => {
    expect(ids(pickClips(bank, { ...rule, pickOrder: 'most_viewed' }, new Set(), 4))).toEqual([
      'b',
      'c',
      'a',
      'd'
    ])
  })

  it('leaves out excluded clips (already used on this channel)', () => {
    expect(ids(pickClips(bank, rule, new Set(['a', 'b']), 5))).toEqual(['c', 'd'])
  })

  it('returns nothing for a count of 0', () => {
    expect(pickClips(bank, rule, new Set(), 0)).toEqual([])
  })
})

describe('rejectReason', () => {
  const none = new Set<string>()

  it('skips hidden, undownloaded and other-channel clips', () => {
    expect(rejectReason(clip('x', { hidden: true }), rule, none)).toBe('hidden')
    expect(rejectReason(clip('x', { downloadStatus: 'pending' }), rule, none)).toBe(
      'not downloaded'
    )
    expect(rejectReason(clip('x', { downloadStatus: 'not_downloadable' }), rule, none)).toBe(
      'not downloaded'
    )
    expect(rejectReason(clip('x', { landscapePath: null }), rule, none)).toBe('not downloaded')
    expect(rejectReason(clip('x', { twitchAccountId: 2 }), rule, none)).toBe('other channel')
  })

  it('accepts a clip that only has a portrait file', () => {
    expect(
      rejectReason(clip('x', { landscapePath: null, portraitPath: '/p.mp4' }), rule, none)
    ).toBeNull()
  })

  it('applies each filter', () => {
    const f = (filters: PickRule['filters']): PickRule => ({ ...rule, filters })
    expect(rejectReason(clip('x'), f({ gameIds: ['ac'] }), none)).toBe('game')
    expect(rejectReason(clip('x', { gameId: null }), f({ gameIds: ['mw4'] }), none)).toBe('game')
    expect(rejectReason(clip('x'), f({ gameIds: ['ac', 'mw4'] }), none)).toBeNull()
    expect(rejectReason(clip('x'), f({ gameIds: [] }), none)).toBeNull()
    expect(rejectReason(clip('x'), f({ minDurationSec: 31 }), none)).toBe('too short')
    expect(rejectReason(clip('x'), f({ maxDurationSec: 29 }), none)).toBe('too long')
    expect(rejectReason(clip('x'), f({ minDurationSec: 30, maxDurationSec: 30 }), none)).toBeNull()
    expect(rejectReason(clip('x'), f({ minViews: 11 }), none)).toBe('views')
    expect(rejectReason(clip('x'), f({ featuredOnly: true }), none)).toBe('not featured')
    expect(
      rejectReason(clip('x', { isFeatured: true }), f({ featuredOnly: true }), none)
    ).toBeNull()
  })
})
