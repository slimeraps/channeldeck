import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Clapperboard, Copy, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DESCRIPTION_MAX_BYTES, TITLE_MAX_CHARS } from '@shared/constants/limits'
import type { VisibilityMode } from '@shared/constants/enums'
import { defaultPublishAt } from '@shared/lib/time'
import type { AccountView } from '@shared/schemas/account'
import {
  descriptionBytes,
  hasErrors,
  type MediaInfo,
  type PostDetail,
  type PostInput,
  type PostIssue,
  type SaveMode,
  type ThumbnailInfo,
  titleLength,
  validatePost
} from '@shared/schemas/post'
import type { ClipView } from '@shared/schemas/twitch'
import { MediaPanel } from '@renderer/components/post-editor/MediaPanel'
import { PublishTimeField } from '@renderer/components/post-editor/PublishTimeField'
import { TagInput } from '@renderer/components/post-editor/TagInput'
import { ClipLibraryDialog } from '@renderer/components/post-editor/ClipLibraryDialog'
import { FormatPicker } from '@renderer/components/post-editor/FormatPicker'
import { TemplatePicker } from '@renderer/components/post-editor/TemplatePicker'
import { ThumbnailPicker } from '@renderer/components/post-editor/ThumbnailPicker'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import { accountsKey, useAccounts } from '@renderer/hooks/useAccounts'
import { postsKey, useDuplicatePost, usePostDetail } from '@renderer/hooks/usePosts'
import { invoke } from '@renderer/lib/ipc'
import { STATUS_LABELS, VISIBILITY_LABELS } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/stores/ui'

const NONE = '__none__'

function emptyInput(): PostInput {
  return {
    accountId: null,
    filePath: null,
    title: '',
    description: '',
    tags: [],
    categoryId: null,
    playlistId: null,
    thumbnailPath: null,
    madeForKids: null,
    notifySubscribers: true,
    license: 'youtube',
    embeddable: true,
    defaultLanguage: null,
    defaultAudioLanguage: null,
    syntheticMedia: false,
    visibilityMode: 'schedule',
    publishAtUtc: defaultPublishAt(),
    missedPolicy: 'ask'
  }
}

/** Sets the video and, if the title is still empty, starts it from the file name. */
function withVideo(input: PostInput, info: MediaInfo): PostInput {
  return {
    ...input,
    filePath: info.path,
    title:
      input.title ||
      info.fileName
        .replace(/\.[^.]+$/, '')
        .replace(/[<>]/g, '')
        .slice(0, TITLE_MAX_CHARS)
  }
}

/** A banked Twitch clip as the video: links it (never-twice) and starts title and credit. */
function withClip(input: PostInput, clip: ClipView, info: MediaInfo): PostInput {
  const credit = [clip.creatorName ? `Clipped by ${clip.creatorName}` : null, clip.url]
    .filter(Boolean)
    .join('\n')
  // Replace text that came from the file name or a previously picked clip; keep your own.
  const fromBefore = !input.title || Boolean(input.clipId)
  return {
    ...input,
    filePath: info.path,
    clipId: clip.id,
    render: null,
    title: fromBefore ? clip.title.replace(/[<>]/g, '').slice(0, TITLE_MAX_CHARS) : input.title,
    description: !input.description || input.clipId ? credit : input.description
  }
}

function clipFilesOf(clip: ClipView): NonNullable<PostDetail['clip']> {
  return {
    twitchAccountId: clip.twitchAccountId,
    landscapePath: clip.landscapePath,
    portraitPath: clip.portraitPath
  }
}

/** Channel defaults fill only the fields you haven't touched yet. */
function applyDefaults(
  input: PostInput,
  account: AccountView,
  touched: Set<keyof PostInput>
): PostInput {
  const d = account.defaults
  const next: PostInput = { ...input, accountId: account.id }
  const fill = <K extends keyof PostInput>(key: K, value: PostInput[K] | undefined): void => {
    if (!touched.has(key) && value !== undefined) next[key] = value
  }
  fill('categoryId', d.categoryId ?? null)
  fill('playlistId', d.playlistId ?? null)
  fill('tags', d.tags ?? [])
  fill('madeForKids', d.madeForKids ?? null)
  fill('license', d.license ?? 'youtube')
  fill('defaultLanguage', d.defaultLanguage ?? null)
  fill('defaultAudioLanguage', d.defaultAudioLanguage ?? null)
  if (!touched.has('description') && d.descriptionFooter && !input.description.trim()) {
    next.description = d.descriptionFooter
  }
  return next
}

