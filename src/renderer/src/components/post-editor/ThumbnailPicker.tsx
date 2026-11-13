import { ImagePlus, X } from 'lucide-react'
import { isThumbnailPath } from '@shared/constants/limits'
import type { ThumbnailInfo } from '@shared/schemas/post'
import { Button } from '@renderer/components/ui/button'
import { formatBytes } from '@renderer/lib/status'

interface Props {
  thumbnail: ThumbnailInfo | null
  onPick: () => void
  onDropPath: (path: string) => void
  onClear: () => void
}

/** Custom thumbnail: JPG or PNG up to 2 MB, with a 16:9 preview. */
export function ThumbnailPicker({
  thumbnail,
  onPick,
  onDropPath,
  onClear
}: Props): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3"
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const file = e.dataTransfer.files[0]
        const path = file ? window.api.getPathForFile(file) : ''
        if (path && isThumbnailPath(path)) onDropPath(path)
      }}
    >
      <div className="flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {thumbnail ? (
          <img
            src={thumbnail.previewUrl}
            alt="Thumbnail preview"
            className="size-full object-cover"
          />
        ) : (
          <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        {thumbnail ? (
          <p className="truncate text-xs text-muted-foreground" title={thumbnail.path}>
            {thumbnail.fileName} · {formatBytes(thumbnail.sizeBytes)}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            JPG or PNG, up to 2 MB. Drop one here or choose.
          </p>
        )}
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onPick}>
            {thumbnail ? 'Replace' : 'Choose image'}
          </Button>
          {thumbnail ? (
            <Button size="icon" variant="ghost" aria-label="Remove thumbnail" onClick={onClear}>
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
