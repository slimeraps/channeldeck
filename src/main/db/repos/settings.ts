import { sql } from 'drizzle-orm'
import {
  type SettingKey,
  SETTING_KEYS,
  type Settings,
  type SettingsPatch,
  settingsPatchSchema,
  settingsShape
} from '@shared/schemas/settings'
import type { Db } from '../client'
import { settings } from '../schema'
import { type Clock, isoNow } from './common'

export interface SettingsWarning {
  key: string
  message: string
}

export interface SettingsStore {
  /** All settings: stored values over defaults. Invalid stored values fall back to defaults. */
  get(): Settings
  getKey<K extends SettingKey>(key: K): Settings[K]
  /** Validates and saves the given keys; returns the full, updated settings. */
  update(patch: SettingsPatch): Settings
  /** Removes stored overrides so the given keys use defaults again. */
  reset(keys: SettingKey[]): Settings
}

export function createSettingsStore(
  db: Db,
  defaults: Settings,
  clock: Clock,
  onWarning: (warning: SettingsWarning) => void = () => {}
): SettingsStore {
  function readAll(): Settings {
    const merged: Record<string, unknown> = { ...defaults }
    for (const row of db.select().from(settings).all()) {
      if (!(SETTING_KEYS as string[]).includes(row.key)) continue // retired setting
      const key = row.key as SettingKey
      let raw: unknown
      try {
        raw = JSON.parse(row.valueJson)
      } catch {
        onWarning({ key, message: 'stored value is not valid JSON; using default' })
        continue
      }
      const parsed = settingsShape[key].safeParse(raw)
      if (parsed.success) merged[key] = parsed.data
      else onWarning({ key, message: `stored value is invalid; using default` })
    }
    return merged as Settings
  }

  return {
    get: readAll,

    getKey(key) {
      return readAll()[key]
    },

    update(patch) {
      const valid = settingsPatchSchema.strict().parse(patch)
      const now = isoNow(clock)
      db.transaction((tx) => {
        for (const [key, value] of Object.entries(valid)) {
          if (value === undefined) continue
          tx.insert(settings)
            .values({ key, valueJson: JSON.stringify(value), updatedAt: now })
            .onConflictDoUpdate({
              target: settings.key,
              set: { valueJson: sql`excluded.value_json`, updatedAt: now }
            })
            .run()
        }
      })
      return readAll()
    },

    reset(keys) {
      db.transaction((tx) => {
        for (const key of keys) {
          tx.delete(settings)
            .where(sql`${settings.key} = ${key}`)
            .run()
        }
      })
      return readAll()
    }
  }
}