function Field({
  label,
  htmlFor,
  error,
  warning,
  aside,
  children
}: {
  label: string
  htmlFor?: string
  error?: string | undefined
  warning?: string | undefined
  aside?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={htmlFor}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!error && warning ? <p className="text-xs text-amber-300">{warning}</p> : null}
    </div>
  )
}

function Counter({
  used,
  max,
  unit
}: {
  used: number
  max: number
  unit?: string
}): React.JSX.Element {
  return (
    <span
      className={cn('text-xs text-muted-foreground tabular-nums', used > max && 'text-destructive')}
    >
      {used}/{max}
      {unit ? ` ${unit}` : ''}
    </span>
  )
}

// ---------------------------------------------------------------------------------------------

interface FormProps {
  detail: PostDetail | null
  /** Connected channels (already loaded). */
  usable: AccountView[]
  /** A video dropped on the window before the editor opened, already inspected. */
  initialMedia: MediaInfo | null
  initialMediaError: string | null
  /** A clip picked on the Clips page ("Post…"), with initialMedia = its file. */
  initialClip: ClipView | null
  /** A publish time picked in the calendar. */
  initialPublishAtUtc: string | null
  onClose: () => void
}

function initialInput(
  detail: PostDetail | null,
  usable: AccountView[],
  initialMedia: MediaInfo | null,
  initialPublishAtUtc: string | null,
  initialClip: ClipView | null
): PostInput {
  if (detail) return detail.input
  let input = emptyInput()
  if (initialPublishAtUtc) {
    input = { ...input, visibilityMode: 'schedule', publishAtUtc: initialPublishAtUtc }
  }
  const first = usable.find((a) => a.enabled && a.tokenStatus === 'ok') ?? usable[0]
  if (first) input = applyDefaults(input, first, new Set())
  if (initialMedia) {
    input = initialClip
      ? withClip(input, initialClip, initialMedia)
      : withVideo(input, initialMedia)
  }
  return input
}

