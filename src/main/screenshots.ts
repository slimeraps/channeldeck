import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { PostEvent } from './domain/postState'
import { quotaDayFor } from './domain/quota'
import { emitToRenderer } from './appWindow'
import type { Repos } from './db/repos'
import { logger } from './logger'
import { runFfmpeg } from './media/ffmpeg'

/**
 * Dev-only screenshot mode for UI work (CHANNELDECK_SCREENSHOTS=<empty folder>, from source
 * only). Runs in that throwaway data folder with Dry Run on, starts no jobs and makes no
 * Google or Twitch calls. Captures every screen empty, fills the database with demo data,
 * captures every screen again, then quits. PNGs land in <folder>/shots.
 */

const DAY = 86_400_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------------------

const TITLES = [
  'INSANE 1v4 clutch on Dust',
  'chat made me do it',
  'The cleanest flick you will ever see in your entire life, no really, watch till the end',
  'MW4 Day 9: the mech that would not die',
  'rage quit speedrun any%',
  'he really thought he had me',
  'POV: you trust your teammate',
  'raid boss down on the first try??',
  'funniest fail of the week',
  'tiny clip big laugh',
  'when the lag hits at the worst moment',
  'Ranked grind, episode 47'
]

/** Settings and the Google client file a set-up Mac would have (fake values, never used). */
export function prepareDemoFolder(dir: string, repos: Repos): void {
  writeFileSync(
    join(dir, 'google-client.json'),
    JSON.stringify({
      installed: {
        client_id: 'demo-client.apps.googleusercontent.com',
        client_secret: 'demo-not-a-secret',
        project_id: 'channeldeck-demo'
      }
    })
  )
  repos.settings.update({ dryRun: true, clipsRoot: join(dir, 'clips') })
}

