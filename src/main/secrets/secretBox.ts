/**
 * Encrypts secrets (refresh tokens, the Twitch client secret) with Electron's safeStorage,
 * which on macOS uses a key kept in the login Keychain. Only ciphertext is stored.
 *
 * Takes a safeStorage-like object so it can be tested without Electron.
 */

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export class SecretsUnavailableError extends Error {
  constructor() {
    super(
      'Secure storage is not available, so ChannelDeck cannot store sign-in tokens. ' +
        'Make sure you are signed in to macOS and the login Keychain is unlocked.'
    )
    this.name = 'SecretsUnavailableError'
  }
}

export interface SecretBox {
  isAvailable(): boolean
  encrypt(plainText: string): Buffer
  decrypt(cipherText: Buffer): string
}

export function createSecretBox(storage: SafeStorageLike): SecretBox {
  const ensureAvailable = (): void => {
    if (!storage.isEncryptionAvailable()) throw new SecretsUnavailableError()
  }
  return {
    isAvailable: () => storage.isEncryptionAvailable(),
    encrypt(plainText) {
      ensureAvailable()
      if (plainText.length === 0) throw new Error('Refusing to encrypt an empty secret')
      return storage.encryptString(plainText)
    },
    decrypt(cipherText) {
      ensureAvailable()
      return storage.decryptString(cipherText)
    }
  }
}
