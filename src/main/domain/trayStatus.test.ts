import { describe, expect, it } from 'vitest'
import { formatNext, trayStatus, type TrayPost } from './trayStatus'

const now = new Date('2026-11-13T15:00:00Z')
const post = (o: Partial<TrayPost>): TrayPost => ({
  status: 'scheduled',
  visibilityMode: 'schedule',
  publishAtUtc: '2026-11-14T00:00:00.000Z',
  title: 'A',
  ...o
})

describe('trayStatus', () => {
  it('counts pending posts and finds the next future publish', () => {
    const s = trayStatus(
      [
        post({ title: 'later', publishAtUtc: '2026-11-15T00:00:00.000Z' }),
        post({ title: 'soon', publishAtUtc: '2026-11-13T18:00:00.000Z', status: 'queued' }),
        post({ title: 'past', publishAtUtc: '2026-11-13T10:00:00.000Z' }),
        post({ status: 'published' }),
        post({ status: 'draft' }),
        post({ status: 'canceled' }),
        post({ status: 'needs_approval', publishAtUtc: '2026-11-16T00:00:00.000Z' }),
        post({ status: 'queued', visibilityMode: 'public', publishAtUtc: null })
      ],
      now
    )
    expect(s).toEqual({
      pending: 5,
      needsYou: 1,
      next: { title: 'soon', atUtc: '2026-11-13T18:00:00.000Z' }
    })
  })

  it('has no next publish when nothing is scheduled', () => {
    expect(trayStatus([], now)).toEqual({ pending: 0, needsYou: 0, next: null })
  })

  it('formats the next publish with a relative time', () => {
    expect(formatNext('2026-11-13T17:05:00.000Z', now, 'America/Chicago')).toBe(
      'Fri 11:05 (in 2h 5m)'
    )
    expect(formatNext('2026-11-13T15:20:00.000Z', now, 'UTC')).toBe('Fri 15:20 (in 20m)')
    expect(formatNext('2026-11-20T15:00:00.000Z', now, 'UTC')).toBe('Fri 15:00 (in 7d)')
  })
})
