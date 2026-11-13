import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { closeDatabase, initDatabase } from './db'
import { createUploadJob } from './jobs/upload'
import { logger } from './logger'
import { ffmpegPath, renderVertical, runFfmpeg } from './media/ffmpeg'
import { ffprobePath, probeVideo } from './media/ffprobe'
import { getPosts, getYouTubeAccounts, initServices } from './services'

/**
 * Build check (CHANNELDECK_SELF_TEST=<folder>). In a throwaway data folder: opens a new
 * database (runs every migration), makes a 2-second test video with the bundled ffmpeg, reads
 * it with ffprobe, renders a vertical version, then queues it on a fake channel and runs the
 * real upload job in Dry Run. Writes self-test.json and exits 0 only if all of it worked.
 * No network: Dry Run never calls Google.
 */
export async function runSelfTest(): Promise<number> {
  await app.whenReady()
  const dir = app.getPath('userData')
  const report: Record<string, unknown> = {
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: dir
  }
  let ok = false
  try {
    const repos = initDatabase()
    report['migrations'] = 'applied'
    initServices()

    const video = join(dir, 'self-test.mp4')
    await runFfmpeg([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1920x1080:rate=30:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      video
    ])
    report['ffmpeg'] = ffmpegPath()
    const probe = await probeVideo(video)
    report['ffprobe'] = {
      path: ffprobePath(),
      size: `${probe.width}x${probe.height}`,
      durationSec: probe.durationSec
    }

    const vertical = join(dir, 'self-test-vertical.mp4')
    await renderVertical({
      spec: {
        sourcePath: video,
        kind: 'facecam_split',
        crops: {
          facecam: { x: 1440, y: 0, width: 480, height: 270 },
          gameplay: { x: 420, y: 0, width: 1080, height: 1080 }
        }
      },
      video: probe,
      output: vertical,
      maxSeconds: 1
    })
    const rendered = await probeVideo(vertical)
    report['render'] = `${rendered.width}x${rendered.height}`

    repos.settings.update({ dryRun: true })
    const account = repos.accounts.create({
      channelId: 'UC_CHANNELDECK_SELF_TEST',
      channelTitle: 'Self-test channel'
    })
    const post = await getPosts().save({
      mode: 'queue',
      input: {
        accountId: account.id,
        filePath: video,
        title: 'ChannelDeck self-test',
        description: 'Dry Run only.',
        tags: [],
        categoryId: '20',
        playlistId: null,
        thumbnailPath: null,
        madeForKids: false,
        notifySubscribers: false,
        license: 'youtube',
        embeddable: true,
        defaultLanguage: null,
        defaultAudioLanguage: null,
        syntheticMedia: false,
        visibilityMode: 'private',
        publishAtUtc: null,
        missedPolicy: 'ask'
      }
    })
    const upload = createUploadJob({
      repos,
      withApi: (id, fn) => getYouTubeAccounts().withApi(id, fn),
      notify: () => {},
      emitChanged: () => {},
      emitProgress: () => {},
      logger
    })
    await upload.run(post.id, new AbortController().signal)
    const row = repos.posts.require(post.id)
    report['upload'] = { status: row.status, videoId: row.youtubeVideoId, error: row.lastError }
    ok =
      rendered.width === 1080 &&
      rendered.height === 1920 &&
      row.status === 'processing' &&
      Boolean(row.youtubeVideoId?.startsWith('DRYRUN-'))
  } catch (error) {
    report['error'] = error instanceof Error ? error.message : String(error)
  }
  report['ok'] = ok
  const text = JSON.stringify(report, null, 2)
  writeFileSync(join(dir, 'self-test.json'), `${text}\n`)
  logger.info(`[self-test] ${ok ? 'passed' : 'FAILED'}`, report)
  process.stdout.write(`${text}\n`)
  closeDatabase()
  return ok ? 0 : 1
}
