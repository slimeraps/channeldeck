import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Repos } from '../db/repos'
import type { ClipRow } from '../db/repos/clips'
import type { TwitchAccountRow } from '../db/repos/twitchAccounts'
import {
  clipFileBase,
  clipFolder,
  clipVideoName,
  downloadRetryDelayMs,
  MAX_DOWNLOAD_ATTEMPTS
} from '../domain/clips'
import type { Helix } from '../twitch/helix'
import { TwitchHttpError } from '../twitch/helix'
import { withRetry } from './retry'
import type { JobType } from './runner'

/**
 * Downloads banked clips. Download URLs from Get Clips Download are temporary, so they're
 * requested right before downloading (≤10 clips per request). Each file streams to a .part
 * file, is checked with ffprobe, then renamed into place. A thumbnail and a .json sidecar go
 * next to it. Failures retry with backoff (5 min, 20 min, 80 min...).
 */

export interface ClipDownloadDeps {
  repos: Repos
  helixFor: (accountId: number, signal?: AbortSignal) => Helix
  /** Rejects if the file isn't a readable video (ffprobe). */
  verifyVideo: (path: string) => Promise<unknown>
  emitChanged: () => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: () => Date
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** Clips per run before yielding to other work (the next tick continues). */
const PER_RUN = 30

class NotDownloadable extends Error {}

export function createClipDownloadJob(deps: ClipDownloadDeps): JobType<number> {
  const { repos, logger } = deps
  const clock = deps.clock ?? (() => new Date())
  const doFetch = deps.fetchImpl ?? fetch

  async function fetchToFile(url: string, dest: string, signal: AbortSignal): Promise<number> {
    const part = `${dest}.part`
    await withRetry(
      async () => {
        const res = await doFetch(url, { signal })
        if (!res.ok || !res.body) {
          throw Object.assign(new Error(`Download failed (HTTP ${res.status})`), {
            status: res.status
          })
        }
        await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part), { signal })
      },
      {
        shouldRetry: (e) => {
          const status = (e as { status?: number }).status
          return { retry: status === undefined || status >= 500 || status === 429 }
        },
        signal,
        ...(deps.sleep ? { sleep: deps.sleep } : {})
      },
      { attempts: 3, baseMs: 2000, maxMs: 15_000 }
    )
    try {
      await deps.verifyVideo(part)
    } catch (error) {
      await rm(part, { force: true })
      throw new Error(
        `The downloaded file isn't a playable video (${error instanceof Error ? error.message : error}).`,
        { cause: error }
      )
    }
    await rename(part, dest)
    return (await stat(dest)).size
  }

  async function downloadClip(
    account: TwitchAccountRow,
    clip: ClipRow,
    urls: { landscape: string | null; portrait: string | null },
    signal: AbortSignal
  ): Promise<void> {
    if (!urls.landscape && !urls.portrait)
      throw new NotDownloadable('Twitch has no download for this clip.')
    repos.clips.setDownload(clip.id, { downloadStatus: 'downloading' })
    const root = repos.settings.getKey('clipsRoot')
    const dir = join(root, clipFolder(account.login, clip.createdAtUtc))
    await mkdir(dir, { recursive: true })
    const naming = { id: clip.id, title: clip.title, createdAtUtc: clip.createdAtUtc }

    let bytes = 0
    let landscapePath: string | null = null
    let portraitPath: string | null = null
    if (urls.landscape) {
      landscapePath = join(dir, clipVideoName(naming, 'landscape'))
      bytes += await fetchToFile(urls.landscape, landscapePath, signal)
    }
    if (urls.portrait) {
      portraitPath = join(dir, clipVideoName(naming, 'portrait'))
      bytes += await fetchToFile(urls.portrait, portraitPath, signal)
    }

    const base = join(dir, clipFileBase(naming))
    let thumbPath: string | null = null
    if (clip.thumbnailUrl) {
      try {
        const res = await doFetch(clip.thumbnailUrl, { signal })
        if (res.ok) {
          thumbPath = `${base}.jpg`
          await writeFile(thumbPath, Buffer.from(await res.arrayBuffer()))
        }
      } catch {
        thumbPath = null // a missing thumbnail isn't worth failing the clip
      }
    }

    await writeFile(
      `${base}.json`,
      JSON.stringify(
        {
          clip: {
            id: clip.id,
            title: clip.title,
            url: clip.url,
            broadcaster: {
              id: account.broadcasterId,
              login: account.login,
              displayName: account.displayName
            },
            creatorName: clip.creatorName,
            gameId: clip.gameId,
            gameName: clip.gameName,
            viewCount: clip.viewCount,
            durationSec: clip.durationSec,
            createdAt: clip.createdAtUtc,
            vodId: clip.videoId,
            vodOffset: clip.vodOffset,
            isFeatured: clip.isFeatured,
            thumbnailUrl: clip.thumbnailUrl
          },
          files: { landscape: landscapePath, portrait: portraitPath, thumbnail: thumbPath },
          downloadedAt: clock().toISOString()
        },
        null,
        2
      )
    )

    repos.clips.setDownload(clip.id, {
      downloadStatus: 'downloaded',
      landscapePath,
      portraitPath,
      thumbPath,
      fileSize: bytes,
      downloadAttempts: 0,
      downloadError: null,
      downloadRetryAfterUtc: null
    })
  }

  function markFailed(clip: ClipRow, message: string): void {
    const attempts = clip.downloadAttempts + 1
    repos.clips.setDownload(clip.id, {
      downloadStatus: 'failed',
      downloadAttempts: attempts,
      downloadError: message,
      downloadRetryAfterUtc: new Date(
        clock().getTime() + downloadRetryDelayMs(attempts)
      ).toISOString()
    })
  }

  return {
    name: 'clip-download',
    concurrency: () => 2,
    key: (id) => String(id),

    findWork(now) {
      const iso = now.toISOString()
      return repos.twitchAccounts
        .list()
        .filter(
          (a) =>
            a.tokenStatus === 'ok' && repos.clips.hasDueDownloads(a.id, iso, MAX_DOWNLOAD_ATTEMPTS)
        )
        .map((a) => a.id)
    },

    async run(accountId, signal) {
      const account = repos.twitchAccounts.get(accountId)
      if (!account || account.tokenStatus !== 'ok') return
      const helix = deps.helixFor(accountId, signal)
      let done = 0
      while (done < PER_RUN && !signal.aborted) {
        const batch = repos.clips.dueDownloads(
          accountId,
          clock().toISOString(),
          MAX_DOWNLOAD_ATTEMPTS,
          10
        )
        if (batch.length === 0) break
        let urls
        try {
          // Fresh, short-lived links, requested right before downloading.
          urls = await helix.getClipDownloads({
            editorId: account.editorId,
            broadcasterId: account.broadcasterId,
            clipIds: batch.map((c) => c.id)
          })
        } catch (error) {
          const message =
            error instanceof TwitchHttpError && error.status === 403
              ? `The signed-in Twitch account is no longer an editor of ${account.displayName}. Reconnect it.`
              : error instanceof Error
                ? error.message
                : String(error)
          for (const clip of batch) markFailed(clip, message)
          logger.warn(`[clips] download links for ${account.login} failed`, message)
          break
        }
        const byId = new Map(urls.map((u) => [u.clip_id, u]))
        for (const clip of batch) {
          if (signal.aborted) {
            repos.clips.setDownload(clip.id, { downloadStatus: 'pending' })
            continue
          }
          const entry = byId.get(clip.id)
          try {
            if (!entry)
              throw new NotDownloadable('Twitch left this clip out (no access, or it was deleted).')
            await downloadClip(
              account,
              clip,
              { landscape: entry.landscape_download_url, portrait: entry.portrait_download_url },
              signal
            )
          } catch (error) {
            if (error instanceof NotDownloadable) {
              repos.clips.setDownload(clip.id, {
                downloadStatus: 'not_downloadable',
                downloadError: error.message
              })
            } else if (signal.aborted) {
              repos.clips.setDownload(clip.id, { downloadStatus: 'pending' })
            } else {
              markFailed(clip, error instanceof Error ? error.message : String(error))
              logger.warn(`[clips] download of ${clip.id} failed`, error)
            }
          }
          done += 1
        }
        deps.emitChanged()
      }
    }
  }
}
