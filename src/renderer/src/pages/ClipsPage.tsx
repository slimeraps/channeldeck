import { CheckSquare, Clapperboard, ExternalLink, Filter, Search, Send, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PickOrder } from '@shared/constants/enums'
import type { ClipSearchInput, ClipView } from '@shared/schemas/twitch'
import { ClipCard } from '@renderer/components/clips/ClipCard'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { useAccounts } from '@renderer/hooks/useAccounts'
import { useClipSearch, useTwitchAccounts, useTwitchAction } from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { formatBytes, formatDuration } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

const PAGE = 60
const ANY = '__any__'

interface Filters {
  gameId?: string
  posted?: 'posted' | 'unposted'
  featuredOnly?: boolean
  minViews?: number
  minDurationSec?: number
  maxDurationSec?: number
  from?: string
  to?: string
  includeHidden?: boolean
}

function numberOrUndefined(value: string): number | undefined {
  const n = Number(value)
  return value.trim() === '' || Number.isNaN(n) ? undefined : n
}

function ClipPreview({
  clip,
  onClose,
  onPost
}: {
  clip: ClipView
  onClose: () => void
  onPost: () => void
}): React.JSX.Element {
  const video = clip.portraitUrl ?? clip.landscapeUrl
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{clip.title}</DialogTitle>
          <DialogDescription>
            {[
              clip.twitchName,
              clip.gameName,
              `${clip.viewCount.toLocaleString()} views`,
              clip.creatorName ? `clipped by ${clip.creatorName}` : null,
              new Date(clip.createdAtUtc).toLocaleString(),
              formatDuration(clip.durationSec)
            ]
              .filter(Boolean)
              .join(' · ')}
          </DialogDescription>
        </DialogHeader>
        {video ? (
          <div className="flex justify-center overflow-hidden rounded-lg bg-black">
            <video src={video} controls autoPlay className="max-h-[60vh]" />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            This clip isn’t on disk ({clip.downloadStatus.replace('_', ' ')}).
            {clip.downloadError ? ` ${clip.downloadError}` : ''}
          </p>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          {clip.landscapeUrl ? (
            <span className="rounded bg-muted px-2 py-1">Landscape file</span>
          ) : null}
          {clip.portraitUrl ? (
            <span className="rounded bg-muted px-2 py-1">Portrait file</span>
          ) : null}
          <Button variant="ghost" size="sm" asChild className="ml-auto">
            <a href={clip.url} target="_blank" rel="noreferrer">
              Open on Twitch <ExternalLink aria-hidden />
            </a>
          </Button>
          <Button size="sm" onClick={onPost} disabled={!clip.landscapePath && !clip.portraitPath}>
            <Send aria-hidden /> Post this clip…
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ClipsPage(): React.JSX.Element {
  const twitch = useTwitchAccounts()
  const youtube = useAccounts()
  const setPage = useUiStore((s) => s.setPage)
  const openNewPost = useUiStore((s) => s.openNewPost)
  const accounts = twitch.data ?? []

  // 'all' = every channel at once (the default with more than one), or one channel's id.
  const [chosenView, setView] = useState<'all' | number | null>(null)
  const view: 'all' | number | null =
    chosenView ?? (accounts.length > 1 ? 'all' : (accounts[0]?.id ?? null))
  /** In the All view: channels to show (empty = all of them). */
  const [shown, setShown] = useState<number[]>([])
  const scope =
    view === 'all'
      ? accounts.filter((a) => shown.length === 0 || shown.includes(a.id))
      : accounts.filter((a) => a.id === view)
  const scopeStats = scope.reduce(
    (sum, a) => ({
      total: sum.total + a.stats.total,
      downloaded: sum.downloaded + a.stats.downloaded,
      bytes: sum.bytes + a.stats.bytesOnDisk
    }),
    { total: 0, downloaded: 0, bytes: 0 }
  )
  const backfilling = scope.filter((a) => a.backfill)
  const busy = scope.some((a) => a.backfill || a.syncing)

  const [sort, setSort] = useState<PickOrder>('oldest')
  const [title, setTitle] = useState('')
  const [filters, setFilters] = useState<Filters>({})
  const [showFilters, setShowFilters] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<ClipView | null>(null)
  const [addTo, setAddTo] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const query: ClipSearchInput | null = useMemo(() => {
    if (view === null) return null
    const ids = view === 'all' ? shown : [view]
    return {
      ...(ids.length > 0 ? { twitchAccountIds: ids } : {}),
      sort,
      limit,
      offset: 0,
      ...(title.trim() ? { titleSearch: title.trim() } : {}),
      ...(filters.gameId ? { gameId: filters.gameId } : {}),
      ...(filters.posted ? { posted: filters.posted } : {}),
      ...(filters.featuredOnly ? { featuredOnly: true } : {}),
      ...(filters.minViews !== undefined ? { minViews: filters.minViews } : {}),
      ...(filters.minDurationSec !== undefined ? { minDurationSec: filters.minDurationSec } : {}),
      ...(filters.maxDurationSec !== undefined ? { maxDurationSec: filters.maxDurationSec } : {}),
      ...(filters.from ? { fromUtc: new Date(`${filters.from}T00:00:00`).toISOString() } : {}),
      ...(filters.to ? { toUtc: new Date(`${filters.to}T23:59:59`).toISOString() } : {}),
      ...(filters.includeHidden ? { includeHidden: true } : {})
    }
  }, [view, shown, sort, limit, title, filters])

  const clips = useClipSearch(query)
  const ids = [...selected]
  const clear = (): void => setSelected(new Set())

  const hide = useTwitchAction(
    (v: { ids: string[]; hidden: boolean }) => invoke('clips:setHidden', v),
    (r, v) =>
      `${r.updated} clip${r.updated === 1 ? '' : 's'} ${v.hidden ? 'hidden (never autoposted)' : 'unhidden'}`
  )
  const redownload = useTwitchAction(
    (v: string[]) => invoke('clips:redownload', { ids: v }),
    (r) => `${r.queued} clip${r.queued === 1 ? '' : 's'} queued to download again`
  )
  const deleteLocal = useTwitchAction(
    (v: string[]) => invoke('clips:deleteLocal', { ids: v }),
    (r) => `Deleted local files for ${r.deleted} clip${r.deleted === 1 ? '' : 's'}`
  )
  const addToChannel = useTwitchAction(
    (v: { ids: string[]; accountId: number }) => invoke('clips:addToChannel', v),
    (r) =>
      `${r.created} draft${r.created === 1 ? '' : 's'} created${r.skipped.length ? `; skipped ${r.skipped.length} (${r.skipped.slice(0, 2).join('; ')})` : ''}. Open them in the Queue to set times.`
  )

  if (twitch.isSuccess && accounts.length === 0) {
    return (
      <EmptyState
        icon={Clapperboard}
        title="No clips banked yet"
        action={<Button onClick={() => setPage('channels')}>Connect Twitch</Button>}
      >
        Connect a Twitch account on the Channels page and ChannelDeck saves every clip to disk,
        sorted oldest to newest, and keeps it in sync daily.
      </EmptyState>
    )
  }

  const items = clips.data?.items ?? []
  const total = clips.data?.total ?? 0
  const allShownSelected = items.length > 0 && items.every((c) => selected.has(c.id))
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }))
    setLimit(PAGE)
  }

  return (
    <div className="space-y-4 px-8 py-6">
      {/* Channel tabs + disk meter */}
      <div className="flex flex-wrap items-center gap-2">
        {accounts.length > 1 ? (
          <button
            type="button"
            onClick={() => {
              setView('all')
              clear()
              setLimit(PAGE)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              view === 'all'
                ? 'bg-secondary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All channels
            <span className="ml-1.5 text-xs text-muted-foreground">
              {accounts.reduce((n, a) => n + a.stats.total, 0)}
            </span>
          </button>
        ) : null}
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setView(a.id)
              clear()
              setLimit(PAGE)
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              a.id === view
                ? 'bg-secondary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: a.color }}
              aria-hidden
            />
            {a.displayName}
            <span className="text-xs text-muted-foreground">{a.stats.total}</span>
          </button>
        ))}
        {scope.length > 0 ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {formatBytes(scopeStats.bytes)} on disk · {scopeStats.downloaded}/{scopeStats.total}{' '}
            downloaded
            {backfilling.length === 1 && backfilling[0]?.backfill
              ? ` · backfilling ${backfilling[0].backfill.windowsDone}/${backfilling[0].backfill.windowsTotal} weeks`
              : backfilling.length > 1
                ? ` · ${backfilling.length} channels backfilling`
                : ''}
          </span>
        ) : null}
      </div>

      {/* All channels: pick which ones to show */}
      {view === 'all' ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 text-muted-foreground">Show</span>
          {accounts.map((a) => {
            const on = shown.length === 0 || shown.includes(a.id)
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={shown.includes(a.id)}
                onClick={() => {
                  setShown((current) => {
                    const next = current.includes(a.id)
                      ? current.filter((id) => id !== a.id)
                      : [...current, a.id]
                    // Every channel picked is the same as none: show all.
                    return next.length === accounts.length ? [] : next
                  })
                  clear()
                  setLimit(PAGE)
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors',
                  on ? 'text-foreground' : 'text-muted-foreground opacity-60'
                )}
                style={on ? { borderColor: a.color } : undefined}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: a.color }}
                  aria-hidden
                />
                {a.displayName}
              </button>
            )
          })}
          {shown.length > 0 ? (
            <button
              type="button"
              className="ml-1 text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setShown([])
                setLimit(PAGE)
              }}
            >
              Show all
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Search, sort, filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            className="h-9 pl-8"
            placeholder="Search titles"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setLimit(PAGE)
            }}
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as PickOrder)}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="most_viewed">Most viewed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.gameId ?? ANY}
          onValueChange={(v) => setFilter('gameId', v === ANY ? undefined : v)}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Any game" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any game</SelectItem>
            {(clips.data?.games ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.posted ?? ANY}
          onValueChange={(v) =>
            setFilter('posted', v === ANY ? undefined : (v as Filters['posted']))
          }
        >
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Posted or not</SelectItem>
            <SelectItem value="unposted">Unposted</SelectItem>
            <SelectItem value="posted">Posted / queued</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={showFilters ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
        >
          <Filter aria-hidden />
          More filters
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {total.toLocaleString()} clip{total === 1 ? '' : 's'}
        </span>
        {items.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setSelected(allShownSelected ? new Set() : new Set(items.map((c) => c.id)))
            }
            title={
              items.length < total
                ? `Selects the ${items.length} clips shown; "Show more" loads the rest`
                : undefined
            }
          >
            <CheckSquare aria-hidden />
            {allShownSelected
              ? 'Select none'
              : `Select all${items.length < total ? ` ${items.length} shown` : ''}`}
          </Button>
        ) : null}
      </div>

      {showFilters ? (
        <div className="flex flex-wrap items-end gap-4 rounded-lg border p-3 text-xs">
          <label className="grid gap-1">
            Min views
            <Input
              className="h-8 w-24"
              inputMode="numeric"
              value={filters.minViews ?? ''}
              onChange={(e) => setFilter('minViews', numberOrUndefined(e.target.value))}
            />
          </label>
          <label className="grid gap-1">
            Length from (s)
            <Input
              className="h-8 w-24"
              inputMode="numeric"
              value={filters.minDurationSec ?? ''}
              onChange={(e) => setFilter('minDurationSec', numberOrUndefined(e.target.value))}
            />
          </label>
          <label className="grid gap-1">
            to (s)
            <Input
              className="h-8 w-24"
              inputMode="numeric"
              value={filters.maxDurationSec ?? ''}
              onChange={(e) => setFilter('maxDurationSec', numberOrUndefined(e.target.value))}
            />
          </label>
          <label className="grid gap-1">
            Created from
            <Input
              className="h-8 w-40"
              type="date"
              value={filters.from ?? ''}
              onChange={(e) => setFilter('from', e.target.value || undefined)}
            />
          </label>
          <label className="grid gap-1">
            to
            <Input
              className="h-8 w-40"
              type="date"
              value={filters.to ?? ''}
              onChange={(e) => setFilter('to', e.target.value || undefined)}
            />
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.featuredOnly ?? false}
              onCheckedChange={(v) => setFilter('featuredOnly', v || undefined)}
            />
            Featured only
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={filters.includeHidden ?? false}
              onCheckedChange={(v) => setFilter('includeHidden', v || undefined)}
            />
            Show hidden
          </label>
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            Reset
          </Button>
        </div>
      ) : null}

      {/* Selection bar */}
      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow">
          <span className="font-medium">{selected.size} selected</span>
          <Select value={addTo} onValueChange={setAddTo}>
            <SelectTrigger size="sm" className="w-48">
              <SelectValue placeholder="Add to channel…" />
            </SelectTrigger>
            <SelectContent>
              {(youtube.data ?? []).map((a) => (
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
          <Button
            size="sm"
            disabled={!addTo || addToChannel.isPending}
            onClick={() =>
              addToChannel.mutate({ ids, accountId: Number(addTo) }, { onSuccess: clear })
            }
          >
            Add as drafts
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => hide.mutate({ ids, hidden: true }, { onSuccess: clear })}
          >
            Hide
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => hide.mutate({ ids, hidden: false }, { onSuccess: clear })}
          >
            Unhide
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => redownload.mutate(ids, { onSuccess: clear })}
          >
            Re-download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Delete local files
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto"
            aria-label="Clear selection"
            onClick={clear}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      {/* Grid */}
      {clips.isSuccess && items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {busy
            ? 'Clips are on their way: the first sync is running.'
            : 'No clips match these filters.'}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {items.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              selected={selected.has(clip.id)}
              showChannel={view === 'all'}
              onOpen={() => setPreview(clip)}
              onPost={() => openNewPost(undefined, undefined, clip.id)}
              onToggle={() =>
                setSelected((s) => {
                  const next = new Set(s)
                  if (next.has(clip.id)) next.delete(clip.id)
                  else next.add(clip.id)
                  return next
                })
              }
            />
          ))}
        </div>
      )}

      {items.length < total ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setLimit((l) => l + PAGE)}
            disabled={clips.isFetching}
          >
            Show more ({(total - items.length).toLocaleString()} left)
          </Button>
        </div>
      ) : null}

      {preview ? (
        <ClipPreview
          clip={preview}
          onClose={() => setPreview(null)}
          onPost={() => {
            setPreview(null)
            openNewPost(undefined, undefined, preview.id)
          }}
        />
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete the local files for {selected.size} clip{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The video files and thumbnails are moved off your disk for good. The clips stay in the
              bank and can be downloaded again with Re-download. Clips still waiting to upload are
              refused.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep files</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteLocal.mutate(ids, { onSuccess: clear })}
            >
              Delete files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
