import { FileVideo, Loader2, TriangleAlert, Upload, X } from 'lucide-react'
import { useState } from 'react'
import { isVideoPath } from '@shared/constants/limits'
import type { MediaInfo } from '@shared/schemas/post'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { formatBytes, formatDuration } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'

interface Props {
  media: MediaInfo | null
  /** A path is set but couldn't be read (moved or deleted). */
  missingPath: string | null
  busy: boolean
  invalid?: boolean
  onPick: () => void
  onDropPath: (path: string) => void
  onClear: () => void
}

export function MediaPanel({
  media,
  missingPath,
  busy,
  invalid,
  onPick,
  onDropPath,
  onClear
}: Props): React.JSX.Element {
  const [over, setOver] = useState(false)

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = window.api.getPathForFile(file)
    if (path && isVideoPath(path)) onDropPath(path)
  }

  if (media) {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video
            key={media.previewUrl}
            src={media.previewUrl}
            controls
            preload="metadata"
            className={cn('mx-auto block max-h-80', media.height > media.width ? 'h-80' : 'w-full')}
          />
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium" title={media.path}>
              {media.fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDuration(media.durationSec)} · {media.width}×{media.height} ·{' '}
              {media.aspectRatio} · {formatBytes(media.sizeBytes)}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {media.isShort ? (
                <Badge className="bg-red-600 text-white">Short</Badge>
              ) : (
                <Badge variant="outline">Video</Badge>
              )}
              {media.isLong ? (
                <Badge variant="outline" className="border-amber-500/50 text-amber-300">
                  <TriangleAlert aria-hidden />
                  Over 15 min: needs a verified channel
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="outline" onClick={onPick} disabled={busy}>
              Replace
            </Button>
            <Button size="icon" variant="ghost" aria-label="Remove video" onClick={onClear}>
              <X aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 text-center transition-colors',
        over ? 'border-primary bg-primary/5' : 'border-border',
        invalid && 'border-destructive/60'
      )}
    >
      {busy ? (
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <FileVideo className="size-8 text-muted-foreground" aria-hidden />
      )}
      <div>
        <p className="text-sm font-medium">{busy ? 'Reading video…' : 'Drop a video here'}</p>
        <p className="text-xs text-muted-foreground">MP4, MOV, M4V, WebM, MKV…</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onPick} disabled={busy}>
        <Upload aria-hidden />
        Choose file
      </Button>
      {missingPath ? (
        <p className="text-xs text-destructive" title={missingPath}>
          File missing: {missingPath.split('/').pop()}
        </p>
      ) : null}
    </div>
  )
}
