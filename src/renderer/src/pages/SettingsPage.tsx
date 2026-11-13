import { useMutation } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import { useAppInfo } from '@renderer/hooks/useAppInfo'
import { invoke } from '@renderer/lib/ipc'

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

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-8 py-6">
      <section>
        <h2 className="text-sm font-semibold">About</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Google and Twitch credentials, clip folder, sync time, Dry Run and backups are added here
          as their phases land.
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
