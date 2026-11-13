import { describe, expect, it } from 'vitest'
import { normalizeSlots, resolveLocalTime, slotsBetween, slotsOnDate } from './slots'

const CHI = 'America/Chicago'

describe('resolveLocalTime', () => {
  it('converts an ordinary local time to UTC', () => {
    expect(resolveLocalTime('2026-11-12', '18:00', CHI).toISOString()).toBe(
      '2026-11-13T00:00:00.000Z'
    )
  })

  it('moves a time skipped by spring forward to the next valid minute', () => {
    // 2027-03-14: clocks go 01:59 CST → 03:00 CDT, so 02:30 doesn't exist.
    expect(resolveLocalTime('2027-03-14', '02:30', CHI).toISOString()).toBe(
      '2027-03-14T08:00:00.000Z' // 03:00 CDT
    )
    expect(resolveLocalTime('2027-03-14', '02:00', CHI).toISOString()).toBe(
      '2027-03-14T08:00:00.000Z'
    )
    expect(resolveLocalTime('2027-03-14', '03:00', CHI).toISOString()).toBe(
      '2027-03-14T08:00:00.000Z'
    )
  })

  it('uses the first occurrence of a time repeated by fall back', () => {
    // 2026-11-01: 01:00–01:59 happens twice (CDT, then CST).
    expect(resolveLocalTime('2026-11-01', '01:30', CHI).toISOString()).toBe(
      '2026-11-01T06:30:00.000Z' // 01:30 CDT
    )
    expect(resolveLocalTime('2026-11-01', '02:00', CHI).toISOString()).toBe(
      '2026-11-01T08:00:00.000Z'
    )
  })

  it('works in zones without DST and with half-hour offsets', () => {
    expect(resolveLocalTime('2026-07-01', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-07-01T03:30:00.000Z'
    )
    expect(resolveLocalTime('2026-07-01', '09:00', 'UTC').toISOString()).toBe(
      '2026-07-01T09:00:00.000Z'
    )
  })
})

describe('slotsBetween', () => {
  const rule = { slots: ['09:00', '12:00', '15:00', '18:00'], weekdays: [1, 2, 3, 4, 5, 6, 7] }

  it('lists 3 days × 4 slots after now', () => {
    // Thu 2026-11-12 10:00 CST.
    const from = new Date('2026-11-12T16:00:00Z')
    const to = new Date(from.getTime() + 3 * 86_400_000)
    const slots = slotsBetween(rule, from, to, CHI)
    expect(slots[0]).toBe('2026-11-12T18:00:00.000Z') // today 12:00, 09:00 already passed
    expect(slots).toHaveLength(12)
    expect(slots.at(-1)).toBe('2026-11-15T15:00:00.000Z') // Sun 09:00
  })

  it('only uses the chosen weekdays (local)', () => {
    const weekdays = { slots: ['20:00'], weekdays: [1, 3, 5] } // Mon, Wed, Fri
    const from = new Date('2026-11-09T06:00:00Z') // Mon 00:00 CST
    const to = new Date('2026-11-16T06:00:00Z')
    // 20:00 CST is 02:00 UTC the next day: the local weekday decides, not the UTC one.
    expect(slotsBetween(weekdays, from, to, CHI)).toEqual([
      '2026-11-10T02:00:00.000Z',
      '2026-11-12T02:00:00.000Z',
      '2026-11-14T02:00:00.000Z'
    ])
  })

  it('keeps one slot a day across both DST changes', () => {
    const daily = { slots: ['02:30'], weekdays: [1, 2, 3, 4, 5, 6, 7] }
    const spring = slotsBetween(
      daily,
      new Date('2027-03-13T00:00:00Z'),
      new Date('2027-03-16T00:00:00Z'),
      CHI
    )
    expect(spring).toEqual([
      '2027-03-13T08:30:00.000Z', // 02:30 CST
      '2027-03-14T08:00:00.000Z', // gap → 03:00 CDT
      '2027-03-15T07:30:00.000Z' // 02:30 CDT
    ])
    const fall = slotsBetween(
      { slots: ['01:30'], weekdays: [1, 2, 3, 4, 5, 6, 7] },
      new Date('2026-10-31T00:00:00Z'),
      new Date('2026-11-03T00:00:00Z'),
      CHI
    )
    expect(fall).toEqual([
      '2026-10-31T06:30:00.000Z',
      '2026-11-01T06:30:00.000Z', // first 01:30 only
      '2026-11-02T07:30:00.000Z'
    ])
  })

  it('returns nothing without slots or weekdays', () => {
    const from = new Date('2026-11-12T00:00:00Z')
    const to = new Date('2026-11-20T00:00:00Z')
    expect(slotsBetween({ slots: [], weekdays: [1] }, from, to, CHI)).toEqual([])
    expect(slotsBetween({ slots: ['09:00'], weekdays: [] }, from, to, CHI)).toEqual([])
  })
})

describe('helpers', () => {
  it('counts slots on a local date', () => {
    const rule = { slots: ['09:00', '18:00'], weekdays: [6, 7] }
    expect(slotsOnDate(rule, '2026-11-14', CHI)).toBe(2) // Saturday
    expect(slotsOnDate(rule, '2026-11-13', CHI)).toBe(0) // Friday
  })

  it('normalizes slot lists', () => {
    expect(normalizeSlots(['18:00', '09:00', '18:00', '9:00', '24:00'])).toEqual(['09:00', '18:00'])
  })
})
