import { describe, expect, it } from 'vitest'
import { createSwipeTracker } from './swipe'

describe('createSwipeTracker', () => {
  it('steps forward once a sideways swipe passes the threshold', () => {
    const track = createSwipeTracker({ threshold: 60, idleMs: 250 })
    expect(track(30, 0, 0)).toBe(0)
    expect(track(40, 2, 16)).toBe(1)
  })

  it('steps back for a swipe the other way', () => {
    const track = createSwipeTracker({ threshold: 60, idleMs: 250 })
    expect(track(-80, 0, 0)).toBe(-1)
  })

  it('moves only one step per gesture, momentum included', () => {
    const track = createSwipeTracker({ threshold: 60, idleMs: 250 })
    expect(track(100, 0, 0)).toBe(1)
    for (let t = 16; t < 800; t += 16) expect(track(100, 0, t)).toBe(0)
  })

  it('starts a new gesture after a pause', () => {
    const track = createSwipeTracker({ threshold: 60, idleMs: 250 })
    expect(track(100, 0, 0)).toBe(1)
    expect(track(100, 0, 600)).toBe(1)
  })

  it('ignores mostly vertical scrolling', () => {
    const track = createSwipeTracker({ threshold: 60, idleMs: 250 })
    for (let t = 0; t < 200; t += 16) expect(track(20, 80, t)).toBe(0)
  })
})
