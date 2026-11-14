import { lstat, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Repos } from '../db/repos'
import { filesToClean, isInside } from '../domain/cleanup'
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

  /**
   * Works out what deleting `path` would really remove. Only files inside `allowedRoot` (a real
   * path) qualify: the file's parent folder is resolved first, so a linked subfolder can't send
   * the delete somewhere else, and the delete later goes by name inside that real folder.
   */
  async function locate(
    path: string | null,
    allowedRoot: string
  ): Promise<
    { kind: 'none' } | { kind: 'gone' } | { kind: 'outside' } | { kind: 'file'; target: string }
  > {
    if (!path) return { kind: 'none' }
    let parent: string
    try {
      parent = await realpath(dirname(path))
    } catch {
      return { kind: 'gone' } // the folder is gone, so the file is too
    }
    if (!isInside(allowedRoot, parent)) return { kind: 'outside' }
    return { kind: 'file', target: join(parent, basename(path)) }
  }

  /** Deletes a located file; returns the bytes freed (0 if it was already gone). */
  async function removeFile(target: string): Promise<number> {
    try {
      const info = await lstat(target)
      if (!info.isFile() && !info.isSymbolicLink()) return 0 // never remove a folder
      await rm(target, { force: true })
      return info.size
    } catch {
      return 0 // already gone
    }
  }

  async function realRoot(path: string): Promise<string | null> {
    try {
      return await realpath(path)
    } catch {
      return null
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
        rendered: Boolean(p.renderJson),
        renderSourcePath: p.renderJson?.sourcePath ?? null
      })),
      now: clock(),
      days
    })
    // Only ever delete inside the clip folder (clips) or its _renders folder (renders).
    const clipsRoot = repos.settings.getKey('clipsRoot')
    const clipsReal = await realRoot(clipsRoot)
    const rendersReal = await realRoot(join(clipsRoot, '_renders'))

    let bytes = 0
    let clipCount = 0
    let renderCount = 0
    for (const id of plan.clipIds) {
      const clip = repos.clips.get(id)
      if (!clip) continue
      const found = clipsReal
        ? await Promise.all([
            locate(clip.landscapePath, clipsReal),
            locate(clip.portraitPath, clipsReal)
          ])
        : [{ kind: 'outside' as const }]
      if (found.some((f) => f.kind === 'outside')) {
        logger.warn(`[cleanup] refused: clip ${id} has a file outside the clip folder, left alone`)
        continue
      }
      for (const f of found) if (f.kind === 'file') bytes += await removeFile(f.target)
      repos.clips.setDownload(id, {
        downloadStatus: 'deleted',
        landscapePath: null,
        portraitPath: null,
        fileSize: 0
      })
      clipCount++
    }
    for (const path of plan.renderPaths) {
      const found = rendersReal ? await locate(path, rendersReal) : { kind: 'outside' as const }
      if (found.kind === 'outside') {
        logger.warn(`[cleanup] refused: render ${path} is outside the renders folder, left alone`)
        continue
      }
      if (found.kind === 'file') bytes += await removeFile(found.target)
      renderCount++
    }

    if (clipCount + renderCount > 0) {
      const mb = (bytes / 1_048_576).toFixed(1)
      repos.eventLog.write({
        kind: 'cleanup.done',
        message: `Deleted local files of ${clipCount} posted clip(s) and ${renderCount} render(s), ${mb} MB`
      })
      logger.info(`[cleanup] ${clipCount} clips, ${renderCount} renders, ${mb} MB`)
      deps.emitChanged()
    }
    return { clips: clipCount, renders: renderCount, bytes }
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
