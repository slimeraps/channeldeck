import { Clapperboard, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PickOrder } from '@shared/constants/enums'
import type { ClipSearchInput, ClipView } from '@shared/schemas/twitch'
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
import { useClipSearch, useTwitchAccounts } from '@renderer/hooks/useTwitch'
import { formatDuration } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'

const PAGE = 48

/** Pick one banked Twitch clip to post (from the post editor). */
export function ClipLibraryDialog({
  onPick,
  onClose
}: {
  onPick: (clip: ClipView) => void
  onClose: () => void
}): React.JSX.Element {
  const twitch = useTwitchAccounts()
  const accounts = twitch.data ?? []
  const [title, setTitle] = useState('')
  const [shown, setShown] = useState<number[]>([])
  const [unposted, setUnposted] = useState(true)
  const [sort, setSort] = useState<PickOrder>('newest')
  const [limit, setLimit] = useState(PAGE)

  const query: ClipSearchInput = useMemo(
    () => ({
      sort,
      limit,
      offset: 0,
      ...(shown.length ? { twitchAccountIds: shown } : {}),
      ...(title.trim() ? { titleSearch: title.trim() } : {}),
      ...(unposted ? { posted: 'unposted' as const } : {})
    }),
    [sort, limit, shown, title, unposted]
  )
  const clips = useClipSearch(query)
  const items = (clips.data?.items ?? []).filter((c) => c.landscapePath || c.portraitPath)
  const total = clips.data?.total ?? 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard className="size-4" aria-hidden /> Clip library
          </DialogTitle>
          <DialogDescription>
            Pick a downloaded clip to post. You can make it vertical in the editor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search
              className="absolute top-2.5 left-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-9 pl-8"
              placeholder="Search titles"
              value={title}
              autoFocus
              onChange={(e) => {
                setTitle(e.target.value)
                setLimit(PAGE)
              }}
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as PickOrder)}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="most_viewed">Most viewed</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={unposted} onCheckedChange={setUnposted} />
            Unposted only
          </label>
          {accounts.length > 1 ? (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {accounts.map((a) => {
                const on = shown.length === 0 || shown.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={shown.includes(a.id)}
                    onClick={() =>
                      setShown((s) => {
                        const next = s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]
                        return next.length === accounts.length ? [] : next
                      })
                    }
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-2.5 py-1',
                      !on && 'opacity-50'
                    )}
                    style={on ? { borderColor: a.color } : undefined}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ background: a.color }}
                      aria-hidden
                    />
                    {a.displayName}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {clips.isSuccess && items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {accounts.length === 0
                ? 'Connect a Twitch channel on the Channels page to build a clip library.'
                : unposted
                  ? 'No unposted clips match. Turn off “Unposted only” to see all clips.'
                  : 'No downloaded clips match.'}
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {items.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => onPick(clip)}
                  className="group overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary"
                >
                  <div className="relative aspect-video bg-muted">
                    {clip.thumbnailUrl ? (
                      <img
                        src={clip.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : null}
                    <span
                      className="absolute inset-x-0 top-0 h-1"
                      style={{ backgroundColor: clip.twitchColor }}
                      aria-hidden
                    />
                    <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1 text-[11px] text-white tabular-nums">
                      {formatDuration(clip.durationSec)}
                    </span>
                  </div>
                  <div className="space-y-0.5 p-2">
                    <p className="line-clamp-2 text-xs leading-snug font-medium">{clip.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[
                        clip.twitchName,
                        `${clip.viewCount.toLocaleString()} views`,
                        new Date(clip.createdAtUtc).toLocaleDateString()
                      ].join(' · ')}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {clips.data && clips.data.items.length < total ? (
            <div className="flex justify-center py-3">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
