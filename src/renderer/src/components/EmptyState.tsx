import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  children: ReactNode
  action?: ReactNode
  footnote?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  footnote
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border bg-card">
        <Icon className="size-7 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{children}</p>
      {action ? <div className="mt-6">{action}</div> : null}
      {footnote ? <div className="mt-6">{footnote}</div> : null}
    </div>
  )
}
