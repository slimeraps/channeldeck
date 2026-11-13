import { stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { isThumbnailPath, isVideoPath, THUMBNAIL_MAX_BYTES } from '@shared/constants/limits'
import type { PostStatus } from '@shared/constants/enums'
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
import { type Clock, systemClock } from '../db/repos/common'
import type { Repos } from '../db/repos'
import type { PostRow, PostFields } from '../db/repos/posts'
import { UserFacingError } from '../errors'
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
  clock?: Clock
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
    const fileExists = post.filePath ? existsSync(post.filePath) : false
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
      fileMissing: Boolean(post.filePath) && !fileExists && !post.youtubeVideoId,
      videoPreviewUrl: post.filePath && fileExists ? mediaUrl(post.filePath) : null,
      thumbnailPreviewUrl:
        post.thumbnailPath && existsSync(post.thumbnailPath) ? mediaUrl(post.thumbnailPath) : null,
      youtubeVideoId: post.youtubeVideoId,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt
    }
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
      missedPolicy: post.missedPolicy
    }
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
      filePath: clean.filePath,
      fileSize: probe?.sizeBytes ?? null,
      fileMtime: probe?.mtimeMs ?? null,
      durationSec: probe?.durationSec ?? null,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
      isShort: probe?.isShort ?? false,
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
      uploadAfterUtc: mode === 'queue' ? uploadAfter(clean, now) : null
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
      let mediaInfo: MediaInfo | null = null
      if (post.filePath && existsSync(post.filePath)) {
        try {
          mediaInfo = toMediaInfo(await deps.probe(post.filePath))
        } catch {
          mediaInfo = null
        }
      }
      let thumbnail: ThumbnailInfo | null = null
      if (post.thumbnailPath) {
        thumbnail = await inspectThumbnail(post.thumbnailPath).catch(() => null)
      }
      return {
        id: post.id,
        status: post.status,
        source: post.source,
        input: toInput(post),
        media: mediaInfo,
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
      const fields = await buildFields(input, mode)
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
      if (post.filePath) media.grant(post.filePath)
      if (post.thumbnailPath) media.grant(post.thumbnailPath)
      deps.emitChanged()
      if (post.status === 'queued') deps.kickJobs?.()
      return toListItem(post, accountLookup())
    },

    duplicate(id: string): PostListItem {
      const source = repos.posts.require(id)
      const copy = repos.posts.create({
        ...toInput(source),
        accountId: source.accountId,
        tagsJson: source.tagsJson,
        fileSize: source.fileSize,
        fileMtime: source.fileMtime,
        durationSec: source.durationSec,
        width: source.width,
        height: source.height,
        isShort: source.isShort,
        // A copy is always a fresh manual draft: no clip link (never-twice) and no YouTube id.
        source: 'manual',
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
      deps.emitChanged()
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

    deleteDraft(id: string): void {
      repos.posts.deleteDraft(id)
      deps.emitChanged()
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
