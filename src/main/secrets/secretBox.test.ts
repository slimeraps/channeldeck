import { describe, expect, it } from 'vitest'
import { createSecretBox, type SafeStorageLike, SecretsUnavailableError } from './secretBox'

/** Reversible stand-in for safeStorage (XOR), good enough to prove the plumbing. */
function fakeStorage(available = true): SafeStorageLike {
  const xor = (buf: Buffer): Buffer => Buffer.from(buf.map((b) => b ^ 0x5a))
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => xor(Buffer.from(s, 'utf8')),
    decryptString: (b) => xor(b).toString('utf8')
  }
}

describe('secret box', () => {
  it('round-trips a secret and never stores plaintext', () => {
    const box = createSecretBox(fakeStorage())
    const token = '1//0gRefreshTokenValue'
    const cipher = box.encrypt(token)
    expect(Buffer.isBuffer(cipher)).toBe(true)
    expect(cipher.toString('utf8')).not.toContain(token)
    expect(box.decrypt(cipher)).toBe(token)
  })

  it('refuses to work when secure storage is unavailable', () => {
    const box = createSecretBox(fakeStorage(false))
    expect(box.isAvailable()).toBe(false)
    expect(() => box.encrypt('x')).toThrow(SecretsUnavailableError)
    expect(() => box.decrypt(Buffer.from('x'))).toThrow(SecretsUnavailableError)
  })

  it('refuses empty secrets', () => {
    expect(() => createSecretBox(fakeStorage()).encrypt('')).toThrow(/empty/)
  })
})
