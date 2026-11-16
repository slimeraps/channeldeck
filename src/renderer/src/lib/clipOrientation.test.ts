import { describe, expect, it } from 'vitest'
import { orientationOptions, pickOrientation } from './clipOrientation'

const both = {
  landscapeUrl: 'cdmedia://l',
  portraitUrl: 'cdmedia://p',
  downloadStatus: 'downloaded'
}
const landscapeOnly = { ...both, portraitUrl: null }
const portraitOnly = { ...both, landscapeUrl: null }
const none = { landscapeUrl: null, portraitUrl: null, downloadStatus: 'pending' }

describe('pickOrientation', () => {
  it('defaults to portrait when both files exist', () => {
    expect(pickOrientation(both)).toBe('portrait')
  })

  it('keeps the chosen version while its file exists', () => {
    expect(pickOrientation(both, 'landscape')).toBe('landscape')
    expect(pickOrientation(both, 'portrait')).toBe('portrait')
  })

  it('falls back to the file that exists', () => {
    expect(pickOrientation(landscapeOnly)).toBe('landscape')
    expect(pickOrientation(landscapeOnly, 'portrait')).toBe('landscape')
    expect(pickOrientation(portraitOnly, 'landscape')).toBe('portrait')
  })

  it('returns null with no local files', () => {
    expect(pickOrientation(none)).toBeNull()
    expect(pickOrientation(none, 'landscape')).toBeNull()
  })
})

describe('orientationOptions', () => {
  it('enables both buttons when both files exist', () => {
    const options = orientationOptions(both)
    expect(options.map((o) => [o.orientation, o.enabled, o.url])).toEqual([
      ['landscape', true, 'cdmedia://l'],
      ['portrait', true, 'cdmedia://p']
    ])
    expect(options[0]?.hint).toMatch(/horizontal/)
  })

  it('disables the missing version and says why', () => {
    const [landscape, portrait] = orientationOptions(landscapeOnly)
    expect(landscape?.enabled).toBe(true)
    expect(portrait?.enabled).toBe(false)
    expect(portrait?.hint).toMatch(/no vertical version/)
  })

  it('explains each download status when nothing is on disk', () => {
    const hint = (downloadStatus: string): string | undefined =>
      orientationOptions({ ...none, downloadStatus })[0]?.hint
    expect(hint('pending')).toMatch(/waiting to download/)
    expect(hint('downloading')).toMatch(/downloading/)
    expect(hint('failed')).toMatch(/failed/)
    expect(hint('not_downloadable')).toMatch(/doesn’t let/)
    expect(hint('deleted')).toMatch(/deleted/)
    expect(orientationOptions(none).every((o) => !o.enabled)).toBe(true)
  })
})
