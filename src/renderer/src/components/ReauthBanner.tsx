import { TriangleAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useAccounts, useReconnect } from '@renderer/hooks/useAccounts'
import { useUiStore } from '@renderer/stores/ui'

/** App-wide warning while any channel's Google sign-in has expired. */
export function ReauthBanner(): React.JSX.Element | null {
  const accounts = useAccounts()
  const reconnect = useReconnect()
  const setPage = useUiStore((s) => s.setPage)
  const expired = (accounts.data ?? []).filter((a) => a.tokenStatus === 'needs_reauth')
  if (expired.length === 0) return null

  const first = expired[0]
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-8 py-2 text-sm"
    >
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="flex-1">
        {expired.length === 1
          ? `${first?.channelTitle} needs you to sign in again. Its uploads are paused until then.`
          : `${expired.length} channels need you to sign in again. Their uploads are paused until then.`}
      </span>
      {expired.length === 1 && first ? (
        <Button size="sm" onClick={() => reconnect.mutate(first.id)} disabled={reconnect.isPending}>
          Reconnect
        </Button>
      ) : (
        <Button size="sm" onClick={() => setPage('channels')}>
          Go to Channels
        </Button>
      )}
    </div>
  )
}
