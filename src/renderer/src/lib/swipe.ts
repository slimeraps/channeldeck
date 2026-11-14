/**
 * Turns horizontal wheel events (a two-finger trackpad swipe, or Shift + mouse wheel) into
 * single steps: one gesture moves one page, however long the trackpad's momentum keeps
 * sending events. Mostly-vertical scrolling is ignored so the week view still scrolls.
 */
export interface SwipeOptions {
  /** Sideways distance (px) that counts as a swipe. */
  threshold?: number
  /** A pause this long (ms) between events ends the gesture. */
  idleMs?: number
}

export type SwipeStep = -1 | 0 | 1

export function createSwipeTracker({ threshold = 60, idleMs = 250 }: SwipeOptions = {}): (
  deltaX: number,
  deltaY: number,
  timeMs: number
) => SwipeStep {
  let total = 0
  let fired = false
  let lastMs = Number.NEGATIVE_INFINITY

  return (deltaX, deltaY, timeMs) => {
    if (timeMs - lastMs > idleMs) {
      total = 0
      fired = false
    }
    lastMs = timeMs
    if (fired || Math.abs(deltaX) <= Math.abs(deltaY)) return 0
    total += deltaX
    if (Math.abs(total) < threshold) return 0
    fired = true
    return total > 0 ? 1 : -1
  }
}
