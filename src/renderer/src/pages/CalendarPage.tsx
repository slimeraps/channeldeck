import { CalendarDays, ChevronLeft, ChevronRight, Clapperboard } from 'lucide-react'
import { DateTime } from 'luxon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { PostStatus } from '@shared/constants/enums'
import type { PostListItem } from '@shared/schemas/post'
import { EmptyState } from '@renderer/components/EmptyState'
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
import { useAccounts } from '@renderer/hooks/useAccounts'
import { usePosts, useReschedule } from '@renderer/hooks/usePosts'
import { STATUS_LABELS } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

const MIME = 'application/x-channeldeck-post'
const SHOWN: PostStatus[] = [
  'draft',
  'needs_approval',
  'queued',
  'rendering',
  'uploading',
  'processing',
  'scheduled',
  'published',
  'needs_decision',
  'failed',
  'waiting_quota'
]
/** Statuses the calendar lets you drag (the server checks again). */
const MOVABLE: PostStatus[] = [
  'draft',
  'needs_approval',
  'queued',
  'failed',
  'waiting_quota',
  'processing',
  'scheduled'
]
const EDITABLE: PostStatus[] = ['draft', 'needs_approval', 'queued']
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const MONTH_CHIPS = 3

type Mode = 'week' | 'month'

