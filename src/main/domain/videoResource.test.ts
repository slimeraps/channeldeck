import { describe, expect, it } from 'vitest'
import { buildVideoResource, looksLockedPrivate, type PostForUpload } from './videoResource'

const post = (o: Partial<PostForUpload> = {}): PostForUpload => ({
  title: 'MW4 Day 9',
  description: 'Day 9',
  tags: ['mw4'],
  categoryId: '20',
  defaultLanguage: null,
  defaultAudioLanguage: null,
  visibilityMode: 'schedule',
  publishAtUtc: '2026-11-14T17:00:00.000Z',
  madeForKids: false,
  license: 'youtube',
  embeddable: true,
  syntheticMedia: false,
  ...o
})

describe('buildVideoResource', () => {
  it('schedules with private + publishAt in RFC 3339 UTC', () => {
    expect(buildVideoResource(post())).toEqual({
      snippet: { title: 'MW4 Day 9', description: 'Day 9', categoryId: '20', tags: ['mw4'] },
      status: {
        privacyStatus: 'private',
        publishAt: '2026-11-14T17:00:00Z',
        selfDeclaredMadeForKids: false,
        license: 'youtube',
        embeddable: true,
        containsSyntheticMedia: false
      }
    })
  })

  it('uses the visibility directly for "now" modes, without publishAt', () => {
    for (const mode of ['public', 'unlisted', 'private'] as const) {
      const r = buildVideoResource(post({ visibilityMode: mode, publishAtUtc: null }))
      expect(r.status['privacyStatus']).toBe(mode)
      expect(r.status).not.toHaveProperty('publishAt')
    }
  })

  it('includes languages only when set and omits empty tags', () => {
    const r = buildVideoResource(
      post({ tags: [], defaultLanguage: 'en', defaultAudioLanguage: 'en-US' })
    )
    expect(r.snippet).not.toHaveProperty('tags')
    expect(r.snippet).toMatchObject({ defaultLanguage: 'en', defaultAudioLanguage: 'en-US' })
  })

  it('refuses to build without the required fields', () => {
    expect(() => buildVideoResource(post({ categoryId: null }))).toThrow(/category/)
    expect(() => buildVideoResource(post({ madeForKids: null }))).toThrow(/Made for kids/)
    expect(() => buildVideoResource(post({ publishAtUtc: null }))).toThrow(/publish time/)
  })
})

describe('looksLockedPrivate', () => {
  it('flags public/unlisted uploads that came back private', () => {
    expect(looksLockedPrivate('public', 'private')).toBe(true)
    expect(looksLockedPrivate('unlisted', 'private')).toBe(true)
    expect(looksLockedPrivate('public', 'public')).toBe(false)
    expect(looksLockedPrivate('schedule', 'private')).toBe(false)
    expect(looksLockedPrivate('private', 'private')).toBe(false)
  })
})
