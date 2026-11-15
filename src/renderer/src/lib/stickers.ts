import { CANVAS_SIZES } from '@shared/geometry'
import { type EditOverlay, type EditSpec, overlaysOf } from '@shared/schemas/edit'
import { invoke } from '@renderer/lib/ipc'

/**
 * Sticker and logo images for the editor's preview. Stills are decoded once; GIFs are decoded
 * frame by frame (WebCodecs ImageDecoder) so the preview can show exactly the frame the render
 * shows at any moment: the render starts a GIF when its sticker appears and loops it.
 */

export type StickerImage =
  | { kind: 'still'; image: ImageBitmap; width: number; height: number }
  | {
      kind: 'animated'
      /** Each frame and when it ends, in ms from the start of the loop. */
      frames: { image: ImageBitmap; untilMs: number }[]
      totalMs: number
      width: number
      height: number
    }

/** At most this many GIF frames are kept (a long GIF still plays, just not every frame). */
const MAX_FRAMES = 300
const cache = new Map<string, Promise<StickerImage>>()

/** Decodes every frame of a GIF (with its timing) from the file's bytes. */
async function decodeGif(fileName: string): Promise<StickerImage> {
  const bytes = await invoke('editor:assetBytes', { fileName })
  const Decoder = (window as unknown as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder
  if (!Decoder) {
    const image = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/gif' }))
    return { kind: 'still', image, width: image.width, height: image.height }
  }
  const decoder = new Decoder({ data: bytes, type: 'image/gif' })
  await decoder.completed
  const count = Math.min(MAX_FRAMES, decoder.tracks.selectedTrack?.frameCount ?? 1)
  const frames: { image: ImageBitmap; untilMs: number }[] = []
  let at = 0
  for (let i = 0; i < count; i++) {
    const { image } = await decoder.decode({ frameIndex: i })
    // GIFs that say 0 ms per frame play at 10 fps in browsers (and close to it in ffmpeg).
    const ms = image.duration ? Math.max(20, image.duration / 1000) : 100
    at += ms
    frames.push({ image: await createImageBitmap(image), untilMs: at })
    image.close()
  }
  decoder.close()
  const first = frames[0]?.image
  return {
    kind: 'animated',
    frames,
    totalMs: Math.max(1, at),
    width: first?.width ?? 1,
    height: first?.height ?? 1
  }
}

/** A still image through an <img> (cdmedia:// is allowed for images, not for fetch). */
function loadStill(url: string): Promise<StickerImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      createImageBitmap(img)
        .then((image) =>
          resolve({ kind: 'still', image, width: image.width, height: image.height })
        )
        .catch(reject)
    }
    img.onerror = () => reject(new Error(`Couldn't load ${url}`))
    img.src = url
  })
}

/** Loads (once) the image for a sticker file. */
export function loadSticker(fileName: string, url: string): Promise<StickerImage> {
  let pending = cache.get(fileName)
  if (!pending) {
    pending = fileName.endsWith('.gif') ? decodeGif(fileName) : loadStill(url)
    // A failed load can be tried again later.
    pending.catch(() => cache.delete(fileName))
    cache.set(fileName, pending)
  }
  return pending
}

/** The frame of a sticker to show `ms` after it appears. */
export function stickerFrame(image: StickerImage, ms: number): ImageBitmap | null {
  if (image.kind === 'still') return image.image
  const at = ((ms % image.totalMs) + image.totalMs) % image.totalMs
  return (image.frames.find((f) => at < f.untilMs) ?? image.frames.at(-1))?.image ?? null
}

export interface StickerHit {
  id: string
  /** Bounding box in output pixels. */
  box: { x: number; y: number; width: number; height: number }
}

/** Where a sticker sits on the canvas (output pixels), given its image's shape. */
export function stickerBox(
  overlay: EditOverlay,
  spec: Pick<EditSpec, 'canvas'>,
  image: { width: number; height: number }
): StickerHit['box'] {
  const size = CANVAS_SIZES[spec.canvas]
  const width = overlay.width * size.width
  const height = (width * image.height) / Math.max(1, image.width)
  return {
    x: overlay.x * size.width - width / 2,
    y: overlay.y * size.height - height / 2,
    width,
    height
  }
}

/** Draws the stickers on screen at output time `t` (under the text) and returns where they are. */
export function drawStickers(
  ctx: CanvasRenderingContext2D,
  spec: EditSpec,
  t: number,
  images: ReadonlyMap<string, StickerImage>
): StickerHit[] {
  const size = CANVAS_SIZES[spec.canvas]
  const k = ctx.canvas.width / size.width
  const hits: StickerHit[] = []
  for (const overlay of overlaysOf(spec)) {
    if (t < overlay.startSec || t > overlay.endSec) continue
    const image = images.get(overlay.asset)
    if (!image) continue
    const frame = stickerFrame(image, (t - overlay.startSec) * 1000)
    if (!frame) continue
    const box = stickerBox(overlay, spec, image)
    ctx.save()
    ctx.globalAlpha = overlay.opacity
    ctx.drawImage(frame, box.x * k, box.y * k, box.width * k, box.height * k)
    ctx.restore()
    hits.push({ id: overlay.id, box })
  }
  return hits
}
