import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import {
  isThumbnailPath,
  isVideoPath,
  SHORT_MAX_SECONDS,
  THUMBNAIL_MAX_BYTES
} from '@shared/constants/limits'
import type { LayoutKind, PostStatus } from '@shared/constants/enums'
import type { RenderSpecJson } from '@shared/types/json'
import { accountDefaultsSchema } from '@shared/schemas/account'
import {
  hasErrors,
  type MediaInfo,
  normalizeTags,
  type PostDetail,
  type PostInput,
  type PostListItem,
  type SaveMode,
  type ThumbnailInfo,
  validatePost
} from '@shared/schemas/post'
import {
  finalizeDescription,
  finalizeTitle,
  hasPostVariables,
  postDateLabel,
  renderPostVariables
} from '@shared/templates'
import { type Clock, systemClock } from '../db/repos/common'
import type { Repos } from '../db/repos'
import type { PostRow, PostFields } from '../db/repos/posts'
import { renderFileName } from '../domain/render'
import { buildStatusUpdate, type StatusChange } from '../domain/statusSync'
import { UserFacingError } from '../errors'
import { classifyGoogleError } from '../google/errors'
import type { YouTubeApi } from '../google/youtube'
import type { MediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { mediaUrl } from '../media/mediaUrl'

/**
 * The post editor and queue table's view of posts. Validates with the same rules the
 * editor uses, probes the video for its facts, and moves status only through
 * postsRepo.transition().
 */

export interface PostsServiceDeps {
  repos: Repos
  probe: (path: string) => Promise<ProbeResult>
  media: MediaAccess
  emitChanged: () => void
  /** Ask the job runner to look for work now (after queueing or Upload now). */
  kickJobs?: () => void
  /** YouTube calls for a channel (real or Dry Run). Needed for actions on uploaded videos. */
  withApi?: <T>(accountId: number, fn: (api: YouTubeApi) => Promise<T>) => Promise<T>
  clock?: Clock
  /** IANA zone for {{date}} (default: the Mac's). */
  zone?: string
  /** ffmpeg vertical conversion (media/ffmpeg renderVertical), for "Render now". */
  renderVertical?: (args: {
    spec: RenderSpecJson
    video: { width: number; height: number; durationSec: number }
    output: string
  }) => Promise<void>
}

/** Statuses the editor may change. Later phases widen this (failed, needs_decision...). */
const EDITABLE: PostStatus[] = ['draft', 'needs_approval', 'queued']
/** Statuses where Unschedule cancels without touching YouTube. */
const CANCELABLE_BEFORE_UPLOAD: PostStatus[] = [
  'needs_approval',
  'queued',
  'waiting_quota',
  'needs_decision',
  'failed'
]

export type PostsService = ReturnType<typeof createPostsService>

export function createPostsService(deps: PostsServiceDeps) {
  const { repos, media } = deps
  const clock = deps.clock ?? systemClock
  const zone = deps.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  function toMediaInfo(probe: ProbeResult): MediaInfo {
    media.grant(probe.path)
    return { ...probe, previewUrl: mediaUrl(probe.path) }
  }

  async function inspectVideo(path: string): Promise<MediaInfo> {
    if (!isAbsolute(path)) throw new UserFacingError('That file path is not valid.')
    if (!isVideoPath(path)) {
      throw new UserFacingError(
        `${basename(path)} isn't a video file ChannelDeck recognizes (mp4, mov, m4v, webm, mkv…).`
      )
    }
    return toMediaInfo(await deps.probe(path))
  }

  async function inspectThumbnail(path: string): Promise<ThumbnailInfo> {
    if (!isAbsolute(path)) throw new UserFacingError('That file path is not valid.')
    if (!isThumbnailPath(path)) throw new UserFacingError('Thumbnails must be JPG or PNG.')
    let size: number
    try {
      const info = await stat(path)
      if (!info.isFile()) throw new Error('not a file')
      size = info.size
    } catch {
      throw new UserFacingError(`File missing: ${path}`)
    }
    if (size > THUMBNAIL_MAX_BYTES) {
      throw new UserFacingError(
        `${basename(path)} is ${(size / 1024 / 1024).toFixed(1)} MB. YouTube thumbnails must be 2 MB or smaller.`
      )
    }
    media.grant(path)
    return { path, fileName: basename(path), sizeBytes: size, previewUrl: mediaUrl(path) }
  }

  function toListItem(
    post: PostRow,
    accounts: Map<number, { title: string; color: string }>
  ): PostListItem {
    const account = accounts.get(post.accountId)
    // An autopost waiting for its vertical render has no file yet: check its source instead.
    const rendered = post.filePath ? existsSync(post.filePath) : false
    const previewPath = !rendered && post.renderJson ? post.renderJson.sourcePath : post.filePath
    const fileExists = rendered || (previewPath ? existsSync(previewPath) : false)
    return {
      id: post.id,
      accountId: post.accountId,
      channelTitle: account?.title ?? 'Removed channel',
      channelColor: account?.color ?? '#71717a',
      source: post.source,
      status: post.status,
      visibilityMode: post.visibilityMode,
      title: post.title,
      publishAtUtc: post.publishAtUtc,
      uploadAfterUtc: post.uploadAfterUtc,
      isShort: post.isShort,
      durationSec: post.durationSec,
      uploadProgress: post.uploadProgress,
      lastError: post.lastError,
      retryAfterUtc: post.retryAfterUtc,
      fileMissing: Boolean(previewPath) && !fileExists && !post.youtubeVideoId,
      videoPreviewUrl: previewPath && fileExists ? mediaUrl(previewPath) : null,
      thumbnailPreviewUrl:
        post.thumbnailPath && existsSync(post.thumbnailPath) ? mediaUrl(post.thumbnailPath) : null,
      youtubeVideoId: post.youtubeVideoId,
      ruleId: post.ruleId,
      ruleName: post.ruleId ? (repos.autopostRules.get(post.ruleId)?.name ?? null) : null,
      needsRender: Boolean(post.renderJson) && !rendered,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt
    }
  }

  /** An autopost you unscheduled or deleted: its rule won't pick that clip again. */
  function rememberSkipped(post: PostRow): void {
    if (post.ruleId && post.clipId) repos.autopostRules.addSkipped(post.ruleId, post.clipId)
  }

  function accountLookup(): Map<number, { title: string; color: string }> {
    return new Map(
      repos.accounts
        .list({ includeRemoved: true })
        .map((a) => [a.id, { title: a.channelTitle, color: a.color }])
    )
  }

  function toInput(post: PostRow): PostInput {
    return {
      accountId: post.accountId,
      filePath: post.filePath,
      title: post.title,
      description: post.description,
      tags: post.tagsJson,
      categoryId: post.categoryId,
      playlistId: post.playlistId,
      thumbnailPath: post.thumbnailPath,
      madeForKids: post.madeForKids,
      notifySubscribers: post.notifySubscribers,
      license: post.license,
      embeddable: post.embeddable,
      defaultLanguage: post.defaultLanguage,
      defaultAudioLanguage: post.defaultAudioLanguage,
      syntheticMedia: post.syntheticMedia,
      visibilityMode: post.visibilityMode,
      publishAtUtc: post.publishAtUtc,
      missedPolicy: post.missedPolicy,
      templateId: post.templateId,
      seriesId: post.seriesId,
      // A vertical render is edited as its horizontal source plus the layout.
      ...(post.renderJson
        ? {
            filePath: post.renderJson.sourcePath,
            render: { kind: post.renderJson.kind, presetId: post.renderJson.presetId }
          }
        : { render: null })
    }
  }

  /**
   * Going into the queue: take the series number (once; a post keeps it if it goes back to
   * drafts and is queued again) and fill in {{n}}, {{date}} and {{channel}}.
   */
  function fillVariables(post: PostRow): PostRow {
    const text = `${post.title}\n${post.description}`
    const needsNumber = post.seriesId !== null && post.seriesNumber === null
    if (!needsNumber && !hasPostVariables(text)) return post
    const number = needsNumber
      ? repos.series.takeNextNumber(post.seriesId as number)
      : post.seriesNumber
    const account = repos.accounts.get(post.accountId)
    const values = {
      ...(number !== null ? { n: String(number) } : {}),
      date: postDateLabel(new Date(post.publishAtUtc ?? clock().toISOString()), zone),
      channel: account?.channelTitle ?? ''
    }
    return repos.posts.update(post.id, {
      seriesNumber: number,
      title: finalizeTitle(renderPostVariables(post.title, values)),
      description: finalizeDescription(renderPostVariables(post.description, values))
    })
  }

  /** When the upload may start: lead time before a scheduled publish, otherwise right away. */
  function uploadAfter(input: PostInput, now: Date): string {
    if (input.visibilityMode === 'schedule' && input.publishAtUtc) {
      const leadMs = repos.settings.getKey('uploadLeadHours') * 3600_000
      const at = Math.max(now.getTime(), Date.parse(input.publishAtUtc) - leadMs)
      return new Date(at).toISOString()
    }
    return now.toISOString()
  }

  /** What a vertical render of `sourcePath` with this layout would be (path and spec). */
  function planRender(
    sourcePath: string,
    choice: { kind: LayoutKind; presetId: number | null }
  ): { outputPath: string; spec: RenderSpecJson } {
    const preset = choice.presetId ? repos.layoutPresets.get(choice.presetId) : undefined
    const kind = preset?.kind ?? choice.kind
    const crops = preset?.cropsJson ?? {}
    const outputPath = join(
      repos.settings.getKey('clipsRoot'),
      '_renders',
      renderFileName(sourcePath, kind, crops)
    )
    return { outputPath, spec: { sourcePath, kind, crops, presetId: preset?.id ?? null } }
  }

  async function buildFields(input: PostInput, mode: SaveMode): Promise<PostFields> {
    const now = clock()
    const tags = normalizeTags(input.tags)
    const clean: PostInput = {
      ...input,
      title: input.title.trim(),
      tags,
      publishAtUtc: input.visibilityMode === 'schedule' ? input.publishAtUtc : null
    }

    let probe: ProbeResult | null = null
    if (clean.filePath) {
      if (!isVideoPath(clean.filePath)) throw new UserFacingError('That file is not a video.')
      try {
        probe = await deps.probe(clean.filePath)
      } catch (error) {
        // A draft may point at a file that's gone; a queued post may not.
        if (mode === 'queue') throw error
      }
    }

    // Vertical render: filePath is the horizontal source; the post uploads the render.
    let file: Pick<
      PostFields,
      'filePath' | 'fileSize' | 'fileMtime' | 'durationSec' | 'width' | 'height' | 'isShort'
    > & { renderJson: RenderSpecJson | null } = {
      filePath: clean.filePath,
      fileSize: probe?.sizeBytes ?? null,
      fileMtime: probe?.mtimeMs ?? null,
      durationSec: probe?.durationSec ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      isShort: probe?.isShort ?? false,
      renderJson: null
    }
    if (clean.render && clean.filePath) {
      const { outputPath, spec } = planRender(clean.filePath, clean.render)
      // Already rendered (Render now)? Use its real details; otherwise it renders at upload.
      const rendered = existsSync(outputPath)
        ? await deps.probe(outputPath).catch(() => null)
        : null
      const durationSec = rendered?.durationSec ?? probe?.durationSec ?? null
      file = {
        filePath: outputPath,
        fileSize: rendered?.sizeBytes ?? null,
        fileMtime: rendered?.mtimeMs ?? null,
        durationSec,
        width: 1080,
        height: 1920,
        isShort: durationSec === null || durationSec <= SHORT_MAX_SECONDS,
        renderJson: spec
      }
    }
    if (clean.thumbnailPath) await inspectThumbnail(clean.thumbnailPath)

    const issues = validatePost(clean, { mode, now, durationSec: probe?.durationSec ?? null })
    if (hasErrors(issues)) {
      throw new UserFacingError(
        issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
          .join(' ')
      )
    }

    if (clean.accountId === null) throw new UserFacingError('Pick a channel.')
    const account = repos.accounts.get(clean.accountId)
    if (!account || account.removedAt)
      throw new UserFacingError('That channel is no longer connected.')

    return {
      accountId: clean.accountId,
      ...file,
      title: clean.title,
      description: clean.description,
      tagsJson: tags,
      categoryId: clean.categoryId,
      playlistId: clean.playlistId,
      thumbnailPath: clean.thumbnailPath,
      madeForKids: clean.madeForKids,
      notifySubscribers: clean.notifySubscribers,
      license: clean.license,
      embeddable: clean.embeddable,
      defaultLanguage: clean.defaultLanguage?.trim() || null,
      defaultAudioLanguage: clean.defaultAudioLanguage?.trim() || null,
      syntheticMedia: clean.syntheticMedia,
      visibilityMode: clean.visibilityMode,
      publishAtUtc: clean.publishAtUtc,
      missedPolicy: clean.missedPolicy,
      templateId: clean.templateId ?? null,
      seriesId: clean.seriesId ?? null,
      uploadAfterUtc: mode === 'queue' ? uploadAfter(clean, now) : null
    }
  }

  function requireFuture(publishAtUtc: string, now: Date): void {
    const at = Date.parse(publishAtUtc)
    if (Number.isNaN(at)) throw new UserFacingError('That publish time is not valid.')
    if (at <= now.getTime() + 60_000)
      throw new UserFacingError('Pick a publish time at least a minute in the future.')
  }

  function requireApi(): NonNullable<PostsServiceDeps['withApi']> {
    if (!deps.withApi) throw new Error('YouTube access is not wired into the posts service')
    return deps.withApi
  }

  /** Reads the current status part, changes only what's needed, and sends the whole part back. */
  async function changeStatusOnYouTube(post: PostRow, change: StatusChange): Promise<void> {
    const videoId = post.youtubeVideoId as string
    if (videoId.startsWith('DRYRUN-')) return
    try {
      await requireApi()(post.accountId, async (api) => {
        const current = await api.videoStatusPart(videoId)
        if (!current) throw new UserFacingError('This video no longer exists on YouTube.')
        if (current['privacyStatus'] !== 'private') {
          throw new UserFacingError(
            'This video is already public on YouTube, so it can no longer be rescheduled or kept private.'
          )
        }
        await api.updateVideoStatus(videoId, buildStatusUpdate(current, change))
      })
    } catch (error) {
      if ((error as { userFacing?: boolean }).userFacing) throw error
      throw new UserFacingError(classifyGoogleError(error).message, { cause: error })
    }
  }

  const service = {
    inspectVideo,
    inspectThumbnail,

    list(
      filter: { accountId?: number; statuses?: PostStatus[]; source?: PostRow['source'] } = {}
    ): PostListItem[] {
      const accounts = accountLookup()
      return repos.posts.list(filter).map((p) => toListItem(p, accounts))
    },

    async get(id: string): Promise<PostDetail> {
      const post = repos.posts.require(id)
      const probeIfThere = async (path: string | null): Promise<MediaInfo | null> => {
        if (!path || !existsSync(path)) return null
        try {
          return toMediaInfo(await deps.probe(path))
        } catch {
          return null
        }
      }
      const input = toInput(post)
      const mediaInfo = await probeIfThere(input.filePath)
      const rendered = post.renderJson ? await probeIfThere(post.filePath) : null
      const clipRow = post.clipId ? repos.clips.get(post.clipId) : undefined
      const onDisk = (p: string | null): string | null => (p && existsSync(p) ? p : null)
      const clip = clipRow
        ? {
            twitchAccountId: clipRow.twitchAccountId,
            landscapePath: onDisk(clipRow.landscapePath),
            portraitPath: onDisk(clipRow.portraitPath)
          }
        : null
      if (clip?.landscapePath) media.grant(clip.landscapePath)
      if (clip?.portraitPath) media.grant(clip.portraitPath)
      let thumbnail: ThumbnailInfo | null = null
      if (post.thumbnailPath) {
        thumbnail = await inspectThumbnail(post.thumbnailPath).catch(() => null)
      }
      return {
        id: post.id,
        status: post.status,
        source: post.source,
        input,
        media: mediaInfo,
        rendered,
        clip,
        thumbnail,
        editable: EDITABLE.includes(post.status) && !post.youtubeVideoId
      }
    },

    async save({
      id,
      input,
      mode
    }: {
      id?: string
      input: PostInput
      mode: SaveMode
    }): Promise<PostListItem> {
      const before = id ? repos.posts.require(id) : undefined
      const fields = {
        ...(await buildFields(input, mode)),
        // A different series means a different number.
        ...(before && before.seriesId !== (input.seriesId ?? null) ? { seriesNumber: null } : {})
      }
      let post: PostRow
      if (!id) {
        post = repos.posts.create({
          ...fields,
          source: 'manual',
          status: mode === 'queue' ? 'queued' : 'draft'
        })
      } else {
        const existing = repos.posts.require(id)
        if (!EDITABLE.includes(existing.status) || existing.youtubeVideoId) {
          throw new UserFacingError(
            `This post is ${existing.status.replace('_', ' ')} and can't be edited right now.`
          )
        }
        // A status change carries the new fields in the same transaction, so a failed
        // transition can't leave the edited fields saved under the old status.
        if (mode === 'draft' && existing.status !== 'draft') {
          post = repos.posts.transition(id, 'to_draft', {
            patch: fields,
            reason: 'saved as draft'
          })
        } else if (mode === 'queue' && existing.status === 'draft') {
          post = repos.posts.transition(id, 'enqueue', { patch: fields })
        } else {
          post = repos.posts.update(id, fields)
        }
      }
      if (post.status === 'queued') post = fillVariables(post)
      if (post.filePath) media.grant(post.filePath)
      if (post.thumbnailPath) media.grant(post.thumbnailPath)
      deps.emitChanged()
      if (post.status === 'queued') deps.kickJobs?.()
      return toListItem(post, accountLookup())
    },

    /**
     * A draft copy, on the same channel or another one. On the same channel it's a plain
     * manual post (no clip link, which never-twice would refuse). On another channel a
     * Twitch clip keeps its link, so never-twice still protects that channel.
     */
    duplicate(id: string, accountId?: number): PostListItem {
      const source = repos.posts.require(id)
      const target = accountId ?? source.accountId
      const otherChannel = target !== source.accountId
      let channelDefaults: { playlistId?: string | undefined } = {}
      if (otherChannel) {
        const account = repos.accounts.get(target)
        if (!account || account.removedAt) throw new UserFacingError('Pick a connected channel.')
        const parsed = accountDefaultsSchema.safeParse(account.defaultsJson)
        if (parsed.success) channelDefaults = parsed.data
      }
      const series = source.seriesId ? repos.series.get(source.seriesId) : undefined
      const keepSeries = series && (series.accountId === null || series.accountId === target)
      const keepClip = otherChannel && source.clipId !== null
      const copy = repos.posts.create({
        ...toInput(source),
        accountId: target,
        tagsJson: source.tagsJson,
        fileSize: source.fileSize,
        fileMtime: source.fileMtime,
        durationSec: source.durationSec,
        width: source.width,
        height: source.height,
        isShort: source.isShort,
        // Not rendered yet? The copy renders the same way when it's uploaded.
        renderJson: source.renderJson,
        // Playlists belong to a channel.
        playlistId: otherChannel ? (channelDefaults.playlistId ?? null) : source.playlistId,
        seriesId: keepSeries ? source.seriesId : null,
        source: keepClip ? 'twitch_clip' : 'manual',
        clipId: keepClip ? source.clipId : null,
        status: 'draft'
      })
      deps.emitChanged()
      return toListItem(copy, accountLookup())
    },

    cancel(id: string): PostListItem {
      const post = repos.posts.require(id)
      if (post.status === 'draft')
        throw new UserFacingError("Drafts aren't scheduled. Delete the draft instead.")
      if (post.youtubeVideoId) {
        throw new UserFacingError(
          'This video is already on YouTube. Keep-as-private and delete arrive in Phase 5.'
        )
      }
      if (!CANCELABLE_BEFORE_UPLOAD.includes(post.status)) {
        throw new UserFacingError(`This post is ${post.status} and can't be unscheduled right now.`)
      }
      const updated = repos.posts.transition(id, 'cancel', { reason: 'unscheduled' })
      rememberSkipped(post)
      deps.emitChanged()
      return toListItem(updated, accountLookup())
    },

    /** Review mode: an autopost you've checked goes into the upload queue. */
    approve(id: string): PostListItem {
      const post = repos.posts.require(id)
      if (post.status !== 'needs_approval') {
        throw new UserFacingError(`This post is ${post.status}, not waiting for approval.`)
      }
      if (post.publishAtUtc && post.publishAtUtc <= clock().toISOString()) {
        throw new UserFacingError(
          'Its publish time has already passed. Change the time first, or unschedule it.'
        )
      }
      const updated = repos.posts.transition(id, 'approve', { reason: 'approved' })
      deps.emitChanged()
      deps.kickJobs?.()
      return toListItem(updated, accountLookup())
    },

    /** Upload a queued post right away instead of waiting for its lead time. */
    uploadNow(id: string): PostListItem {
      const post = repos.posts.require(id)
      if (post.status !== 'queued') {
        throw new UserFacingError(
          post.status === 'waiting_quota'
            ? "Today's YouTube quota is used up. This post will upload after midnight Pacific."
            : `Only queued posts can be uploaded now; this one is ${post.status.replace('_', ' ')}.`
        )
      }
      const account = repos.accounts.get(post.accountId)
      if (!account || account.removedAt || !account.enabled || account.tokenStatus !== 'ok') {
        throw new UserFacingError(
          account?.tokenStatus === 'needs_reauth'
            ? `${account.channelTitle} needs you to sign in again before it can upload.`
            : 'Uploads for this channel are switched off on the Channels page.'
        )
      }
      const updated = repos.posts.update(id, {
        uploadAfterUtc: clock().toISOString(),
        retryAfterUtc: null
      })
      deps.emitChanged()
      deps.kickJobs?.()
      return toListItem(updated, accountLookup())
    },

    /** Try a failed post again; a post already on YouTube only redoes its unfinished steps. */
    retry(id: string): PostListItem {
      const post = repos.posts.require(id)
      if (post.status !== 'failed' && post.status !== 'waiting_quota') {
        throw new UserFacingError(
          `Only failed posts can be retried; this one is ${post.status.replace('_', ' ')}.`
        )
      }
      repos.postSteps.resetUnfinished(id)
      const updated = repos.posts.transition(id, 'retry', {
        patch: { lastError: null, retryAfterUtc: null, uploadAfterUtc: clock().toISOString() },
        reason: 'retried by you'
      })
      deps.emitChanged()
      deps.kickJobs?.()
      return toListItem(updated, accountLookup())
    },

    /** "Needs decision": the publish time passed before the upload. Publish now or pick a new time. */
    decide(
      id: string,
      choice: { action: 'publish_now' } | { action: 'reschedule'; publishAtUtc: string }
    ): PostListItem {
      const post = repos.posts.require(id)
      if (post.status !== 'needs_decision') {
        throw new UserFacingError('This post is not waiting for a decision.')
      }
      const now = clock()
      if (choice.action === 'publish_now') {
        repos.posts.update(id, {
          visibilityMode: 'public',
          publishAtUtc: null,
          uploadAfterUtc: now.toISOString()
        })
      } else {
        requireFuture(choice.publishAtUtc, now)
        repos.posts.update(id, {
          visibilityMode: 'schedule',
          publishAtUtc: choice.publishAtUtc,
          uploadAfterUtc: uploadAfter(
            { ...toInput(post), visibilityMode: 'schedule', publishAtUtc: choice.publishAtUtc },
            now
          )
        })
      }
      const updated = repos.posts.transition(id, 'resolve_decision', {
        reason: choice.action === 'publish_now' ? 'you chose publish now' : 'you picked a new time'
      })
      deps.emitChanged()
      deps.kickJobs?.()
      return toListItem(updated, accountLookup())
    },

    /** New publish time. Before upload: just saved. After upload: updated on YouTube too. */
    async reschedule(id: string, publishAtUtc: string): Promise<PostListItem> {
      const post = repos.posts.require(id)
      const now = clock()
      requireFuture(publishAtUtc, now)

      if (!post.youtubeVideoId) {
        if (
          !['draft', 'needs_approval', 'queued', 'failed', 'waiting_quota'].includes(post.status)
        ) {
          throw new UserFacingError(
            `This post is ${post.status.replace('_', ' ')} and can't be rescheduled right now.`
          )
        }
        const next = { ...toInput(post), visibilityMode: 'schedule' as const, publishAtUtc }
        const updated = repos.posts.update(id, {
          visibilityMode: 'schedule',
          publishAtUtc,
          ...(post.status === 'draft' ? {} : { uploadAfterUtc: uploadAfter(next, now) })
        })
        deps.emitChanged()
        return toListItem(updated, accountLookup())
      }

      if (post.status === 'published') {
        throw new UserFacingError(
          'This video is already live, so its publish time can no longer change.'
        )
      }
      if (post.status !== 'processing' && post.status !== 'scheduled') {
        throw new UserFacingError(
          `This post is ${post.status.replace('_', ' ')} and can't be rescheduled right now.`
        )
      }
      await changeStatusOnYouTube(post, { kind: 'reschedule', publishAtUtc })
      const updated = repos.posts.update(id, { visibilityMode: 'schedule', publishAtUtc })
      repos.eventLog.write({
        kind: 'post.rescheduled',
        message: `Publish time changed to ${publishAtUtc}`,
        postId: id
      })
      deps.emitChanged()
      return toListItem(updated, accountLookup())
    },

    /** Uploaded but not yet public: clear the schedule and leave it private on YouTube. */
    async keepPrivate(id: string): Promise<PostListItem> {
      const post = repos.posts.require(id)
      if (!post.youtubeVideoId || (post.status !== 'processing' && post.status !== 'scheduled')) {
        throw new UserFacingError(
          'Only uploaded videos that are not public yet can be kept private.'
        )
      }
      await changeStatusOnYouTube(post, { kind: 'keepPrivate' })
      const updated = repos.posts.transition(id, 'keep_private', {
        patch: { visibilityMode: 'private', publishAtUtc: null },
        reason: 'you chose keep as private'
      })
      deps.emitChanged()
      return toListItem(updated, accountLookup())
    },

    /** videos.delete, then the post is canceled (a Twitch clip goes back to the bank). */
    async deleteFromYouTube(id: string): Promise<PostListItem> {
      const post = repos.posts.require(id)
      if (!post.youtubeVideoId) throw new UserFacingError('This post has no video on YouTube.')
      if (
        post.status === 'canceled' ||
        post.status === 'uploading' ||
        post.status === 'rendering'
      ) {
        throw new UserFacingError(
          `This post is ${post.status} and can't be deleted from YouTube right now.`
        )
      }
      const videoId = post.youtubeVideoId
      if (!videoId.startsWith('DRYRUN-')) {
        try {
          await requireApi()(post.accountId, (api) => api.deleteVideo(videoId))
        } catch (error) {
          const c = classifyGoogleError((error as { cause?: unknown }).cause ?? error)
          const notFound = (error as { response?: { status?: number } }).response?.status === 404
          if (!notFound) throw new UserFacingError(c.message, { cause: error })
        }
      }
      const updated = repos.posts.transition(id, 'delete_from_youtube', {
        reason: 'you deleted it from YouTube'
      })
      rememberSkipped(post)
      deps.emitChanged()
      return toListItem(updated, accountLookup())
    },

    deleteDraft(id: string): void {
      repos.posts.deleteDraft(id)
      deps.emitChanged()
    },

    /**
     * "Render now": converts the source to vertical with the layout, into the same file the
     * upload would make (so the upload reuses it). Returns the rendered video's details.
     */
    async renderVertical(
      sourcePath: string,
      choice: { kind: LayoutKind; presetId: number | null }
    ): Promise<MediaInfo> {
      if (!isAbsolute(sourcePath) || !isVideoPath(sourcePath) || !existsSync(sourcePath)) {
        throw new UserFacingError('Pick a video first.')
      }
      if (!deps.renderVertical) throw new UserFacingError('Vertical rendering is not available.')
      const { outputPath, spec } = planRender(sourcePath, choice)
      if (!existsSync(outputPath)) {
        const source = await deps.probe(sourcePath)
        await deps.renderVertical({ spec, video: source, output: outputPath })
      }
      return toMediaInfo(await deps.probe(outputPath))
    },

    filePathFor(id: string): string {
      const post = repos.posts.require(id)
      if (!post.filePath) throw new UserFacingError('This post has no video file yet.')
      if (!existsSync(post.filePath)) throw new UserFacingError(`File missing: ${post.filePath}`)
      return post.filePath
    }
  }
  return service
}
