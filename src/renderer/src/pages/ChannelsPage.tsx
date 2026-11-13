import { useIsMutating } from '@tanstack/react-query'
import { FileKey2, Info, Loader2, Plus, Radio } from 'lucide-react'
import { useState } from 'react'
import type { AccountView } from '@shared/schemas/account'
import { ChannelDefaultsDialog } from '@renderer/components/channels/ChannelDefaultsDialog'
import { ChannelRow } from '@renderer/components/channels/ChannelRow'
import { GoogleSetupCard } from '@renderer/components/channels/GoogleSetupCard'
import { RemoveChannelDialog } from '@renderer/components/channels/RemoveChannelDialog'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  useAccounts,
  useAddChannel,
  useCancelSignIn,
  useGoogleClientStatus,
  useImportClientFile,
  signInMutationKey
} from '@renderer/hooks/useAccounts'

export function ChannelsPage(): React.JSX.Element {
  const client = useGoogleClientStatus()
  const accounts = useAccounts()
  const addChannel = useAddChannel()
  const cancelSignIn = useCancelSignIn()
  const importFile = useImportClientFile()
  const signInBusy = useIsMutating({ mutationKey: signInMutationKey }) > 0

  const [editing, setEditing] = useState<AccountView | null>(null)
  const [removing, setRemoving] = useState<AccountView | null>(null)

  const configured = client.data?.configured ?? false
  const list = accounts.data ?? []

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-8 py-6">
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">YouTube channels</h2>
            <p className="text-sm text-muted-foreground">
              Channels ChannelDeck can upload to. They share one daily YouTube quota.
            </p>
          </div>
          {configured ? (
            <Button onClick={() => addChannel.mutate()} disabled={signInBusy}>
              {addChannel.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Plus aria-hidden />
              )}
              Add channel
            </Button>
          ) : null}
        </div>

        {client.isSuccess && !configured ? <GoogleSetupCard problem={client.data.problem} /> : null}

        {signInBusy ? (
          <Alert>
            <Loader2 className="animate-spin" aria-hidden />
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>
                Finish signing in in your browser. Pick the Google account, then the channel (or
                brand account) you want to add.
              </span>
              <Button size="sm" variant="outline" onClick={() => cancelSignIn.mutate()}>
                Cancel
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {configured && list.length === 0 && !signInBusy ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center">
            <p className="font-medium">No channels connected yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Click Add channel and sign in with the Google account that owns your channel.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          {list.map((account) => (
            <ChannelRow
              key={account.id}
              account={account}
              signInBusy={signInBusy}
              onEditDefaults={() => setEditing(account)}
              onRemove={() => setRemoving(account)}
            />
          ))}
        </div>

        {configured ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              Brand-account channels: click <span className="text-foreground">Add channel</span>{' '}
              again and choose the other channel in Google&apos;s account picker. Each channel is
              added separately.
            </p>
          </div>
        ) : null}

        {configured && client.data ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileKey2 className="size-3.5" aria-hidden />
            Google client{client.data.projectId ? ` for project ${client.data.projectId}` : ''} (
            {client.data.clientIdHint})
            <Button
              variant="link"
              size="sm"
              className="h-auto px-1 text-xs"
              onClick={() => importFile.mutate()}
            >
              Replace file
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Twitch accounts</h2>
          <p className="text-sm text-muted-foreground">
            Channels whose clips ChannelDeck banks and autoposts.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">
          <Radio className="size-5" aria-hidden />
          <span className="flex-1">Connecting Twitch arrives with the clip bank.</span>
          <Badge variant="outline">Coming in Phase 6</Badge>
        </div>
      </section>

      {editing ? (
        <ChannelDefaultsDialog account={editing} onClose={() => setEditing(null)} />
      ) : null}
      {removing ? (
        <RemoveChannelDialog account={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </div>
  )
}
