import type { PostStatus } from '@shared/constants/enums'

/**
 * "Delete local files N days after posting": which clips and vertical renders are safe to
 * remove. Pure: a clip goes only once every post that used it is published (none still on
 * its way) and the newest of those publishes is at least N days old.
 */

export interface CleanupClip {
  id: string
  downloadStatus: string
  landscapePath: string | null
  portraitPath: string | null
}

export interface CleanupPost {
  clipId: string | null
  status: PostStatus
  publishAtUtc: string | null
  updatedAt: string
  filePath: string | null
  rendered: boolean
}

const DONE: PostStatus[] = ['published', 'canceled']

export function filesToClean(args: {
  clips: readonly CleanupClip[]
  posts: readonly CleanupPost[]
  now: Date
  days: number
}): { clipIds: string[]; renderPaths: string[] } {
  const cutoff = new Date(args.now.getTime() - args.days * 86_400_000).toISOString()
  const publishedAt = (p: CleanupPost): string => p.publishAtUtc ?? p.updatedAt

  const byClip = new Map<string, CleanupPost[]>()
  for (const p of args.posts) {
    if (p.clipId) byClip.set(p.clipId, [...(byClip.get(p.clipId) ?? []), p])
  }

  const clipIds = args.clips
    .filter((clip) => {
      if (clip.downloadStatus !== 'downloaded') return false
      if (!clip.landscapePath && !clip.portraitPath) return false
      const posts = byClip.get(clip.id) ?? []
      const published = posts.filter((p) => p.status === 'published')
      if (published.length === 0) return false
      if (posts.some((p) => !DONE.includes(p.status))) return false
      const newest = published.map(publishedAt).sort().at(-1) as string
      return newest <= cutoff
    })
    .map((c) => c.id)

  // A render can go once its post is published long enough, unless an unfinished post uses it.
  const inUse = new Set(
    args.posts.filter((p) => !DONE.includes(p.status) && p.filePath).map((p) => p.filePath)
  )
  const renderPaths = [
    ...new Set(
      args.posts
        .filter(
          (p) =>
            p.rendered &&
            p.filePath &&
            p.status === 'published' &&
            publishedAt(p) <= cutoff &&
            !inUse.has(p.filePath)
        )
        .map((p) => p.filePath as string)
    )
  ]
  return { clipIds, renderPaths }
}
