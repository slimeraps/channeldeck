import { BarChart3, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { DateTime } from 'luxon'
import { useState } from 'react'
import {
  ANALYTICS_RANGES,
  type AnalyticsDay,
  type AnalyticsRange,
  type AnalyticsReport,
  type AnalyticsTarget
} from '@shared/schemas/analytics'
import type { AccountView } from '@shared/schemas/account'
import { EmptyState } from '@renderer/components/EmptyState'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAccounts } from '@renderer/hooks/useAccounts'
import { useAnalytics, useRefreshAnalytics } from '@renderer/hooks/useAnalytics'
import { formatRelative } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en-US')

function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}

function formatHours(minutes: number): string {
  const hours = minutes / 60
  return hours >= 10 ? whole.format(Math.round(hours)) : hours.toFixed(1)
}

/** A round top for the y axis (1, 2 or 5 × a power of ten) so ticks read cleanly. */
function niceMax(max: number): number {
  if (max <= 0) return 1
  const half = max / 2
  const power = 10 ** Math.floor(Math.log10(half))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= half) ?? 10 * power
  return step * 2
}

function formatDay(date: string, format = 'LLL d'): string {
  return DateTime.fromISO(date).toFormat(format)
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

/** Daily views as thin bars, with a hover tooltip per day. One series, so no legend. */
function DailyChart({ days }: { days: AnalyticsDay[] }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const width = 720
  const height = 180
  const top = 12
  const bottom = 22
  const left = 40
  const plotH = height - top - bottom
  const plotW = width - left
  const max = niceMax(Math.max(0, ...days.map((d) => d.views)))
  const step = plotW / days.length
  const barW = Math.max(2, step - 2) // 2px gap between bars
  const ticks = [0, max / 2, max]
  const labelEvery = Math.ceil(days.length / 7)
  const hovered = hover !== null ? days[hover] : undefined

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Views per day"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => {
          const y = top + plotH - (t / max) * plotH
          return (
            <g key={t}>
              <line x1={left} x2={width} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
              <text
                x={left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {compact.format(t)}
              </text>
            </g>
          )
        })}
        {days.map((d, i) => {
          const h = (d.views / max) * plotH
          const x = left + i * step + (step - barW) / 2
          const r = Math.min(4, barW / 2, h)
          const y = top + plotH - h
          return (
            <g key={d.date}>
              {h > 0 ? (
                <path
                  // Rounded top, square base on the baseline.
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  className={cn('fill-primary', hover !== null && hover !== i && 'opacity-50')}
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  x={left + i * step + step / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {formatDay(d.date)}
                </text>
              ) : null}
              {/* Hit target: the whole column, bigger than the bar. */}
              <rect
                x={left + i * step}
                y={top}
                width={step}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          )
        })}
      </svg>
      {hovered && hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${((left + hover * step + step / 2) / width) * 100}%` }}
        >
          <div className="font-medium">{formatDay(hovered.date, 'ccc, LLL d')}</div>
          <div className="tabular-nums">{whole.format(hovered.views)} views</div>
          <div className="tabular-nums text-muted-foreground">
            {formatHours(hovered.minutesWatched)} h watched ·{' '}
            {hovered.subscribersNet >= 0 ? '+' : ''}
            {hovered.subscribersNet} subs
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Report({
  report,
  channels
}: {
  report: AnalyticsReport
  channels: AccountView[]
}): React.JSX.Element {
  const all = report.accountId === 'all'
  const channelOf = (id: number) => channels.find((c) => c.id === id)
  const t = report.totals
  const net = t.subscribersGained - t.subscribersLost
  return (
    <div className="space-y-6">
      {report.skipped.length > 0 ? (
        <Alert>
          <AlertDescription>
            {report.skipped.map((s) => (
              <span key={s.accountId} className="block">
                Left out {s.title}: {s.reason}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Views" value={whole.format(t.views)} />
        <Stat label="Watch time (hours)" value={formatHours(t.minutesWatched)} />
        <Stat label="Avg view duration" value={formatDuration(t.averageViewDuration)} />
        <Stat
          label="Subscribers"
          value={`${net >= 0 ? '+' : ''}${whole.format(net)}`}
          sub={`${whole.format(t.subscribersGained)} gained · ${whole.format(t.subscribersLost)} lost`}
        />
      </div>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Views per day</h2>
          <span className="text-xs text-muted-foreground">
            {report.lastDataDate
              ? `Through ${formatDay(report.lastDataDate, 'LLL d')} (YouTube lags a day or two)`
              : 'No data yet'}
          </span>
        </div>
        {report.daily.length > 0 ? (
          <DailyChart days={report.daily} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            YouTube hasn’t reported any days in this range yet.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">Top videos</h2>
        {report.topVideos.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No views in this range.
          </p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-normal">Video</th>
                <th className="px-3 py-2 text-right font-normal">Views</th>
                <th className="px-3 py-2 text-right font-normal">Watch h</th>
                <th className="px-3 py-2 text-right font-normal">Avg view</th>
                <th className="px-3 py-2 text-right font-normal">Likes</th>
                <th className="px-4 py-2 text-right font-normal">Subs</th>
              </tr>
            </thead>
            <tbody>
              {report.topVideos.map((v) => (
                <tr key={`${v.accountId}:${v.videoId}`} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <a
                      href={`https://www.youtube.com/watch?v=${v.videoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-1.5 hover:underline"
                    >
                      <span className="truncate">{v.title ?? v.videoId}</span>
                      <ExternalLink
                        className="size-3 shrink-0 opacity-0 group-hover:opacity-60"
                        aria-hidden
                      />
                    </a>
                    {all || v.postId ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {all ? (
                          <>
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: channelOf(v.accountId)?.color }}
                              aria-hidden
                            />
                            {channelOf(v.accountId)?.channelTitle ?? 'Removed channel'}
                          </>
                        ) : null}
                        {all && v.postId ? ' · ' : null}
                        {v.postId ? 'Posted by ChannelDeck' : null}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{whole.format(v.views)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatHours(v.minutesWatched)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatDuration(v.averageViewDuration)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{whole.format(v.likes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {whole.format(v.subscribersGained)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        {all
          ? `${report.channelCount} channel${report.channelCount === 1 ? '' : 's'} added together. `
          : ''}
        Updated {formatRelative(report.fetchedAt)}. Analytics use the YouTube Analytics API, which
        has its own quota; they don’t touch your 10,000 daily upload units.
      </p>
    </div>
  )
}

export function AnalyticsPage(): React.JSX.Element {
  const accounts = useAccounts()
  const setPage = useUiStore((s) => s.setPage)
  const list = (accounts.data ?? []).filter((a) => a.tokenStatus === 'ok')
  const [picked, setPicked] = useState<AnalyticsTarget | null>(null)
  const [days, setDays] = useState<AnalyticsRange>(28)
  // Default: every channel added up when there's more than one.
  const accountId: AnalyticsTarget | null =
    picked === 'all' || list.some((a) => a.id === picked)
      ? picked
      : list.length > 1
        ? 'all'
        : (list[0]?.id ?? null)
  const report = useAnalytics(accountId, days)
  const refresh = useRefreshAnalytics()

  if (accounts.isSuccess && list.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No channels to show"
        action={<Button onClick={() => setPage('channels')}>Go to Channels</Button>}
      >
        Connect a YouTube channel (or reconnect one that needs signing in) to see its views, watch
        time, subscribers and top videos here.
      </EmptyState>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={accountId !== null ? String(accountId) : ''}
          onValueChange={(v) => setPicked(v === 'all' ? 'all' : Number(v))}
        >
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            {list.length > 1 ? <SelectItem value="all">All channels</SelectItem> : null}
            {list.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: a.color }}
                  aria-hidden
                />
                {a.channelTitle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Date range">
          {ANALYTICS_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={cn(
                'rounded px-2.5 py-1 text-xs',
                r === days ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
              aria-pressed={r === days}
            >
              {r} days
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={accountId === null || refresh.isPending || report.isFetching}
          onClick={() => accountId !== null && refresh.mutate({ accountId, days })}
        >
          <RefreshCw className={cn(refresh.isPending && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </div>

      {report.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{report.error.message}</AlertDescription>
        </Alert>
      ) : report.data ? (
        <Report report={report.data} channels={accounts.data ?? []} />
      ) : (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading analytics…
        </div>
      )}
    </div>
  )
}
