import anton from '../../../../resources/fonts/Anton-Regular.ttf?url'
import archivoBlack from '../../../../resources/fonts/ArchivoBlack-Regular.ttf?url'
import bebasNeue from '../../../../resources/fonts/BebasNeue-Regular.ttf?url'
import type { EditFont } from '@shared/schemas/edit'

/**
 * The editor's text fonts: the same files ffmpeg uses for the render (resources/fonts),
 * loaded once into the page so the preview draws with them.
 */
const FILES: Record<EditFont, string> = {
  'Archivo Black': archivoBlack,
  Anton: anton,
  'Bebas Neue': bebasNeue
}

let loading: Promise<void> | null = null

/** Resolves when every editor font can be drawn (fonts that fail to load are skipped). */
export function loadEditorFonts(): Promise<void> {
  loading ??= Promise.all(
    (Object.entries(FILES) as [EditFont, string][]).map(async ([family, url]) => {
      const face = new FontFace(family, `url("${url}")`)
      try {
        document.fonts.add(await face.load())
      } catch {
        // The preview falls back to a system font; the render still uses the right one.
      }
    })
  ).then(() => undefined)
  return loading
}
