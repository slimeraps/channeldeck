/**
 * Exponential backoff with full jitter, for network errors and 5xx. Pure apart from the
 * injected sleep, so tests can run it instantly.
 */

export interface BackoffOptions {
  /** Total attempts including the first. */
  attempts: number
  baseMs: number
  maxMs: number
  random?: () => number
}

export const DEFAULT_BACKOFF: BackoffOptions = { attempts: 5, baseMs: 2_000, maxMs: 60_000 }

/** Delay before attempt `n` (1-based retry number): random in [0, min(max, base·2^(n-1))]. */
export function backoffDelay(
  retry: number,
  { baseMs, maxMs, random = Math.random }: BackoffOptions
): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, retry - 1))
  return Math.round(random() * cap)
}

export interface RetryHooks {
  /** Decide whether an error is worth another attempt, and an optional server-requested wait. */
  shouldRetry: (error: unknown) => { retry: boolean; afterMs?: number | null }
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  signal?: AbortSignal
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  hooks: RetryHooks,
  options: BackoffOptions = DEFAULT_BACKOFF
): Promise<T> {
  const sleep = hooks.sleep ?? abortableSleep
  let attempt = 1
  for (;;) {
    try {
      return await fn(attempt)
    } catch (error) {
      const decision = hooks.shouldRetry(error)
      if (!decision.retry || attempt >= options.attempts || hooks.signal?.aborted) throw error
      const delay = decision.afterMs ?? backoffDelay(attempt, options)
      hooks.onRetry?.(error, attempt, delay)
      await sleep(delay, hooks.signal)
      attempt += 1
    }
  }
}
