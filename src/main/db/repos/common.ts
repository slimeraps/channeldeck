/** Shared helpers for repositories. */

import { UserFacingError } from '../../errors'

export type Clock = () => Date

export const systemClock: Clock = () => new Date()

export function isoNow(clock: Clock): string {
  return clock().toISOString()
}

/** A row with this unique key already exists (e.g. the same YouTube channel twice). */
export class DuplicateError extends UserFacingError {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateError'
  }
}

export class NotFoundError extends UserFacingError {
  constructor(what: string, id: string | number) {
    super(`${what} ${id} not found`)
    this.name = 'NotFoundError'
  }
}

/** better-sqlite3 throws SqliteError with a `code`; drizzle may wrap it in `cause`. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: unknown }).code
      if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return true
      }
      current = (current as { cause?: unknown }).cause
    } else {
      break
    }
  }
  return false
}
