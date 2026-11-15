import { DOWNLOAD_STATUSES, POST_STATUSES } from '@shared/constants/enums'
import { HEALTH_EVENT_LIMIT, type HealthSnapshot } from '@shared/schemas/health'
import type { Repos } from '../db/repos'
import { redactString } from '../redact'
import { createStatusService } from './status'

/**
 * The Health page's snapshot. Read-only: it only counts and reads, never writes, and never
 * touches tokens, secrets or secret.* settings. Pure apart from what is passed in (the clock,
 * app facts, the database size), so tests can build it from createTestDb().
 */

export interface HealthDeps {
  repos: Repos
  now: Date
  app: { version: string; electron: string; platform: string }
  schemaVersion: number
  dbFileBytes: number | null
  jobsPaused: boolean
}

const HIDDEN_TITLE = 'a video'

// Absolute paths: two or more folders deep, so "/ 1" or "and/or" are left alone.
const ABSOLUTE_PATH = /(?:~|[A-Za-z]:)?(?:\/[^\s"'“”‘’`<>|,;:()[\]{}]+){2,}/g
// Anything in double quotes (straight or curly): that is where titles show up.
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g

/** Escapes text for use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Makes an event message safe to show: secrets scrubbed with the same redaction the log file
 * uses, file paths hidden, and (with Hide post titles on) every post title and every quoted
 * title we can't match to a post replaced with "a video".
 */
export function sanitizeEventMessage(
  message: string,
  { hideTitles, titles }: { hideTitles: boolean; titles: readonly string[] }
): string {
  let out = redactString(message).replace(ABSOLUTE_PATH, '[path]')
  if (hideTitles) {
    // Longest first, so a title that contains a shorter one is replaced whole.
    for (const title of [...titles].sort((a, b) => b.length - a.length)) {
      if (title.trim()) out = out.replace(new RegExp(escapeRegExp(title), 'g'), HIDDEN_TITLE)
    }
    // A post that is gone has no title to look up; whatever is quoted could be one.
    out = out.replace(QUOTED, HIDDEN_TITLE)
  }
  return out
}

export function buildHealthSnapshot(deps: HealthDeps): HealthSnapshot {
  const { repos, now } = deps
  const settings = repos.settings.get()

  const posts = Object.fromEntries(POST_STATUSES.map((s) => [s, 0])) as HealthSnapshot['posts']
  for (const row of repos.posts.countByStatus()) posts[row.status] = row.count

  const clips = Object.fromEntries(DOWNLOAD_STATUSES.map((s) => [s, 0])) as HealthSnapshot['clips']
  for (const row of repos.clips.countByDownloadStatus()) clips[row.status] = row.count

  const channels: HealthSnapshot['channels'] = [
    ...repos.accounts.list().map((a) => ({
      platform: 'youtube' as const,
      name: a.channelTitle,
      tokenStatus: a.tokenStatus
    })),
    ...repos.twitchAccounts.list().map((a) => ({
      platform: 'twitch' as const,
      name: a.displayName,
      tokenStatus: a.tokenStatus
    }))
  ]

  const rows = repos.eventLog.recent({ limit: HEALTH_EVENT_LIMIT })
  const titles = new Set<string>()
  for (const row of rows) {
    const post = row.postId ? repos.posts.get(row.postId) : undefined
    if (post) titles.add(post.title)
  }

  return {
    generatedAtUtc: now.toISOString(),
    app: {
      version: deps.app.version,
      electron: deps.app.electron,
      platform: deps.app.platform,
      schemaVersion: deps.schemaVersion,
      dbFileBytes: deps.dbFileBytes
    },
    dryRun: settings.dryRun,
    posts,
    clips,
    channels,
    quota: createStatusService({ repos, clock: () => now }).quotaToday(),
    jobs: { state: deps.jobsPaused ? 'paused' : 'running' },
    dryRunCalls: repos.eventLog.count('dryrun.call'),
    events: rows.map((row) => ({
      id: row.id,
      atUtc: row.atUtc,
      level: row.level,
      kind: row.kind,
      message: sanitizeEventMessage(row.message, {
        hideTitles: settings.hidePostTitles,
        titles: [...titles]
      })
    }))
  }
}

export type HealthService = ReturnType<typeof createHealthService>

export function createHealthService(deps: {
  repos: Repos
  /** Facts only main knows (Electron, the database file, the job runner). */
  environment: () => Omit<HealthDeps, 'repos' | 'now'>
  clock?: () => Date
}) {
  const clock = deps.clock ?? (() => new Date())
  return {
    snapshot(): HealthSnapshot {
      return buildHealthSnapshot({ repos: deps.repos, now: clock(), ...deps.environment() })
    }
  }
}
