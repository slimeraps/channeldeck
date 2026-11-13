import { and, eq, sql } from 'drizzle-orm'
import { POST_STEPS, type PostStepName, type StepStatus } from '@shared/constants/enums'
import type { Db } from '../client'
import { postSteps } from '../schema'
import { type Clock, isoNow } from './common'

export type PostStepRow = typeof postSteps.$inferSelect

export interface PostStepsRepo {
  /** Creates any missing steps as pending (render only when needed). Idempotent. */
  ensure(postId: string, steps: readonly PostStepName[]): PostStepRow[]
  list(postId: string): PostStepRow[]
  /** Sets a step's status; starting a step counts an attempt. */
  set(
    postId: string,
    step: PostStepName,
    status: StepStatus,
    lastError?: string | null
  ): PostStepRow
  /** Puts every unfinished step back to pending (e.g. after a crash or a retry). */
  resetUnfinished(postId: string): void
}

const ORDER = new Map(POST_STEPS.map((s, i) => [s, i]))

export function createPostStepsRepo(db: Db, clock: Clock): PostStepsRepo {
  const repo: PostStepsRepo = {
    ensure(postId, steps) {
      const now = isoNow(clock)
      for (const step of steps) {
        db.insert(postSteps)
          .values({ postId, step, status: 'pending', updatedAt: now })
          .onConflictDoNothing()
          .run()
      }
      return repo.list(postId)
    },

    list(postId) {
      return db
        .select()
        .from(postSteps)
        .where(eq(postSteps.postId, postId))
        .all()
        .sort((a, b) => (ORDER.get(a.step) ?? 0) - (ORDER.get(b.step) ?? 0))
    },

    set(postId, step, status, lastError) {
      const row = db
        .update(postSteps)
        .set({
          status,
          updatedAt: isoNow(clock),
          ...(lastError !== undefined ? { lastError } : {}),
          ...(status === 'running' ? { attempts: sql`${postSteps.attempts} + 1` } : {})
        })
        .where(and(eq(postSteps.postId, postId), eq(postSteps.step, step)))
        .returning()
        .get()
      if (!row) throw new Error(`Post ${postId} has no ${step} step`)
      return row
    },

    resetUnfinished(postId) {
      db.update(postSteps)
        .set({ status: 'pending', updatedAt: isoNow(clock) })
        .where(and(eq(postSteps.postId, postId), sql`${postSteps.status} IN ('running', 'failed')`))
        .run()
    }
  }
  return repo
}
