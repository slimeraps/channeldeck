import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { TwitchConfig } from '@shared/schemas/twitch'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useSetTwitchConfig } from '@renderer/hooks/useTwitch'

const CONSOLE = 'https://dev.twitch.tv/console/apps/create'

/** Client ID + Secret for your own Twitch app. Shown until a Client ID is saved, and for edits. */
export function TwitchSetup({
  config,
  onDone
}: {
  config: TwitchConfig
  onDone?: () => void
}): React.JSX.Element {
  const save = useSetTwitchConfig()
  const [clientId, setClientId] = useState(config.clientId ?? '')
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden />
          Your Twitch app
        </CardTitle>
        <CardDescription>
          ChannelDeck talks to Twitch through an app you register once in the Twitch developer
          console.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            In the Twitch developer console, click{' '}
            <span className="text-foreground">Register Your Application</span>.
          </li>
          <li>
            Add this <span className="text-foreground">OAuth Redirect URL</span> exactly:
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs text-foreground select-text">
                {config.redirectUri}
              </code>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Copy redirect URL"
                onClick={() => {
                  void navigator.clipboard.writeText(config.redirectUri)
                  setCopied(true)
                  toast.success('Copied')
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>
          </li>
          <li>
            Set <span className="text-foreground">Client Type</span> to{' '}
            <span className="text-foreground">Confidential</span>, then create it, open{' '}
            <span className="text-foreground">Manage</span>, and click{' '}
            <span className="text-foreground">New Secret</span>.
          </li>
          <li>Paste the Client ID and Client Secret here. The secret is kept in your Keychain.</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="tw-client-id">Client ID</Label>
            <Input
              id="tw-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tw-secret">Client Secret</Label>
            <Input
              id="tw-secret"
              type="password"
              value={secret}
              placeholder={config.hasSecret ? '•••••••• saved (leave empty to keep)' : ''}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          No secret? ChannelDeck can use Twitch’s device-code sign-in instead, but those sign-ins
          expire after 30 days, so you’d reconnect monthly.
        </p>
      </CardContent>
      <CardFooter className="gap-3">
        <Button
          disabled={!clientId.trim() || save.isPending}
          onClick={() =>
            save.mutate(
              {
                clientId: clientId.trim(),
                ...(secret.trim() ? { clientSecret: secret.trim() } : {})
              },
              { onSuccess: () => onDone?.() }
            )
          }
        >
          Save Twitch app
        </Button>
        {config.hasSecret ? (
          <Button
            variant="ghost"
            onClick={() =>
              save.mutate(
                { clientId: clientId.trim(), clientSecret: null },
                { onSuccess: () => onDone?.() }
              )
            }
          >
            Remove secret
          </Button>
        ) : null}
        <Button variant="ghost" asChild>
          <a href={CONSOLE} target="_blank" rel="noreferrer">
            Open Twitch console
            <ExternalLink aria-hidden />
          </a>
        </Button>
      </CardFooter>
    </Card>
  )
}
