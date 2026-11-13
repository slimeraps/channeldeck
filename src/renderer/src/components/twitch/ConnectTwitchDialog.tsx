import { ExternalLink, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { useConnectTwitch } from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { useUiStore } from '@renderer/stores/ui'

export function ConnectTwitchDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const connect = useConnectTwitch()
  const deviceCode = useUiStore((s) => s.deviceCode)
  const setDeviceCode = useUiStore((s) => s.setDeviceCode)
  const [mode, setMode] = useState<'broadcaster' | 'editor'>('broadcaster')
  const [channel, setChannel] = useState('')
  const [from, setFrom] = useState('')

  const close = (): void => {
    if (connect.isPending) void invoke('twitch:cancelConnect')
    setDeviceCode(null)
    onClose()
  }

  const start = (): void => {
    setDeviceCode(null)
    connect.mutate(
      {
        mode,
        ...(mode === 'editor' ? { channelLogin: channel.trim() } : {}),
        backfillFromUtc: from ? new Date(`${from}T00:00:00`).toISOString() : null
      },
      {
        onSuccess: () => {
          setDeviceCode(null)
          onClose()
        },
        onError: () => setDeviceCode(null)
      }
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a Twitch channel</DialogTitle>
          <DialogDescription>
            ChannelDeck asks only for permission to manage clips on that channel.
          </DialogDescription>
        </DialogHeader>

        {connect.isPending ? (
          deviceCode ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                Enter this code at twitch.tv/activate:
              </p>
              <p className="font-mono text-3xl tracking-widest select-text">
                {deviceCode.userCode}
              </p>
              <Button variant="outline" asChild>
                <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer">
                  Open twitch.tv/activate
                  <ExternalLink aria-hidden />
                </a>
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finish signing in to Twitch in your browser…
            </p>
          )
        ) : (
          <div className="space-y-4">
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as typeof mode)}
              className="gap-3"
            >
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="broadcaster" className="mt-0.5" />
                <span>
                  It’s my channel
                  <span className="block text-xs text-muted-foreground">
                    Sign in as the broadcaster.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <RadioGroupItem value="editor" className="mt-0.5" />
                <span>
                  I’m an editor of someone else’s channel
                  <span className="block text-xs text-muted-foreground">
                    Sign in as yourself; the channel owner must have made you an editor.
                  </span>
                </span>
              </label>
            </RadioGroup>
            {mode === 'editor' ? (
              <div className="grid gap-1.5">
                <Label htmlFor="tw-channel">Channel name</Label>
                <Input
                  id="tw-channel"
                  placeholder="as in twitch.tv/name"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="tw-from">Bank clips from</Label>
              <Input
                id="tw-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-48"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to backfill every clip since the channel was created.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {!connect.isPending ? (
            <Button onClick={start} disabled={mode === 'editor' && !channel.trim()}>
              Sign in with Twitch
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
