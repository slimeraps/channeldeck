import { safeStorage } from 'electron'
import { createSecretBox, type SecretBox } from './secretBox'

export { SecretsUnavailableError, type SecretBox } from './secretBox'

/** The app's secret box, backed by Electron safeStorage (Keychain). Use after app ready. */
export const secrets: SecretBox = createSecretBox(safeStorage)
