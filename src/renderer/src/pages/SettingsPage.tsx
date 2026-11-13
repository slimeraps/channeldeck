import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileKey2, FolderOpen, KeyRound, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { QuotaMeter } from '@renderer/components/QuotaMeter'
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
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { Switch } from '@renderer/components/ui/switch'
import { useGoogleClientStatus, useImportClientFile } from '@renderer/hooks/useAccounts'
import { useAppInfo } from '@renderer/hooks/useAppInfo'
import { useSettings, useUpdateSettings } from '@renderer/hooks/useSettings'
import { useStorage } from '@renderer/hooks/useStatus'
import { useTwitchConfig } from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { formatBytes } from '@renderer/lib/status'
import { formatLocal } from '@renderer/lib/time'

const NEVER = 'never'

function Section({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
      <Separator className="my-3" />
      {children}
    </section>
  )
}

function SettingRow({
  title,
  hint,
  children
}: {
  title: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-2">
      <div>
        <div className="text-sm">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | undefined }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs select-text">{value ?? '…'}</span>
    </div>
  )
}

function StorageSection(): React.JSX.Element {
  const storage = useStorage()
  const s = storage.data
  const clipBytes = (s?.accounts ?? []).reduce((n, a) => n + a.bytes, 0)
  const total = clipBytes + (s?.rendersBytes ?? 0)
  return (
    <div className="space-y-2">
      {(s?.accounts ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No Twitch channels yet.</p>
      ) : null}
      {(s?.accounts ?? []).map((a) => (
        <div key={a.id} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: a.color }} aria-hidden />
              {a.name}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatBytes(a.bytes)} · {a.downloaded}/{a.total} clips on disk
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-muted">
            <div
              className="h-full"
              style={{
                width: `${total ? Math.max(1, (a.bytes / total) * 100) : 0}%`,
                background: a.color
              }}
            />
          </div>
        </div>
      ))}
      <div className="flex justify-between pt-1 text-xs text-muted-foreground">
        <span>Vertical renders: {formatBytes(s?.rendersBytes ?? 0)}</span>
        <span>{s?.freeBytes != null ? `${formatBytes(s.freeBytes)} free on this disk` : ''}</span>
      </div>
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const qc = useQueryClient()
  const info = useAppInfo()
  const openLogs = useMutation({ mutationFn: () => invoke('app:openLogsFolder') })
  const googleClient = useGoogleClientStatus()
  const importClient = useImportClientFile()
  const twitchConfig = useTwitchConfig()
  const settings = useSettings()
  const update = useUpdateSettings()
  const s = settings.data?.settings
  const [editTwitch, setEditTwitch] = useState(false)
  const [confirmImport, setConfirmImport] = useState(false)

  const exportBackup = useMutation({
    mutationFn: () => invoke('backup:export'),
    onSuccess: (r) => {
      if (r.saved) toast.success(`Backup saved to ${r.path}`)
    },
    onError: (e) => toast.error(e.message)
  })
  const importBackup = useMutation({
    mutationFn: () => invoke('backup:import'),
    onSuccess: (r) => {
      if (!r.imported) return
      void qc.invalidateQueries()
      const a = r.report.added
      const parts = [
        a.youtubeChannels && `${a.youtubeChannels} YouTube channel(s)`,
        a.twitchChannels && `${a.twitchChannels} Twitch channel(s)`,
        a.templates && `${a.templates} template(s)`,
        a.series && `${a.series} series`,
        a.layouts && `${a.layouts} layout(s)`,
        a.rules && `${a.rules} rule(s), switched off`,
        a.drafts && `${a.drafts} draft(s)`
      ].filter(Boolean)
      toast.success(
        `Imported ${parts.length ? parts.join(', ') : 'nothing new'}${r.report.skipped ? `; ${r.report.skipped} already here` : ''}.`,
        { duration: 10_000 }
      )
    },
    onError: (e) => toast.error(e.message)
  })

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-8 py-6">
      <Section title="Uploads">
        {settings.data?.uploadsPausedUntil ? (
          <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Today&apos;s YouTube quota is used up. Uploads resume at{' '}
            {formatLocal(settings.data.uploadsPausedUntil)} (midnight Pacific).
          </p>
        ) : null}
        <SettingRow
          title="Dry Run"
          hint="Log exactly which YouTube calls would run, with their data, without uploading anything. Channel, category and playlist lookups still work."
        >
          <Switch
            checked={s?.dryRun ?? false}
            disabled={!s}
            onCheckedChange={(dryRun) => update.mutate({ dryRun })}
            aria-label="Dry Run"
          />
        </SettingRow>
        <SettingRow title="Uploads at once" hint="How many videos upload in parallel.">
          <Select
            value={String(s?.uploadConcurrency ?? 1)}
            onValueChange={(v) => update.mutate({ uploadConcurrency: Number(v) })}
          >
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Upload scheduled posts"
          hint="How long before the publish time a scheduled post uploads. Earlier is safer if the Mac might be asleep."
        >
          <Select
            value={String(s?.uploadLeadHours ?? 24)}
            onValueChange={(v) => update.mutate({ uploadLeadHours: Number(v) })}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 6, 12, 24, 48, 72].map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {h} hour{h === 1 ? '' : 's'} before
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </Section>

      <Section
        title="YouTube quota today"
        hint="Shared by every channel in your Google Cloud project. Free; going over just pauses uploads until midnight Pacific."
      >
        <QuotaMeter detailed />
      </Section>

      <Section title="Clip bank">
        <SettingRow
          title="Clip folder"
          hint="Where Twitch clips are saved: <folder>/<channel>/<year>/<year-month>/, oldest first by name."
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-64 truncate font-mono text-xs select-text" title={s?.clipsRoot}>
              {s?.clipsRoot ?? '…'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const r = await invoke('settings:chooseClipsFolder')
                if (r.changed) void settings.refetch()
              }}
            >
              <FolderOpen aria-hidden />
              Choose…
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          title="Daily clip sync"
          hint="New clips are pulled once a day at this time, and at launch or wake if the last sync is over a day old."
        >
          <Input
            type="time"
            className="w-32"
            value={s?.dailySyncTime ?? '04:00'}
            onChange={(e) => e.target.value && update.mutate({ dailySyncTime: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          title="Delete local files after posting"
          hint="Frees disk space: once every post of a clip is published, its video files (and vertical renders) go after this long. Thumbnails and details stay."
        >
          <Select
            value={s?.deleteLocalAfterPostingDays ? String(s.deleteLocalAfterPostingDays) : NEVER}
            onValueChange={(v) =>
              update.mutate({ deleteLocalAfterPostingDays: v === NEVER ? null : Number(v) })
            }
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEVER}>Never</SelectItem>
              {[3, 7, 14, 30, 90].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  After {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </Section>

      <Section title="Disk usage">
        <StorageSection />
      </Section>

      <Section title="Google and Twitch apps" hint="Stored only on this Mac.">
        <div className="flex items-center justify-between gap-4 py-2 text-sm">
          <div>
            <div>Google client file</div>
            <div className="text-xs text-muted-foreground">
              {googleClient.data?.configured
                ? `Imported${googleClient.data.projectId ? ` for project ${googleClient.data.projectId}` : ''} (${googleClient.data.clientIdHint})`
                : (googleClient.data?.problem ?? 'Not imported yet')}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => importClient.mutate()}
            disabled={importClient.isPending}
          >
            <FileKey2 aria-hidden />
            {googleClient.data?.configured ? 'Replace…' : 'Import…'}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 py-2 text-sm">
          <div>
            <div>Twitch app</div>
            <div className="text-xs text-muted-foreground">
              {twitchConfig.data?.clientId
                ? `Client ID ${twitchConfig.data.clientId.slice(0, 6)}… · ${twitchConfig.data.hasSecret ? 'secret saved in your Keychain' : 'no secret (device-code sign-in)'}`
                : 'Not set up yet'}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setEditTwitch((v) => !v)}>
            <KeyRound aria-hidden />
            {editTwitch ? 'Close' : 'Edit…'}
          </Button>
        </div>
        {editTwitch && twitchConfig.data ? (
          <div className="pt-2">
            <TwitchSetup config={twitchConfig.data} onDone={() => setEditTwitch(false)} />
          </div>
        ) : null}
      </Section>

      <Section title="Mac">
        <SettingRow
          title="Keep in menu bar"
          hint="Closing the window leaves ChannelDeck running in the menu bar, so uploads and clip syncs carry on. Quit from the menu bar icon or with ⌘Q."
        >
          <Switch
            checked={s?.keepInTray ?? true}
            disabled={!s}
            onCheckedChange={(keepInTray) => update.mutate({ keepInTray })}
            aria-label="Keep in menu bar"
          />
        </SettingRow>
        <SettingRow
          title="Launch at login"
          hint={
            info.data && !info.data.isPackaged
              ? 'Saved now; takes effect in the installed app (not while running from source).'
              : 'Start ChannelDeck when you log in. With "Keep in menu bar" on, it starts in the menu bar.'
          }
        >
          <Switch
            checked={s?.launchAtLogin ?? false}
            disabled={!s}
            onCheckedChange={(launchAtLogin) => update.mutate({ launchAtLogin })}
            aria-label="Launch at login"
          />
        </SettingRow>
      </Section>

      <Section
        title="Backup"
        hint="A JSON file with your settings, channels, Twitch channels, templates, series, layouts, rules and unposted posts. Never any sign-in token or secret."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => exportBackup.mutate()}
            disabled={exportBackup.isPending}
          >
            <Download aria-hidden />
            Export backup…
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirmImport(true)}
            disabled={importBackup.isPending}
          >
            <Upload aria-hidden />
            Import backup…
          </Button>
        </div>
      </Section>

      <Section title="About">
        {info.isError ? (
          <p className="text-sm text-destructive">Could not reach the main process.</p>
        ) : (
          <div>
            <Row label="Version" value={info.data?.version} />
            <Row label="Electron" value={info.data?.electron} />
            <Row
              label="Platform"
              value={info.data ? `${info.data.platform} ${info.data.arch}` : undefined}
            />
            <Row label="Logs" value={info.data?.logsPath} />
            <Row label="Database" value={info.data?.databasePath} />
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => openLogs.mutate()}
            disabled={openLogs.isPending}
          >
            <FolderOpen aria-hidden />
            Open logs folder
          </Button>
          {s?.setupDismissed ? (
            <Button
              variant="ghost"
              onClick={() => {
                update.mutate({ setupDismissed: false })
              }}
            >
              Show setup checklist
            </Button>
          ) : null}
          {openLogs.isError ? (
            <span className="text-sm text-destructive">{openLogs.error.message}</span>
          ) : null}
        </div>
      </Section>

      <AlertDialog open={confirmImport} onOpenChange={setConfirmImport}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import a backup?</AlertDialogTitle>
            <AlertDialogDescription>
              Settings are replaced by the backup’s. Channels, Twitch channels, templates, series,
              layouts and rules that aren’t here yet are added (anything with the same name or
              channel stays as it is). Channels come back signed out, so you’ll click Reconnect on
              each; rules come back switched off; unposted posts come back as drafts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => importBackup.mutate()}>
              Choose backup file…
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
