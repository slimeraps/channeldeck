import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestDb,
  seedAccount,
  seedClip,
  seedTwitchAccount,
  type TestDb
} from '../../../tests/helpers/db'
import { createCleanupJob } from './cleanup'

let t: TestDb
let dir: string
beforeEach(() => {
  t = createTestDb() // 2026-11-12T12:00Z
  dir = mkdtempSync(join(tmpdir(), 'cd-cleanup-'))
})
afterEach(() => {
  t.close()
  rmSync(dir, { recursive: true, force: true })
})

function file(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(1000))
  return path
}

describe('cleanup job', () => {
  it('does nothing while the setting is off', async () => {
    const job = createCleanupJob({
      repos: t.repos,
      emitChanged: vi.fn(),
      logger: console,
      clock: t.clock
    })
    expect(job.findWork(t.clock())).toEqual([])
    expect(await job.runNow()).toEqual({ clips: 0, renders: 0, bytes: 0 })
  })

  it('deletes the files of clips posted long enough ago, keeping the thumbnail', async () => {
    t.repos.settings.update({ deleteLocalAfterPostingDays: 7 })
    const channel = seedAccount(t.repos).id
    const twitch = seedTwitchAccount(t.repos).id
    seedClip(t.repos, twitch, 'old')
    seedClip(t.repos, twitch, 'fresh')
    const thumb = file('old.jpg')
    const oldFile = file('old_landscape.mp4')
    const freshFile = file('fresh_landscape.mp4')
    t.repos.clips.setDownload('old', {
      downloadStatus: 'downloaded',
      landscapePath: oldFile,
      thumbPath: thumb,
      fileSize: 1000
    })
    t.repos.clips.setDownload('fresh', {
      downloadStatus: 'downloaded',
      landscapePath: freshFile,
      fileSize: 1000
    })
    // Published posts can only come from transitions; build them the way uploads do.
    const publish = (clipId: string, at: string): void => {
      const p = t.repos.posts.create({
        accountId: channel,
        status: 'queued',
        source: 'twitch_clip',
        clipId,
        publishAtUtc: at
      })
      for (const e of [
        'start_upload',
        'upload_complete',
        'mark_scheduled',
        'mark_published'
      ] as const)
        t.repos.posts.transition(
          p.id,
          e,
          e === 'upload_complete' ? { patch: { youtubeVideoId: `v-${clipId}` } } : {}
        )
    }
    publish('old', '2026-11-01T12:00:00.000Z')
    publish('fresh', '2026-11-10T12:00:00.000Z')
    const render = file('r_1.mp4')
    const rp = t.repos.posts.create({
      accountId: channel,
      status: 'queued',
      source: 'manual',
      filePath: render,
      renderJson: { sourcePath: oldFile, kind: 'blur_fill', crops: {}, presetId: null },
      publishAtUtc: '2026-11-01T12:00:00.000Z'
    })
    for (const e of [
      'start_upload',
      'upload_complete',
      'mark_scheduled',
      'mark_published'
    ] as const)
      t.repos.posts.transition(
        rp.id,
        e,
        e === 'upload_complete' ? { patch: { youtubeVideoId: 'v-r' } } : {}
      )

    const job = createCleanupJob({
      repos: t.repos,
      emitChanged: vi.fn(),
      logger: console,
      clock: t.clock
    })
    expect(job.findWork(t.clock())).toEqual(['cleanup'])
    expect(await job.runNow()).toEqual({ clips: 1, renders: 1, bytes: 2000 })
    expect(existsSync(oldFile)).toBe(false)
    expect(existsSync(render)).toBe(false)
    expect(existsSync(thumb)).toBe(true)
    expect(existsSync(freshFile)).toBe(true)
    expect(t.repos.clips.get('old')).toMatchObject({
      downloadStatus: 'deleted',
      landscapePath: null
    })
    expect(t.repos.clips.get('fresh')?.downloadStatus).toBe('downloaded')
    // Hourly: not again right away.
    expect(job.findWork(t.clock())).toEqual([])
  })
})
