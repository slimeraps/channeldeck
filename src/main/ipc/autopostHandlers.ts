import { getAutopost, getLayouts, getPosts } from '../services'
import { handle } from './handle'

export function registerAutopostHandlers(): void {
  handle('posts:approve', ({ id }) => getPosts().approve(id))

  handle('autopost:list', () => getAutopost().list())
  handle('autopost:save', ({ id, input }) => getAutopost().save(input, id))
  handle('autopost:delete', ({ id, cancelUpcoming }) => getAutopost().remove(id, cancelUpcoming))
  handle('autopost:setEnabled', ({ id, enabled }) => getAutopost().setEnabled(id, enabled))
  handle('autopost:preview', (input) => getAutopost().preview(input))
  handle('autopost:approveAll', ({ id }) => getAutopost().approveAll(id))
  handle('autopost:forecast', () => getAutopost().forecast())

  handle('layouts:list', () => getLayouts().list())
  handle('layouts:save', ({ id, input }) => getLayouts().save(input, id))
  handle('layouts:delete', ({ id }) => getLayouts().remove(id))
  handle('layouts:sampleFrame', (input) => getLayouts().sampleFrame(input))
  handle('layouts:testRender', (input) => getLayouts().testRender(input))
}
