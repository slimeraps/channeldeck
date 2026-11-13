import { type Dirent, readdirSync, statfsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DAILY_UNITS, DAILY_UPLOAD_CALLS } from '@shared/constants/quota'
import type { Repos } from '../db/repos'
import { type Clock, systemClock } from '../db/repos/common'
import { nextQuotaReset, quotaDayFor } from '../domain/quota'

/** Quota and storage numbers for the meters (sidebar and Settings). */

export interface QuotaToday {
  day: string
  uploadCalls: number
  uploadLimit: number
  units: number
  unitLimit: number
  resetsAtUtc: string
}

export interface StorageInfo {
  clipsRoot: string
  accounts: {
    id: number
    name: string
    color: string
    bytes: number
    downloaded: number
    total: number
  }[]
  rendersBytes: number
  /** Free space on the disk holding the clip folder (null if unknown). */
  freeBytes: number | null
}

/** Total size of the files under a folder (0 if it doesn't exist). */
export function folderSize(path: string): number {
  let total = 0
  let entries: Dirent[]
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) total += folderSize(full)
    else if (entry.isFile()) {
      try {
        total += statSync(full).size
      } catch {
        // vanished while counting
      }
    }
  }
  return total
}

function freeSpace(path: string): number | null {
  // The clip folder may not exist yet: ask about the nearest folder that does.
  for (let p = path; ; p = dirname(p)) {
    try {
      const s = statfsSync(p)
      return s.bavail * s.bsize
    } catch {
      if (dirname(p) === p) return null
    }
  }
}

export type StatusService = ReturnType<typeof createStatusService>

export function createStatusService(deps: { repos: Repos; clock?: Clock }) {
  const { repos } = deps
  const clock = deps.clock ?? systemClock
  return {
    quotaToday(): QuotaToday {
      const now = clock()
      const day = quotaDayFor(now)
      const totals = repos.quota.totalsForDay(day)
      return {
        day,
        uploadCalls: totals.uploadCalls,
        uploadLimit: DAILY_UPLOAD_CALLS,
        units: totals.units,
        unitLimit: DAILY_UNITS,
        resetsAtUtc: nextQuotaReset(now).toISOString()
      }
    },

    storage(): StorageInfo {
      const clipsRoot = repos.settings.getKey('clipsRoot')
      return {
        clipsRoot,
        accounts: repos.twitchAccounts.list().map((a) => {
          const stats = repos.clips.stats(a.id)
          return {
            id: a.id,
            name: a.displayName,
            color: a.color,
            bytes: stats.bytesOnDisk,
            downloaded: stats.downloaded,
            total: stats.total
          }
        }),
        rendersBytes: folderSize(join(clipsRoot, '_renders')),
        freeBytes: freeSpace(clipsRoot)
      }
    }
  }
}
