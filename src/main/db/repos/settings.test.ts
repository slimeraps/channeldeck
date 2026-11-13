import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@shared/schemas/settings'
import { createTestDb, type TestDb } from '../../../../tests/helpers/db'
import { createSettingsStore } from './settings'

let t: TestDb
beforeEach(() => {
  t = createTestDb()
})
afterEach(() => t.close())

const defaults = defaultSettings({ homeDir: '/Users/test' })

describe('settings store', () => {
  it('returns defaults when nothing is stored', () => {
    expect(t.repos.settings.get()).toEqual(defaults)
    expect(defaults.clipsRoot).toBe('/Users/test/Movies/ChannelDeck/Clips')
    expect(defaults.dailySyncTime).toBe('04:00')
    expect(defaults.uploadConcurrency).toBe(1)
    expect(defaults.dryRun).toBe(false)
  })

  it('round-trips updates and keeps other keys at their defaults', () => {
    const updated = t.repos.settings.update({
      dryRun: true,
      dailySyncTime: '05:30',
      uploadConcurrency: 2,
      twitchClientId: 'abc123'
    })
    expect(updated).toEqual({
      ...defaults,
      dryRun: true,
      dailySyncTime: '05:30',
      uploadConcurrency: 2,
      twitchClientId: 'abc123'
    })
    // A fresh store over the same database reads the same values.
    expect(createSettingsStore(t.db, defaults, t.clock).get()).toEqual(updated)
    expect(t.repos.settings.getKey('dailySyncTime')).toBe('05:30')
  })

  it('stores null values', () => {
    t.repos.settings.update({ deleteLocalAfterPostingDays: 14 })
    expect(
      t.repos.settings.update({ deleteLocalAfterPostingDays: null }).deleteLocalAfterPostingDays
    ).toBe(null)
  })

  it('rejects invalid values and unknown keys without saving anything', () => {
    expect(() => t.repos.settings.update({ uploadConcurrency: 4 })).toThrow()
    expect(() => t.repos.settings.update({ dailySyncTime: '4am' })).toThrow()
    expect(() =>
      t.repos.settings.update({ dryRun: true, nope: 1 } as unknown as Parameters<
        TestDb['repos']['settings']['update']
      >[0])
    ).toThrow()
    expect(t.repos.settings.get()).toEqual(defaults)
  })

  it('falls back to the default for a corrupt stored value and warns', () => {
    t.sqlite
      .prepare(
        "INSERT INTO settings (key, value_json) VALUES ('uploadConcurrency', '99'), ('dryRun', '{oops')"
      )
      .run()
    const onWarning = vi.fn()
    const store = createSettingsStore(t.db, defaults, t.clock, onWarning)
    expect(store.get().uploadConcurrency).toBe(1)
    expect(store.get().dryRun).toBe(false)
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ key: 'uploadConcurrency' }))
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ key: 'dryRun' }))
  })

  it('ignores retired keys', () => {
    t.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES ('oldThing', '1')").run()
    expect(t.repos.settings.get()).toEqual(defaults)
  })

  it('resets keys to defaults', () => {
    t.repos.settings.update({ keepInTray: false, dryRun: true })
    expect(t.repos.settings.reset(['keepInTray'])).toEqual({ ...defaults, dryRun: true })
  })
})
