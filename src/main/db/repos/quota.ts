import { and, eq, sql } from 'drizzle-orm'
import type { QuotaBucket } from '@shared/constants/enums'
import type { Db } from '../client'
import { quotaUsage } from '../schema'
import { type Clock, isoNow } from './common'

export interface QuotaCall {
  /** Pacific-time day "YYYY-MM-DD" (computed by domain/quota in Phase 4). */
  quotaDay: string
  bucket: QuotaBucket
  method: string
  cost: number
  accountId?: number | null
  postId?: string | null
  dryRun?: boolean
}

export interface QuotaTotals {
  uploadCalls: number
  units: number
}

export interface QuotaRepo {
  record(call: QuotaCall): void
  /** Real calls only: Dry Run calls are logged but don't count against quota. */
  totalsForDay(quotaDay: string): QuotaTotals
}

export function createQuotaRepo(db: Db, clock: Clock): QuotaRepo {
  return {
    record(call) {
      db.insert(quotaUsage)
        .values({
          atUtc: isoNow(clock),
          quotaDay: call.quotaDay,
          bucket: call.bucket,
          method: call.method,
          cost: call.cost,
          accountId: call.accountId ?? null,
          postId: call.postId ?? null,
          dryRun: call.dryRun ?? false
        })
        .run()
    },

    totalsForDay(quotaDay) {
      const rows = db
        .select({ bucket: quotaUsage.bucket, total: sql<number>`sum(${quotaUsage.cost})` })
        .from(quotaUsage)
        .where(and(eq(quotaUsage.quotaDay, quotaDay), eq(quotaUsage.dryRun, false)))
        .groupBy(quotaUsage.bucket)
        .all()
      const totals: QuotaTotals = { uploadCalls: 0, units: 0 }
      for (const row of rows) {
        if (row.bucket === 'upload') totals.uploadCalls = row.total
        else totals.units = row.total
      }
      return totals
    }
  }
}
