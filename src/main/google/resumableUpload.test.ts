import { describe, expect, it, vi } from 'vitest'
import { nextOffsetFromRange, uploadResumable } from './resumableUpload'

describe('uploadResumable', () => {
  it('refuses to start without a real file size', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(
      uploadResumable({
        accessToken: async () => 'token',
        resource: {},
        parts: ['snippet', 'status'],
        notifySubscribers: false,
        filePath: '/tmp/clip.mp4',
        sizeBytes: 0,
        contentType: 'video/mp4',
        fetchImpl
      })
    ).rejects.toThrow('Upload size unknown')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('nextOffsetFromRange', () => {
  it('resumes after the last byte YouTube has', () => {
    expect(nextOffsetFromRange('bytes=0-999999')).toBe(1_000_000)
    expect(nextOffsetFromRange('bytes=0-0')).toBe(1)
  })

  it('starts from zero when nothing arrived', () => {
    expect(nextOffsetFromRange(null)).toBe(0)
    expect(nextOffsetFromRange('garbage')).toBe(0)
  })
})
