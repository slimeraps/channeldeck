import { Check, ExternalLink, FolderOpen, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  useAccounts,
  useAddChannel,
  useGoogleClientStatus,
  useImportClientFile
} from '@renderer/hooks/useAccounts'
import { useSettings, useUpdateSettings } from '@renderer/hooks/useSettings'
import { useTwitchAccounts, useTwitchConfig } from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

const CREDENTIALS = 'https://console.cloud.google.com/apis/credentials'
const AUDIENCE = 'https://console.cloud.google.com/auth/audience'

interface Step {
  key: string
  title: string
  hint: string
  done: boolean
  optional?: boolean
  action: React.ReactNode
}

/**
 * First-run checklist: Google client file → consent screen In production → add a channel →
 * Twitch app → connect Twitch → clip folder. Shown at the top of the Queue until every step is
 * done or you hide it (Settings → Show setup checklist brings it back).
 */
export function SetupChecklist(): React.JSX.Element | null {
  const settings = useSettings()
  const update = useUpdateSettings()
  const google = useGoogleClientStatus()
  const importClient = useImportClientFile()
  const accounts = useAccounts()
  const addChannel = useAddChannel()
  const twitchConfig = useTwitchConfig()
  const twitch = useTwitchAccounts()
  const setPage = useUiStore((s) => s.setPage)
  const s = settings.data?.settings
  if (!s || !google.data || !accounts.data || !twitchConfig.data || !twitch.data) return null

  const steps: Step[] = [
    {
      key: 'google',
      title: 'Import your Google client file',
      hint: 'In Google Cloud: enable YouTube Data API v3, then create an OAuth client of type Desktop app and download its JSON.',
      done: google.data.configured,
      action: (
        <>
          <Button size="sm" variant="ghost" asChild>
            <a href={CREDENTIALS} target="_blank" rel="noreferrer">
              Google Cloud <ExternalLink aria-hidden />
            </a>
          </Button>
          <Button size="sm" onClick={() => importClient.mutate()} disabled={importClient.isPending}>
            Import…
          </Button>
        </>
      )
    },
    {
      key: 'consent',
      title: 'Publish the consent screen (In production)',
      hint: 'Google Auth Platform → Audience → Publish app. In Testing, Google signs your channels out every 7 days.',
      done: s.setupConsentConfirmed,
      action: (
        <>
          <Button size="sm" variant="ghost" asChild>
            <a href={AUDIENCE} target="_blank" rel="noreferrer">
              Audience page <ExternalLink aria-hidden />
            </a>
          </Button>
          <Button size="sm" onClick={() => update.mutate({ setupConsentConfirmed: true })}>
            It says In production
          </Button>
        </>
      )
    },
    {
      key: 'channel',
      title: 'Add a YouTube channel',
      hint: 'Sign in with Google in your browser and pick the channel. Repeat for each channel.',
      done: accounts.data.length > 0,
      action: (
        <Button
          size="sm"
          onClick={() => addChannel.mutate()}
          disabled={!google.data.configured || addChannel.isPending}
        >
          Add channel
        </Button>
      )
    },
    {
      key: 'twitchApp',
      title: 'Set up your Twitch app',
      hint: 'Register an app in the Twitch developer console and paste its Client ID and Secret.',
      done: Boolean(twitchConfig.data.clientId),
      optional: true,
      action: (
        <Button size="sm" onClick={() => setPage('channels')}>
          Open Channels
        </Button>
      )
    },
    {
      key: 'twitch',
      title: 'Connect a Twitch channel',
      hint: 'Its clips are backfilled and then synced daily into the clip bank.',
      done: twitch.data.length > 0,
      optional: true,
      action: (
        <Button
          size="sm"
          onClick={() => setPage('channels')}
          disabled={!twitchConfig.data.clientId}
        >
          Connect Twitch
        </Button>
      )
    },
    {
      key: 'folder',
      title: 'Check the clip folder',
      hint: s.clipsRoot,
      done: s.setupClipFolderConfirmed,
      action: (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const r = await invoke('settings:chooseClipsFolder')
              if (r.changed) update.mutate({ setupClipFolderConfirmed: true })
            }}
          >
            <FolderOpen aria-hidden /> Choose…
          </Button>
          <Button size="sm" onClick={() => update.mutate({ setupClipFolderConfirmed: true })}>
            Use this folder
          </Button>
        </>
      )
    }
  ]

  const done = steps.filter((x) => x.done).length
  if (s.setupDismissed || done === steps.length) return null
  const next = steps.find((x) => !x.done)

  return (
    <section className="mx-8 mt-6 rounded-lg border bg-card p-4" aria-label="Setup checklist">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Set up ChannelDeck</h2>
          <p className="text-sm text-muted-foreground">
            {done} of {steps.length} done. Twitch steps are only needed for the clip bank.
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Hide the setup checklist"
          title="Hide (Settings can bring it back)"
          onClick={() => update.mutate({ setupDismissed: true })}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 divide-y">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3 py-2.5">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
                step.done
                  ? 'border-green-500 bg-green-500/15 text-green-400'
                  : step === next
                    ? 'border-primary text-primary'
                    : 'text-muted-foreground'
              )}
            >
              {step.done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn('text-sm', step.done && 'text-muted-foreground line-through')}>
                {step.title}
                {step.optional ? (
                  <span className="ml-1.5 text-xs text-muted-foreground no-underline">
                    (optional)
                  </span>
                ) : null}
              </div>
              {!step.done ? (
                <div className="truncate text-xs text-muted-foreground" title={step.hint}>
                  {step.hint}
                </div>
              ) : null}
            </div>
            {!step.done ? <div className="flex shrink-0 gap-1.5">{step.action}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
