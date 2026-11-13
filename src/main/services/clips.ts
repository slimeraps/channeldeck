import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { accountDefaultsSchema } from '@shared/schemas/account'
import type { ClipSearchInput, ClipView } from '@shared/schemas/twitch'
import type { Repos } from '../db/repos'
import type { ClipRow } from '../db/repos/clips'
import { DuplicateError } from '../db/repos/common'
import { UserFacingError } from '../errors'
import type { MediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { mediaUrl } from '../media/mediaUrl'

/** The Clips page: search the bank, and bulk actions on selected clips. */

export interface ClipsServiceDeps {
  repos: Repos
  media: MediaAccess
  probe: (path: string) => Promise<ProbeResult>
  emitChanged: () => void
  emitPostsChanged: () => void
  kickJobs?: () => void
}

const ACTIVE_POST_STATUSES = [
  'draft',
  'needs_approval',
  'queued',
  'rendering',
  'uploading',
  'waiting_quota',
  'needs_decision',
  'failed'
]

export type ClipsService = ReturnType<typeof createClipsService>

export function createClipsService(deps: ClipsServiceDeps) {
  const { repos } = deps

  function local(path: string | null): string | null {
    if (!path || !existsSync(path)) return null
    deps.media.grant(path)
    return mediaUrl(path)
  }

  function toView(
    clip: ClipRow,
    postsByClip: Map<string, ClipView['posts']>,
    twitch: Map<number, { displayName: string; color: string }>
  ): ClipView {
    const source = twitch.get(clip.twitchAccountId)
    return {
      id: clip.id,
      twitchAccountId: clip.twitchAccountId,
      twitchName: source?.displayName ?? 'Removed channel',
      twitchColor: source?.color ?? '#71717a',
      title: clip.title,
      gameName: clip.gameName,
      creatorName: clip.creatorName,
      viewCount: clip.viewCount,
      durationSec: clip.durationSec,
      createdAtUtc: clip.createdAtUtc,
      isFeatured: clip.isFeatured,
      hidden: clip.hidden,
      url: clip.url,
      thumbnailUrl: local(clip.thumbPath) ?? clip.thumbnailUrl,
      landscapeUrl: local(clip.landscapePath),
      portraitUrl: local(clip.portraitPath),
      downloadStatus: clip.downloadStatus,
      downloadError: clip.downloadError,
      posts: postsByClip.get(clip.id) ?? []
    }
  }

  function postsFor(ids: string[]): Map<string, ClipView['posts']> {
    const accounts = new Map(repos.accounts.list({ includeRemoved: true }).map((a) => [a.id, a]))
    const map = new Map<string, ClipView['posts']>()
    if (ids.length === 0) return map
    for (const post of repos.posts.list({})) {
      if (!post.clipId || !ids.includes(post.clipId) || post.status === 'canceled') continue
      const account = accounts.get(post.accountId)
      const list = map.get(post.clipId) ?? []
      list.push({
        postId: post.id,
        status: post.status,
        channelTitle: account?.channelTitle ?? 'Removed channel',
        channelColor: account?.color ?? '#71717a',
        youtubeVideoId: post.youtubeVideoId
      })
      map.set(post.clipId, list)
    }
    return map
  }

  function requireClips(ids: string[]): ClipRow[] {
    return ids.map((id) => {
      const clip = repos.clips.get(id)
      if (!clip) throw new UserFacingError(`Clip ${id} isn't in the bank.`)
      return clip
    })
  }

  return {
    search(input: ClipSearchInput) {
      const { items, total } = repos.clips.search({
        ...input,
        ...(input.titleSearch ? { titleSearch: input.titleSearch } : {})
      })
      const posts = postsFor(items.map((c) => c.id))
      const twitch = new Map(repos.twitchAccounts.list().map((a) => [a.id, a]))
      return {
        items: items.map((c) => toView(c, posts, twitch)),
        total,
        games: repos.clips.gamesFor(input.twitchAccountIds)
      }
    },

    setHidden(ids: string[], hidden: boolean): { updated: number } {
      repos.clips.setHidden(ids, hidden)
      deps.emitChanged()
      return { updated: ids.length }
    },

    redownload(ids: string[]): { queued: number } {
      for (const clip of requireClips(ids)) {
        repos.clips.setDownload(clip.id, {
          downloadStatus: 'pending',
          downloadAttempts: 0,
          downloadError: null,
          downloadRetryAfterUtc: null
        })
      }
      deps.emitChanged()
      deps.kickJobs?.()
      return { queued: ids.length }
    },

    async deleteLocal(ids: string[]): Promise<{ deleted: number }> {
      const clips = requireClips(ids)
      // Don't pull the file out from under a post that still needs to upload it.
      const busy = repos.posts
        .list({})
        .filter(
          (p) =>
            p.clipId &&
            ids.includes(p.clipId) &&
            ACTIVE_POST_STATUSES.includes(p.status) &&
            !p.youtubeVideoId
        )
      if (busy.length > 0) {
        throw new UserFacingError(
          `${busy.length} selected clip${busy.length === 1 ? ' is' : 's are'} still waiting to upload. Unschedule ${busy.length === 1 ? 'that post' : 'those posts'} first.`
        )
      }
      let deleted = 0
      for (const clip of clips) {
        for (const path of [clip.landscapePath, clip.portraitPath, clip.thumbPath]) {
          if (path) await rm(path, { force: true })
        }
        repos.clips.setDownload(clip.id, {
          downloadStatus: 'deleted',
          landscapePath: null,
          portraitPath: null,
          thumbPath: null,
          fileSize: 0
        })
        deleted += 1
      }
      deps.emitChanged()
      return { deleted }
    },

    /** Turns clips into draft posts on a channel, using that channel's defaults. */
    async addToChannel(
      ids: string[],
      accountId: number
    ): Promise<{ created: number; skipped: string[] }> {
      const account = repos.accounts.get(accountId)
      if (!account || account.removedAt)
        throw new UserFacingError('Pick a connected YouTube channel.')
      const defaults = accountDefaultsSchema.safeParse(account.defaultsJson)
      const d = defaults.success ? defaults.data : {}
      let created = 0
      const skipped: string[] = []
      for (const clip of requireClips(ids)) {
        const file = clip.portraitPath ?? clip.landscapePath
        if (!file || !existsSync(file)) {
          skipped.push(`${clip.title}: not downloaded yet`)
          continue
        }
        const probe = await deps.probe(file).catch(() => null)
        const credit = [clip.creatorName ? `Clipped by ${clip.creatorName}` : null, clip.url]
          .filter(Boolean)
          .join('\n')
        const description = [credit, d.descriptionFooter]
          .filter(Boolean)
          .join('\n\n')
          .replace(/[<>]/g, '')
        try {
          repos.posts.create({
            accountId,
            status: 'draft',
            source: 'twitch_clip',
            clipId: clip.id,
            filePath: file,
            fileSize: probe?.sizeBytes ?? clip.fileSize,
            fileMtime: probe?.mtimeMs ?? null,
            durationSec: probe?.durationSec ?? clip.durationSec,
            width: probe?.width ?? null,
            height: probe?.height ?? null,
            isShort: probe?.isShort ?? false,
            title: clip.title.replace(/[<>]/g, '').slice(0, 100),
            description,
            tagsJson: d.tags ?? [],
            categoryId: d.categoryId ?? null,
            playlistId: d.playlistId ?? null,
            madeForKids: d.madeForKids ?? null,
            license: d.license ?? 'youtube',
            defaultLanguage: d.defaultLanguage ?? null,
            defaultAudioLanguage: d.defaultAudioLanguage ?? null,
            visibilityMode: 'schedule',
            publishAtUtc: null
          })
          deps.media.grant(file)
          created += 1
        } catch (error) {
          if (error instanceof DuplicateError)
            skipped.push(`${clip.title}: already on ${account.channelTitle}`)
          else throw error
        }
      }
      if (created > 0) deps.emitPostsChanged()
      deps.emitChanged()
      return { created, skipped }
    }
  }
}
