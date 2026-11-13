import { describe, expect, it } from 'vitest'
import { descriptionBytes, titleLength } from './schemas/post'
import {
  clipTemplateValues,
  DEFAULT_DESCRIPTION_TEMPLATE,
  finalizeDescription,
  finalizeTitle,
  hasPostVariables,
  postDateLabel,
  renderPostVariables,
  renderTemplate,
  unknownVariables
} from './templates'

const clip = {
  title: 'Insane 1v4 clutch',
  url: 'https://clips.twitch.tv/AbcDef',
  creatorName: 'clipperdude',
  viewCount: 12345,
  createdAtUtc: '2026-11-12T03:30:00.000Z',
  gameName: 'MechWarrior 4'
}
const values = clipTemplateValues(clip, {
  broadcasterName: 'Helmsy',
  broadcasterLogin: 'helmsyy',
  n: 7,
  zone: 'America/Chicago'
})

describe('renderTemplate', () => {
  it('fills every clip variable', () => {
    expect(
      renderTemplate(
        '{{clip_title}} | {{game}} | {{broadcaster}} | {{clipper}} | {{clip_date}} | {{views}} | #{{n}}',
        values
      )
    ).toBe('Insane 1v4 clutch | MechWarrior 4 | Helmsy | clipperdude | Nov 11, 2026 | 12,345 | #7')
  })

  it('uses the local date of the clip, not the UTC one', () => {
    // 03:30 UTC on the 12th is the evening of the 11th in Chicago.
    expect(values.clip_date).toBe('Nov 11, 2026')
  })

  it('tolerates spaces inside braces and leaves unknown variables visible', () => {
    expect(renderTemplate('{{ clip_title }} {{nope}}', values)).toBe('Insane 1v4 clutch {{nope}}')
    expect(unknownVariables('{{ clip_title }} {{nope}} {{date}} {{nope}}')).toEqual([
      'nope',
      'date'
    ])
  })

  it('renders the default description with credit and links', () => {
    expect(renderTemplate(DEFAULT_DESCRIPTION_TEMPLATE, values)).toBe(
      'Clipped by clipperdude\nhttps://clips.twitch.tv/AbcDef\n\nWatch Helmsy live: https://www.twitch.tv/helmsyy'
    )
  })

  it('renders a missing game as empty', () => {
    const v = clipTemplateValues(
      { ...clip, gameName: null },
      { broadcasterName: 'H', broadcasterLogin: 'h', n: 1, zone: 'UTC' }
    )
    expect(renderTemplate('[{{game}}]', v)).toBe('[]')
  })
})

describe('finalizeTitle', () => {
  it('removes angle brackets and line breaks', () => {
    expect(finalizeTitle('  <b>Big</b>\nplay  ')).toBe('bBig/b play')
  })

  it('cuts long titles at a word, within 100 characters', () => {
    const long = `${'word '.repeat(30)}end`
    const out = finalizeTitle(long)
    expect(titleLength(out)).toBeLessThanOrEqual(100)
    expect(out.endsWith('word…')).toBe(true)
  })

  it('counts emoji as one character and never splits one', () => {
    const out = finalizeTitle('😀'.repeat(150))
    expect(titleLength(out)).toBe(100)
    expect(out.endsWith('…')).toBe(true)
  })

  it('falls back when the template renders empty', () => {
    expect(finalizeTitle('  ', 'Clip')).toBe('Clip')
  })
})

describe('finalizeDescription', () => {
  it('keeps descriptions under 5000 bytes without splitting characters', () => {
    const out = finalizeDescription('é'.repeat(3000)) // 6000 bytes
    expect(descriptionBytes(out)).toBe(5000)
    expect(out).toBe('é'.repeat(2500))
  })

  it('removes angle brackets', () => {
    expect(finalizeDescription('a <tag> b')).toBe('a tag b')
  })
})

describe('post templates', () => {
  it('fills in only the variables it has values for', () => {
    expect(
      renderPostVariables('MW4 Day {{n}} · {{ date }} · {{channel}}', {
        date: 'Nov 14, 2026',
        channel: 'Helmsy'
      })
    ).toBe('MW4 Day {{n}} · Nov 14, 2026 · Helmsy')
    expect(renderPostVariables('MW4 Day {{n}}', { n: '9' })).toBe('MW4 Day 9')
    expect(renderPostVariables('{{clip_title}} {{n}}', { n: '2' })).toBe('{{clip_title}} 2')
  })

  it('detects remaining variables', () => {
    expect(hasPostVariables('Day {{n}}')).toBe(true)
    expect(hasPostVariables('Day {{ date }}')).toBe(true)
    expect(hasPostVariables('Day 9 {{clip_title}}')).toBe(false)
  })

  it('labels the publish date in the local zone', () => {
    expect(postDateLabel(new Date('2026-11-15T03:00:00Z'), 'America/Chicago')).toBe('Nov 14, 2026')
  })
})
