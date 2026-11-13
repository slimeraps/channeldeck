import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { PostStepName } from '@shared/constants/enums'
import type { Repos } from '../db/repos'
import type { PostRow } from '../db/repos/posts'
import { nextQuotaReset } from '../domain/quota'
import { AUDIT_LOCK_MESSAGE, buildVideoResource, looksLockedPrivate } from '../domain/videoResource'
import { classifyGoogleError, type ClassifiedError } from '../google/errors'
import type { YouTubeApi } from '../google/youtube'
import { contentTypeFor } from '../media/mediaUrl'
import { type BackoffOptions, DEFAULT_BACKOFF, withRetry } from './retry'
import type { JobType } from './runner'

/**
 * Uploads queued posts. Each post runs as steps (render → insert → thumbnail → playlist),
 * each tracked in post_steps and retried on its own. Render only exists for autoposts that
 * need a vertical conversion. The YouTube video
 * id is saved the moment videos.insert succeeds, and a post that has one is never inserted
 * again. Status changes only through postsRepo.transition().
 */

export interface UploadJobDeps {
  repos: Repos
  /** Runs a YouTube call for a channel (real or Dry Run), handling expired sign-ins. */
  withApi: <T>(accountId: number, fn: (api: YouTubeApi) => Promise<T>) => Promise<T>
  notify: (title: string, body: string) => void
  emitChanged: () => void
  emitProgress: (postId: string, sentBytes: number, totalBytes: number) => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: () => Date
  backoff?: BackoffOptions
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Converts post.renderJson's source to post.filePath and reports the result. */
  renderVideo?: (post: PostRow, signal: AbortSignal) => Promise<RenderedFile>
}

export interface RenderedFile {
  sizeBytes: number
  mtimeMs: number
  durationSec: number
  width: number
  height: number
  isShort: boolean
}

export interface UploadJob extends JobType<string> {
  /** After a crash/quit: put half-done posts back so they restart cleanly. Returns how many. */
  recoverInterrupted(): number
  /** Until when uploads are paused because the daily quota ran out (null = not paused). */
  pausedUntil(): Date | null
}

const PROGRESS_DB_MS = 1000
const PROGRESS_EVENT_MS = 200

class FileProblem extends Error {}
class RenderProblem extends Error {}

