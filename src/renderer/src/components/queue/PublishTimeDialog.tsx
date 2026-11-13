import { useState } from 'react'
import { defaultPublishAt } from '@shared/lib/time'
import { PublishTimeField } from '@renderer/components/post-editor/PublishTimeField'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'

interface Props {
  title: string
  description: string
  initial: string | null
  confirmLabel: string
  busy?: boolean
  onConfirm: (publishAtUtc: string) => void
  onClose: () => void
}

/** Pick a new publish time (Needs decision, or rescheduling an uploaded video). */
export function PublishTimeDialog({
  title,
  description,
  initial,
  confirmLabel,
  busy,
  onConfirm,
  onClose
}: Props): React.JSX.Element {
  // When the dialog opened; "a minute from now" is measured from here.
  const [openedAt] = useState(() => Date.now())
  const [value, setValue] = useState<string | null>(() =>
    initial && Date.parse(initial) > openedAt ? initial : defaultPublishAt()
  )
  const valid = value !== null && Date.parse(value) > openedAt + 60_000
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <PublishTimeField value={value} onChange={setValue} invalid={!valid} />
        {!valid ? (
          <p className="text-xs text-destructive">Pick a time at least a minute from now.</p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={() => value && onConfirm(value)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
