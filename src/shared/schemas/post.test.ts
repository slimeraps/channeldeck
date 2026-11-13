import { describe, expect, it } from 'vitest'
import {
  aspectRatioLabel,
  descriptionBytes,
  hasErrors,
  isLongVideo,
  isShortCandidate,
  normalizeTags,
  type PostInput,
  tagsLength,
  titleLength,
  validatePost
} from './post'

const now = new Date('2026-11-12T12:00:00Z')

function input(overrides: Partial<PostInput> = {}): PostInput {
  return {
    accountId: 1,
    filePath: '/Users/cody/Movies/mw4-day-9.mp4',
    title: 'MW4 Day 9',
    description: 'Day 9 of the grind.',
    tags: ['mw4', 'mechwarrior'],
    categoryId: '20',
    playlistId: null,
    thumbnailPath: null,
    madeForKids: false,
    notifySubscribers: true,
    license: 'youtube',
    embeddable: true,
    defaultLanguage: null,
    defaultAudioLanguage: null,
    syntheticMedia: false,
    visibilityMode: 'schedule',
    publishAtUtc: '2026-11-13T17:00:00.000Z',
    missedPolicy: 'ask',
    ...overrides
  }
}

const fields = (issues: ReturnType<typeof validatePost>, severity = 'error') =>
  issues.filter((i) => i.severity === severity).map((i) => i.field)

describe('measuring like YouTube', () => {
  it('counts title characters as code points', () => {
    expect(titleLength('abc')).toBe(3)
    expect(titleLength('🔥🔥')).toBe(2)
  })

  it('counts description bytes, not characters', () => {
    expect(descriptionBytes('abc')).toBe(3)
    expect(descriptionBytes('é')).toBe(2)
    expect(descriptionBytes('🔥')).toBe(4)
  })

  it('counts tags with commas and quotes around tags with spaces', () => {
    expect(tagsLength([])).toBe(0)
    expect(tagsLength(['Foo-Baz'])).toBe(7) // YouTube's own example
    expect(tagsLength(['Foo Baz'])).toBe(9) // YouTube's own example
    expect(tagsLength(['drift', 'track day'])).toBe(5 + 1 + 11)
  })

  it('normalizes tags', () => {
    expect(normalizeTags(['  drift ', 'Drift', '', 'track   day'])).toEqual(['drift', 'track day'])
  })
})

describe('Shorts and long videos', () => {
  it('detects vertical or square videos up to 3 minutes', () => {
    expect(isShortCandidate({ width: 1080, height: 1920, durationSec: 59 })).toBe(true)
    expect(isShortCandidate({ width: 1080, height: 1080, durationSec: 180 })).toBe(true)
    expect(isShortCandidate({ width: 1080, height: 1920, durationSec: 180.5 })).toBe(false)
    expect(isShortCandidate({ width: 1920, height: 1080, durationSec: 30 })).toBe(false)
  })

  it('flags videos over 15 minutes', () => {
    expect(isLongVideo(15 * 60)).toBe(false)
    expect(isLongVideo(15 * 60 + 1)).toBe(true)
  })

  it('labels common aspect ratios', () => {
    expect(aspectRatioLabel(1920, 1080)).toBe('16:9')
    expect(aspectRatioLabel(1080, 1920)).toBe('9:16')
    expect(aspectRatioLabel(1080, 1080)).toBe('1:1')
    expect(aspectRatioLabel(1998, 1080)).toBe('1.85:1')
  })
})

describe('validatePost', () => {
  it('accepts a complete scheduled post', () => {
    expect(validatePost(input(), { mode: 'queue', now })).toEqual([])
  })

  it('enforces title rules', () => {
    expect(fields(validatePost(input({ title: 'x'.repeat(101) }), { mode: 'queue', now }))).toEqual(
      ['title']
    )
    expect(fields(validatePost(input({ title: 'x'.repeat(100) }), { mode: 'queue', now }))).toEqual(
      []
    )
    expect(fields(validatePost(input({ title: 'Day <9>' }), { mode: 'draft', now }))).toEqual([
      'title'
    ])
    expect(fields(validatePost(input({ title: '   ' }), { mode: 'queue', now }))).toEqual(['title'])
  })

  it('enforces description bytes and angle brackets', () => {
    expect(
      fields(validatePost(input({ description: 'é'.repeat(2500) }), { mode: 'queue', now }))
    ).toEqual([])
    expect(
      fields(validatePost(input({ description: 'é'.repeat(2501) }), { mode: 'queue', now }))
    ).toEqual(['description'])
    expect(fields(validatePost(input({ description: 'a > b' }), { mode: 'queue', now }))).toEqual([
      'description'
    ])
  })

  it('enforces the tag budget', () => {
    const tags = Array.from({ length: 50 }, (_, i) => `tag number ${i}`) // way over 500
    expect(fields(validatePost(input({ tags }), { mode: 'draft', now }))).toEqual(['tags'])
  })

  it('requires the YouTube essentials only when queueing', () => {
    const empty = input({
      filePath: null,
      title: '',
      categoryId: null,
      madeForKids: null,
      publishAtUtc: null
    })
    expect(hasErrors(validatePost(empty, { mode: 'draft', now }))).toBe(false)
    expect(fields(validatePost(empty, { mode: 'queue', now })).sort()).toEqual(
      ['categoryId', 'filePath', 'madeForKids', 'publishAtUtc', 'title'].sort()
    )
  })

  it('requires a channel even for drafts', () => {
    expect(fields(validatePost(input({ accountId: null }), { mode: 'draft', now }))).toEqual([
      'accountId'
    ])
  })

  it('requires a future publish time for Schedule', () => {
    expect(
      fields(
        validatePost(input({ publishAtUtc: '2026-11-12T11:59:00.000Z' }), { mode: 'queue', now })
      )
    ).toEqual(['publishAtUtc'])
    expect(fields(validatePost(input({ publishAtUtc: 'soon' }), { mode: 'queue', now }))).toEqual([
      'publishAtUtc'
    ])
  })

  it('does not need a publish time for Public / Unlisted / Private now', () => {
    for (const visibilityMode of ['public', 'unlisted', 'private'] as const) {
      expect(
        validatePost(input({ visibilityMode, publishAtUtc: null }), { mode: 'queue', now })
      ).toEqual([])
    }
  })

  it('warns (without blocking) about long videos', () => {
    const issues = validatePost(input(), { mode: 'queue', now, durationSec: 20 * 60 })
    expect(hasErrors(issues)).toBe(false)
    expect(fields(issues, 'warning')).toEqual(['filePath'])
  })
})
