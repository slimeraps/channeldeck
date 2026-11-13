import { getAutopost, getLayouts, getPosts, getTemplates } from '../services'
import { handle } from './handle'

export function registerAutopostHandlers(): void {
  handle('posts:approve', ({ id }) => getPosts().approve(id))
  handle('posts:renderVertical', ({ sourcePath, kind, presetId }) =>
    getPosts().renderVertical(sourcePath, { kind, presetId })
  )

  handle('autopost:list', () => getAutopost().list())
  handle('autopost:save', ({ id, input }) => getAutopost().save(input, id))
  handle('autopost:delete', ({ id, cancelUpcoming }) => getAutopost().remove(id, cancelUpcoming))
  handle('autopost:setEnabled', ({ id, enabled }) => getAutopost().setEnabled(id, enabled))
  handle('autopost:preview', (input) => getAutopost().preview(input))
  handle('autopost:approveAll', ({ id }) => getAutopost().approveAll(id))
  handle('autopost:forecast', () => getAutopost().forecast())
  handle('autopost:swapCandidates', ({ id }) => getAutopost().swapCandidates(id))
  handle('autopost:swapClip', ({ id, clipId }) => getAutopost().swapClip(id, clipId))

  handle('layouts:list', () => getLayouts().list())
  handle('layouts:save', ({ id, input }) => getLayouts().save(input, id))
  handle('layouts:delete', ({ id }) => getLayouts().remove(id))
  handle('layouts:sampleFrame', (input) => getLayouts().sampleFrame(input))
  handle('layouts:testRender', (input) => getLayouts().testRender(input))

  handle('templates:list', () => getTemplates().listTemplates())
  handle('templates:save', ({ id, input }) => getTemplates().saveTemplate(input, id))
  handle('templates:delete', ({ id }) => getTemplates().deleteTemplate(id))
  handle('series:list', () => getTemplates().listSeries())
  handle('series:save', ({ id, input }) => getTemplates().saveSeries(input, id))
  handle('series:delete', ({ id }) => getTemplates().deleteSeries(id))
}
