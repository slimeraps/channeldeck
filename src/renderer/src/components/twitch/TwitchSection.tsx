import {
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import { CHANNEL_COLORS } from '@shared/constants/colors'
import type { TwitchAccountView } from '@shared/schemas/twitch'
import { ConnectTwitchDialog } from '@renderer/components/twitch/ConnectTwitchDialog'
import { TwitchSetup } from '@renderer/components/twitch/TwitchSetup'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Switch } from '@renderer/components/ui/switch'
import {
  useReconnectTwitch,
  useTwitchAccounts,
  useTwitchAction,
  useTwitchConfig
} from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { formatBytes } from '@renderer/lib/status'
import { formatRelative } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'

function TwitchRow({
  account,
  onRemove
}: {
  account: TwitchAccountView
  onRemove: () => void
}): React.JSX.Element {
  const reconnect = useReconnectTwitch()
  const update = useTwitchAction((v: { id: number; syncEnabled?: boolean; color?: string }) =>
    invoke('twitch:update', v)
  )
  const syncNow = useTwitchAction(
    (id: number) => invoke('twitch:syncNow', { id }),
    () => `Syncing ${account.displayName}…`
  )
  const needsReauth = account.tokenStatus === 'needs_reauth'
  const b = account.backfill
  const pct = b && b.windowsTotal > 0 ? Math.round((b.windowsDone / b.windowsTotal) * 100) : 0

  return (
    <div
      className={cn('rounded-lg border bg-card px-4 py-3', !account.syncEnabled && 'opacity-60')}
    >
      <div className="flex items-center gap-4">
        <div className="relative">
          <Avatar className="size-10">
            {account.avatarUrl ? <AvatarImage src={account.avatarUrl} alt="" /> : null}
            <AvatarFallback>{account.displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span
            className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-card"
            style={{ backgroundColor: account.color }}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{account.displayName}</span>
            {needsReauth ? (
              <Badge variant="destructive">Needs re-auth</Badge>
            ) : (
              <Badge variant="outline" className="text-green-400">
                OK
              </Badge>
            )}
            {account.viaEditor ? <Badge variant="secondary">Editor</Badge> : null}
            {account.syncing ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden /> syncing
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {[
              `@${account.login}`,
              `${account.stats.total} clips`,
              `${account.stats.downloaded} downloaded`,
              account.stats.pendingDownloads
                ? `${account.stats.pendingDownloads} to download`
                : null,
              account.stats.failedDownloads ? `${account.stats.failedDownloads} failed` : null,
              formatBytes(account.stats.bytesOnDisk),
              account.lastSyncUtc
                ? `synced ${formatRelative(account.lastSyncUtc)}`
                : 'not synced yet'
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        {needsReauth ? (
          <Button
            size="sm"
            onClick={() => reconnect.mutate(account.id)}
            disabled={reconnect.isPending}
          >
            <KeyRound aria-hidden />
            Reconnect
          </Button>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={account.syncEnabled}
            onCheckedChange={(syncEnabled) => update.mutate({ id: account.id, syncEnabled })}
            aria-label={`Clip sync for ${account.displayName}`}
          />
          Sync
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`More for ${account.displayName}`}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={needsReauth || account.syncing}
              onSelect={() => syncNow.mutate(account.id)}
            >
              <RefreshCw aria-hidden /> Sync now
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => reconnect.mutate(account.id)}
              disabled={reconnect.isPending}
            >
              <KeyRound aria-hidden /> Reconnect…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Color
            </DropdownMenuLabel>
            <div className="flex gap-1.5 px-2 pb-2">
              {CHANNEL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Color ${color}`}
                  onClick={() => update.mutate({ id: account.id, color })}
                  className={cn(
                    'size-5 rounded-full border-2',
                    color === account.color ? 'border-foreground' : 'border-transparent'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              <Trash2 aria-hidden /> Remove…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {b ? (
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Backfilling clip history ({b.windowsDone} of {b.windowsTotal} weeks)
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function TwitchSection(): React.JSX.Element {
  const config = useTwitchConfig()
  const accounts = useTwitchAccounts()
  const [connecting, setConnecting] = useState(false)
  const [editingApp, setEditingApp] = useState(false)
  const [removing, setRemoving] = useState<TwitchAccountView | null>(null)
  const remove = useTwitchAction(
    (id: number) => invoke('twitch:remove', { id }),
    (r) => `Removed. ${r.removedClips} clips forgotten; files on disk were kept.`
  )

  const configured = Boolean(config.data?.clientId)
  const list = accounts.data ?? []

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Twitch accounts</h2>
          <p className="text-sm text-muted-foreground">
            Channels whose clips ChannelDeck banks and autoposts.
          </p>
        </div>
        {configured ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditingApp((v) => !v)}>
              <Settings2 aria-hidden />
              Twitch app
            </Button>
            <Button onClick={() => setConnecting(true)}>
              <Plus aria-hidden />
              Connect Twitch
            </Button>
          </div>
        ) : null}
      </div>

      {config.data && (!configured || editingApp) ? (
        <TwitchSetup config={config.data} onDone={() => setEditingApp(false)} />
      ) : null}

      {configured && list.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <Radio className="size-5" aria-hidden />
          <span>
            No Twitch channels yet. Click <span className="text-foreground">Connect Twitch</span> to
            start banking clips.
          </span>
        </div>
      ) : null}

      <div className="space-y-2">
        {list.map((account) => (
          <TwitchRow key={account.id} account={account} onRemove={() => setRemoving(account)} />
        ))}
      </div>

      {connecting ? <ConnectTwitchDialog onClose={() => setConnecting(false)} /> : null}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              ChannelDeck stops syncing this channel and forgets its clips. Downloaded files stay in
              your clip folder, and videos already on YouTube aren’t touched. Posts made from its
              clips that aren’t uploaded yet need to be unscheduled first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => removing && remove.mutate(removing.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
