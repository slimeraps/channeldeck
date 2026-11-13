/**
 * Encrypts secrets (refresh tokens, the Twitch client secret) with Electron's safeStorage,
 * which on macOS uses a key kept in the login Keychain. Only ciphertext is stored.
 *
 * Uses the async safeStorage API (Electron 45 deprecated the sync one). Ciphertext made by
 * the old sync encryptString() still decrypts with decryptStringAsync(), so existing tokens
 * keep working. Takes a safeStorage-like object so it can be tested without Electron.
 */

export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plainText: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>
}

export class SecretsUnavailableError extends Error {
  readonly userFacing = true as const

  constructor() {
    super(
      'Secure storage is not available, so ChannelDeck cannot store sign-in tokens. ' +
        'Make sure you are signed in to macOS and the login Keychain is unlocked.'
    )
    this.name = 'SecretsUnavailableError'
  }
}

export interface SecretBox {
  isAvailable(): Promise<boolean>
  encrypt(plainText: string): Promise<Buffer>
  /**
   * Decrypts. If the Keychain key was rotated, the secret is re-encrypted with the new key
   * and handed to `onReEncrypted` so the caller can save it.
   */
  decrypt(cipherText: Buffer, onReEncrypted?: (fresh: Buffer) => void): Promise<string>
}

export function createSecretBox(storage: SafeStorageLike): SecretBox {
  const ensureAvailable = async (): Promise<void> => {
    if (!(await storage.isAsyncEncryptionAvailable())) throw new SecretsUnavailableError()
  }
  const box: SecretBox = {
    isAvailable: () => storage.isAsyncEncryptionAvailable(),
    async encrypt(plainText) {
      if (plainText.length === 0) throw new Error('Refusing to encrypt an empty secret')
      await ensureAvailable()
      return storage.encryptStringAsync(plainText)
    },
    async decrypt(cipherText, onReEncrypted) {
      await ensureAvailable()
      const { result, shouldReEncrypt } = await storage.decryptStringAsync(cipherText)
      if (shouldReEncrypt && onReEncrypted) onReEncrypted(await storage.encryptStringAsync(result))
      return result
    }
  }
  return box
}