export function createUploadJob(deps: UploadJobDeps): UploadJob {
  const { repos, logger } = deps
  const clock = deps.clock ?? (() => new Date())
  let quotaPausedUntil: Date | null = null

  // Uploads already parked for quota keep the whole queue paused until the reset.
  for (const post of repos.posts.list({ statuses: ['waiting_quota'] })) {
    if (post.retryAfterUtc) {
      const at = new Date(post.retryAfterUtc)
      if (!quotaPausedUntil || at > quotaPausedUntil) quotaPausedUntil = at
    }
  }

  function accountReady(accountId: number): boolean {
    const account = repos.accounts.get(accountId)
    return Boolean(account && !account.removedAt && account.enabled && account.tokenStatus === 'ok')
  }

  function stepsFor(post: PostRow): PostStepName[] {
    const steps: PostStepName[] = post.renderJson ? ['render', 'insert'] : ['insert']
    if (post.thumbnailPath) steps.push('thumbnail')
    if (post.playlistId) steps.push('playlist')
    return steps
  }

  function unfinishedSteps(post: PostRow): boolean {
    return repos.postSteps
      .list(post.id)
      .some((s) => s.status === 'pending' || s.status === 'running')
  }

  async function preflight(post: PostRow): Promise<void> {
    if (!post.filePath) throw new FileProblem('This post has no video file.')
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(post.filePath)
    } catch {
      throw new FileProblem(`File missing: ${post.filePath}`)
    }
    if (post.fileSize !== null && info.size !== post.fileSize) {
      throw new FileProblem(
        `File missing: ${post.filePath} changed size since it was queued (${post.fileSize} → ${info.size} bytes). Open the post and add the video again.`
      )
    }
  }

  /** An autopost whose vertical file doesn't exist yet (or was deleted since). */
  function needsRender(post: PostRow): boolean {
    return Boolean(post.renderJson) && !post.youtubeVideoId && !existsSync(post.filePath ?? '')
  }

  async function render(post: PostRow, signal: AbortSignal): Promise<PostRow> {
    if (!deps.renderVideo) throw new RenderProblem('Vertical rendering is not available.')
    const source = post.renderJson?.sourcePath
    if (!source || !existsSync(source)) {
      throw new FileProblem(`File missing: ${source ?? 'the clip file'} (needed for the render)`)
    }
    let out: RenderedFile
    try {
      out = await deps.renderVideo(post, signal)
    } catch (error) {
      if (signal.aborted) throw error
      throw new RenderProblem(error instanceof Error ? error.message : String(error), {
        cause: error
      })
    }
    return repos.posts.update(post.id, {
      fileSize: out.sizeBytes,
      fileMtime: out.mtimeMs,
      durationSec: out.durationSec,
      width: out.width,
      height: out.height,
      isShort: out.isShort
    })
  }

  async function runSteps(initial: PostRow, signal: AbortSignal): Promise<PostRow> {
    let post = initial
    // Retrying a post that's already on YouTube: no insert, go straight to the other steps.
    if (post.status === 'uploading' && post.youtubeVideoId) {
      post = repos.posts.transition(post.id, 'upload_complete', { reason: 'already on YouTube' })
    }
    const steps = repos.postSteps.ensure(post.id, stepsFor(post))
    const account = repos.accounts.require(post.accountId)

    for (const step of steps) {
      if (step.status === 'done' || step.status === 'skipped') continue
      if (signal.aborted) throw signal.reason ?? new Error('aborted')
      repos.postSteps.set(post.id, step.step, 'running')

      try {
        if (step.step === 'render') {
          if (needsRender(post)) post = await render(post, signal)
        } else if (step.step === 'insert') {
          if (!post.youtubeVideoId) {
            await preflight(post)
            const resource = buildVideoResource({ ...post, tags: post.tagsJson })
            let lastDb = 0
            let lastEvent = 0
            const video = await deps.withApi(post.accountId, (api) =>
              api.uploadVideo({
                resource,
                notifySubscribers: post.notifySubscribers,
                filePath: post.filePath as string,
                sizeBytes: post.fileSize ?? 0,
                contentType: contentTypeFor(post.filePath as string),
                signal,
                onProgress: (sent, total) => {
                  const now = Date.now()
                  if (now - lastEvent >= PROGRESS_EVENT_MS || sent === total) {
                    lastEvent = now
                    deps.emitProgress(post.id, sent, total)
                  }
                  if (now - lastDb >= PROGRESS_DB_MS) {
                    lastDb = now
                    repos.posts.update(post.id, { uploadProgress: total > 0 ? sent / total : 0 })
                  }
                },
                onRetry: (message, attempt, delay) =>
                  logger.warn(`[upload] ${post.id}: retry ${attempt} in ${delay} ms (${message})`)
              })
            )
            // Save the video id first, so this post can never be inserted twice.
            post = repos.posts.transition(post.id, 'upload_complete', {
              patch: { youtubeVideoId: video.id, uploadProgress: 1, lastError: null },
              reason: `video ${video.id}`
            })
            if (looksLockedPrivate(post.visibilityMode, video.status?.privacyStatus)) {
              post = repos.posts.update(post.id, { lastError: AUDIT_LOCK_MESSAGE })
              repos.eventLog.write({
                kind: 'post.audit_lock',
                level: 'warn',
                message: AUDIT_LOCK_MESSAGE,
                postId: post.id
              })
              deps.notify(
                'Uploaded as private',
                `"${post.title}" was locked private by YouTube. See the queue for why.`
              )
            }
          } else if (post.status === 'uploading') {
            // Resuming a post that's already on YouTube: no second insert.
            post = repos.posts.transition(post.id, 'upload_complete', {
              reason: 'already on YouTube'
            })
          }
        } else if (step.step === 'thumbnail' && post.thumbnailPath && post.youtubeVideoId) {
          const videoId = post.youtubeVideoId
          const thumb = post.thumbnailPath
          await withRetry(
            () =>
              deps.withApi(post.accountId, (api) =>
                api.setThumbnail(videoId, thumb, contentTypeFor(thumb))
              ),
            retryHooks(signal),
            deps.backoff ?? DEFAULT_BACKOFF
          )
        } else if (step.step === 'playlist' && post.playlistId && post.youtubeVideoId) {
          const videoId = post.youtubeVideoId
          const playlistId = post.playlistId
          await withRetry(
            () => deps.withApi(post.accountId, (api) => api.addToPlaylist(playlistId, videoId)),
            retryHooks(signal),
            deps.backoff ?? DEFAULT_BACKOFF
          )
        }
        repos.postSteps.set(post.id, step.step, 'done', null)
        if (step.step === 'render' && post.status === 'rendering') {
          post = repos.posts.transition(post.id, 'start_upload', { reason: 'render done' })
          deps.emitChanged()
        }
      } catch (error) {
        const classified = classify(error)
        // A thumbnail YouTube refuses (unverified channel) shouldn't fail an uploaded video.
        if (step.step === 'thumbnail' && classified.kind === 'fatal') {
          repos.postSteps.set(post.id, 'thumbnail', 'skipped', classified.message)
          post = repos.posts.update(post.id, {
            lastError: `Thumbnail not set: ${classified.message}`
          })
          deps.notify('Thumbnail not set', `${account.channelTitle}: ${classified.message}`)
          continue
        }
        repos.postSteps.set(post.id, step.step, 'failed', classified.message)
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          classified,
          step: step.step
        })
      }
    }
    return post
  }

  function retryHooks(signal: AbortSignal) {
    return {
      shouldRetry: (error: unknown) => {
        const c = classifyGoogleError(error)
        return { retry: c.kind === 'retryable', afterMs: c.retryAfterMs }
      },
      signal,
      ...(deps.sleep ? { sleep: deps.sleep } : {})
    }
  }

  function classify(error: unknown): ClassifiedError {
    const attached = (error as { classified?: ClassifiedError }).classified
    if (attached) return attached
    if (error instanceof FileProblem)
      return { kind: 'fatal', reason: 'fileMissing', message: error.message, retryAfterMs: null }
    if (error instanceof RenderProblem)
      return {
        kind: 'fatal',
        reason: 'render',
        message: `Vertical render failed: ${error.message}`,
        retryAfterMs: null
      }
    // withApi turns invalid_grant into a user-facing error but keeps the original as cause.
    const cause = (error as { cause?: unknown }).cause
    const c = classifyGoogleError(cause ?? error)
    if (c.kind === 'auth' || (error as { userFacing?: boolean }).userFacing) {
      return c.kind === 'auth'
        ? c
        : { ...c, kind: c.kind === 'fatal' ? 'fatal' : c.kind, message: (error as Error).message }
    }
    return c
  }

  function handleFailure(postId: string, error: unknown, signal: AbortSignal): void {
    const post = repos.posts.get(postId)
    if (!post) return
    const account = repos.accounts.get(post.accountId)

    if (signal.aborted) {
      // App quitting: restart cleanly next launch.
      if (post.status === 'uploading' || post.status === 'rendering') {
        repos.posts.transition(post.id, 'interrupted', { reason: 'app quit during upload' })
      }
      repos.postSteps.resetUnfinished(post.id)
      return
    }

    const c = classify(error)
    if (c.kind === 'quota') {
      const retryAt = nextQuotaReset(clock())
      quotaPausedUntil = retryAt
      repos.posts.transition(post.id, 'quota_exhausted', {
        patch: { retryAfterUtc: retryAt.toISOString(), lastError: c.message },
        reason: c.reason ?? 'quota'
      })
      repos.postSteps.resetUnfinished(post.id)
      deps.notify('Uploads paused until midnight Pacific', c.message)
    } else if (c.kind === 'auth' || (account && account.tokenStatus === 'needs_reauth')) {
      // The channel is paused (needs re-auth). Put the post back; it resumes after Reconnect.
      if (post.status === 'uploading') {
        repos.posts.transition(post.id, 'interrupted', {
          patch: { lastError: c.message },
          reason: 'sign-in expired'
        })
      } else {
        repos.posts.transition(post.id, 'fail', {
          patch: { lastError: c.message },
          reason: 'sign-in expired'
        })
      }
      repos.postSteps.resetUnfinished(post.id)
    } else {
      repos.posts.transition(post.id, 'fail', {
        patch: { lastError: c.message },
        reason: c.reason ?? 'error'
      })
      deps.notify('Upload failed', `"${post.title || 'Untitled'}": ${c.message}`)
    }
    logger.warn(`[upload] ${post.id} stopped: ${c.kind} ${c.reason ?? ''} ${c.message}`)
  }

  return {
    name: 'upload',

    concurrency: () => repos.settings.getKey('uploadConcurrency'),

    findWork(now) {
      if (quotaPausedUntil && now < quotaPausedUntil) return []
      quotaPausedUntil = null
      const iso = now.toISOString()
      return repos.posts
        .list({ statuses: ['queued', 'waiting_quota', 'processing'] })
        .filter((p) => {
          if (!accountReady(p.accountId)) return false
          if (p.status === 'processing') return unfinishedSteps(p)
          if (p.retryAfterUtc && p.retryAfterUtc > iso) return false
          if (p.status === 'waiting_quota') return p.retryAfterUtc !== null
          return (p.uploadAfterUtc ?? p.createdAt) <= iso
        })
        .sort((a, b) =>
          (a.publishAtUtc ?? a.uploadAfterUtc ?? a.createdAt).localeCompare(
            b.publishAtUtc ?? b.uploadAfterUtc ?? b.createdAt
          )
        )
        .map((p) => p.id)
    },

    key: (postId) => postId,

    async run(postId, signal) {
      let post = repos.posts.get(postId)
      if (!post || !accountReady(post.accountId)) return
      const now = clock()
      // Another upload just ran out of quota: don't start this one until the reset.
      if (quotaPausedUntil && now < quotaPausedUntil && post.status !== 'processing') return

      if (post.status === 'waiting_quota') {
        post = repos.posts.transition(post.id, 'retry', {
          patch: { retryAfterUtc: null, lastError: null },
          reason: 'quota reset'
        })
      }

      if (post.status === 'queued') {
        // Publish time already passed and nothing is on YouTube yet: follow the post's policy.
        if (
          post.visibilityMode === 'schedule' &&
          !post.youtubeVideoId &&
          post.publishAtUtc &&
          post.publishAtUtc <= now.toISOString()
        ) {
          if (post.missedPolicy === 'ask') {
            repos.posts.transition(post.id, 'publish_time_missed', {
              reason: 'publish time passed before upload'
            })
            deps.notify(
              'Publish time passed',
              `"${post.title}" wasn't uploaded in time. Open the queue to decide what to do.`
            )
            deps.emitChanged()
            return
          }
          post = repos.posts.update(post.id, { visibilityMode: 'public', publishAtUtc: null })
          repos.eventLog.write({
            kind: 'post.missed',
            message: 'Publish time passed; publishing now instead',
            postId: post.id
          })
        }
        const rendering = needsRender(post)
        if (rendering) {
          // The vertical file is missing (first run, or deleted since): render it again.
          repos.postSteps.ensure(post.id, stepsFor(post))
          repos.postSteps.set(post.id, 'render', 'pending', null)
        }
        post = repos.posts.transition(post.id, rendering ? 'start_render' : 'start_upload', {
          patch: { attempts: post.attempts + 1, lastError: null, uploadProgress: 0 }
        })
        deps.emitChanged()
      } else if (post.status !== 'processing') {
        return
      }

      try {
        post = await runSteps(post, signal)
        repos.eventLog.write({
          kind: 'post.uploaded',
          message: `Uploaded as ${post.youtubeVideoId ?? '?'}`,
          postId: post.id,
          accountId: post.accountId
        })
        const account = repos.accounts.get(post.accountId)
        const when =
          post.visibilityMode === 'schedule' && post.publishAtUtc
            ? `Goes public ${new Date(post.publishAtUtc).toLocaleString()}.`
            : `Visibility: ${post.visibilityMode}.`
        const dry = post.youtubeVideoId?.startsWith('DRYRUN-') ? ' (Dry Run)' : ''
        deps.notify(`Uploaded${dry}: ${post.title}`, `${account?.channelTitle ?? ''}. ${when}`)
      } catch (error) {
        handleFailure(postId, error, signal)
      } finally {
        deps.emitChanged()
      }
    },

    recoverInterrupted() {
      let count = 0
      for (const post of repos.posts.list({ statuses: ['uploading', 'rendering'] })) {
        repos.posts.transition(post.id, 'interrupted', {
          reason: 'ChannelDeck closed during the upload'
        })
        repos.postSteps.resetUnfinished(post.id)
        count += 1
      }
      for (const post of repos.posts.list({ statuses: ['processing'] })) {
        repos.postSteps.resetUnfinished(post.id)
      }
      if (count > 0) logger.info(`[upload] put ${count} interrupted upload(s) back in the queue`)
      return count
    },

    pausedUntil: () => quotaPausedUntil
  }
}