function PostEditorForm({
  detail,
  usable,
  initialMedia,
  initialMediaError,
  initialPublishAtUtc,
  initialClip,
  onClose
}: FormProps): React.JSX.Element {
  const qc = useQueryClient()
  const duplicate = useDuplicatePost()
  const openEditPost = useUiStore((s) => s.openEditPost)

  const [input, setInput] = useState<PostInput>(() =>
    initialInput(detail, usable, initialMedia, initialPublishAtUtc, initialClip)
  )
  const [media, setMedia] = useState<MediaInfo | null>(detail?.media ?? initialMedia)
  /** The linked Twitch clip's files (for the Format switch); null for your own videos. */
  const [clipFiles, setClipFiles] = useState<PostDetail['clip']>(
    detail?.clip ?? (initialClip ? clipFilesOf(initialClip) : null)
  )
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [thumbnail, setThumbnail] = useState<ThumbnailInfo | null>(detail?.thumbnail ?? null)
  const [touched, setTouched] = useState<Set<keyof PostInput>>(
    () => new Set(detail ? (Object.keys(detail.input) as (keyof PostInput)[]) : [])
  )
  const [attempted, setAttempted] = useState(false)
  const [mediaBusy, setMediaBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const isNew = detail === null
  const readOnly = detail !== null && !detail.editable
  const missingPath = input.filePath && !media ? input.filePath : null

  const set = <K extends keyof PostInput>(key: K, value: PostInput[K]): void => {
    setInput((prev) => ({ ...prev, [key]: value }))
    setTouched((prev) => new Set(prev).add(key))
  }

  const accountId = input.accountId
  const categories = useQuery({
    queryKey: ['youtube', 'categories'],
    queryFn: () => invoke('youtube:categories', { accountId: accountId as number }),
    enabled: accountId !== null,
    staleTime: Infinity
  })
  const playlists = useQuery({
    queryKey: ['youtube', 'playlists', accountId],
    queryFn: () => invoke('youtube:playlists', { accountId: accountId as number }),
    enabled: accountId !== null,
    staleTime: 5 * 60_000
  })

  /** @param keepClip switching between the linked clip's own files (Format switch). */
  async function loadVideo(
    fetcher: () => Promise<MediaInfo | null>,
    keepClip = false
  ): Promise<void> {
    setMediaBusy(true)
    try {
      const info = await fetcher()
      if (!info) return
      setMedia(info)
      // A different video starts without a vertical render; the Format switch sets one.
      setInput((prev) => ({
        ...withVideo(prev, info),
        render: null,
        ...(keepClip ? {} : { clipId: null })
      }))
      if (!keepClip) setClipFiles(null)
      setTouched((prev) => new Set(prev).add('filePath'))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setMediaBusy(false)
    }
  }

  async function loadThumbnail(fetcher: () => Promise<ThumbnailInfo | null>): Promise<void> {
    try {
      const info = await fetcher()
      if (!info) return
      setThumbnail(info)
      set('thumbnailPath', info.path)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const issues = validatePost(input, {
    mode: 'queue',
    now: new Date(),
    durationSec: media?.durationSec ?? null
  })
  const show = (field: PostIssue['field']): boolean =>
    attempted || touched.has(field as keyof PostInput)
  const errorFor = (field: PostIssue['field']): string | undefined =>
    show(field)
      ? issues.find((i) => i.field === field && i.severity === 'error')?.message
      : undefined
  const warningFor = (field: PostIssue['field']): string | undefined =>
    issues.find((i) => i.field === field && i.severity === 'warning')?.message

  const save = useMutation({
    mutationFn: (mode: SaveMode) =>
      invoke('posts:save', { ...(detail ? { id: detail.id } : {}), input, mode }),
    onSuccess: (post, mode) => {
      void qc.invalidateQueries({ queryKey: postsKey })
      void qc.invalidateQueries({ queryKey: accountsKey })
      toast.success(mode === 'queue' ? `"${post.title}" is in the queue` : 'Draft saved')
      onClose()
    },
    onError: (error) => toast.error(error.message)
  })

  const submit = (mode: SaveMode): void => {
    if (mode === 'queue') {
      setAttempted(true)
      if (hasErrors(issues)) {
        toast.error('Fix the highlighted fields before adding to the queue.')
        return
      }
    } else if (hasErrors(validatePost(input, { mode: 'draft', now: new Date() }))) {
      setAttempted(true)
      toast.error('Fix the highlighted fields before saving.')
      return
    }
    save.mutate(mode)
  }

  const queueErrorCount = attempted ? issues.filter((i) => i.severity === 'error').length : 0
  const account = usable.find((a) => a.id === input.accountId)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {isNew ? 'New post' : 'Edit post'}
          {detail ? <Badge variant="outline">{STATUS_LABELS[detail.status]}</Badge> : null}
        </DialogTitle>
        <DialogDescription>
          {readOnly
            ? 'This post is already moving through the upload pipeline, so it can’t be edited here.'
            : 'Fill in the details. “Add to queue” checks everything YouTube requires.'}
        </DialogDescription>
      </DialogHeader>

      {/* A <fieldset> doesn't clip or scroll reliably, so a plain div does the scrolling. */}
      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        <fieldset
          disabled={readOnly || save.isPending}
          className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
        >
          {/* ---- left: media ---- */}
          <div className="min-w-0 space-y-5">
            <Field
              label="Video"
              error={errorFor('filePath') ?? (media ? undefined : (initialMediaError ?? undefined))}
              warning={warningFor('filePath')}
            >
              <MediaPanel
                media={media}
                missingPath={missingPath}
                busy={mediaBusy}
                invalid={Boolean(errorFor('filePath'))}
                onPick={() => void loadVideo(() => invoke('media:pickVideo'))}
                onDropPath={(path) => void loadVideo(() => invoke('media:inspectVideo', { path }))}
                onClear={() => {
                  setMedia(null)
                  setInput((prev) => ({ ...prev, filePath: null, render: null }))
                }}
              />
            </Field>
            <div className="-mt-3 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={readOnly || mediaBusy}
                onClick={() => setLibraryOpen(true)}
              >
                <Clapperboard aria-hidden /> From clip library…
              </Button>
              {input.clipId ? (
                <span className="truncate text-xs text-muted-foreground">
                  Twitch clip · won’t be posted twice to the same channel
                </span>
              ) : null}
            </div>
            {libraryOpen ? (
              <ClipLibraryDialog
                onClose={() => setLibraryOpen(false)}
                onPick={(clip) => {
                  setLibraryOpen(false)
                  const path = clip.landscapePath ?? clip.portraitPath
                  if (!path) return
                  void (async () => {
                    setMediaBusy(true)
                    try {
                      const info = await invoke('media:inspectVideo', { path })
                      setMedia(info)
                      setInput((prev) => withClip(prev, clip, info))
                      setClipFiles(clipFilesOf(clip))
                      setTouched((prev) => new Set(prev).add('filePath').add('title'))
                    } catch (error) {
                      toast.error((error as Error).message)
                    } finally {
                      setMediaBusy(false)
                    }
                  })()
                }}
              />
            ) : null}
            <FormatPicker
              input={input}
              media={media}
              clip={clipFiles}
              disabled={readOnly || mediaBusy}
              onChoose={({ filePath, render }) => {
                void (async () => {
                  if (filePath && filePath !== input.filePath) {
                    await loadVideo(() => invoke('media:inspectVideo', { path: filePath }), true)
                  }
                  setInput((prev) => ({ ...prev, render }))
                })()
              }}
            />
            <Field label="Thumbnail">
              <ThumbnailPicker
                thumbnail={thumbnail}
                onPick={() => void loadThumbnail(() => invoke('media:pickThumbnail'))}
                onDropPath={(path) =>
                  void loadThumbnail(() => invoke('media:inspectThumbnail', { path }))
                }
                onClear={() => {
                  setThumbnail(null)
                  set('thumbnailPath', null)
                }}
              />
            </Field>
          </div>

          {/* ---- right: details ---- */}
          <div className="min-w-0 space-y-4">
            <Field label="Channel" htmlFor="pe-channel" error={errorFor('accountId')}>
              <Select
                value={input.accountId?.toString() ?? ''}
                onValueChange={(v) => {
                  const chosen = usable.find((a) => a.id === Number(v))
                  if (chosen) {
                    setInput((prev) =>
                      applyDefaults(
                        prev,
                        chosen,
                        isNew ? touched : new Set(Object.keys(prev) as (keyof PostInput)[])
                      )
                    )
                    setTouched((prev) => new Set(prev).add('accountId'))
                  }
                }}
              >
                <SelectTrigger id="pe-channel" className="w-full">
                  <SelectValue
                    placeholder={
                      usable.length ? 'Choose a channel' : 'Connect a channel first (Channels page)'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {usable.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: a.color }}
                        aria-hidden
                      />
                      {a.channelTitle}
                      {a.tokenStatus === 'needs_reauth' ? ' (needs re-auth)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <TemplatePicker
              input={input}
              channelTitle={account?.channelTitle ?? ''}
              onChange={(patch) => setInput((prev) => ({ ...prev, ...patch }))}
            />

            <Field
              label="Title"
              htmlFor="pe-title"
              error={errorFor('title')}
              aside={<Counter used={titleLength(input.title)} max={TITLE_MAX_CHARS} />}
            >
              <Input
                id="pe-title"
                value={input.title}
                onChange={(e) => set('title', e.target.value)}
                aria-invalid={Boolean(errorFor('title'))}
                placeholder="e.g. MW4 Day 9"
              />
            </Field>

            <Field
              label="Description"
              htmlFor="pe-description"
              error={errorFor('description')}
              aside={
                <Counter
                  used={descriptionBytes(input.description)}
                  max={DESCRIPTION_MAX_BYTES}
                  unit="bytes"
                />
              }
            >
              <Textarea
                id="pe-description"
                rows={5}
                value={input.description}
                onChange={(e) => set('description', e.target.value)}
                aria-invalid={Boolean(errorFor('description'))}
              />
            </Field>

            <Field label="Tags" htmlFor="pe-tags" error={errorFor('tags')}>
              <TagInput
                id="pe-tags"
                value={input.tags}
                onChange={(tags) => set('tags', tags)}
                invalid={Boolean(errorFor('tags'))}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Category" htmlFor="pe-category" error={errorFor('categoryId')}>
                <Select value={input.categoryId ?? ''} onValueChange={(v) => set('categoryId', v)}>
                  <SelectTrigger
                    id="pe-category"
                    className="w-full"
                    aria-invalid={Boolean(errorFor('categoryId'))}
                  >
                    <SelectValue placeholder={categories.isLoading ? 'Loading…' : 'Choose'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Playlist"
                htmlFor="pe-playlist"
                aside={
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Refresh playlists"
                    disabled={accountId === null}
                    onClick={async () => {
                      if (accountId === null) return
                      try {
                        const fresh = await invoke('youtube:playlists', {
                          accountId,
                          refresh: true
                        })
                        qc.setQueryData(['youtube', 'playlists', accountId], fresh)
                      } catch (e) {
                        toast.error((e as Error).message)
                      }
                    }}
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                  </button>
                }
              >
                <Select
                  value={input.playlistId ?? NONE}
                  onValueChange={(v) => set('playlistId', v === NONE ? null : v)}
                >
                  <SelectTrigger id="pe-playlist" className="w-full">
                    <SelectValue placeholder={playlists.isLoading ? 'Loading…' : 'None'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {(playlists.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {categories.isError ? (
              <p className="text-xs text-destructive">{categories.error.message}</p>
            ) : null}

            <Field label="Made for kids" error={errorFor('madeForKids')}>
              <RadioGroup
                className="flex gap-5"
                value={input.madeForKids === null ? '' : input.madeForKids ? 'yes' : 'no'}
                onValueChange={(v) => set('madeForKids', v === 'yes')}
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="no" /> No, it’s not made for kids
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="yes" /> Yes, it’s made for kids
                </label>
              </RadioGroup>
            </Field>

            <Field label="Visibility" error={errorFor('publishAtUtc')}>
              <div className="grid grid-cols-4 gap-1 rounded-lg border p-1">
                {(['schedule', 'public', 'unlisted', 'private'] as VisibilityMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      set('visibilityMode', mode)
                      if (mode === 'schedule' && !input.publishAtUtc)
                        set('publishAtUtc', defaultPublishAt())
                    }}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-xs transition-colors',
                      input.visibilityMode === mode
                        ? 'bg-secondary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {VISIBILITY_LABELS[mode]}
                  </button>
                ))}
              </div>
              {input.visibilityMode === 'schedule' ? (
                <div className="space-y-3 pt-1">
                  <PublishTimeField
                    value={input.publishAtUtc}
                    onChange={(v) => set('publishAtUtc', v)}
                    invalid={Boolean(errorFor('publishAtUtc'))}
                  />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    If the publish time passes before the upload finishes:
                    <Select
                      value={input.missedPolicy}
                      onValueChange={(v) => set('missedPolicy', v as PostInput['missedPolicy'])}
                    >
                      <SelectTrigger size="sm" className="h-7 w-36 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ask">Ask me</SelectItem>
                        <SelectItem value="publish_now">Publish now</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {input.visibilityMode === 'private'
                    ? 'Uploads as private. Nobody sees it until you change it on YouTube.'
                    : `Uploads as soon as possible and goes ${input.visibilityMode} right away.`}
                </p>
              )}
            </Field>

            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <ChevronDown
                className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-180')}
                aria-hidden
              />
              More options
            </button>
            {showAdvanced ? (
              <div className="grid gap-4 rounded-lg border p-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <label className="flex items-center justify-between gap-2">
                    Notify subscribers
                    <Switch
                      checked={input.notifySubscribers}
                      onCheckedChange={(v) => set('notifySubscribers', v)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    Allow embedding
                    <Switch
                      checked={input.embeddable}
                      onCheckedChange={(v) => set('embeddable', v)}
                    />
                  </label>
                  <label className="col-span-2 flex items-center justify-between gap-2">
                    Contains altered or synthetic media
                    <Switch
                      checked={input.syntheticMedia}
                      onCheckedChange={(v) => set('syntheticMedia', v)}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="License" htmlFor="pe-license">
                    <Select
                      value={input.license}
                      onValueChange={(v) => set('license', v as PostInput['license'])}
                    >
                      <SelectTrigger id="pe-license" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="youtube">Standard YouTube</SelectItem>
                        <SelectItem value="creativeCommon">Creative Commons</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Language" htmlFor="pe-lang">
                    <Input
                      id="pe-lang"
                      placeholder="en"
                      value={input.defaultLanguage ?? ''}
                      onChange={(e) => set('defaultLanguage', e.target.value || null)}
                    />
                  </Field>
                  <Field label="Audio language" htmlFor="pe-audio">
                    <Input
                      id="pe-audio"
                      placeholder="en"
                      value={input.defaultAudioLanguage ?? ''}
                      onChange={(e) => set('defaultAudioLanguage', e.target.value || null)}
                    />
                  </Field>
                </div>
              </div>
            ) : null}
          </div>
        </fieldset>
      </div>

      <div className="flex items-center gap-3 border-t pt-4">
        <p className="flex-1 text-xs text-muted-foreground">
          {queueErrorCount > 0
            ? `${queueErrorCount} thing${queueErrorCount === 1 ? '' : 's'} to fix before this can be queued.`
            : account
              ? `Posting to ${account.channelTitle}.`
              : ''}
        </p>
        {detail && usable.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" title="Copies the saved version as a draft">
                <Copy aria-hidden /> Duplicate to…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {usable
                .filter((a) => a.id !== input.accountId)
                .map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={() =>
                      duplicate.mutate(
                        { id: detail.id, accountId: a.id },
                        { onSuccess: (copy) => openEditPost(copy.id) }
                      )
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
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {!readOnly ? (
          <>
            <Button variant="secondary" onClick={() => submit('draft')} disabled={save.isPending}>
              Save as draft
            </Button>
            <Button onClick={() => submit('queue')} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {detail?.status === 'queued' ? 'Save to queue' : 'Add to queue'}
            </Button>
          </>
        ) : null}
      </div>
    </>
  )
}

/** The post editor dialog, opened by New post, ⌘N, a dropped video, or Edit in the queue. */
export function PostEditor(): React.JSX.Element | null {
  const editor = useUiStore((s) => s.editor)
  const close = useUiStore((s) => s.closeEditor)
  const detail = usePostDetail(editor.open ? editor.postId : null)
  const accounts = useAccounts()
  const dropped = useQuery({
    queryKey: ['media', 'inspect', editor.session, editor.initialFilePath],
    queryFn: () => invoke('media:inspectVideo', { path: editor.initialFilePath as string }),
    enabled: editor.open && editor.initialFilePath !== null,
    retry: false,
    gcTime: 0
  })
  // "Post…" on the Clips page: the clip and its video file.
  const fromClip = useQuery({
    queryKey: ['clipPost', editor.session, editor.initialClipId],
    queryFn: async (): Promise<{ clip: ClipView; media: MediaInfo }> => {
      const clip = await invoke('clips:get', { id: editor.initialClipId as string })
      const path = clip.landscapePath ?? clip.portraitPath
      if (!path) throw new Error('This clip isn’t downloaded yet, so it can’t be posted.')
      return { clip, media: await invoke('media:inspectVideo', { path }) }
    },
    enabled: editor.open && editor.initialClipId !== null,
    retry: false,
    gcTime: 0
  })

  if (!editor.open) return null
  const failed = detail.isError
    ? detail.error.message
    : fromClip.isError
      ? fromClip.error.message
      : null
  const loading =
    !failed &&
    ((editor.postId !== null && !detail.data) ||
      accounts.isLoading ||
      (editor.initialFilePath !== null && dropped.isLoading) ||
      (editor.initialClipId !== null && fromClip.isLoading))

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex max-h-[92vh] flex-col gap-4 sm:max-w-5xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {loading || failed ? (
          <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
            {failed ?? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                {dropped.isLoading ? 'Reading video…' : 'Loading…'}
              </>
            )}
            <DialogTitle className="sr-only">Loading post</DialogTitle>
            <DialogDescription className="sr-only">Loading</DialogDescription>
          </div>
        ) : (
          <PostEditorForm
            key={editor.session}
            detail={detail.data ?? null}
            usable={accounts.data ?? []}
            initialMedia={dropped.data ?? fromClip.data?.media ?? null}
            initialClip={fromClip.data?.clip ?? null}
            initialMediaError={dropped.isError ? dropped.error.message : null}
            initialPublishAtUtc={editor.initialPublishAtUtc}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
