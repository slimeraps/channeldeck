import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { styleFromSpec, type EditSpec } from '@shared/schemas/edit'
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
import { stylesKey } from '@renderer/hooks/useEditStyles'
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
    </Dialog>
  )
}
