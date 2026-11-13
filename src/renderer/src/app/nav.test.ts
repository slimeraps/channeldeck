import { describe, expect, it } from 'vitest'
import { PAGE_IDS, PAGES, getPage } from './nav'

describe('sidebar pages', () => {
  it('lists the seven sidebar pages in the order from the brief', () => {
    expect(PAGES.map((p) => p.label)).toEqual([
      'Queue',
      'Calendar',
      'Clips',
      'Autopost',
      'Channels',
      'Templates',
      'Settings'
    ])
  })

  it('has exactly one definition per page id', () => {
    expect(PAGES.map((p) => p.id)).toEqual([...PAGE_IDS])
  })

  it('gives every page an empty state', () => {
    for (const page of PAGES) {
      expect(page.emptyTitle.length, page.id).toBeGreaterThan(0)
      expect(page.emptyBody.length, page.id).toBeGreaterThan(0)
    }
  })

  it('looks pages up by id', () => {
    expect(getPage('clips').label).toBe('Clips')
  })
})
