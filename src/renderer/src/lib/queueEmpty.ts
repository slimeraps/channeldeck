export type QueueEmptyView = 'rows' | 'first-run' | 'no-active' | 'no-match'

interface QueueEmptyInput {
  /** Both the filtered and the unfiltered post lists have loaded. */
  loaded: boolean
  rowCount: number
  /** Posts in every status, ignoring all filters. */
  totalPosts: number
  statusFilter: string
  accountFilter: string
  sourceFilter: string
}

/**
 * What the queue shows when there may be nothing to list. Only a user with no posts
 * at all gets the first-run screen; everyone else keeps the filter bar.
 */
export function queueEmptyView(i: QueueEmptyInput): QueueEmptyView {
  if (!i.loaded || i.rowCount > 0) return 'rows'
  if (i.totalPosts === 0) return 'first-run'
  if (i.statusFilter === 'active' && i.accountFilter === 'all' && i.sourceFilter === 'all') {
    return 'no-active'
  }
  return 'no-match'
}
