import { powerMonitor, powerSaveBlocker } from 'electron'
import { emitToRenderer } from '../appWindow'
import { getRepos } from '../db'
import { logger } from '../logger'
import { notify } from '../notify'
import { createPowerGuard } from '../power'
import { getYouTubeAccounts } from '../services'
import { createJobRunner, type JobRunner } from './runner'
import { createUploadJob, type UploadJob } from './upload'

let runner: JobRunner | null = null
let uploadJob: UploadJob | null = null

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
    logger
  })
  // A quit mid-upload leaves posts "uploading": put them back so they restart cleanly.
  uploadJob.recoverInterrupted()
  runner.register(uploadJob)

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

export function uploadsPausedUntil(): Date | null {
  return uploadJob?.pausedUntil() ?? null
}

export async function stopJobs(): Promise<void> {
  await runner?.stop()
  runner = null
}
