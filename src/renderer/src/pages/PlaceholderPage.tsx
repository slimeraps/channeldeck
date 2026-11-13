import type { PageDef } from '@renderer/app/nav'
import { EmptyState } from '@renderer/components/EmptyState'
import { NewPostButton } from '@renderer/components/NewPostButton'
import { Badge } from '@renderer/components/ui/badge'

/** Stand-in for pages that later phases build. Shows the page's empty state. */
export function PlaceholderPage({ page }: { page: PageDef }): React.JSX.Element {
  return (
    <EmptyState
      icon={page.icon}
      title={page.emptyTitle}
      action={page.offersNewPost ? <NewPostButton /> : undefined}
      footnote={<Badge variant="outline">Coming in Phase {page.phase}</Badge>}
    >
      {page.emptyBody}
    </EmptyState>
  )
}
