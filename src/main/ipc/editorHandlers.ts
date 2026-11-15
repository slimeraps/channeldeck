import { getEditor } from '../services'
import { handle } from './handle'

export function registerEditorHandlers(): void {
  handle('editor:source', ({ path }) => getEditor().source(path))
  handle('editor:strips', ({ path }) => getEditor().strips(path))
  handle('editor:render', ({ spec }) => getEditor().render(spec))
  handle('editor:cancelRender', () => getEditor().cancelRender())
  handle('editor:reveal', ({ path }) => getEditor().reveal(path))
  handle('editor:export', ({ spec }) => getEditor().exportFile(spec))
  handle('editor:postedClips', ({ accountId, clipIds }) =>
    getEditor().postedClips(accountId, clipIds)
  )
  handle('editor:listProjects', () => getEditor().listProjects())
  handle('editor:createProject', ({ spec, name }) => getEditor().createProject(spec, name))
  handle('editor:getProject', ({ id }) => getEditor().getProject(id))
  handle('editor:saveProject', ({ id, spec }) => getEditor().saveProject(id, spec))
  handle('editor:renameProject', ({ id, name }) => getEditor().renameProject(id, name))
  handle('editor:captionModel', () => getEditor().captionModel())
  handle('editor:downloadCaptionModel', async () => {
    await getEditor().downloadCaptionModel()
    return { ready: true }
  })
  handle('editor:cancelModelDownload', () => getEditor().cancelModelDownload())
  handle('editor:makeCaptions', ({ paths }) => getEditor().makeCaptions(paths))
  handle('editor:listAssets', () => getEditor().listAssets())
  handle('editor:assetBytes', ({ fileName }) => getEditor().assetBytes(fileName))
  handle('editor:importAssets', () => getEditor().importAssets())
  handle('editor:deleteAsset', async ({ id }) => {
    await getEditor().deleteAsset(id)
    return { deleted: true }
  })
  handle('editor:deleteProject', async ({ id }) => {
    await getEditor().deleteProject(id)
    return { deleted: true }
  })
}
