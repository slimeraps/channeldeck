import { TriangleAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useAccounts, useReconnect } from '@renderer/hooks/useAccounts'
import { useReconnectTwitch, useTwitchAccounts } from '@renderer/hooks/useTwitch'
import { useUiStore } from '@renderer/stores/ui'

interface Expired {
  key: string
  name: string
  color: string
  kind: 'YouTube' | 'Twitch'
  reconnect: () => void
}

/** App-wide warning while any YouTube or Twitch sign-in has expired. */
export function ReauthBanner(): React.JSX.Element | null {
  const accounts = useAccounts()
  const twitch = useTwitchAccounts()
  const reconnect = useReconnect()
  const reconnectTwitch = useReconnectTwitch()
  const setPage = useUiStore((s) => s.setPage)

  const expired: Expired[] = [
    ...(accounts.data ?? [])
      .filter((a) => a.tokenStatus === 'needs_reauth')
      .map((a) => ({
        key: `yt-${a.id}`,
        name: a.channelTitle,
        color: a.color,
        kind: 'YouTube' as const,
        reconnect: () => reconnect.mutate(a.id)
      })),
    ...(twitch.data ?? [])
      .filter((a) => a.tokenStatus === 'needs_reauth')
      .map((a) => ({
        key: `tw-${a.id}`,
        name: a.displayName,
        color: a.color,
        kind: 'Twitch' as const,
        reconnect: () => reconnectTwitch.mutate(a.id)
      }))
  ]
  if (expired.length === 0) return null

  const only = expired.length === 1 ? expired[0] : undefined
  const effect = (e: Expired): string =>
    e.kind === 'YouTube' ? 'its uploads are paused' : 'its clip sync is paused'

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-8 py-2 text-sm"
    >
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="flex flex-1 flex-wrap items-center gap-x-1.5">
        {expired.map((e, i) => (
          <span key={e.key} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: e.color }} aria-hidden />
            <span className="font-medium">{e.name}</span>
            <span className="text-muted-foreground">({e.kind})</span>
            {i < expired.length - 1 ? ',' : ''}
          </span>
        ))}
        <span>
          {only
            ? `needs you to sign in again; ${effect(only)} until then.`
            : 'need you to sign in again; they’re paused until then.'}
        </span>
      </span>
      {only ? (
        <Button
          size="sm"
          onClick={only.reconnect}
          disabled={reconnect.isPending || reconnectTwitch.isPending}
        >
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
