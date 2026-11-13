import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import type { InitialPostStatus, PostSource, PostStatus } from '@shared/constants/enums'
import { nextPostStatus, type PostEvent } from '../../domain/postState'
import type { Db } from '../client'
import { eventLog, posts } from '../schema'
import { type Clock, DuplicateError, isoNow, isUniqueViolation, NotFoundError } from './common'

export type PostRow = typeof posts.$inferSelect

type PostInsert = typeof posts.$inferInsert

/** Everything a caller may set on a post. `status` is deliberately absent. */
export type PostFields = Omit<PostInsert, 'id' | 'status' | 'createdAt' | 'updatedAt'>
export type PostPatch = Partial<PostFields>

export interface CreatePostInput extends PostFields {
  /** The only statuses a post can start in; everything after goes through transition(). */
  status: InitialPostStatus
}

export interface ListPostsFilter {
  statuses?: PostStatus[]
  accountId?: number
  source?: PostSource
}

export interface TransitionOptions {
  /** Fields to change in the same write (e.g. youtubeVideoId with upload_complete). */
  patch?: PostPatch
  /** Short human-readable reason for the event log. */
  reason?: string
}

export interface PostsRepo {
  create(input: CreatePostInput): PostRow
  get(id: string): PostRow | undefined
  require(id: string): PostRow
  list(filter?: ListPostsFilter): PostRow[]
  /** Updates fields other than status. Use transition() to change status. */
  update(id: string, patch: PostPatch): PostRow
  /** The single writer of posts.status. Validates with nextPostStatus() and logs the change. */
  transition(id: string, event: PostEvent, options?: TransitionOptions): PostRow
  /** Drafts are deleted outright; anything else is canceled through transition(). */
  deleteDraft(id: string): void
}

function assertNoStatus(patch: object): void {
  if ('status' in patch) {
    throw new Error('posts.status can only change through postsRepo.transition()')
  }
}

function neverTwiceMessage(): string {
  return 'This clip is already queued or posted on that channel. Each clip goes to a channel only once.'
}

export function createPostsRepo(db: Db, clock: Clock): PostsRepo {
  const repo: PostsRepo = {
    create(input) {
      const { status, ...fields } = input
      assertNoStatus(fields)
      const now = isoNow(clock)
      try {
        return db.transaction((tx) => {
          const row = tx
            .insert(posts)
            .values({ ...fields, id: randomUUID(), status, createdAt: now, updatedAt: now })
            .returning()
            .get()
          tx.insert(eventLog)
            .values({
              atUtc: now,
              kind: 'post.created',
              message: `Post created as ${status}`,
              postId: row.id,
              accountId: row.accountId,
              dataJson: { status, source: row.source }
            })
            .run()
          return row
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateError(neverTwiceMessage())
        throw error
      }
    },

    get: (id) => db.select().from(posts).where(eq(posts.id, id)).get(),

    require(id) {
      const row = repo.get(id)
      if (!row) throw new NotFoundError('Post', id)
      return row
    },

    list({ statuses, accountId, source } = {}) {
      const filters: SQL[] = []
      if (statuses?.length) filters.push(inArray(posts.status, statuses))
      if (accountId !== undefined) filters.push(eq(posts.accountId, accountId))
      if (source) filters.push(eq(posts.source, source))
      return db
        .select()
        .from(posts)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(posts.publishAtUtc), asc(posts.createdAt))
        .all()
    },

    update(id, patch) {
      assertNoStatus(patch)
      try {
        const row = db
          .update(posts)
          .set({ ...patch, updatedAt: isoNow(clock) })
          .where(eq(posts.id, id))
          .returning()
          .get()
        if (!row) throw new NotFoundError('Post', id)
        return row
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateError(neverTwiceMessage())
        throw error
      }
    },

    transition(id, event, { patch = {}, reason } = {}) {
      assertNoStatus(patch)
      const now = isoNow(clock)
      try {
        return db.transaction((tx) => {
          const current = tx.select().from(posts).where(eq(posts.id, id)).get()
          if (!current) throw new NotFoundError('Post', id)

          const videoId =
            patch.youtubeVideoId !== undefined ? patch.youtubeVideoId : current.youtubeVideoId
          const to = nextPostStatus(current.status, event, { hasVideoId: Boolean(videoId) })

          const row = tx
            .update(posts)
            // Compare-and-set on the old status so two writers can't both move the post.
            .set({ ...patch, status: to, updatedAt: now })
            .where(and(eq(posts.id, id), eq(posts.status, current.status)))
            .returning()
            .get()
          if (!row) throw new Error(`Post ${id} changed while moving it to ${to}; try again`)

          tx.insert(eventLog)
            .values({
              atUtc: now,
              kind: 'post.status',
              message: `${current.status} → ${to} (${event})${reason ? `: ${reason}` : ''}`,
              postId: id,
              accountId: row.accountId,
              dataJson: { event, from: current.status, to, ...(reason ? { reason } : {}) }
            })
            .run()
          return row
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateError(neverTwiceMessage())
        throw error
      }
    },

    deleteDraft(id) {
      const row = repo.require(id)
      if (row.status !== 'draft') {
        throw new Error(
          `Only drafts can be deleted; this post is ${row.status}. Cancel it instead.`
        )
      }
      db.delete(posts)
        .where(and(eq(posts.id, id), eq(posts.status, 'draft')))
        .run()
    }
  }
  return repo
}
