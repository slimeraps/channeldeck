import { useMutation } from '@tanstack/react-query'
import { FileKey2, FolderOpen } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import { Switch } from '@renderer/components/ui/switch'
import { useGoogleClientStatus, useImportClientFile } from '@renderer/hooks/useAccounts'
import { useAppInfo } from '@renderer/hooks/useAppInfo'
import { useSettings, useUpdateSettings } from '@renderer/hooks/useSettings'
import { invoke } from '@renderer/lib/ipc'
import { formatLocal } from '@renderer/lib/time'

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
    <div className="flex items-baseline justify-between gap-6 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs select-text">{value ?? '…'}</span>
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const info = useAppInfo()
  const openLogs = useMutation({ mutationFn: () => invoke('app:openLogsFolder') })
  const googleClient = useGoogleClientStatus()
  const importClient = useImportClientFile()
  const settings = useSettings()
  const update = useUpdateSettings()
  const s = settings.data?.settings

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-8 py-6">
      <section>
        <h2 className="text-sm font-semibold">Uploads</h2>
        <Separator className="my-3" />
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
      </section>

      <section>
        <h2 className="text-sm font-semibold">Clip bank</h2>
        <Separator className="my-3" />
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
      </section>

      <section>
        <h2 className="text-sm font-semibold">Google</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The Desktop-app OAuth client from your Google Cloud project. Stored only on this Mac.
        </p>
        <Separator className="my-3" />
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            {googleClient.data?.configured
              ? `Imported${googleClient.data.projectId ? ` for project ${googleClient.data.projectId}` : ''} (${googleClient.data.clientIdHint})`
              : (googleClient.data?.problem ?? 'Not imported yet')}
          </span>
          <Button
            variant="secondary"
            onClick={() => importClient.mutate()}
            disabled={importClient.isPending}
          >
            <FileKey2 aria-hidden />
            {googleClient.data?.configured
              ? 'Replace Google client file'
              : 'Import Google client file'}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">About</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Launch at login, keep in menu bar, and backups are added here in Phase 9.
        </p>
        <Separator className="my-3" />
        {info.isError ? (
          <p className="text-sm text-destructive">Could not reach the main process.</p>
        ) : (
          <div>
            <Row label="Version" value={info.data?.version} />
            <Row label="Electron" value={info.data?.electron} />
            <Row label="Chromium" value={info.data?.chrome} />
            <Row label="Node" value={info.data?.node} />
            <Row
              label="Platform"
              value={info.data ? `${info.data.platform} ${info.data.arch}` : undefined}
            />
            <Row label="Logs" value={info.data?.logsPath} />
            <Row label="Database" value={info.data?.databasePath} />
          </div>
        )}
      </section>

      <section className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => openLogs.mutate()} disabled={openLogs.isPending}>
          <FolderOpen aria-hidden />
          Open logs folder
        </Button>
        {openLogs.isError ? (
          <span className="text-sm text-destructive">{openLogs.error.message}</span>
        ) : null}
        <Badge variant="outline" className="ml-auto">
          Full settings in Phase 9
        </Badge>
      </section>
    </div>
  )
}
