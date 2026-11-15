import { describe, expect, it } from 'vitest'
import { queueEmptyView } from './queueEmpty'

const base = {
  loaded: true,
  rowCount: 0,
  totalPosts: 3,
  statusFilter: 'active',
  accountFilter: 'all',
  sourceFilter: 'all'
}

describe('queueEmptyView', () => {
  it('shows rows while loading', () => {
    expect(queueEmptyView({ ...base, loaded: false, totalPosts: 0 })).toBe('rows')
  })

  it('shows rows when there are any', () => {
    expect(queueEmptyView({ ...base, rowCount: 2 })).toBe('rows')
  })

  it('shows first-run only when no posts exist in any status', () => {
    expect(queueEmptyView({ ...base, totalPosts: 0 })).toBe('first-run')
    expect(queueEmptyView({ ...base, totalPosts: 0, statusFilter: 'failed' })).toBe('first-run')
  })

  it('keeps the filter bar when only finished posts exist', () => {
    expect(queueEmptyView(base)).toBe('no-active')
  })

  it('reports no-match when other filters are applied', () => {
    expect(queueEmptyView({ ...base, accountFilter: '2' })).toBe('no-match')
    expect(queueEmptyView({ ...base, sourceFilter: 'autopost' })).toBe('no-match')
    expect(queueEmptyView({ ...base, statusFilter: 'failed' })).toBe('no-match')
    expect(queueEmptyView({ ...base, statusFilter: 'all' })).toBe('no-match')
  })
})
