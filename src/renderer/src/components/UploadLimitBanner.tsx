import { Hourglass } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useAccounts } from '@renderer/hooks/useAccounts'
import { useRetryChannel } from '@renderer/hooks/usePosts'
import { formatLocal, formatRelative } from '@renderer/lib/time'

/**
 * App-wide note while a channel is held back by YouTube's per-channel upload limit
 * (uploadLimitExceeded). Only that channel waits; the others keep uploading.
 */
export function UploadLimitBanner(): React.JSX.Element | null {
  const accounts = useAccounts()
  const retry = useRetryChannel()
  const now = new Date().toISOString()
  const limited = (accounts.data ?? []).filter(
    (a) => a.uploadLimitedUntilUtc !== null && a.uploadLimitedUntilUtc > now
  )
  if (limited.length === 0) return null

  return (
    <div role="status" className="border-b border-amber-500/40 bg-amber-500/10 text-sm">
      {limited.map((a) => {
        const until = a.uploadLimitedUntilUtc as string
        return (
          <div key={a.id} className="flex items-center gap-3 px-8 py-2">
            <Hourglass className="size-4 shrink-0 text-amber-300" aria-hidden />
            <p className="flex-1">
              <span className="inline-flex items-center gap-1 align-baseline">
                <span className="size-2 rounded-full" style={{ background: a.color }} aria-hidden />
                <span className="font-medium">{a.channelTitle}</span>
              </span>{' '}
              hit YouTube&apos;s daily upload limit for the channel. Its uploads wait until{' '}
              {formatLocal(until)} ({formatRelative(until)}). Your other channels keep uploading.{' '}
              <span className="text-muted-foreground">
                This is a limit on the channel, not your API quota.
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={retry.isPending}
              onClick={() => retry.mutate(a.id)}
              title="Forget the limit and try this channel's uploads now. If YouTube still refuses, it waits again."
            >
              Try now
            </Button>
          </div>
        )
      })}
    </div>
  )
}
