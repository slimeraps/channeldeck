import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import type { AccountView, RemovePostsAction } from '@shared/schemas/account'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { accountsKey } from '@renderer/hooks/useAccounts'
import { invoke } from '@renderer/lib/ipc'

export function RemoveChannelDialog({
  account,
  onClose
}: {
  account: AccountView
  onClose: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [action, setAction] = useState<RemovePostsAction>('cancel')
  const [moveTo, setMoveTo] = useState<number | undefined>(undefined)

  const preview = useQuery({
    queryKey: ['accounts', 'removalPreview', account.id],
    queryFn: () => invoke('accounts:removalPreview', { accountId: account.id })
  })

  const remove = useMutation({
    mutationFn: () =>
      invoke('accounts:remove', {
        accountId: account.id,
        postsAction: action,
        ...(action === 'move' && moveTo !== undefined ? { moveToAccountId: moveTo } : {})
      }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: accountsKey })
      toast.success(
        result.revoked
          ? `Removed ${account.channelTitle} and revoked its access`
          : `Removed ${account.channelTitle} (its Google access was already gone)`
      )
      onClose()
    },
    onError: (error) => toast.error(error.message)
  })

  const pending = preview.data?.pendingPosts ?? 0
  const targets = preview.data?.moveTargets ?? []
  const blocked = (preview.data?.inProgress ?? 0) > 0
  const canConfirm =
    preview.isSuccess &&
    !blocked &&
    (action !== 'move' || moveTo !== undefined) &&
    !remove.isPending

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {account.channelTitle}?</AlertDialogTitle>
          <AlertDialogDescription>
            ChannelDeck signs out of this channel and revokes its access at Google. Videos already
            on YouTube stay exactly as they are. You can add the channel again later.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {blocked ? (
          <p className="text-sm text-destructive">
            An upload for this channel is in progress. Wait for it to finish first.
          </p>
        ) : null}

        {pending > 0 ? (
          <div className="space-y-3">
            <p className="text-sm">
              {pending} post{pending === 1 ? '' : 's'} for this channel{' '}
              {pending === 1 ? "hasn't" : "haven't"} been uploaded yet. What should happen to{' '}
              {pending === 1 ? 'it' : 'them'}?
            </p>
            <RadioGroup value={action} onValueChange={(v) => setAction(v as RemovePostsAction)}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="cancel" id="rm-cancel" />
                <Label htmlFor="rm-cancel">Cancel them (clips go back to the bank)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="drafts" id="rm-drafts" />
                <Label htmlFor="rm-drafts">Keep them as drafts</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="move" id="rm-move" disabled={targets.length === 0} />
                <Label htmlFor="rm-move">Move them to another channel</Label>
              </div>
            </RadioGroup>
            {action === 'move' ? (
              <Select value={moveTo?.toString()} onValueChange={(v) => setMoveTo(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a channel" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Keep channel</AlertDialogCancel>
          <Button variant="destructive" disabled={!canConfirm} onClick={() => remove.mutate()}>
            Remove channel
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
