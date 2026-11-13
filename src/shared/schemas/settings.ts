import { z } from 'zod'

/**
 * App settings (non-secret). Each key is stored as its own row in the `settings` table.
 * Secrets such as the Twitch client secret never live here; they go through
 * main/secrets as safeStorage ciphertext.
 */

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:mm, for example 04:00')

export const settingsShape = {
  /** Absolute path to the clip bank. Default: ~/Movies/ChannelDeck/Clips. */
  clipsRoot: z.string().min(1),
  /** Local time the daily clip sync runs. */
  dailySyncTime: timeOfDay,
  /** Upload a scheduled post this many hours before its publish time. */
  uploadLeadHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 14),
  /** Parallel uploads. */
  uploadConcurrency: z.number().int().min(1).max(3),
  launchAtLogin: z.boolean(),
  keepInTray: z.boolean(),
  /** Log YouTube calls instead of making them. Twitch sync and downloads still run. */
  dryRun: z.boolean(),
  /** Delete a clip's local files this many days after it's posted; null = keep forever. */
  deleteLocalAfterPostingDays: z.number().int().min(1).max(3650).nullable(),
  /** Twitch app Client ID (public). The client secret is stored separately, encrypted. */
  twitchClientId: z.string().trim().min(1).max(100).nullable(),
  /** First-run checklist: hidden by you. */
  setupDismissed: z.boolean(),
  /** You confirmed the Google consent screen is "In production" (can't be checked via API). */
  setupConsentConfirmed: z.boolean(),
  /** You confirmed (or chose) the clip folder. */
  setupClipFolderConfirmed: z.boolean()
} as const

export const settingsSchema = z.object(settingsShape).strict()
export type Settings = z.infer<typeof settingsSchema>
export type SettingKey = keyof Settings

export const settingsPatchSchema = settingsSchema.partial()
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export const SETTING_KEYS = Object.keys(settingsShape) as SettingKey[]

export function defaultSettings({ homeDir }: { homeDir: string }): Settings {
  return {
    clipsRoot: `${homeDir.replace(/\/+$/, '')}/Movies/ChannelDeck/Clips`,
    dailySyncTime: '04:00',
    uploadLeadHours: 24,
    uploadConcurrency: 1,
    launchAtLogin: false,
    keepInTray: true,
    dryRun: false,
    deleteLocalAfterPostingDays: null,
    twitchClientId: null,
    setupDismissed: false,
    setupConsentConfirmed: false,
    setupClipFolderConfirmed: false
  }
}
