import {
  ExternalLink,
  KeyRound,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import { CHANNEL_COLORS } from '@shared/constants/colors'
import type { AccountView } from '@shared/schemas/account'
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
import { useReconnect, useRefreshAccount, useUpdateAccount } from '@renderer/hooks/useAccounts'
import { formatLocal, formatRelative } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'

interface ChannelRowProps {
  account: AccountView
  signInBusy: boolean
  onEditDefaults: () => void
  onRemove: () => void
}

export function ChannelRow({
  account,
  signInBusy,
  onEditDefaults,
  onRemove
}: ChannelRowProps): React.JSX.Element {
  const update = useUpdateAccount()
  const reconnect = useReconnect()
  const refresh = useRefreshAccount()
  const needsReauth = account.tokenStatus === 'needs_reauth'

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-lg border bg-card px-4 py-3',
        !account.enabled && 'opacity-60'
      )}
    >
      <div className="relative">
        <Avatar className="size-10">
          {account.avatarUrl ? <AvatarImage src={account.avatarUrl} alt="" /> : null}
          <AvatarFallback>{account.channelTitle.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span
          className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-card"
          style={{ backgroundColor: account.color }}
          aria-hidden
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{account.channelTitle}</span>
          {needsReauth ? (
            <Badge variant="destructive">Needs re-auth</Badge>
          ) : (
            <Badge variant="outline" className="text-green-400">
              OK
            </Badge>
          )}
          {!account.enabled ? <Badge variant="secondary">Paused</Badge> : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {[
            account.channelHandle,
            `${account.counts.pending} pending`,
            `${account.counts.scheduled} scheduled`,
            account.nextPublishAtUtc
              ? `next ${formatLocal(account.nextPublishAtUtc)} (${formatRelative(account.nextPublishAtUtc)})`
              : 'nothing scheduled'
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>

      {needsReauth ? (
        <Button
          size="sm"
          onClick={() => reconnect.mutate(account.id)}
          disabled={signInBusy || reconnect.isPending}
        >
          <KeyRound aria-hidden />
          Reconnect
        </Button>
      ) : null}

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={account.enabled}
          onCheckedChange={(enabled) => update.mutate({ accountId: account.id, enabled })}
          aria-label={`Uploads for ${account.channelTitle}`}
        />
        {account.enabled ? 'On' : 'Off'}
      </label>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More for ${account.channelTitle}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={onEditDefaults}>
            <SlidersHorizontal aria-hidden />
            Defaults for new posts…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => refresh.mutate(account.id)}
            disabled={needsReauth || refresh.isPending}
          >
            <RefreshCw aria-hidden />
            Check sign-in and refresh
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => reconnect.mutate(account.id)}
            disabled={signInBusy || reconnect.isPending}
          >
            <KeyRound aria-hidden />
            Reconnect…
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a
              href={`https://studio.youtube.com/channel/${account.channelId}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink aria-hidden />
              Open in YouTube Studio
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Calendar color
          </DropdownMenuLabel>
          <div className="flex gap-1.5 px-2 pb-2">
            {CHANNEL_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Color ${color}`}
                onClick={() => update.mutate({ accountId: account.id, color })}
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
            <Trash2 aria-hidden />
            Remove channel…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
