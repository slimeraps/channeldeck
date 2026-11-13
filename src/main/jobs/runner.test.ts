import { describe, expect, it, vi } from 'vitest'
import { createPowerGuard } from '../power'
import { createJobRunner } from './runner'

function fakePower() {
  const api = { start: vi.fn(() => 7), stop: vi.fn() }
  return { api, guard: createPowerGuard(api) }
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('job runner', () => {
  it('runs work up to the concurrency limit and holds the power blocker while busy', async () => {
    const { api, guard } = fakePower()
    const runner = createJobRunner({ power: guard, logger })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const started: string[] = []
    runner.register({
      name: 'upload',
      concurrency: () => 2,
      findWork: () => ['a', 'b', 'c'],
      key: (x: string) => x,
      run: async (x: string) => {
        started.push(x)
        await gate
      }
    })
    runner.kick()
    expect(started).toEqual(['a', 'b'])
    expect(runner.running()).toEqual({ upload: ['a', 'b'] })
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(guard.held).toBe(2)

    release()
    await runner.idle()
    // 'c' started once a slot freed up; everything finished; blocker released.
    expect(started).toContain('c')
    expect(guard.held).toBe(0)
    expect(api.stop).toHaveBeenCalledWith(7)
  })

  it('never runs the same item twice at once', async () => {
    const { guard } = fakePower()
    const runner = createJobRunner({ power: guard, logger })
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    runner.register({
      name: 'upload',
      concurrency: () => 3,
      findWork: () => ['same'],
      key: (x: string) => x,
      run: async () => {
        calls += 1
        await gate
      }
    })
    runner.kick()
    runner.kick()
    runner.kick()
    expect(calls).toBe(1)
    release()
    await runner.idle()
  })

  it('does not spin on an item that is still ready after it ran', async () => {
    const { guard } = fakePower()
    const runner = createJobRunner({ power: guard, logger })
    let runs = 0
    runner.register({
      name: 'upload',
      concurrency: () => 1,
      // Always "ready", e.g. a post whose channel is paused so run() skips it.
      findWork: () => ['stuck'],
      key: (x: string) => x,
      run: async () => {
        runs += 1
      }
    })
    runner.kick()
    await runner.idle()
    expect(runs).toBe(1)
    // The next real tick (or kick) does try again.
    runner.kick()
    await runner.idle()
    expect(runs).toBe(2)
  })

  it('keeps going when a job crashes', async () => {
    const { guard } = fakePower()
    const runner = createJobRunner({ power: guard, logger })
    let n = 0
    runner.register({
      name: 'flaky',
      concurrency: () => 1,
      findWork: () => (n < 2 ? [`item${n}`] : []),
      key: (x: string) => x,
      run: async () => {
        n += 1
        throw new Error('boom')
      }
    })
    runner.kick()
    await runner.idle()
    expect(n).toBe(2)
    expect(logger.error).toHaveBeenCalled()
    expect(guard.held).toBe(0)
  })
})

describe('power guard', () => {
  it('starts the blocker once and stops it when the last holder releases', () => {
    const { api, guard } = fakePower()
    const a = guard.acquire()
    const b = guard.acquire()
    a()
    a() // double release is harmless
    expect(api.stop).not.toHaveBeenCalled()
    b()
    expect(api.stop).toHaveBeenCalledTimes(1)
  })
})
