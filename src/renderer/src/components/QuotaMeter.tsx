import { formatRelative } from '@renderer/lib/time'
import { useQuota } from '@renderer/hooks/useStatus'
import { cn } from '@renderer/lib/utils'

function Bar({ used, max }: { used: number; max: number }): React.JSX.Element {
  const pct = Math.min(100, (used / max) * 100)
  return (
    <div className="h-1.5 overflow-hidden rounded bg-muted">
      <div
        className={cn(
          'h-full transition-[width]',
          pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary'
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * Today's YouTube quota: upload calls (100 a day) and units (10,000 a day), shared by all
 * channels in the Google Cloud project. Resets at midnight Pacific.
 */
export function QuotaMeter({ detailed = false }: { detailed?: boolean }): React.JSX.Element | null {
  const quota = useQuota()
  const q = quota.data
  if (!q) return null
  return (
    <div className={cn('space-y-2', detailed ? 'text-sm' : 'text-[11px]')}>
      <div className="space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <span>Uploads today</span>
          <span className="tabular-nums">
            {q.uploadCalls} / {q.uploadLimit}
          </span>
        </div>
        <Bar used={q.uploadCalls} max={q.uploadLimit} />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <span>Quota units</span>
          <span className="tabular-nums">
            {q.units.toLocaleString()} / {q.unitLimit.toLocaleString()}
          </span>
        </div>
        <Bar used={q.units} max={q.unitLimit} />
      </div>
      <div className="text-muted-foreground">
        Resets {formatRelative(q.resetsAtUtc)}
        {detailed ? ' (midnight Pacific). Dry Run calls don’t count.' : ''}
      </div>
    </div>
  )
}
