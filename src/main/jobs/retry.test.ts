import { describe, expect, it, vi } from 'vitest'
import { backoffDelay, withRetry } from './retry'

describe('backoffDelay', () => {
  it('grows exponentially, capped, with full jitter', () => {
    const opts = { attempts: 5, baseMs: 1000, maxMs: 10_000, random: () => 1 }
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, opts))).toEqual([
      1000, 2000, 4000, 8000, 10_000, 10_000
    ])
    expect(backoffDelay(3, { ...opts, random: () => 0 })).toBe(0)
    expect(backoffDelay(3, { ...opts, random: () => 0.5 })).toBe(2000)
  })
})

describe('withRetry', () => {
  const noSleep = vi.fn(async () => {})

  it('retries retryable errors up to the attempt limit', async () => {
    const fn = vi.fn(async (attempt: number) => {
      if (attempt < 3) throw new Error('blip')
      return 'ok'
    })
    await expect(
      withRetry(fn, { shouldRetry: () => ({ retry: true }), sleep: noSleep })
    ).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gives up after 5 attempts', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always')
    })
    await expect(
      withRetry(fn, { shouldRetry: () => ({ retry: true }), sleep: noSleep })
    ).rejects.toThrow('always')
    expect(fn).toHaveBeenCalledTimes(5)
  })

  it('does not retry errors that should not be retried', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fatal')
    })
    await expect(
      withRetry(fn, { shouldRetry: () => ({ retry: false }), sleep: noSleep })
    ).rejects.toThrow('fatal')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses a server-requested delay when given', async () => {
    const sleep = vi.fn(async () => {})
    let first = true
    await withRetry(
      async () => {
        if (first) {
          first = false
          throw new Error('503')
        }
        return 1
      },
      { shouldRetry: () => ({ retry: true, afterMs: 30_000 }), sleep }
    )
    expect(sleep).toHaveBeenCalledWith(30_000, undefined)
  })
})
