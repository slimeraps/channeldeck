import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { accountDefaultsSchema, type AccountView } from '@shared/schemas/account'
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
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { useUpdateAccount } from '@renderer/hooks/useAccounts'
import { invoke } from '@renderer/lib/ipc'

const NONE = '__none__'

type Defaults = AccountView['defaults']

interface Props {
  account: AccountView
  onClose: () => void
}

function Field({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Defaults applied to new posts for one channel (category, tags, playlist, ...). */
export function ChannelDefaultsDialog({ account, onClose }: Props): React.JSX.Element {
  const update = useUpdateAccount()
  const qc = useQueryClient()
  const [form, setForm] = useState<Defaults>(account.defaults)
  const [tagsText, setTagsText] = useState((account.defaults.tags ?? []).join(', '))
  const [error, setError] = useState<string | null>(null)

  const categories = useQuery({
    queryKey: ['youtube', 'categories'],
    queryFn: () => invoke('youtube:categories', { accountId: account.id }),
    staleTime: Infinity
  })
  const playlists = useQuery({
    queryKey: ['youtube', 'playlists', account.id],
    queryFn: () => invoke('youtube:playlists', { accountId: account.id }),
    staleTime: 5 * 60 * 1000
  })

  // Empty values are stored as "not set" (undefined), not as empty strings.
  const set = <K extends keyof Defaults>(key: K, value: Defaults[K] | undefined): void =>
    setForm((f) => ({ ...f, [key]: value === '' ? undefined : value }))

  const save = (): void => {
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    // Drop unset keys so the stored JSON only holds real defaults.
    const candidate = Object.fromEntries(
      Object.entries({ ...form, tags: tags.length ? tags : undefined }).filter(
        ([, v]) => v !== undefined
      )
    )
    const parsed = accountDefaultsSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the fields')
      return
    }
    update.mutate(
      { accountId: account.id, defaults: parsed.data },
      {
        onSuccess: () => {
          toast.success(`Saved defaults for ${account.channelTitle}`)
          onClose()
        }
      }
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Defaults for {account.channelTitle}</DialogTitle>
          <DialogDescription>New posts on this channel start with these values.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category" htmlFor="d-category">
              <Select
                value={form.categoryId ?? NONE}
                onValueChange={(v) => set('categoryId', v === NONE ? undefined : v)}
              >
                <SelectTrigger id="d-category" className="w-full">
                  <SelectValue placeholder={categories.isLoading ? 'Loading…' : 'None'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(categories.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Made for kids" htmlFor="d-kids">
              <Select
                value={form.madeForKids === undefined ? NONE : form.madeForKids ? 'yes' : 'no'}
                onValueChange={(v) => set('madeForKids', v === NONE ? undefined : v === 'yes')}
              >
                <SelectTrigger id="d-kids" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Ask each time</SelectItem>
                  <SelectItem value="no">No, not made for kids</SelectItem>
                  <SelectItem value="yes">Yes, made for kids</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Playlist" htmlFor="d-playlist">
            <div className="flex gap-2">
              <Select
                value={form.playlistId ?? NONE}
                onValueChange={(v) => set('playlistId', v === NONE ? undefined : v)}
              >
                <SelectTrigger id="d-playlist" className="w-full">
                  <SelectValue placeholder={playlists.isLoading ? 'Loading…' : 'None'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(playlists.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title} ({p.itemCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                aria-label="Refresh playlists"
                onClick={async () => {
                  const fresh = await invoke('youtube:playlists', {
                    accountId: account.id,
                    refresh: true
                  }).catch((e: Error) => {
                    toast.error(e.message)
                    return null
                  })
                  if (fresh) qc.setQueryData(['youtube', 'playlists', account.id], fresh)
                }}
              >
                <RefreshCw aria-hidden />
              </Button>
            </div>
            {categories.isError || playlists.isError ? (
              <p className="text-xs text-destructive">
                {(categories.error ?? playlists.error)?.message}
              </p>
            ) : null}
          </Field>

          <Field label="Tags" htmlFor="d-tags" hint="Comma-separated, e.g. drift, cars, track day">
            <Input id="d-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Language" htmlFor="d-lang">
              <Input
                id="d-lang"
                placeholder="en"
                value={form.defaultLanguage ?? ''}
                onChange={(e) => set('defaultLanguage', e.target.value.trim())}
              />
            </Field>
            <Field label="Audio language" htmlFor="d-audio">
              <Input
                id="d-audio"
                placeholder="en"
                value={form.defaultAudioLanguage ?? ''}
                onChange={(e) => set('defaultAudioLanguage', e.target.value.trim())}
              />
            </Field>
            <Field label="License" htmlFor="d-license">
              <Select
                value={form.license ?? 'youtube'}
                onValueChange={(v) => set('license', v as Defaults['license'])}
              >
                <SelectTrigger id="d-license" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="youtube">Standard YouTube</SelectItem>
                  <SelectItem value="creativeCommon">Creative Commons</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            label="Description footer"
            htmlFor="d-footer"
            hint="Added to the end of every description."
          >
            <Textarea
              id="d-footer"
              rows={3}
              value={form.descriptionFooter ?? ''}
              onChange={(e) => set('descriptionFooter', e.target.value)}
            />
          </Field>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            Save defaults
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
