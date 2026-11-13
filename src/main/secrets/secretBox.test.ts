import { describe, expect, it, vi } from 'vitest'
import { createSecretBox, type SafeStorageLike, SecretsUnavailableError } from './secretBox'

/** Reversible stand-in for safeStorage (XOR), good enough to prove the plumbing. */
export function fakeStorage(available = true, rotated = false): SafeStorageLike {
  const xor = (buf: Buffer): Buffer => Buffer.from(buf.map((b) => b ^ 0x5a))
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (s) => xor(Buffer.from(s, 'utf8')),
    decryptStringAsync: async (b) => ({ result: xor(b).toString('utf8'), shouldReEncrypt: rotated })
  }
}

describe('secret box', () => {
  it('round-trips a secret and never stores plaintext', async () => {
    const box = createSecretBox(fakeStorage())
    const token = '1//0gRefreshTokenValue'
    const cipher = await box.encrypt(token)
    expect(Buffer.isBuffer(cipher)).toBe(true)
    expect(cipher.toString('utf8')).not.toContain(token)
    expect(await box.decrypt(cipher)).toBe(token)
  })

  it('re-encrypts when the Keychain key was rotated', async () => {
    const plain = createSecretBox(fakeStorage())
    const cipher = await plain.encrypt('secret')
    const onReEncrypted = vi.fn()
    expect(await createSecretBox(fakeStorage(true, true)).decrypt(cipher, onReEncrypted)).toBe(
      'secret'
    )
    expect(onReEncrypted).toHaveBeenCalledWith(expect.any(Buffer))
  })

  it('refuses to work when secure storage is unavailable', async () => {
    const box = createSecretBox(fakeStorage(false))
    expect(await box.isAvailable()).toBe(false)
    await expect(box.encrypt('x')).rejects.toThrow(SecretsUnavailableError)
    await expect(box.decrypt(Buffer.from('x'))).rejects.toThrow(SecretsUnavailableError)
  })

  it('refuses empty secrets', async () => {
    await expect(createSecretBox(fakeStorage()).encrypt('')).rejects.toThrow(/empty/)
  })
})
