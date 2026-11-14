import { getEditor } from '../services'
import { handle } from './handle'

export function registerEditorHandlers(): void {
  handle('editor:source', ({ path }) => getEditor().source(path))
  handle('editor:strips', ({ path }) => getEditor().strips(path))
  handle('editor:render', ({ spec }) => getEditor().render(spec))
  handle('editor:cancelRender', () => getEditor().cancelRender())
  handle('editor:reveal', ({ path }) => getEditor().reveal(path))
}
