import type { PowerGuard } from '../power'

/**
 * The in-process job runner. Every tick (30 s, plus immediately on start, on wake, and when
 * something is queued), each registered job type is asked for work and started up to its
 * concurrency limit. Jobs run in the background; a job's own code persists its progress so
 * a quit can't lose anything.
 */

export interface JobType<Item> {
  name: string
  concurrency(): number
  /** Work ready to run now, in priority order. Items must have stable keys. */
  findWork(now: Date): Item[]
  key(item: Item): string
  run(item: Item, signal: AbortSignal): Promise<void>
}

export interface RunnerDeps {
  power: PowerGuard
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: () => Date
  intervalMs?: number
}

export interface JobRunner {
  register<Item>(job: JobType<Item>): void
  start(): void
  stop(): Promise<void>
  /** Run a tick now (e.g. after "Upload now", on wake). */
  kick(): void
  /** Keys currently running, per job type. */
  running(): Record<string, string[]>
  /** Wait for everything currently running (tests). */
  idle(): Promise<void>
}

export const TICK_MS = 30_000

export function createJobRunner(deps: RunnerDeps): JobRunner {
  // Each job type's items differ; the runner only touches them through the job's own methods.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry, typed per job at register()
  const jobs: JobType<any>[] = []
  const active = new Map<string, Map<string, Promise<void>>>()
  const controller = new AbortController()
  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false
  let tickAgain = false
  const clock = deps.clock ?? (() => new Date())
  /**
   * Items that finished since the last timer tick or kick. A "slot freed" tick won't restart
   * them, so an item that is still ready after running (e.g. its channel is paused) waits
   * for the next real tick instead of spinning in a tight loop.
   */
  const justFinished = new Set<string>()

  function tick(reason: 'timer' | 'kick' | 'slot' = 'kick'): void {
    if (controller.signal.aborted) return
    if (reason !== 'slot') justFinished.clear()
    if (ticking) {
      tickAgain = true
      return
    }
    ticking = true
    try {
      for (const job of jobs) {
        const running = active.get(job.name) ?? new Map<string, Promise<void>>()
        active.set(job.name, running)
        const free = job.concurrency() - running.size
        if (free <= 0) continue
        let work: unknown[]
        try {
          work = job.findWork(clock())
        } catch (error) {
          deps.logger.error(`[jobs] ${job.name}: finding work failed`, error)
          continue
        }
        for (const item of work) {
          if (running.size >= job.concurrency()) break
          const key = job.key(item)
          if (running.has(key) || justFinished.has(`${job.name}:${key}`)) continue
          const release = deps.power.acquire()
          const promise = job
            .run(item, controller.signal)
            .catch((error: unknown) =>
              deps.logger.error(`[jobs] ${job.name} ${key} crashed`, error)
            )
            .finally(() => {
              running.delete(key)
              justFinished.add(`${job.name}:${key}`)
              release()
              // A slot opened: look for more work straight away.
              queueMicrotask(() => tick('slot'))
            })
          running.set(key, promise)
        }
      }
    } finally {
      ticking = false
      if (tickAgain) {
        tickAgain = false
        queueMicrotask(() => tick('slot'))
      }
    }
  }

  return {
    register(job) {
      jobs.push(job)
    },
    start() {
      if (timer) return
      timer = setInterval(() => tick('timer'), deps.intervalMs ?? TICK_MS)
      tick('kick')
    },
    async stop() {
      if (timer) clearInterval(timer)
      timer = null
      controller.abort(new Error('ChannelDeck is quitting'))
      await Promise.allSettled([...active.values()].flatMap((m) => [...m.values()]))
    },
    kick: () => tick('kick'),
    running() {
      return Object.fromEntries([...active.entries()].map(([name, m]) => [name, [...m.keys()]]))
    },
    async idle() {
      for (;;) {
        const pending = [...active.values()].flatMap((m) => [...m.values()])
        if (pending.length === 0) return
        await Promise.allSettled(pending)
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  }
}
