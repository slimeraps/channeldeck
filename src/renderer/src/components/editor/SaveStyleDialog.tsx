import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { styleFromSpec, type EditSpec } from '@shared/schemas/edit'
import { Trash2 } from 'lucide-react'
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
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { stylesKey, useEditStyles } from '@renderer/hooks/useEditStyles'
import { invoke } from '@renderer/lib/ipc'

/** Saves the look of the edit (text, stickers, captions) so an autopost rule can use it. */
export function SaveStyleDialog({
  spec,
  onClose
}: {
  spec: EditSpec
  onClose: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const styles = useEditStyles()
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null)

  const style = styleFromSpec(spec)
  const parts = [
    style.texts.length > 0
      ? `${style.texts.length} text layer${style.texts.length === 1 ? '' : 's'}`
      : null,
    style.overlays.length > 0
      ? `${style.overlays.length} sticker${style.overlays.length === 1 ? '' : 's'}`
      : null,
    style.captions ? 'auto captions' : null
  ].filter(Boolean)

  async function remove(id: number): Promise<void> {
    try {
      await invoke('editor:deleteStyle', { id })
      await qc.invalidateQueries({ queryKey: stylesKey })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRemoving(null)
    }
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await invoke('editor:saveStyle', { name, spec })
      await qc.invalidateQueries({ queryKey: stylesKey })
      toast.success(`Saved the style "${name.trim()}". Pick it in an autopost rule.`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as style</DialogTitle>
          <DialogDescription>
            {parts.length > 0
              ? `Keeps ${parts.join(', ')}, without the footage. An autopost rule can put it on every clip it posts. Text may use {{clip_title}} and the other variables.`
              : 'Add some text, a sticker or captions first. A style is the look of an edit.'}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder="Style name, like Big title + captions"
          aria-label="Style name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && parts.length > 0 && void save()}
        />
        {(styles.data ?? []).length > 0 ? (
          <div className="max-h-40 space-y-1 overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              Your styles. Click one to replace it with this edit's look.
            </p>
            {(styles.data ?? []).map((st) => (
              <div key={st.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => setName(st.name)}
                >
                  {st.name}
                  {st.usedByRules > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · {st.usedByRules} rule{st.usedByRules === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete the style ${st.name}`}
                  onClick={() => setRemoving({ id: st.id, name: st.name })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || parts.length === 0 || saving}
            onClick={() => void save()}
          >
            Save style
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the style “{removing?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Posts already planned keep their look. A style an autopost rule uses can’t be deleted
              until you pick another one there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && void remove(removing.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
