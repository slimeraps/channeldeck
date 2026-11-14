import {
  ArrowDown,
  ArrowUp,
  CalendarX,
  Check,
  CheckCheck,
  CheckSquare,
  Clapperboard,
  CloudUpload,
  Copy,
  ExternalLink,
  FolderSearch,
  ListVideo,
  MoreHorizontal,
  CalendarClock,
  EyeOff,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Shuffle,
  Trash2,
  TriangleAlert,
  Upload,
  X
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { useAutopostAction, useRules } from '@renderer/hooks/useAutopost'
import { invoke } from '@renderer/lib/ipc'
import {
  useCancelPost,
  useDeleteDraft,
  useDuplicatePost,
  usePosts,
  useDecide,
  useDeleteFromYouTube,
  useKeepPrivate,
  useReschedule,
  useRetryPost,
  useRevealPost,
  useSyncStatus,
  useUploadNow,
  useApprovePost,
  useBulkPostAction,
  type BulkPostAction
} from '@renderer/hooks/usePosts'
import { PublishTimeDialog } from '@renderer/components/queue/PublishTimeDialog'
import { SwapClipDialog } from '@renderer/components/queue/SwapClipDialog'
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
/** Autoposts can swap their clip until they upload. */
const SWAPPABLE: PostStatus[] = [
  'needs_approval',
  'queued',
  'failed',
  'waiting_quota',
  'needs_decision'
]
const UNSCHEDULABLE: PostStatus[] = [
  'needs_approval',
  'queued',
  'waiting_quota',
  'needs_decision',
  'failed'
]

/** Which selected posts each bulk action applies to (the rest are left alone). */
const BULK_ELIGIBLE: Record<BulkPostAction, (p: PostListItem) => boolean> = {
  approve: (p) => p.status === 'needs_approval',
  uploadNow: (p) => p.status === 'queued',
  retry: (p) => p.status === 'failed' || p.status === 'waiting_quota',
  duplicate: () => true,
  cancel: (p) => UNSCHEDULABLE.includes(p.status) && !p.youtubeVideoId,
  deleteDraft: (p) => p.status === 'draft'
}

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
      <div className="whitespace-nowrap">
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

function UploadProgress({ post }: { post: PostListItem }): React.JSX.Element {
  const live = useProgressStore((s) => s.byPost[post.id])
  const fraction = live && live.total > 0 ? live.sent / live.total : post.uploadProgress
  const pct = Math.round(fraction * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  )
}

function StatusCell({
  post,
  onApprove,
  approving
}: {
  post: PostListItem
  onApprove: () => void
  approving: boolean
}): React.JSX.Element {
  const detail =
    post.status === 'waiting_quota' && post.retryAfterUtc
      ? `Retries ${formatRelative(post.retryAfterUtc)}`
      : post.status === 'needs_decision'
        ? 'The publish time passed before it uploaded. Open ⋯ to publish now, pick a new time, or unschedule.'
        : post.lastError
  return (
    <div className="space-y-1">
      <Badge variant="outline" className={STATUS_TONES[post.status]}>
        {STATUS_LABELS[post.status]}
      </Badge>
      {post.status === 'uploading' || post.status === 'rendering' ? (
        <UploadProgress post={post} />
      ) : null}
      {post.status === 'needs_approval' ? (
        <Button
          size="sm"
          variant="outline"
          className="flex h-7"
          disabled={approving}
          onClick={onApprove}
        >
          <Check aria-hidden /> Approve
        </Button>
      ) : null}
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
  const [newTimeFor, setNewTimeFor] = useState<PostListItem | null>(null)
  const [swapFor, setSwapFor] = useState<PostListItem | null>(null)
  const [confirmKeepPrivate, setConfirmKeepPrivate] = useState<PostListItem | null>(null)
  const [confirmYouTubeDelete, setConfirmYouTubeDelete] = useState<PostListItem | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState<'cancel' | 'deleteDraft' | null>(null)
  const clearSelection = (): void => setSelected(new Set())

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
  const approve = useApprovePost()
  const rules = useRules()
  const approveAll = useAutopostAction(
    (id: number) => invoke('autopost:approveAll', { id }),
    (r) => `Approved ${r.approved} autopost${r.approved === 1 ? '' : 's'}`
  )
  const waiting = (rules.data ?? []).filter((r) => r.pendingApproval > 0)
  const retry = useRetryPost()
  const decide = useDecide()
  const reschedule = useReschedule()
  const keepPrivate = useKeepPrivate()
  const deleteFromYouTube = useDeleteFromYouTube()
  const syncStatus = useSyncStatus()
  const bulk = useBulkPostAction()

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

  // Only rows still in the table count (a post can leave the filter after an action).
  const selectedRows = rows.filter((p) => selected.has(p.id))
  const allSelected = rows.length > 0 && selectedRows.length === rows.length
  const eligible = (action: BulkPostAction): string[] =>
    selectedRows.filter(BULK_ELIGIBLE[action]).map((p) => p.id)
  const runBulk = (action: BulkPostAction): void =>
    bulk.mutate({ action, ids: eligible(action) }, { onSuccess: clearSelection })
  const toggle = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
        <Select
          value={accountFilter}
          onValueChange={(v) => {
            setAccountFilter(v)
            clearSelection()
          }}
        >
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
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as StatusFilter)
            clearSelection()
          }}
        >
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
          onValueChange={(v) => {
            setSourceFilter(v as typeof sourceFilter)
            clearSelection()
          }}
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => syncStatus.mutate()}
          disabled={syncStatus.isPending}
          title="Ask YouTube for the latest status of uploaded videos"
        >
          <RefreshCw className={cn(syncStatus.isPending && 'animate-spin')} aria-hidden />
          Check status
        </Button>
      </div>

      {waiting.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <CheckCheck className="size-4 text-amber-300" aria-hidden />
          <span className="mr-auto">
            {waiting.reduce((n, r) => n + r.pendingApproval, 0)} autoposts are waiting for your
            approval.
          </span>
          {waiting.map((r) => (
            <Button
              key={r.id}
              size="sm"
              variant="outline"
              disabled={approveAll.isPending}
              onClick={() => approveAll.mutate(r.id)}
            >
              Approve all from “{r.input.name}” ({r.pendingApproval})
            </Button>
          ))}
        </div>
      ) : null}

      {/* Selection bar */}
      {selectedRows.length > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow">
          <span className="font-medium">{selectedRows.length} selected</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((p) => p.id)))}
          >
            <CheckSquare aria-hidden />
            {allSelected ? 'Select none' : `Select all ${rows.length}`}
          </Button>
          {(
            [
              ['approve', 'Approve', Check],
              ['uploadNow', 'Upload now', CloudUpload],
              ['retry', 'Retry', RotateCcw]
            ] as const
          ).map(([action, label, Icon]) =>
            eligible(action).length > 0 ? (
              <Button
                key={action}
                size="sm"
                variant="ghost"
                disabled={bulk.isPending}
                onClick={() => runBulk(action)}
              >
                <Icon aria-hidden /> {label} ({eligible(action).length})
              </Button>
            ) : null
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={bulk.isPending}
            onClick={() => runBulk('duplicate')}
          >
            <Copy aria-hidden /> Duplicate
          </Button>
          {eligible('cancel').length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={bulk.isPending}
              onClick={() => setConfirmBulk('cancel')}
            >
              <CalendarX aria-hidden /> Unschedule ({eligible('cancel').length})…
            </Button>
          ) : null}
          {eligible('deleteDraft').length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={bulk.isPending}
              onClick={() => setConfirmBulk('deleteDraft')}
            >
              <Trash2 aria-hidden /> Delete drafts ({eligible('deleteDraft').length})…
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto"
            aria-label="Clear selection"
            onClick={clearSelection}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-10 py-2 pr-0 pl-3" aria-label="Select" />
              <th className="hidden w-[6.5rem] px-3 py-2 font-medium xl:table-cell" />
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="hidden w-44 px-3 py-2 font-medium lg:table-cell">Channel</th>
              <th className="hidden w-10 px-3 py-2 font-medium lg:table-cell" aria-label="Source" />
              <th className="w-44 px-3 py-2 font-medium">
                <button
                  type="button"
                  className="flex items-center gap-1 whitespace-nowrap hover:text-foreground"
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
              <th className="w-40 px-3 py-2 font-medium">Status</th>
              <th className="w-14 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((post) => {
              const editable = EDITABLE.includes(post.status) && !post.youtubeVideoId
              const isSelected = selected.has(post.id)
              return (
                <tr
                  key={post.id}
                  className={cn(
                    'group cursor-default border-t hover:bg-muted/30',
                    isSelected && 'bg-primary/5 hover:bg-primary/10'
                  )}
                  onDoubleClick={() => editable && openEditPost(post.id)}
                >
                  <td className="py-2 pr-0 pl-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`Select ${post.title || 'post'}`}
                      onClick={() => toggle(post.id)}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className={cn(
                        'flex size-5 items-center justify-center rounded border transition-opacity',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/50',
                        !isSelected &&
                          selectedRows.length === 0 &&
                          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                      )}
                    >
                      {isSelected ? <Check className="size-3.5" aria-hidden /> : null}
                    </button>
                  </td>
                  <td className="hidden px-3 py-2 xl:table-cell">
                    <Preview post={post} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="truncate font-medium">
                      {post.title || <span className="text-muted-foreground">Untitled</span>}
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="size-2 shrink-0 rounded-full lg:hidden"
                        style={{ backgroundColor: post.channelColor }}
                        title={post.channelTitle}
                        aria-label={post.channelTitle}
                      />
                      {post.durationSec ? formatDuration(post.durationSec) : null}
                      {post.isShort ? (
                        <Badge className="h-4 bg-red-600 px-1 text-[10px] text-white">Short</Badge>
                      ) : null}
                      {post.fileMissing ? (
                        <span className="text-destructive">File missing</span>
                      ) : null}
                      {post.needsRender ? (
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          Vertical render
                        </Badge>
                      ) : null}
                      {post.ruleName ? (
                        <span className="truncate" title="Made by this autopost rule">
                          · {post.ruleName}
                        </span>
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
                  <td className="hidden px-3 py-2 lg:table-cell">
                    <span className="flex min-w-0 items-center gap-2" title={post.channelTitle}>
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: post.channelColor }}
                        aria-hidden
                      />
                      <span className="truncate">{post.channelTitle}</span>
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground lg:table-cell">
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
                    <StatusCell
                      post={post}
                      approving={approve.isPending}
                      onApprove={() => approve.mutate(post.id)}
                    />
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
                        {post.status === 'needs_approval' ? (
                          <DropdownMenuItem onSelect={() => approve.mutate(post.id)}>
                            <Check aria-hidden /> Approve
                          </DropdownMenuItem>
                        ) : null}
                        {post.ruleId && !post.youtubeVideoId && SWAPPABLE.includes(post.status) ? (
                          <DropdownMenuItem onSelect={() => setSwapFor(post)}>
                            <Shuffle aria-hidden /> Swap clip…
                          </DropdownMenuItem>
                        ) : null}
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
                        {post.status === 'needs_decision' ? (
                          <>
                            <DropdownMenuItem
                              onSelect={() => decide.mutate({ id: post.id, action: 'publish_now' })}
                            >
                              <Send aria-hidden /> Upload and publish now
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setNewTimeFor(post)}>
                              <CalendarClock aria-hidden /> Pick a new time…
                            </DropdownMenuItem>
                          </>
                        ) : null}
                        {post.youtubeVideoId &&
                        (post.status === 'processing' || post.status === 'scheduled') ? (
                          <>
                            {post.visibilityMode === 'schedule' ? (
                              <DropdownMenuItem onSelect={() => setNewTimeFor(post)}>
                                <CalendarClock aria-hidden /> Change publish time…
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem onSelect={() => setConfirmKeepPrivate(post)}>
                              <EyeOff aria-hidden /> Keep as private…
                            </DropdownMenuItem>
                          </>
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
                        {(accounts.data ?? []).length > 1 ? (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <Copy aria-hidden /> Duplicate to…
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {(accounts.data ?? [])
                                .filter((a) => a.id !== post.accountId)
                                .map((a) => (
                                  <DropdownMenuItem
                                    key={a.id}
                                    onSelect={() =>
                                      duplicate.mutate({ id: post.id, accountId: a.id })
                                    }
                                  >
                                    <span
                                      className="size-2 rounded-full"
                                      style={{ background: a.color }}
                                      aria-hidden
                                    />
                                    {a.channelTitle}
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ) : null}
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
                        {post.youtubeVideoId &&
                        !['canceled', 'uploading', 'rendering'].includes(post.status) ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setConfirmYouTubeDelete(post)}
                          >
                            <Trash2 aria-hidden /> Delete from YouTube…
                          </DropdownMenuItem>
                        ) : null}
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
              variant="destructive"
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
              variant="destructive"
              onClick={() => confirmCancel && cancel.mutate(confirmCancel.id)}
            >
              Unschedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmBulk !== null}
        onOpenChange={(open) => !open && setConfirmBulk(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmBulk === 'deleteDraft'
                ? `Delete ${eligible('deleteDraft').length} draft${eligible('deleteDraft').length === 1 ? '' : 's'}?`
                : `Unschedule ${eligible('cancel').length} post${eligible('cancel').length === 1 ? '' : 's'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmBulk === 'deleteDraft'
                ? 'The selected drafts will be deleted. Your video files stay where they are. Other selected posts are left alone.'
                : 'None of these have been uploaded, so they will simply be canceled. Nothing changes on YouTube, and Twitch clips go back to the bank. Selected posts that are already on YouTube or can’t be unscheduled are left alone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => confirmBulk && runBulk(confirmBulk)}
            >
              {confirmBulk === 'deleteDraft' ? 'Delete drafts' : 'Unschedule'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {swapFor ? <SwapClipDialog post={swapFor} onClose={() => setSwapFor(null)} /> : null}

      {newTimeFor ? (
        <PublishTimeDialog
          title={
            newTimeFor.status === 'needs_decision'
              ? 'Pick a new publish time'
              : 'Change publish time'
          }
          description={
            newTimeFor.youtubeVideoId
              ? `“${newTimeFor.title}” is already on YouTube. The new time is saved there too.`
              : `“${newTimeFor.title}” will upload ahead of the new time and go public then.`
          }
          initial={newTimeFor.publishAtUtc}
          confirmLabel={newTimeFor.youtubeVideoId ? 'Update on YouTube' : 'Save new time'}
          busy={reschedule.isPending || decide.isPending}
          onClose={() => setNewTimeFor(null)}
          onConfirm={(publishAtUtc) => {
            const target = newTimeFor
            const done = { onSuccess: () => setNewTimeFor(null) }
            if (target.status === 'needs_decision') {
              decide.mutate({ id: target.id, action: 'reschedule', publishAtUtc }, done)
            } else {
              reschedule.mutate({ id: target.id, publishAtUtc }, done)
            }
          }}
        />
      ) : null}

      <AlertDialog
        open={confirmKeepPrivate !== null}
        onOpenChange={(open) => !open && setConfirmKeepPrivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep this video private?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmKeepPrivate?.title || 'Untitled'}” stays on YouTube as private and won’t go
              public. Its schedule is removed. You can change it later in YouTube Studio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Never mind</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmKeepPrivate && keepPrivate.mutate(confirmKeepPrivate.id)}
            >
              Keep private
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmYouTubeDelete !== null}
        onOpenChange={(open) => !open && setConfirmYouTubeDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this video from YouTube?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmYouTubeDelete?.title || 'Untitled'}” will be permanently deleted from
              YouTube, including its views and comments. This can’t be undone. Your local video file
              is not touched, and a Twitch clip goes back to the bank.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                confirmYouTubeDelete && deleteFromYouTube.mutate(confirmYouTubeDelete.id)
              }
            >
              Delete from YouTube
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
