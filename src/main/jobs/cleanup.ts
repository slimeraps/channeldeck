import { rm, stat } from 'node:fs/promises'
import type { Repos } from '../db/repos'
import { filesToClean } from '../domain/cleanup'
import type { JobType } from './runner'

/**
 * "Delete local files N days after posting" (Settings). Once an hour: removes the video
 * files of clips whose posts are all published and old enough (thumbnail and .json sidecar
 * stay), and vertical renders of published posts. Clips become "Local file deleted" and are
 * never downloaded again on their own.
 */

const EVERY_MS = 60 * 60_000

export interface CleanupJob extends JobType<'cleanup'> {
  /** Runs now regardless of the hourly schedule (tests). */
  runNow(): Promise<{ clips: number; renders: number; bytes: number }>
}

export function createCleanupJob(deps: {
  repos: Repos
  emitChanged: () => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: () => Date
}): CleanupJob {
  const { repos, logger } = deps
  const clock = deps.clock ?? (() => new Date())
  let lastRun = 0

  async function remove(path: string | null): Promise<number> {
    if (!path) return 0
    try {
      const { size } = await stat(path)
      await rm(path, { force: true })
      return size
    } catch {
      return 0 // already gone
    }
  }

  async function runNow(): Promise<{ clips: number; renders: number; bytes: number }> {
    lastRun = clock().getTime()
    const days = repos.settings.getKey('deleteLocalAfterPostingDays')
    if (days === null) return { clips: 0, renders: 0, bytes: 0 }
    const clips = repos.twitchAccounts.list().flatMap(
      (a) =>
        repos.clips.search({
          twitchAccountId: a.id,
          sort: 'oldest',
          includeHidden: true,
          limit: 1_000_000,
          offset: 0
        }).items
    )
    const posts = repos.posts.list({})
    const plan = filesToClean({
      clips,
      posts: posts.map((p) => ({
        clipId: p.clipId,
        status: p.status,
        publishAtUtc: p.publishAtUtc,
        updatedAt: p.updatedAt,
        filePath: p.filePath,
        rendered: Boolean(p.renderJson)
      })),
      now: clock(),
      days
    })
    let bytes = 0
    for (const id of plan.clipIds) {
      const clip = repos.clips.get(id)
      if (!clip) continue
      bytes += (await remove(clip.landscapePath)) + (await remove(clip.portraitPath))
      repos.clips.setDownload(id, {
        downloadStatus: 'deleted',
        landscapePath: null,
        portraitPath: null,
        fileSize: 0
      })
    }
    for (const path of plan.renderPaths) bytes += await remove(path)

    const total = plan.clipIds.length + plan.renderPaths.length
    if (total > 0) {
      const mb = (bytes / 1_048_576).toFixed(1)
      repos.eventLog.write({
        kind: 'cleanup.done',
        message: `Deleted local files of ${plan.clipIds.length} posted clip(s) and ${plan.renderPaths.length} render(s), ${mb} MB`
      })
      logger.info(
        `[cleanup] ${plan.clipIds.length} clips, ${plan.renderPaths.length} renders, ${mb} MB`
      )
      deps.emitChanged()
    }
    return { clips: plan.clipIds.length, renders: plan.renderPaths.length, bytes }
  }

  return {
    name: 'cleanup',
    concurrency: () => 1,
    key: () => 'cleanup',
    findWork(now) {
      if (repos.settings.getKey('deleteLocalAfterPostingDays') === null) return []
      return now.getTime() - lastRun >= EVERY_MS ? ['cleanup'] : []
    },
    async run() {
      await runNow()
    },
    runNow
  }
}
