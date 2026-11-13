import { describe, expect, it } from 'vitest'
import { isAllowedNavigation, isAppUrl, isSafeExternalUrl } from './security'

const dev = { devServerUrl: 'http://localhost:5173' }
const packaged = { devServerUrl: undefined }

describe('isAppUrl', () => {
  it('accepts the dev server origin in development only', () => {
    expect(isAppUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', packaged)).toBe(false)
  })

  it('accepts the bundled renderer file when packaged', () => {
    const file =
      'file:///Applications/ChannelDeck.app/Contents/Resources/app.asar/out/renderer/index.html'
    expect(isAppUrl(file, packaged)).toBe(true)
    expect(isAppUrl('file:///etc/passwd', packaged)).toBe(false)
  })

  it('rejects garbage', () => {
    expect(isAppUrl('not a url', dev)).toBe(false)
    expect(isAppUrl('', packaged)).toBe(false)
  })
})

describe('isAllowedNavigation', () => {
  it('blocks navigation to remote sites', () => {
    expect(isAllowedNavigation('https://evil.example.com', dev)).toBe(false)
    expect(isAllowedNavigation('https://studio.youtube.com', packaged)).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows plain https links', () => {
    expect(isSafeExternalUrl('https://studio.youtube.com/video/abc/edit')).toBe(true)
    expect(isSafeExternalUrl('https://www.twitch.tv/slimeraps')).toBe(true)
  })

  it('blocks other schemes and credentialed urls', () => {
    for (const url of [
      'http://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'smb://server/share',
      'https://user:pass@example.com',
      'nope'
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false)
    }
  })
})
