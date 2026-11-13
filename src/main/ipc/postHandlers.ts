import { dialog, shell } from 'electron'
import { THUMBNAIL_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/constants/limits'
import { getMainWindow } from '../appWindow'
import { getRepos } from '../db'
import { syncStatusNow, uploadsPausedUntil } from '../jobs'
import { getPosts } from '../services'
import { handle } from './handle'

async function pickFile(
  title: string,
  name: string,
  extensions: readonly string[]
): Promise<string | null> {
  const window = getMainWindow()
  const options: Electron.OpenDialogOptions = {
    title,
    properties: ['openFile'],
    filters: [{ name, extensions: [...extensions] }]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

export function registerPostHandlers(): void {
  const posts = (): ReturnType<typeof getPosts> => getPosts()

  handle('media:pickVideo', async () => {
    const path = await pickFile('Choose a video', 'Videos', VIDEO_EXTENSIONS)
    return path ? posts().inspectVideo(path) : null
  })
  handle('media:inspectVideo', ({ path }) => posts().inspectVideo(path))
  handle('media:pickThumbnail', async () => {
    const path = await pickFile('Choose a thumbnail', 'JPG or PNG', THUMBNAIL_EXTENSIONS)
    return path ? posts().inspectThumbnail(path) : null
  })
  handle('media:inspectThumbnail', ({ path }) => posts().inspectThumbnail(path))

  handle('posts:list', (filter) => posts().list(filter))
  handle('posts:get', ({ id }) => posts().get(id))
  handle('posts:save', (input) => posts().save(input))
  handle('posts:duplicate', ({ id, accountId }) => posts().duplicate(id, accountId))
  handle('posts:cancel', ({ id }) => posts().cancel(id))
  handle('posts:deleteDraft', ({ id }) => {
    posts().deleteDraft(id)
    return { deleted: true }
  })
  handle('posts:uploadNow', ({ id }) => posts().uploadNow(id))
  handle('posts:retry', ({ id }) => posts().retry(id))
  handle('posts:decide', (input) =>
    posts().decide(
      input.id,
      input.action === 'publish_now'
        ? { action: 'publish_now' }
        : { action: 'reschedule', publishAtUtc: input.publishAtUtc }
    )
  )
  handle('posts:reschedule', ({ id, publishAtUtc }) => posts().reschedule(id, publishAtUtc))
  handle('posts:keepPrivate', ({ id }) => posts().keepPrivate(id))
  handle('posts:deleteFromYouTube', ({ id }) => posts().deleteFromYouTube(id))
  handle('posts:syncStatus', () => syncStatusNow())

  handle('settings:get', () => ({
    settings: getRepos().settings.get(),
    uploadsPausedUntil: uploadsPausedUntil()?.toISOString() ?? null
  }))
  handle('settings:update', (patch) => getRepos().settings.update(patch))

  handle('posts:reveal', ({ id }) => {
    shell.showItemInFolder(posts().filePathFor(id))
    return { revealed: true }
  })
}
