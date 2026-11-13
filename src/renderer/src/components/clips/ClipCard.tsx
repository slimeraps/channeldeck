import { Check, CloudDownload, Eye, EyeOff, Star, TriangleAlert } from 'lucide-react'
import type { ClipView } from '@shared/schemas/twitch'
import { Badge } from '@renderer/components/ui/badge'
import { formatDuration, STATUS_LABELS } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import type { PostStatus } from '@shared/constants/enums'

const DOWNLOAD_LABEL: Record<string, string> = {
  pending: 'Waiting to download',
  downloading: 'Downloading…',
  downloaded: 'On disk',
  failed: 'Download failed',
  not_downloadable: 'Not downloadable',
  deleted: 'Local file deleted'
}

export function ClipCard({
  clip,
  selected,
  onToggle,
  onOpen,
  showChannel = false
}: {
  clip: ClipView
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  /** Label the Twitch channel (the All channels view). */
  showChannel?: boolean
}): React.JSX.Element {
  const date = new Date(clip.createdAtUtc).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
  return (
    <div
      className={cn(
        'group overflow-hidden rounded-lg border bg-card transition-colors',
        selected && 'border-primary ring-1 ring-primary',
        clip.hidden && 'opacity-60'
      )}
    >
      <div className="relative aspect-video cursor-pointer bg-muted" onClick={onOpen}>
        {clip.thumbnailUrl ? (
          <img src={clip.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : null}
        {/* The Twitch channel's color, so mixed clips stay easy to tell apart. */}
        <span
          className="absolute inset-x-0 top-0 h-1"
          style={{ backgroundColor: clip.twitchColor }}
          aria-hidden
        />
        {showChannel ? (
          <span className="absolute bottom-1.5 left-1.5 flex max-w-[70%] items-center gap-1 rounded bg-black/80 px-1.5 text-[11px] text-white">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: clip.twitchColor }}
              aria-hidden
            />
            <span className="truncate">{clip.twitchName}</span>
          </span>
        ) : null}
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1 text-[11px] text-white tabular-nums">
          {formatDuration(clip.durationSec)}
        </span>
        {clip.isFeatured ? (
          <span
            className="absolute top-1.5 right-1.5 rounded bg-amber-500/90 p-0.5 text-black"
            title="Featured"
          >
            <Star className="size-3" aria-label="Featured" />
          </span>
        ) : null}
        <button
          type="button"
          aria-label={selected ? 'Deselect clip' : 'Select clip'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className={cn(
            'absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded border border-white/70 bg-black/50 text-white',
            selected ? 'bg-primary text-primary-foreground' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          {selected ? <Check className="size-3.5" aria-hidden /> : null}
        </button>
      </div>
      <div className="space-y-1.5 p-2.5">
        <p
          className="line-clamp-2 cursor-pointer text-sm leading-snug font-medium"
          title={clip.title}
          onClick={onOpen}
        >
          {clip.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[
            clip.gameName,
            `${clip.viewCount.toLocaleString()} views`,
            clip.creatorName ? `by ${clip.creatorName}` : null,
            date
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Badge
            variant="outline"
            className={cn(
              'h-5 px-1.5 text-[10px]',
              clip.downloadStatus === 'downloaded' && 'text-green-400',
              (clip.downloadStatus === 'failed' || clip.downloadStatus === 'not_downloadable') &&
                'text-red-300'
            )}
            title={clip.downloadError ?? undefined}
          >
            {clip.downloadStatus === 'failed' ? (
              <TriangleAlert aria-hidden />
            ) : (
              <CloudDownload aria-hidden />
            )}
            {DOWNLOAD_LABEL[clip.downloadStatus] ?? clip.downloadStatus}
          </Badge>
          {clip.hidden ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              <EyeOff aria-hidden /> Hidden
            </Badge>
          ) : null}
          {clip.posts.length === 0 ? (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
              <Eye aria-hidden /> Unposted
            </Badge>
          ) : (
            clip.posts.map((p) => (
              <Badge
                key={p.postId}
                variant="outline"
                className="h-5 gap-1 px-1.5 text-[10px]"
                title={p.channelTitle}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: p.channelColor }}
                  aria-hidden
                />
                {p.youtubeVideoId && !p.youtubeVideoId.startsWith('DRYRUN-') ? (
                  <a
                    href={`https://youtu.be/${p.youtubeVideoId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    {STATUS_LABELS[p.status as PostStatus] ?? p.status}
                  </a>
                ) : (
                  (STATUS_LABELS[p.status as PostStatus] ?? p.status)
                )}
              </Badge>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
