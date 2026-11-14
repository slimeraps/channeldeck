import {
  AlertTriangle,
  CheckCheck,
  Clock,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Wand2
} from 'lucide-react'
import { useState } from 'react'
import type { LayoutView, RuleView } from '@shared/schemas/autopost'
import { LayoutEditor } from '@renderer/components/autopost/LayoutEditor'
import { RuleEditor } from '@renderer/components/autopost/RuleEditor'
import { EmptyState } from '@renderer/components/EmptyState'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
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
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { useUiStore } from '@renderer/stores/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Switch } from '@renderer/components/ui/switch'
import { useAccounts } from '@renderer/hooks/useAccounts'
import {
  useAutopostAction,
  useLayouts,
  useQuotaForecast,
  useRules
} from '@renderer/hooks/useAutopost'
import { useTwitchAccounts } from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { formatLocal, formatRelative, formatSlot } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LAYOUT_LABELS = {
  blur_fill: 'Blurred fill',
  center_crop: 'Center crop',
  facecam_split: 'Facecam split'
} as const

function weekdaySummary(days: number[]): string {
  if (days.length === 7) return 'every day'
  if (days.join() === '1,2,3,4,5') return 'weekdays'
  if (days.join() === '6,7') return 'weekends'
  return days.map((d) => DAY_NAMES[d]).join(', ')
}

