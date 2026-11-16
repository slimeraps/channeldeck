import { z } from 'zod'
import { DOWNLOAD_STATUSES, EVENT_LEVELS, POST_STATUSES, TOKEN_STATUSES } from '../constants/enums'

/**
 * The Health page's snapshot (channel `health:get`). Read-only and safe to show: counts and
 * states only, never tokens, secrets or secret.* settings, file paths or video titles.
 */

function countsFor<const T extends readonly [string, ...string[]]>(keys: T) {
  return z
    .object(
      Object.fromEntries(keys.map((k) => [k, z.number().int().nonnegative()])) as {
        [K in T[number]]: z.ZodNumber
      }
    )
    .strict()
}

export const HEALTH_EVENT_LIMIT = 50

export const healthSnapshotSchema = z
  .object({
    generatedAtUtc: z.string(),
    app: z
      .object({
        version: z.string(),
        electron: z.string(),
        platform: z.string(),
        /** Migrations applied to the database. */
        schemaVersion: z.number().int(),
        /** Size of the database file (not its WAL); null if it can't be read. */
        dbFileBytes: z.number().int().nullable()
      })
      .strict(),
    dryRun: z.boolean(),
    /** Every post status, zeros included. */
    posts: countsFor(POST_STATUSES),
    /** Every clip download status, zeros included. */
    clips: countsFor(DOWNLOAD_STATUSES),
    channels: z.array(
      z
        .object({
          platform: z.enum(['youtube', 'twitch']),
          name: z.string(),
          tokenStatus: z.enum(TOKEN_STATUSES)
        })
        .strict()
    ),
    quota: z
      .object({
        day: z.string(),
        uploadCalls: z.number().int(),
        uploadLimit: z.number().int(),
        units: z.number().int(),
        unitLimit: z.number().int(),
        resetsAtUtc: z.string()
      })
      .strict(),
    jobs: z.object({ state: z.enum(['running', 'paused']) }).strict(),
    /** How many Dry Run calls have been logged (dryrun.call events). */
    dryRunCalls: z.number().int().nonnegative(),
    events: z
      .array(
        z
          .object({
            id: z.number().int(),
            atUtc: z.string(),
            level: z.enum(EVENT_LEVELS),
            kind: z.string(),
            message: z.string()
          })
          .strict()
      )
      .max(HEALTH_EVENT_LIMIT)
  })
  .strict()
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>
