import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { EditorAsset } from '@shared/schemas/editor'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { assetsKey, useEditorAssets } from '@renderer/hooks/useEditorSources'
import { invoke } from '@renderer/lib/ipc'

/**
 * The sticker and logo library: your imported images. Pick one to add it to the edit (as a
 * sticker, or as a logo watermark for the whole video), import more, or delete ones you don't
 * use. Everything stays on your Mac.
 */
export function AssetLibrary({
  purpose,
  onPick,
  onClose
}: {
  purpose: 'sticker' | 'logo'
  onPick: (asset: EditorAsset) => void
  onClose: () => void
}): React.JSX.Element {
  const assets = useEditorAssets()
  const qc = useQueryClient()
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<EditorAsset | null>(null)
  const list = assets.data ?? []

  async function importImages(): Promise<void> {
    setImporting(true)
    try {
      const added = await invoke('editor:importAssets')
      await qc.invalidateQueries({ queryKey: assetsKey })
      // Importing a single logo uses it right away.
      if (purpose === 'logo' && added.length === 1 && added[0]) onPick(added[0])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function remove(asset: EditorAsset): Promise<void> {
    try {
      await invoke('editor:deleteAsset', { id: asset.id })
      await qc.invalidateQueries({ queryKey: assetsKey })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{purpose === 'logo' ? 'Pick your logo' : 'Add a sticker'}</DialogTitle>
          <DialogDescription>
            {purpose === 'logo'
              ? 'Your logo goes in the top right for the whole video, a little see-through. You can move and resize it after.'
              : 'Stickers can be PNG, JPG, WebP or GIF (GIFs play). A PNG with a transparent background looks best.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void importImages()}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <ImagePlus aria-hidden />
            )}
            Import images…
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {assets.isSuccess && list.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No images yet. Import a logo, an emote or any PNG or GIF to use it here.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {list.map((asset) => (
                <div key={asset.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onPick(asset)}
                    className="flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary"
                  >
                    <div className="grid aspect-square place-items-center bg-[repeating-conic-gradient(#263241_0_25%,#161d28_0_50%)] bg-[length:16px_16px] p-2">
                      <img
                        src={asset.url}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <span className="truncate px-2 py-1 text-xs">{asset.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${asset.name}`}
                    onClick={() => setDeleting(asset)}
                    className="absolute top-1 right-1 rounded bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                It's removed from the library. Images that a project or an unposted post still uses
                can't be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => deleting && void remove(deleting)}
              >
                Delete image
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