export async function seedDemoData(dir: string, repos: Repos): Promise<void> {
  const now = Date.now()
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString()
  const clipsRoot = join(dir, 'clips')
  mkdirSync(join(clipsRoot, 'demo'), { recursive: true })

  // A short video and a few differently colored thumbnails for the clip bank.
  const video = join(clipsRoot, 'demo', 'demo_landscape.mp4')
  await runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30:duration=3',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    video
  ])
  const thumbs: string[] = []
  for (const [i, color] of [
    '0x6366f1',
    '0xec4899',
    '0x22c55e',
    '0xf59e0b',
    '0x06b6d4',
    '0xef4444'
  ].entries()) {
    const thumb = join(clipsRoot, 'demo', `thumb_${i}.jpg`)
    await runFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=480x272,drawgrid=w=60:h=34:t=1:c=white@0.25`,
      '-frames:v',
      '1',
      thumb
    ])
    thumbs.push(thumb)
  }

  repos.settings.update({
    setupConsentConfirmed: true,
    setupClipFolderConfirmed: true,
    twitchClientId: 'demo-twitch-client'
  })

  const main = repos.accounts.create({
    channelId: 'UC_DEMO_MAIN',
    channelTitle: 'Slime Raps',
    channelHandle: '@slimeraps',
    color: '#6366f1',
    defaultsJson: { categoryId: '20', tags: ['gaming'], madeForKids: false }
  })
  const shorts = repos.accounts.create({
    channelId: 'UC_DEMO_SHORTS',
    channelTitle: 'Slime Raps Shorts',
    channelHandle: '@slimerapsshorts',
    color: '#ec4899',
    defaultsJson: { categoryId: '20', tags: ['shorts'], madeForKids: false }
  })
  const partner = repos.accounts.create({
    channelId: 'UC_DEMO_PARTNER',
    channelTitle: 'Laykdreki Clips Archive (long channel name)',
    color: '#22c55e'
  })
  repos.accounts.setTokenStatus(partner.id, 'needs_reauth')

  const tw1 = repos.twitchAccounts.create({
    broadcasterId: '900001',
    login: 'slimeraps',
    displayName: 'slimeraps',
    editorId: '900001',
    color: '#8b5cf6'
  })
  const tw2 = repos.twitchAccounts.create({
    broadcasterId: '900002',
    login: 'laykdreki',
    displayName: 'Laykdreki',
    editorId: '900001',
    color: '#f59e0b'
  })
  repos.games.upsertMany([
    { id: '32399', name: 'Counter-Strike' },
    { id: '1234', name: 'MechWarrior 4' },
    { id: '5555', name: 'Just Chatting' }
  ])

  const clipIds: string[] = []
  const games = ['32399', '1234', '5555']
  for (let i = 0; i < 140; i++) {
    const account = i % 3 === 0 ? tw2 : tw1
    const id = `DemoClip${i}`
    clipIds.push(id)
    repos.clips.upsertMany([
      {
        id,
        twitchAccountId: account.id,
        title: TITLES[i % TITLES.length] as string,
        gameId: games[i % games.length] as string,
        creatorName: ['clipperdude', 'modsquad', 'night_owl'][i % 3] as string,
        viewCount: (i * 137) % 4200,
        durationSec: 12 + ((i * 7) % 48),
        createdAtUtc: iso(-(i * 0.45 + 0.2) * DAY),
        vodOffset: null,
        videoId: null,
        isFeatured: i % 11 === 0,
        url: `https://clips.twitch.tv/${id}`,
        thumbnailUrl: null
      }
    ])
    const status = i % 23 === 5 ? 'failed' : i % 29 === 7 ? 'not_downloadable' : 'downloaded'
    repos.clips.setDownload(id, {
      downloadStatus: status,
      ...(status === 'downloaded'
        ? { landscapePath: video, thumbPath: thumbs[i % thumbs.length], fileSize: 18_000_000 }
        : { downloadError: status === 'failed' ? 'Twitch returned HTTP 503' : null })
    })
  }
  repos.clips.setHidden(['DemoClip3', 'DemoClip8'], true)

  const preset = repos.layoutPresets.create({
    twitchAccountId: tw1.id,
    name: 'Facecam top right',
    kind: 'facecam_split',
    cropsJson: {
      facecam: { x: 1440, y: 0, width: 480, height: 270 },
      gameplay: { x: 420, y: 0, width: 1080, height: 1080 }
    }
  })
  const rule = repos.autopostRules.create({
    name: 'Daily Shorts',
    youtubeAccountId: shorts.id,
    twitchAccountIdsJson: [tw1.id, tw2.id],
    slotsJson: ['12:00', '18:00'],
    weekdaysJson: [1, 2, 3, 4, 5, 6, 7],
    pickOrder: 'most_viewed',
    filtersJson: { minViews: 50 },
    format: 'short',
    layoutPresetId: preset.id,
    titleTpl: '{{title}} #shorts',
    descriptionTpl: 'Clipped by {{clipper}} on {{channel}}',
    tagsJson: ['shorts'],
    mode: 'review',
    lookaheadDays: 3,
    enabled: true
  })
  repos.autopostRules.create({
    name: 'Weekend best-of',
    youtubeAccountId: main.id,
    twitchAccountIdsJson: [tw1.id],
    slotsJson: ['20:00'],
    weekdaysJson: [6, 7],
    pickOrder: 'oldest',
    format: 'regular',
    titleTpl: 'Best of: {{title}}',
    descriptionTpl: '',
    mode: 'auto',
    enabled: false
  })

  const template = repos.templates.create({
    name: 'MW4 daily',
    titleTpl: 'MW4 Day {{n}}',
    descriptionTpl: 'Day {{n}} of the MechWarrior 4 run. Live on Twitch daily.',
    tagsJson: ['mw4', 'mechwarrior']
  })
  repos.templates.create({ name: 'Clip of the week', titleTpl: 'Clip of the week: {{date}}' })
  const mw4 = repos.series.create({ name: 'MW4 Day N', templateId: template.id, nextNumber: 12 })

  type Path = PostEvent[]
  const upload: Path = ['start_upload', 'upload_complete']
  let video_n = 1
  const post = (
    accountId: number,
    title: string,
    offsetMs: number,
    path: Path,
    extra: Record<string, unknown> = {},
    initial: 'draft' | 'queued' | 'needs_approval' = 'queued'
  ) => {
    try {
      const row = repos.posts.create({
        accountId,
        status: initial,
        title,
        description: 'Demo post',
        visibilityMode: 'schedule',
        publishAtUtc: iso(offsetMs),
        madeForKids: false,
        categoryId: '20',
        ...extra
      })
      for (const event of path) {
        repos.posts.transition(row.id, event, {
          ...(event === 'upload_complete'
            ? { patch: { youtubeVideoId: `DRYRUN-demo${video_n++}`, uploadProgress: 1 } }
            : {}),
          ...(event === 'fail'
            ? { patch: { lastError: 'YouTube said the title is invalid (it contains < or >).' } }
            : {}),
          ...(event === 'quota_exhausted'
            ? {
                patch: {
                  lastError: 'Daily upload limit reached. Uploads resume after midnight Pacific.',
                  retryAfterUtc: iso(9 * 3600_000)
                }
              }
            : {})
        })
      }
      return row
    } catch (error) {
      logger.warn('[screenshots] could not seed a post', title, error)
      return null
    }
  }

  post(main.id, 'MW4 Day 11', 5 * 3600_000, [...upload, 'mark_scheduled'], {
    seriesId: mw4.id,
    seriesNumber: 11
  })
  post(main.id, 'MW4 Day 10', -1 * DAY, [...upload, 'mark_scheduled', 'mark_published'], {
    seriesId: mw4.id,
    seriesNumber: 10
  })
  post(main.id, 'MW4 Day {{n}}', 1 * DAY + 3 * 3600_000, [], { seriesId: mw4.id }, 'draft')
  post(main.id, 'Ranked grind, episode 47', 2 * DAY, [])
  const uploading = post(
    shorts.id,
    'he really thought he had me #shorts',
    3 * 3600_000,
    ['start_upload'],
    { source: 'twitch_clip', clipId: clipIds[4], isShort: true }
  )
  if (uploading) repos.posts.update(uploading.id, { uploadProgress: 0.42 })
  post(shorts.id, 'POV: you trust your teammate #shorts', 2 * 3600_000, upload, {
    source: 'twitch_clip',
    clipId: clipIds[6],
    isShort: true
  })
  post(shorts.id, 'chat made me do it #shorts', -3 * 3600_000, ['start_upload', 'fail'], {
    source: 'twitch_clip',
    clipId: clipIds[1],
    isShort: true
  })
  post(
    shorts.id,
    'raid boss down on the first try?? #shorts',
    1 * DAY,
    ['start_upload', 'quota_exhausted'],
    { source: 'twitch_clip', clipId: clipIds[7], isShort: true }
  )
  post(main.id, 'when the lag hits at the worst moment', -2 * 3600_000, ['publish_time_missed'])
  post(shorts.id, 'funniest fail of the week #shorts', 2 * DAY + 3600_000, ['cancel'], {
    source: 'twitch_clip',
    clipId: clipIds[8]
  })
  for (const [n, clip] of [10, 13, 16].entries()) {
    post(
      shorts.id,
      `${TITLES[clip % TITLES.length]} #shorts`,
      (n + 1) * DAY + 12 * 3600_000,
      [],
      { source: 'twitch_clip', clipId: clipIds[clip], ruleId: rule.id, isShort: true },
      'needs_approval'
    )
  }
  for (let d = 2; d < 9; d++) {
    post(main.id, `${TITLES[(d * 5) % TITLES.length]}`, d * DAY + 20 * 3600_000, [
      ...upload,
      'mark_scheduled'
    ])
  }
  post(partner.id, 'Archive upload that is waiting for a reconnect', 3 * DAY, [])

  const day = quotaDayFor(new Date())
  for (let i = 0; i < 7; i++)
    repos.quota.record({ quotaDay: day, bucket: 'upload', method: 'videos.insert', cost: 1 })
  for (let i = 0; i < 24; i++)
    repos.quota.record({ quotaDay: day, bucket: 'units', method: 'thumbnails.set', cost: 50 })
}