function RuleCard({
  rule,
  onEdit,
  onDelete
}: {
  rule: RuleView
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const toggle = useAutopostAction((enabled: boolean) =>
    invoke('autopost:setEnabled', { id: rule.id, enabled })
  )
  const approveAll = useAutopostAction(
    () => invoke('autopost:approveAll', { id: rule.id }),
    (r) => `Approved ${r.approved} autopost${r.approved === 1 ? '' : 's'}`
  )
  const r = rule.input
  return (
    <div className={cn('rounded-lg border bg-card p-4', !r.enabled && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ background: rule.channelColor }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{r.name}</span>
            <Badge variant={r.mode === 'auto' ? 'secondary' : 'outline'}>
              {r.mode === 'auto' ? 'Auto' : 'Review'}
            </Badge>
            <Badge variant="outline">{r.format === 'short' ? 'Short' : 'Regular'}</Badge>
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {rule.twitchSources.length === 0 ? 'No Twitch channel' : null}
            {rule.twitchSources.map((t, i) => (
              <span key={t.id} className="inline-flex items-center gap-1">
                {i > 0 ? ', ' : null}
                <span className="size-2 rounded-full" style={{ background: t.color }} aria-hidden />
                {t.name}
              </span>
            ))}{' '}
            → {rule.channelTitle}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {r.slots.map(formatSlot).join(', ')} · {weekdaySummary(r.weekdays)}
            </span>
            {rule.nextSlotUtc ? (
              <span>
                Next slot {formatLocal(rule.nextSlotUtc)} ({formatRelative(rule.nextSlotUtc)})
              </span>
            ) : null}
            <span>{rule.upcoming} upcoming</span>
            <span className={cn(rule.eligibleClips === 0 && 'text-amber-400')}>
              {rule.eligibleClips} clips left
            </span>
            {rule.layoutName ? <span>Layout: {rule.layoutName}</span> : null}
          </div>
          {rule.blockedReason ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
              <AlertTriangle className="size-3.5" aria-hidden /> Paused: {rule.blockedReason}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rule.pendingApproval > 0 ? (
            <Button
              size="sm"
              onClick={() => approveAll.mutate(undefined)}
              disabled={approveAll.isPending}
            >
              <CheckCheck aria-hidden /> Approve all ({rule.pendingApproval})
            </Button>
          ) : null}
          <Switch
            checked={r.enabled}
            onCheckedChange={(on) => toggle.mutate(on)}
            aria-label={`Turn ${r.name} ${r.enabled ? 'off' : 'on'}`}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`More for ${r.name}`}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden /> Edit…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 aria-hidden /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

function QuotaWarning(): React.JSX.Element | null {
  const forecast = useQuotaForecast()
  const over = (forecast.data ?? []).filter((d) => d.overUploads || d.overUnits)
  const first = over[0]
  if (!first) return null
  return (
    <Alert className="border-amber-500/40">
      <AlertTriangle className="text-amber-400" aria-hidden />
      <AlertTitle>Your schedule needs more YouTube quota than you have</AlertTitle>
      <AlertDescription>
        On {first.day} (Pacific) your rules and queue would use{' '}
        {first.overUploads ? `${first.uploads} of 100 daily uploads` : null}
        {first.overUploads && first.overUnits ? ' and ' : null}
        {first.overUnits ? `${first.units.toLocaleString()} of 10,000 quota units` : null}.
        {over.length > 1 ? ` ${over.length - 1} more day(s) too.` : ''} Uploads over the limit wait
        until midnight Pacific. Remove some time slots, or turn a rule off.
      </AlertDescription>
    </Alert>
  )
}

export function AutopostPage(): React.JSX.Element {
  const rules = useRules()
  const layouts = useLayouts()
  const accounts = useAccounts()
  const twitch = useTwitchAccounts()
  const setPage = useUiStore((s) => s.setPage)
  const [editing, setEditing] = useState<RuleView | 'new' | null>(null)
  const [deleting, setDeleting] = useState<RuleView | null>(null)
  const [cancelUpcoming, setCancelUpcoming] = useState(true)
  const [editingLayout, setEditingLayout] = useState<LayoutView | 'new' | null>(null)
  const [deletingLayout, setDeletingLayout] = useState<LayoutView | null>(null)
  const remove = useAutopostAction(
    (v: { id: number; cancelUpcoming: boolean }) => invoke('autopost:delete', v),
    (r) => `Rule deleted${r.canceled ? `; ${r.canceled} upcoming autoposts canceled` : ''}`
  )
  const removeLayout = useAutopostAction(
    (id: number) => invoke('layouts:delete', { id }),
    () => 'Layout deleted'
  )

  const hasYouTube = (accounts.data ?? []).length > 0
  const hasTwitch = (twitch.data ?? []).length > 0
  const list = rules.data ?? []

  if (rules.isSuccess && list.length === 0 && (!hasYouTube || !hasTwitch)) {
    return (
      <EmptyState
        icon={Wand2}
        title="Autopost your Twitch clips"
        action={<Button onClick={() => setPage('channels')}>Open Channels</Button>}
      >
        Connect {!hasYouTube ? 'a YouTube channel' : ''}
        {!hasYouTube && !hasTwitch ? ' and ' : ''}
        {!hasTwitch ? 'a Twitch channel' : ''} on the Channels page first. Then make a rule: which
        clips, which channel, and what times.
      </EmptyState>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Autopost</h1>
          <p className="text-sm text-muted-foreground">
            Rules fill daily time slots with clips from your bank as scheduled YouTube posts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditingLayout('new')} disabled={!hasTwitch}>
            <LayoutTemplate aria-hidden /> New layout
          </Button>
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> New rule
          </Button>
        </div>
      </div>

      <QuotaWarning />

      {list.length === 0 && rules.isSuccess ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Wand2 className="mx-auto mb-3 size-6" aria-hidden />
          No rules yet. Click <span className="text-foreground">New rule</span> to post a clip every
          day at the times you choose. Start in Review mode to approve each one first.
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => setEditing(rule)}
              onDelete={() => {
                setCancelUpcoming(true)
                setDeleting(rule)
              }}
            />
          ))}
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Vertical layouts</h2>
          <p className="text-sm text-muted-foreground">
            How a landscape clip becomes a Short when Twitch has no portrait version. Without a
            layout, rules use a blurred fill.
          </p>
        </div>
        {(layouts.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No layouts yet. A <span className="text-foreground">Facecam split</span> puts your
            camera on top and the game below.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(layouts.data ?? []).map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <LayoutTemplate className="size-5" style={{ color: l.twitchColor }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{l.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {LAYOUT_LABELS[l.kind]} · {l.twitchName}
                    {l.usedByRules ? ` · used by ${l.usedByRules} rule(s)` : ''}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditingLayout(l)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${l.name}`}
                  onClick={() => setDeletingLayout(l)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing ? (
        <RuleEditor rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      {editingLayout ? (
        <LayoutEditor
          layout={editingLayout === 'new' ? null : editingLayout}
          onClose={() => setEditingLayout(null)}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.input.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The rule stops making autoposts. Videos already on YouTube aren’t touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={cancelUpcoming}
              onChange={(e) => setCancelUpcoming(e.target.checked)}
            />
            Also cancel its autoposts that aren’t uploaded yet
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleting && remove.mutate({ id: deleting.id, cancelUpcoming })}
            >
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deletingLayout !== null}
        onOpenChange={(open) => !open && setDeletingLayout(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete layout “{deletingLayout?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingLayout?.usedByRules
                ? `${deletingLayout.usedByRules} rule(s) use it; they’ll switch to the blurred fill. `
                : ''}
              Autoposts already planned keep the layout they were made with.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deletingLayout && removeLayout.mutate(deletingLayout.id)}
            >
              Delete layout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
