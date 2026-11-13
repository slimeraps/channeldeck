import { and, desc, eq, type SQL } from 'drizzle-orm'
import type { EventLevel } from '@shared/constants/enums'
import { redact } from '../../redact'
import type { Db } from '../client'
import { eventLog } from '../schema'
import { type Clock, isoNow } from './common'

export type EventLogRow = typeof eventLog.$inferSelect

export interface EventInput {
  kind: string
  message: string
  level?: EventLevel
  postId?: string | null
  accountId?: number | null
  twitchAccountId?: number | null
  data?: Record<string, unknown>
}

export interface EventLogRepo {
  write(event: EventInput): EventLogRow
  recent(options?: { limit?: number; postId?: string; kind?: string }): EventLogRow[]
}

export function createEventLogRepo(db: Db, clock: Clock): EventLogRepo {
  return {
    write(event) {
      return db
        .insert(eventLog)
        .values({
          atUtc: isoNow(clock),
          level: event.level ?? 'info',
          kind: event.kind,
          message: String(redact(event.message)),
          postId: event.postId ?? null,
          accountId: event.accountId ?? null,
          twitchAccountId: event.twitchAccountId ?? null,
          // Same redaction as the log file: secrets never reach the database either.
          dataJson: event.data ? (redact(event.data) as Record<string, unknown>) : null
        })
        .returning()
        .get()
    },

    recent({ limit = 100, postId, kind } = {}) {
      const filters: SQL[] = []
      if (postId) filters.push(eq(eventLog.postId, postId))
      if (kind) filters.push(eq(eventLog.kind, kind))
      return db
        .select()
        .from(eventLog)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(eventLog.atUtc), desc(eventLog.id))
        .limit(limit)
        .all()
    }
  }
}
