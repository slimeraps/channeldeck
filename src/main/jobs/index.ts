import { powerMonitor, powerSaveBlocker } from 'electron'
import { emitToRenderer } from '../appWindow'
import { getRepos } from '../db'
import { logger } from '../logger'
import { notify } from '../notify'
import { createPowerGuard } from '../power'
import { renderVertical } from '../media/ffmpeg'
import { probeVideo } from '../media/ffprobe'
import { getAutopost, getTwitchAccounts, getYouTubeAccounts, setSyncingProbe } from '../services'
import { createClipDownloadJob } from './clipDownload'
import { createClipSyncJob } from './clipSync'
import { createPlannerJob } from './planner'
import { createJobRunner, type JobRunner } from './runner'
import { createStatusSyncJob, type StatusSyncJob, type SyncSummary } from './statusSync'
import { createUploadJob, type UploadJob } from './upload'

let runner: JobRunner | null = null
let uploadJob: UploadJob | null = null
let statusSync: StatusSyncJob | null = null

/** Starts the job runner: ticks every 30 s, now, and whenever the Mac wakes up. */
export function startJobs(): void {
  if (runner) return
  const repos = getRepos()
  const accounts = getYouTubeAccounts()

  runner = createJobRunner({ power: createPowerGuard(powerSaveBlocker), logger })

  uploadJob = createUploadJob({
    repos,
    withApi: (accountId, fn) => accounts.withApi(accountId, fn),
    notify,
    emitChanged: () => emitToRenderer('posts:changed', undefined),
    emitProgress: (postId, sentBytes, totalBytes) =>
      emitToRenderer('posts:progress', { postId, sentBytes, totalBytes }),
    logger,
    // Autoposts without a portrait file: convert to 1080×1920 before uploading.
    renderVideo: async (post, signal) => {
      const spec = post.renderJson
      if (!spec || !post.filePath) throw new Error('Nothing to render')
      const source = await probeVideo(spec.sourcePath)
      await renderVertical({ spec, video: source, output: post.filePath, signal })
      return probeVideo(post.filePath)
    }
  })
  // A quit mid-upload leaves posts "uploading": put them back so they restart cleanly.
  uploadJob.recoverInterrupted()
  runner.register(uploadJob)

  // Processing → Scheduled → Published, plus rejected/failed/deleted videos.
  statusSync = createStatusSyncJob({
    repos,
    withApi: (accountId, fn) => accounts.withApi(accountId, fn),
    notify,
    emitChanged: () => emitToRenderer('posts:changed', undefined),
    logger
  })
  runner.register(statusSync)

  // Twitch clip bank: backfill + daily sync, then downloads.
  const twitch = getTwitchAccounts()
  const clipSync = createClipSyncJob({
    repos,
    helixFor: (id, signal) => twitch.helixFor(id, signal),
    forceSync: twitch.forceSync,
    notify,
    emitChanged: () => emitToRenderer('twitch:changed', undefined),
    logger
  })
  setSyncingProbe((id) => clipSync.syncingNow().has(id))
  // Autoposting: fills each rule's empty slots with clips from the bank.
  runner.register(createPlannerJob({ autopost: getAutopost() }))
  runner.register(clipSync)
  runner.register(
    createClipDownloadJob({
      repos,
      helixFor: (id, signal) => twitch.helixFor(id, signal),
      verifyVideo: probeVideo,
      emitChanged: () => emitToRenderer('twitch:changed', undefined),
      logger
    })
  )
  // A clip left "downloading" by a quit goes back to the queue.
  for (const account of repos.twitchAccounts.list()) {
    for (const clip of repos.clips.search({
      twitchAccountId: account.id,
      sort: 'oldest',
      includeHidden: true,
      limit: 100_000,
      offset: 0
    }).items) {
      if (clip.downloadStatus === 'downloading')
        repos.clips.setDownload(clip.id, { downloadStatus: 'pending' })
    }
  }

  powerMonitor.on('resume', () => {
    logger.info('[jobs] Mac woke up; checking for work')
    runner?.kick()
  })

  runner.start()
  logger.info('[jobs] runner started')
}

export function kickJobs(): void {
  runner?.kick()
}

export async function syncStatusNow(): Promise<SyncSummary> {
  if (!statusSync) throw new Error('Jobs not started')
  return statusSync.syncNow()
}

export function uploadsPausedUntil(): Date | null {
  return uploadJob?.pausedUntil() ?? null
}

export async function stopJobs(): Promise<void> {
  await runner?.stop()
  runner = null
}