/** The current time, refreshed every minute (keeps renders pure). */
function useNow(): DateTime {
  const [now, setNow] = useState(() => DateTime.local())
  useEffect(() => {
    const id = setInterval(() => setNow(DateTime.local()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function movable(post: PostListItem): boolean {
  return post.visibilityMode === 'schedule' && MOVABLE.includes(post.status)
}

function PostChip({ post, onOpen }: { post: PostListItem; onOpen: () => void }): React.JSX.Element {
  const at = DateTime.fromISO(post.publishAtUtc as string)
  const canMove = movable(post)
  return (
    <button
      type="button"
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME, post.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      title={`${post.title || 'Untitled'} · ${post.channelTitle} · ${STATUS_LABELS[post.status]}${canMove ? ' · drag to move' : ''}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-1 rounded border-l-2 px-1.5 py-0.5 text-left text-[11px] leading-tight',
        canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        post.status === 'draft' && 'border border-dashed border-l-2',
        post.status === 'published' && 'opacity-60',
        post.status === 'failed' && 'ring-1 ring-red-500/60'
      )}
      style={{
        borderLeftColor: post.channelColor,
        backgroundColor: `${post.channelColor}26`
      }}
    >
      <span className="shrink-0 tabular-nums text-muted-foreground">{at.toFormat('HH:mm')}</span>
      {post.source === 'twitch_clip' ? (
        <Clapperboard className="size-3 shrink-0" aria-label="Twitch clip" />
      ) : null}
      {post.status === 'needs_approval' ? (
        <span className="size-1.5 shrink-0 rounded-full bg-amber-400" aria-label="Needs approval" />
      ) : null}
      <span className="truncate">{post.title || 'Untitled'}</span>
    </button>
  )
}

export function CalendarPage(): React.JSX.Element {
  const accounts = useAccounts()
  const posts = usePosts({ statuses: SHOWN })
  const reschedule = useReschedule()
  const openNewPost = useUiStore((s) => s.openNewPost)
  const openEditPost = useUiStore((s) => s.openEditPost)
  const now = useNow()

  const [mode, setMode] = useState<Mode>('week')
  const [anchor, setAnchor] = useState(() => DateTime.local().startOf('day'))
  const [hidden, setHidden] = useState<number[]>([])
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [pending, setPending] = useState<{ post: PostListItem; at: DateTime } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Week view opens around 8:00 instead of midnight.
  useEffect(() => {
    if (mode === 'week' && scrollRef.current) scrollRef.current.scrollTop = 8 * 52
  }, [mode])

  const timed = useMemo(
    () =>
      (posts.data ?? [])
        .filter((p) => p.publishAtUtc && !hidden.includes(p.accountId))
        .sort((a, b) => (a.publishAtUtc as string).localeCompare(b.publishAtUtc as string)),
    [posts.data, hidden]
  )
  /** Posts bucketed by local "yyyy-MM-dd" and "yyyy-MM-dd HH". */
  const byDay = useMemo(() => {
    const day = new Map<string, PostListItem[]>()
    const hour = new Map<string, PostListItem[]>()
    for (const p of timed) {
      const at = DateTime.fromISO(p.publishAtUtc as string)
      const d = at.toFormat('yyyy-MM-dd')
      const h = at.toFormat('yyyy-MM-dd HH')
      day.set(d, [...(day.get(d) ?? []), p])
      hour.set(h, [...(hour.get(h) ?? []), p])
    }
    return { day, hour }
  }, [timed])

  if (accounts.isSuccess && (accounts.data ?? []).length === 0) {
    return (
      <EmptyState icon={CalendarDays} title="Nothing to plan yet">
        Connect a YouTube channel on the Channels page. Scheduled posts for every channel show up
        here, colored by channel.
      </EmptyState>
    )
  }

  const weekStart = anchor.startOf('week')
  const days =
    mode === 'week'
      ? Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i }))
      : Array.from({ length: 42 }, (_, i) =>
          anchor.startOf('month').startOf('week').plus({ days: i })
        )
  const title =
    mode === 'week'
      ? `${weekStart.toFormat('MMM d')} – ${weekStart.plus({ days: 6 }).toFormat('MMM d, yyyy')}`
      : anchor.toFormat('MMMM yyyy')

  function step(dir: 1 | -1): void {
    setAnchor((a) => (mode === 'week' ? a.plus({ weeks: dir }) : a.plus({ months: dir })))
  }

  function open(post: PostListItem): void {
    if (EDITABLE.includes(post.status) && !post.youtubeVideoId) openEditPost(post.id)
    else
      toast(`${post.title || 'Untitled'}: ${STATUS_LABELS[post.status]}. Use the Queue for more.`)
  }

  function newAt(at: DateTime): void {
    if (at <= now) {
      toast.error('That time has passed. Pick a slot in the future.')
      return
    }
    openNewPost(undefined, at.toUTC().toISO() as string)
  }

  function dropOn(target: DateTime, keepTime: boolean, e: React.DragEvent): void {
    e.preventDefault()
    setDropTarget(null)
    const id = e.dataTransfer.getData(MIME)
    const post = timed.find((p) => p.id === id)
    if (!post) return
    const from = DateTime.fromISO(post.publishAtUtc as string)
    const at = keepTime
      ? target.set({ hour: from.hour, minute: from.minute })
      : target.set({ minute: from.minute })
    if (at.toMillis() === from.toMillis()) return
    if (at <= now.plus({ minutes: 1 })) {
      toast.error('That time has passed. Drop it on a future slot.')
      return
    }
    setPending({ post, at })
  }

  const dropProps = (key: string, target: DateTime, keepTime: boolean) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropTarget !== key) setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => dropOn(target, keepTime, e)
  })

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(['week', 'month'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'secondary' : 'ghost'}
              className="h-7 capitalize"
              onClick={() => setMode(m)}
            >
              {m}
            </Button>
          ))}
        </div>
        <Button size="icon" variant="ghost" aria-label="Previous" onClick={() => step(-1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Next" onClick={() => step(1)}>
          <ChevronRight aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAnchor(DateTime.local().startOf('day'))}
        >
          Today
        </Button>
        <h1 className="ml-2 text-base font-semibold">{title}</h1>
        <div className="ml-auto flex flex-wrap gap-1.5 text-xs">
          {(accounts.data ?? []).map((a) => {
            const on = !hidden.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((h) => (on ? [...h, a.id] : h.filter((id) => id !== a.id)))
                }
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1',
                  !on && 'opacity-50'
                )}
                style={on ? { borderColor: a.color } : undefined}
              >
                <span className="size-2 rounded-full" style={{ background: a.color }} aria-hidden />
                {a.channelTitle}
              </button>
            )
          })}
        </div>
      </div>

      {mode === 'week' ? (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          <div className="sticky top-0 z-10 grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b bg-background">
            <div />
            {days.map((d) => (
              <div
                key={d.toISODate()}
                className={cn(
                  'border-l px-2 py-1.5 text-xs',
                  d.hasSame(now, 'day') && 'font-semibold text-primary'
                )}
              >
                {d.toFormat('ccc d')}
              </div>
            ))}
          </div>
          {HOURS.map((h) => (
            <div key={h} className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
              <div className="border-b px-2 pt-1 text-right text-[10px] text-muted-foreground tabular-nums">
                {String(h).padStart(2, '0')}:00
              </div>
              {days.map((d) => {
                const slot = d.set({ hour: h, minute: 0 })
                const key = slot.toFormat('yyyy-MM-dd HH')
                const items = byDay.hour.get(key) ?? []
                const past = slot.plus({ hours: 1 }) <= now
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={-1}
                    aria-label={`New post ${slot.toFormat('ccc d HH:mm')}`}
                    onClick={() => newAt(slot)}
                    {...dropProps(key, slot, false)}
                    className={cn(
                      'min-h-[52px] space-y-0.5 border-b border-l p-0.5',
                      past ? 'bg-muted/20' : 'cursor-pointer hover:bg-muted/30',
                      dropTarget === key && 'bg-primary/15 ring-1 ring-primary ring-inset'
                    )}
                  >
                    {items.map((p) => (
                      <PostChip key={p.id} post={p} onOpen={() => open(p)} />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] overflow-hidden rounded-lg border">
          {days.slice(0, 7).map((d) => (
            <div key={d.weekday} className="border-b px-2 py-1 text-xs text-muted-foreground">
              {d.toFormat('ccc')}
            </div>
          ))}
          {days.map((d) => {
            const key = d.toFormat('yyyy-MM-dd')
            const items = byDay.day.get(key) ?? []
            const inMonth = d.month === anchor.month
            return (
              <div
                key={key}
                role="button"
                tabIndex={-1}
                aria-label={`New post ${d.toFormat('ccc d')}`}
                onClick={() => {
                  const noon = d.set({ hour: 12 })
                  newAt(noon > now ? noon : now.plus({ hours: 1 }).startOf('hour'))
                }}
                {...dropProps(key, d, true)}
                className={cn(
                  'min-h-0 space-y-0.5 overflow-hidden border-b border-l p-1 first:border-l-0',
                  !inMonth && 'bg-muted/20 text-muted-foreground',
                  d.endOf('day') > now && 'cursor-pointer hover:bg-muted/30',
                  dropTarget === key && 'bg-primary/15 ring-1 ring-primary ring-inset'
                )}
              >
                <div
                  className={cn(
                    'text-xs',
                    d.hasSame(now, 'day') &&
                      'inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground'
                  )}
                >
                  {d.day}
                </div>
                {items.slice(0, MONTH_CHIPS).map((p) => (
                  <PostChip key={p.id} post={p} onOpen={() => open(p)} />
                ))}
                {items.length > MONTH_CHIPS ? (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      setAnchor(d)
                      setMode('week')
                    }}
                  >
                    +{items.length - MONTH_CHIPS} more
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Drag a post to move it. Click an empty slot to plan a new post there. Times are in your
        Mac’s time zone.
      </p>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{pending?.post.title || 'Untitled'}”?</AlertDialogTitle>
            <AlertDialogDescription>
              New publish time: {pending?.at.toFormat('cccc, MMM d, yyyy · HH:mm')}.
              {pending?.post.youtubeVideoId
                ? ' It’s already on YouTube, so this also changes the publish time there (50 quota units).'
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the old time</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                pending &&
                reschedule.mutate({
                  id: pending.post.id,
                  publishAtUtc: pending.at.toUTC().toISO() as string
                })
              }
            >
              Move it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
