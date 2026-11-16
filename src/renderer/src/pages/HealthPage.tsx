import { POST_STATUSES } from '@shared/constants/enums'
import { describeEvent, EVENT_GLOSSARY, EVENT_KINDS } from '@shared/eventGlossary'
import type { HealthSnapshot } from '@shared/schemas/health'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useHealth } from '@renderer/hooks/useHealth'
import { STATUS_LABELS, formatBytes } from '@renderer/lib/status'
import { formatLocal, formatRelative } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'

const DOWNLOAD_LABELS: Record<keyof HealthSnapshot['clips'], string> = {
  pending: 'Waiting',
  downloading: 'Downloading',
  downloaded: 'Downloaded',
  failed: 'Failed',
  not_downloadable: 'Not downloadable',
  deleted: 'Files deleted'
}

function Tile({
  title,
  children,
  className
}: {
  title: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">{children}</CardContent>
    </Card>
  )
}

function Line({
  label,
  value,
  dim = false
}: {
  label: string
  value: React.ReactNode
  dim?: boolean
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-4', dim && 'text-muted-foreground')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function Bar({ used, max }: { used: number; max: number }): React.JSX.Element {
  const pct = Math.min(100, (used / max) * 100)
  return (
    <div className="h-1.5 overflow-hidden rounded bg-muted">
      <div
        className={cn(
          'h-full',
          pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary'
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function Counts<K extends string>({
  keys,
  counts,
  labels
}: {
  keys: readonly K[]
  counts: Record<K, number>
  labels: Record<K, string>
}): React.JSX.Element {
  return (
    <>
      {keys.map((key) => (
        <Line key={key} label={labels[key]} value={counts[key]} dim={counts[key] === 0} />
      ))}
    </>
  )
}

const LEVEL_TONES = { info: 'text-muted-foreground', warn: 'text-amber-300', error: 'text-red-400' }

/** One recent event: friendly label over the raw kind, the explanation on hover. */
function EventRow({ e }: { e: HealthSnapshot['events'][number] }): React.JSX.Element {
  const d = describeEvent(e.kind, e.message)
  return (
    <li
      className="flex gap-3 py-1.5 text-xs"
      title={d.check ? `${d.explanation}\nWhat to check: ${d.check}` : d.explanation}
    >
      <span className="w-36 shrink-0 text-muted-foreground">{formatLocal(e.atUtc)}</span>
      <span className="w-52 shrink-0">
        <span className={cn('block', d.known ? 'text-foreground' : 'text-muted-foreground')}>
          {d.label}
        </span>
        <span className="block break-all font-mono text-muted-foreground">{e.kind}</span>
      </span>
      <span className="min-w-0">
        <span className={cn('block break-words', LEVEL_TONES[e.level])}>{e.message}</span>
        {d.check ? <span className="block text-amber-300">Check: {d.check}</span> : null}
      </span>
    </li>
  )
}

/** Every event the app can log, in plain English. Static text; collapsed until opened. */
function EventGlossary(): React.JSX.Element {
  return (
    <details className="mt-3 border-t pt-3 text-xs">
      <summary className="cursor-pointer text-sm">What do these events mean?</summary>
      <dl className="mt-2 space-y-2">
        {EVENT_KINDS.map((kind) => {
          const entry: { label: string; explanation: string; check?: string } = EVENT_GLOSSARY[kind]
          return (
            <div key={kind}>
              <dt>
                {entry.label} <span className="font-mono text-muted-foreground">{kind}</span>
              </dt>
              <dd className="text-muted-foreground">
                {entry.explanation}
                {entry.check ? <span className="text-amber-300"> Check: {entry.check}</span> : null}
              </dd>
            </div>
          )
        })}
      </dl>
    </details>
  )
}

function Snapshot({ h }: { h: HealthSnapshot }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Tile title="App">
          <Line label="Version" value={h.app.version} />
          <Line label="Electron" value={h.app.electron} />
          <Line label="Platform" value={h.app.platform} />
          <Line label="Database version" value={`${h.app.schemaVersion} migrations`} />
          <Line
            label="Database size"
            value={h.app.dbFileBytes === null ? 'unknown' : formatBytes(h.app.dbFileBytes)}
          />
        </Tile>

        <Tile title="Mode">
          <Line
            label="Dry Run"
            value={
              h.dryRun ? (
                <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                  On: nothing is really uploaded
                </Badge>
              ) : (
                <Badge variant="secondary">Off</Badge>
              )
            }
          />
          <Line label="Dry Run calls logged" value={h.dryRunCalls} dim={h.dryRunCalls === 0} />
          <Line
            label="Background jobs"
            value={
              <Badge variant={h.jobs.state === 'paused' ? 'outline' : 'secondary'}>
                {h.jobs.state === 'paused' ? 'Paused' : 'Running'}
              </Badge>
            }
          />
        </Tile>

        <Tile title="YouTube quota today">
          <Line label="Uploads" value={`${h.quota.uploadCalls} / ${h.quota.uploadLimit}`} />
          <Bar used={h.quota.uploadCalls} max={h.quota.uploadLimit} />
          <Line
            label="Units"
            value={`${h.quota.units.toLocaleString()} / ${h.quota.unitLimit.toLocaleString()}`}
          />
          <Bar used={h.quota.units} max={h.quota.unitLimit} />
          <p className="pt-1 text-xs text-muted-foreground">
            Resets {formatLocal(h.quota.resetsAtUtc)} ({formatRelative(h.quota.resetsAtUtc)}), at
            midnight Pacific.
          </p>
        </Tile>

        <Tile title="Posts">
          <Counts keys={POST_STATUSES} counts={h.posts} labels={STATUS_LABELS} />
        </Tile>

        <Tile title="Clips">
          <Counts
            keys={Object.keys(DOWNLOAD_LABELS) as (keyof HealthSnapshot['clips'])[]}
            counts={h.clips}
            labels={DOWNLOAD_LABELS}
          />
        </Tile>

        <Tile title="Channels">
          {h.channels.length === 0 ? (
            <p className="text-muted-foreground">No channels connected.</p>
          ) : (
            h.channels.map((c) => (
              <Line
                key={`${c.platform}:${c.name}`}
                label={`${c.platform === 'youtube' ? 'YouTube' : 'Twitch'}: ${c.name}`}
                value={
                  c.tokenStatus === 'ok' ? (
                    <Badge variant="secondary">Signed in</Badge>
                  ) : (
                    <Badge variant="destructive">Needs sign-in</Badge>
                  )
                }
              />
            ))
          )}
        </Tile>
      </div>

      <Tile title="Recent events">
        {h.events.length === 0 ? (
          <p className="text-muted-foreground">No events yet.</p>
        ) : (
          <ul className="divide-y">
            {h.events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        )}
        <EventGlossary />
      </Tile>
    </div>
  )
}

/** Read-only Health dashboard (Settings → Advanced). One snapshot from `health:get`. */
export function HealthPage(): React.JSX.Element {
  const health = useHealth()
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-8 py-6">
      {health.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            Couldn’t read the health snapshot. See the log for why.
          </AlertDescription>
        </Alert>
      ) : null}
      {health.data ? (
        <Snapshot h={health.data} />
      ) : health.isError ? null : (
        <p className="text-sm text-muted-foreground">Loading health…</p>
      )}
    </div>
  )
}
