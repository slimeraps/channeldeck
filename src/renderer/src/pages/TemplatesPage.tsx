import { FileText, Hash, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  type SeriesInput,
  seriesInputSchema,
  type SeriesView,
  type TemplateInput,
  templateInputSchema,
  type TemplateView
} from '@shared/schemas/templates'
import { POST_TEMPLATE_VARS, renderPostVariables } from '@shared/templates'
import { EmptyState } from '@renderer/components/EmptyState'
import { TagInput } from '@renderer/components/post-editor/TagInput'
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
import { Badge } from '@renderer/components/ui/badge'
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
import { useAccounts } from '@renderer/hooks/useAccounts'
import { useSeries, useTemplateAction, useTemplates } from '@renderer/hooks/useTemplates'
import { invoke } from '@renderer/lib/ipc'

const ANY = '__any__'

function ChannelSelect({
  value,
  onChange
}: {
  value: number | null
  onChange: (id: number | null) => void
}): React.JSX.Element {
  const accounts = useAccounts()
  return (
    <Select
      value={value ? String(value) : ANY}
      onValueChange={(v) => onChange(v === ANY ? null : Number(v))}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any channel</SelectItem>
        {(accounts.data ?? []).map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            <span className="size-2 rounded-full" style={{ background: a.color }} aria-hidden />
            {a.channelTitle}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TemplateDialog({
  template,
  onClose
}: {
  template: TemplateView | null
  onClose: () => void
}): React.JSX.Element {
  const [input, setInput] = useState<TemplateInput>(
    template?.input ?? {
      name: '',
      accountId: null,
      titleTpl: '',
      descriptionTpl: '',
      tags: []
    }
  )
  const save = useTemplateAction(
    (v: { id?: number; input: TemplateInput }) => invoke('templates:save', v),
    (t) => `Saved template "${t.input.name}"`
  )
  const parsed = templateInputSchema.safeParse(input)
  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]): void =>
    setInput((p) => ({ ...p, [k]: v }))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? `Edit “${template.input.name}”` : 'New template'}</DialogTitle>
          <DialogDescription>
            Starts a post with this title, description and tags. {'{{n}}'} needs a series;{' '}
            {'{{date}}'} and {'{{channel}}'} are filled in when the post is queued.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                value={input.name}
                placeholder="MW4 daily"
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Offer it for</Label>
              <ChannelSelect value={input.accountId} onChange={(id) => set('accountId', id)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {POST_TEMPLATE_VARS.map((v) => (
              <button
                key={v.name}
                type="button"
                title={v.label}
                className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
                onClick={() => set('titleTpl', `${input.titleTpl}{{${v.name}}}`)}
              >
                {`{{${v.name}}}`}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-title">Title</Label>
            <Input
              id="tpl-title"
              value={input.titleTpl}
              placeholder="MW4 Day {{n}}"
              onChange={(e) => set('titleTpl', e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea
              id="tpl-desc"
              rows={5}
              value={input.descriptionTpl}
              onChange={(e) => set('descriptionTpl', e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-tags">Tags</Label>
            <TagInput id="tpl-tags" value={input.tags} onChange={(tags) => set('tags', tags)} />
          </div>
        </div>
        <DialogFooter>
          {!parsed.success ? (
            <span className="mr-auto self-center text-xs text-muted-foreground">
              {parsed.error.issues[0]?.message}
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!parsed.success || save.isPending}
            onClick={() =>
              parsed.success &&
              save.mutate(
                { ...(template ? { id: template.id } : {}), input: parsed.data },
                { onSuccess: onClose }
              )
            }
          >
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SeriesDialog({
  series,
  templates,
  onClose
}: {
  series: SeriesView | null
  templates: TemplateView[]
  onClose: () => void
}): React.JSX.Element {
  const [input, setInput] = useState<SeriesInput>(
    series?.input ?? {
      name: '',
      templateId: templates[0]?.id ?? 0,
      accountId: null,
      nextNumber: 1
    }
  )
  const save = useTemplateAction(
    (v: { id?: number; input: SeriesInput }) => invoke('series:save', v),
    (s) => `Saved series "${s.input.name}"`
  )
  const parsed = seriesInputSchema.safeParse(input)
  const template = templates.find((t) => t.id === input.templateId)
  const set = <K extends keyof SeriesInput>(k: K, v: SeriesInput[K]): void =>
    setInput((p) => ({ ...p, [k]: v }))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{series ? `Edit “${series.input.name}”` : 'New series'}</DialogTitle>
          <DialogDescription>
            A template plus a running number. Each post you add to the queue takes the next number;
            drafts don’t use one up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="series-name">Name</Label>
            <Input
              id="series-name"
              value={input.name}
              placeholder="MW4 days"
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Template</Label>
            <Select
              value={input.templateId ? String(input.templateId) : ''}
              onValueChange={(v) => set('templateId', Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.input.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Channel</Label>
              <ChannelSelect value={input.accountId} onChange={(id) => set('accountId', id)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="series-next">Next number</Label>
              <Input
                id="series-next"
                type="number"
                min={0}
                value={input.nextNumber}
                onChange={(e) => set('nextNumber', Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          </div>
          {template ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              Next post:{' '}
              <span className="font-medium">
                {renderPostVariables(template.input.titleTpl || input.name, {
                  n: String(input.nextNumber)
                })}
              </span>
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {!parsed.success ? (
            <span className="mr-auto self-center text-xs text-muted-foreground">
              {parsed.error.issues[0]?.message}
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!parsed.success || save.isPending}
            onClick={() =>
              parsed.success &&
              save.mutate(
                { ...(series ? { id: series.id } : {}), input: parsed.data },
                { onSuccess: onClose }
              )
            }
          >
            Save series
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TemplatesPage(): React.JSX.Element {
  const templates = useTemplates()
  const series = useSeries()
  const [editingTemplate, setEditingTemplate] = useState<TemplateView | 'new' | null>(null)
  const [editingSeries, setEditingSeries] = useState<SeriesView | 'new' | null>(null)
  const [deleting, setDeleting] = useState<
    { kind: 'template'; item: TemplateView } | { kind: 'series'; item: SeriesView } | null
  >(null)
  const removeTemplate = useTemplateAction(
    (id: number) => invoke('templates:delete', { id }),
    () => 'Template deleted'
  )
  const removeSeries = useTemplateAction(
    (id: number) => invoke('series:delete', { id }),
    () => 'Series deleted'
  )
  const tList = templates.data ?? []
  const sList = series.data ?? []

  if (templates.isSuccess && tList.length === 0) {
    return (
      <>
        <EmptyState
          icon={FileText}
          title="No templates yet"
          action={
            <Button onClick={() => setEditingTemplate('new')}>
              <Plus aria-hidden /> New template
            </Button>
          }
        >
          Save a title, description and tags you use often. Add a series to number posts
          automatically, like “MW4 Day {'{{n}}'}” starting at 9.
        </EmptyState>
        {editingTemplate ? (
          <TemplateDialog template={null} onClose={() => setEditingTemplate(null)} />
        ) : null}
      </>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold">Templates</h1>
            <p className="text-sm text-muted-foreground">
              Pick one in the post editor to fill in the title, description and tags.
            </p>
          </div>
          <Button onClick={() => setEditingTemplate('new')}>
            <Plus aria-hidden /> New template
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {tList.map((t) => (
            <div key={t.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
              <FileText className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.input.name}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {t.input.titleTpl || 'No title'}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.channelTitle ? (
                    <Badge variant="outline">{t.channelTitle}</Badge>
                  ) : (
                    <Badge variant="outline">Any channel</Badge>
                  )}
                  {t.seriesCount ? <Badge variant="secondary">{t.seriesCount} series</Badge> : null}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${t.input.name}`}
                onClick={() => setEditingTemplate(t)}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${t.input.name}`}
                onClick={() => setDeleting({ kind: 'template', item: t })}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-base font-semibold">Series</h2>
            <p className="text-sm text-muted-foreground">
              Numbered posts: the number is used up when a post goes into the queue, never by a
              draft.
            </p>
          </div>
          <Button variant="outline" onClick={() => setEditingSeries('new')}>
            <Hash aria-hidden /> New series
          </Button>
        </div>
        {sList.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No series yet. A series turns “MW4 Day {'{{n}}'}” into Day 9, Day 10, Day 11…
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {sList.map((s) => (
              <div key={s.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <Hash className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.input.name}</div>
                  <div className="truncate text-sm">
                    Next: <span className="font-medium">{s.nextTitle}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.templateName} · {s.channelTitle ?? 'any channel'} · {s.numbered} posted
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${s.input.name}`}
                  onClick={() => setEditingSeries(s)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${s.input.name}`}
                  onClick={() => setDeleting({ kind: 'series', item: s })}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {editingTemplate ? (
        <TemplateDialog
          template={editingTemplate === 'new' ? null : editingTemplate}
          onClose={() => setEditingTemplate(null)}
        />
      ) : null}
      {editingSeries ? (
        <SeriesDialog
          series={editingSeries === 'new' ? null : editingSeries}
          templates={tList}
          onClose={() => setEditingSeries(null)}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.item.input.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind === 'series'
                ? 'Posts already numbered keep their titles. New posts can’t use this series.'
                : 'Posts made from it keep their text.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting?.kind === 'template') removeTemplate.mutate(deleting.item.id)
                if (deleting?.kind === 'series') removeSeries.mutate(deleting.item.id)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
