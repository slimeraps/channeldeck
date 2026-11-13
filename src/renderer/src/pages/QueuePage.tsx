import {
  ArrowDown,
  ArrowUp,
  CalendarX,
  Clapperboard,
  CloudUpload,
  Copy,
  ExternalLink,
  FolderSearch,
  ListVideo,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PostSource, PostStatus } from '@shared/constants/enums'
import type { PostListItem } from '@shared/schemas/post'
import { EmptyState } from '@renderer/components/EmptyState'
import { NewPostButton } from '@renderer/components/NewPostButton'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAccounts } from '@renderer/hooks/useAccounts'
import {
  useCancelPost,
  useDeleteDraft,
  useDuplicatePost,
  usePosts,
  useRetryPost,
  useRevealPost,
  useUploadNow
} from '@renderer/hooks/usePosts'
import { useProgressStore } from '@renderer/stores/progress'
import {
  STATUS_LABELS,
  STATUS_TONES,
  VISIBILITY_LABELS,
  formatDuration
} from '@renderer/lib/status'
import { formatLocal, formatRelative } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

const ALL = 'all'
type StatusFilter = typeof ALL | 'active' | PostStatus

const ACTIVE: PostStatus[] = [
  'draft',
  'needs_approval',
  'queued',
  'rendering',
  'uploading',
  'processing',
  'scheduled',
  'needs_decision',
  'failed',
  'waiting_quota'
]
const EDITABLE: PostStatus[] = ['draft', 'needs_approval', 'queued']
const UNSCHEDULABLE: PostStatus[] = [
  'needs_approval',
  'queued',
  'waiting_quota',
  'needs_decision',
  'failed'
]

function Preview({ post }: { post: PostListItem }): React.JSX.Element {
  const box = 'h-12 w-20 shrink-0 overflow-hidden rounded border bg-muted'
  if (post.thumbnailPreviewUrl) {
    return <img src={post.thumbnailPreviewUrl} alt="" className={cn(box, 'object-cover')} />
  }
  if (post.videoPreviewUrl) {
    // #t=1 shows a frame one second in instead of a black first frame.
    return (
      <video
        src={`${post.videoPreviewUrl}#t=1`}
        preload="metadata"
        muted
        className={cn(box, 'object-cover')}
      />
    )
  }
  return (
    <div className={cn(box, 'flex items-center justify-center')}>
      {post.fileMissing ? (
        <TriangleAlert className="size-4 text-destructive" aria-hidden />
      ) : (
        <ListVideo className="size-4 text-muted-foreground" aria-hidden />
      )}
    </div>
  )
}

function PublishCell({ post }: { post: PostListItem }): React.JSX.Element {
  if (post.visibilityMode === 'schedule' && post.publishAtUtc) {
    return (
      <div>
        <div>{formatLocal(post.publishAtUtc)}</div>
        <div className="text-xs text-muted-foreground">{formatRelative(post.publishAtUtc)}</div>
      </div>
    )
  }
  return (
    <div className="text-muted-foreground">
      {VISIBILITY_LABELS[post.visibilityMode]}
      <div className="text-xs">
        {post.visibilityMode === 'schedule' ? 'No time set' : 'Uploads as soon as possible'}
      </div>
    </div>
  )
}

function ProgressCell({ post }: { post: PostListItem }): React.JSX.Element {
  const live = useProgressStore((s) => s.byPost[post.id])
  if (post.status === 'uploading' || post.status === 'rendering') {
    const fraction = live && live.total > 0 ? live.sent / live.total : post.uploadProgress
    const pct = Math.round(fraction * 100)
    return (
      <div className="space-y-1">
        <div className="h-1.5 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">{pct}%</div>
      </div>
    )
  }
  if (post.status === 'processing') {
    return <span className="text-xs text-muted-foreground">On YouTube, processing</span>
  }
  return <span className="text-xs text-muted-foreground">—</span>
}

function StatusCell({ post }: { post: PostListItem }): React.JSX.Element {
  const detail =
    post.status === 'waiting_quota' && post.retryAfterUtc
      ? `Retries ${formatRelative(post.retryAfterUtc)}`
      : post.lastError
  return (
    <div className="max-w-56 space-y-1">
      <Badge variant="outline" className={STATUS_TONES[post.status]}>
        {STATUS_LABELS[post.status]}
      </Badge>
      {detail ? (
        <p
          className={cn(
            'line-clamp-2 text-[11px]',
            post.status === 'failed' ? 'text-red-300' : 'text-muted-foreground'
          )}
          title={post.lastError ?? undefined}
        >
          {detail}
        </p>
      ) : null}
    </div>
  )
}

