/**
 * Keeps macOS from suspending the app while any job runs (powerSaveBlocker
 * 'prevent-app-suspension'). Reference-counted: the blocker is held while at least one
 * job holds it. Takes the blocker API as a dependency so it can be tested.
 */

export interface PowerBlockerApi {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
}

export interface PowerGuard {
  acquire(): () => void
  readonly held: number
}

export function createPowerGuard(api: PowerBlockerApi): PowerGuard {
  let count = 0
  let blockerId: number | null = null
  return {
    acquire() {
      count += 1
      if (blockerId === null) blockerId = api.start('prevent-app-suspension')
      let released = false
      return () => {
        if (released) return
        released = true
        count -= 1
        if (count === 0 && blockerId !== null) {
          api.stop(blockerId)
          blockerId = null
        }
      }
    },
    get held() {
      return count
    }
  }
}
