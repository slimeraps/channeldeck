import { describe, expect, it } from 'vitest'
import { PAGE_IDS, PAGES, getPage, visiblePages } from './nav'

describe('sidebar pages', () => {
  it('lists the sidebar pages in the order from the brief', () => {
    expect(PAGES.map((p) => p.label)).toEqual([
      'Queue',
      'Calendar',
      'Analytics',
      'Clips',
      'Editor',
      'Autopost',
      'Channels',
      'Templates',
      'Settings',
      'Health'
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

  it('hides Health until Show Health is on', () => {
    const labels = visiblePages({ showHealth: false }).map((p) => p.label)
    expect(labels).not.toContain('Health')
    expect(labels).toHaveLength(PAGES.length - 1)
  })

  it('lists Health last, after Settings, when Show Health is on', () => {
    const labels = visiblePages({ showHealth: true }).map((p) => p.label)
    expect(labels.slice(-2)).toEqual(['Settings', 'Health'])
    expect(labels).toHaveLength(PAGES.length)
  })

  it('looks pages up by id', () => {
    expect(getPage('clips').label).toBe('Clips')
  })
})