export function QueuePage(): React.JSX.Element {
  const [accountFilter, setAccountFilter] = useState<string>(ALL)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [sourceFilter, setSourceFilter] = useState<typeof ALL | PostSource>(ALL)
  const [newestFirst, setNewestFirst] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PostListItem | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<PostListItem | null>(null)

  const accounts = useAccounts()
  const posts = usePosts({
    ...(accountFilter !== ALL ? { accountId: Number(accountFilter) } : {}),
    ...(statusFilter === 'active'
      ? { statuses: ACTIVE }
      : statusFilter !== ALL
        ? { statuses: [statusFilter] }
        : {}),
    ...(sourceFilter !== ALL ? { source: sourceFilter } : {})
  })
  const openEditPost = useUiStore((s) => s.openEditPost)
  const duplicate = useDuplicatePost()
  const cancel = useCancelPost()
  const deleteDraft = useDeleteDraft()
  const reveal = useRevealPost()
  const uploadNow = useUploadNow()
  const retry = useRetryPost()

  // Sorted by publish time; posts without one (drafts, upload-now) go after timed ones.
  const rows = useMemo(() => {
    const list = [...(posts.data ?? [])]
    const key = (p: PostListItem): number =>
      p.publishAtUtc ? Date.parse(p.publishAtUtc) : Number.POSITIVE_INFINITY
    list.sort((a, b) => {
      const d = key(a) - key(b)
      if (d !== 0 && Number.isFinite(d)) return newestFirst ? -d : d
      if (d !== 0) return key(a) === Number.POSITIVE_INFINITY ? 1 : -1
      return a.createdAt.localeCompare(b.createdAt)
    })
    return list
  }, [posts.data, newestFirst])

  const filtersActive = accountFilter !== ALL || statusFilter !== 'active' || sourceFilter !== ALL

  if (posts.isSuccess && rows.length === 0 && !filtersActive) {
    return (
      <EmptyState icon={ListVideo} title="Nothing in the queue yet" action={<NewPostButton />}>
        Every post for every channel shows up here with its publish time, status and upload
        progress. Drop a video anywhere on this window to start one.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4 px-8 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All channels</SelectItem>
            {(accounts.data ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id.toString()}>
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
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (not done)</SelectItem>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as PostStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sources</SelectItem>
            <SelectItem value="manual">Manual uploads</SelectItem>
            <SelectItem value="twitch_clip">Twitch clips</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} post{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-24 px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="w-10 px-3 py-2 font-medium" aria-label="Source" />
              <th className="px-3 py-2 font-medium">
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-foreground"
                  onClick={() => setNewestFirst((v) => !v)}
                >
                  Publish time
                  {newestFirst ? (
                    <ArrowDown className="size-3" aria-hidden />
                  ) : (
                    <ArrowUp className="size-3" aria-hidden />
                  )}
                </button>
              </th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="w-32 px-3 py-2 font-medium">Progress</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((post) => {
              const editable = EDITABLE.includes(post.status) && !post.youtubeVideoId
              return (
                <tr
                  key={post.id}
                  className="cursor-default border-t hover:bg-muted/30"
                  onDoubleClick={() => editable && openEditPost(post.id)}
                >
                  <td className="px-3 py-2">
                    <Preview post={post} />
                  </td>
                  <td className="max-w-72 px-3 py-2">
                    <div className="truncate font-medium">
                      {post.title || <span className="text-muted-foreground">Untitled</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {post.durationSec ? formatDuration(post.durationSec) : null}
                      {post.isShort ? (
                        <Badge className="h-4 bg-red-600 px-1 text-[10px] text-white">Short</Badge>
                      ) : null}
                      {post.fileMissing ? (
                        <span className="text-destructive">File missing</span>
                      ) : null}
                      {post.youtubeVideoId?.startsWith('DRYRUN-') ? (
                        <Badge
                          variant="outline"
                          className="h-4 border-amber-500/50 px-1 text-[10px] text-amber-300"
                        >
                          Dry Run
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: post.channelColor }}
                        aria-hidden
                      />
                      <span className="truncate">{post.channelTitle}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {post.source === 'twitch_clip' ? (
                      <Clapperboard className="size-4" aria-label="Twitch clip" />
                    ) : (
                      <Upload className="size-4" aria-label="Manual upload" />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PublishCell post={post} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusCell post={post} />
                  </td>
                  <td className="px-3 py-2">
                    <ProgressCell post={post} />
                  </td>
                  <td className="px-3 py-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${post.title || 'post'}`}
                        >
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={!editable}
                          onSelect={() => openEditPost(post.id)}
                        >
                          <Pencil aria-hidden /> Edit…
                        </DropdownMenuItem>
                        {post.status === 'queued' ? (
                          <DropdownMenuItem onSelect={() => uploadNow.mutate(post.id)}>
                            <CloudUpload aria-hidden /> Upload now
                          </DropdownMenuItem>
                        ) : null}
                        {post.status === 'failed' || post.status === 'waiting_quota' ? (
                          <DropdownMenuItem onSelect={() => retry.mutate(post.id)}>
                            <RotateCcw aria-hidden /> Retry
                          </DropdownMenuItem>
                        ) : null}
                        {post.youtubeVideoId && !post.youtubeVideoId.startsWith('DRYRUN-') ? (
                          <DropdownMenuItem asChild>
                            <a
                              href={`https://studio.youtube.com/video/${post.youtubeVideoId}/edit`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink aria-hidden /> Open in YouTube Studio
                            </a>
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => duplicate.mutate(post.id)}>
                          <Copy aria-hidden /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!post.videoPreviewUrl}
                          onSelect={() => reveal.mutate(post.id)}
                        >
                          <FolderSearch aria-hidden /> Reveal file in Finder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {post.status === 'draft' ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setConfirmDelete(post)}
                          >
                            <Trash2 aria-hidden /> Delete draft…
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={
                              !UNSCHEDULABLE.includes(post.status) || Boolean(post.youtubeVideoId)
                            }
                            onSelect={() => setConfirmCancel(post)}
                          >
                            <CalendarX aria-hidden /> Unschedule…
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No posts match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.title || 'Untitled'}” will be deleted. Your video file stays where it
              is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => confirmDelete && deleteDraft.mutate(confirmDelete.id)}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmCancel !== null}
        onOpenChange={(open) => !open && setConfirmCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unschedule this post?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmCancel?.title || 'Untitled'}” hasn’t been uploaded, so it will simply be
              canceled. Nothing changes on YouTube. If it came from a Twitch clip, the clip goes
              back to the bank.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => confirmCancel && cancel.mutate(confirmCancel.id)}
            >
              Unschedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