// ---------------------------------------------------------------------------------------
// Capturing
// ---------------------------------------------------------------------------------------

const PAGES = ['Queue', 'Calendar', 'Clips', 'Autopost', 'Channels', 'Templates', 'Settings']

export async function captureScreens(
  window: BrowserWindow,
  dir: string,
  seed: () => Promise<void>
): Promise<void> {
  const out = join(dir, 'shots')
  mkdirSync(out, { recursive: true })
  const wc = window.webContents
  let n = 0

  const js = <T>(code: string): Promise<T> => wc.executeJavaScript(code, true) as Promise<T>
  const settle = (ms = 900) => sleep(ms)
  const shot = async (name: string) => {
    await settle(350)
    // capturePage can fail while the compositor is busy (after a reload); try a few times.
    let image: Electron.NativeImage | null = null
    for (let attempt = 0; !image; attempt++) {
      try {
        image = await window.capturePage()
      } catch (error) {
        if (attempt >= 4) throw error
        await settle(1000)
      }
    }
    const size = image.getSize()
    const small = image.resize({ width: Math.round(size.width / 2) })
    n += 1
    writeFileSync(join(out, `${String(n).padStart(2, '0')}-${name}.png`), small.toPNG())
  }
  const go = async (label: string) => {
    await js(
      `[...document.querySelectorAll('nav[aria-label="Main"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`
    )
    await settle()
  }
  const click = async (text: string) => {
    const found = await js<boolean>(`(() => {
      const el = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], tr, [role="row"]')]
        .find(e => e.textContent.trim() === ${JSON.stringify(text)} || e.getAttribute('aria-label') === ${JSON.stringify(text)})
      el?.click(); return Boolean(el)
    })()`)
    if (!found) logger.warn('[screenshots] nothing to click:', text)
    await settle()
    return found
  }
  const escape = async () => {
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await settle(500)
  }
  const scroll = async (fraction: number) => {
    await js(
      `(() => { const el = document.querySelector('main .overflow-auto'); if (el) el.scrollTop = (el.scrollHeight - el.clientHeight) * ${fraction} })()`
    )
    await settle(400)
  }
  const tall = async (name: string) => {
    await scroll(0)
    await shot(`${name}-top`)
    const more = await js<boolean>(
      `(() => { const el = document.querySelector('main .overflow-auto'); return !!el && el.scrollHeight > el.clientHeight + 40 })()`
    )
    if (more) {
      await scroll(0.5)
      await shot(`${name}-middle`)
      await scroll(1)
      await shot(`${name}-bottom`)
      await scroll(0)
    }
  }

  window.setSize(1280, 820)
  await settle(2500)

  // 1. Empty: a new install (Google client file imported, nothing else).
  for (const page of PAGES) {
    await go(page)
    await shot(`empty-${page.toLowerCase()}`)
  }
  await go('Queue')
  emitToRenderer('ui:newPost', undefined)
  await settle()
  await shot('empty-new-post')
  await escape()

  // 2. With demo data.
  logger.info('[screenshots] seeding demo data')
  await seed()
  logger.info('[screenshots] seeded; reloading')
  window.show()
  window.focus()
  const loaded = new Promise<void>((resolve) => wc.once('did-finish-load', () => resolve()))
  wc.reload()
  await loaded
  await settle(2500)
  for (const page of PAGES) {
    await go(page)
    await tall(`data-${page.toLowerCase()}`)
  }

  await go('Queue')
  emitToRenderer('ui:newPost', undefined)
  await settle()
  await shot('data-new-post')
  await click('From clip library…')
  await shot('data-clip-library')
  await escape()
  await escape()

  await go('Autopost')
  if (await click('New rule')) {
    await shot('data-new-rule')
    await escape()
  }

  await go('Templates')
  if (await click('New template')) {
    await shot('data-new-template')
    await escape()
  }

  // 3. The smallest window the app allows.
  window.setSize(960, 600)
  await settle(800)
  for (const page of ['Queue', 'Clips', 'Calendar', 'Settings']) {
    await go(page)
    await shot(`small-${page.toLowerCase()}`)
  }
  logger.info(`[screenshots] saved ${n} screenshots to ${out}`)
}
