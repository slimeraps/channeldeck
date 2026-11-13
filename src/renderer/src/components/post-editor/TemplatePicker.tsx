import { Hash } from 'lucide-react'
import type { PostInput } from '@shared/schemas/post'
import { hasPostVariables, postDateLabel, renderPostVariables } from '@shared/templates'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useSeries, useTemplates } from '@renderer/hooks/useTemplates'

const NONE = '__none__'

/**
 * Template and series pickers for the post editor. Picking one fills in the title,
 * description and tags; a series also links the post, so {{n}} becomes its next number
 * when the post is queued.
 */
export function TemplatePicker({
  input,
  channelTitle,
  onChange
}: {
  input: PostInput
  channelTitle: string
  onChange: (patch: Partial<PostInput>) => void
}): React.JSX.Element | null {
  const templates = useTemplates()
  const series = useSeries()
  const forChannel = <T extends { input: { accountId: number | null } }>(list: T[]): T[] =>
    list.filter((x) => x.input.accountId === null || x.input.accountId === input.accountId)
  const tList = forChannel(templates.data ?? [])
  const sList = forChannel(series.data ?? [])
  const chosenSeries = sList.find((s) => s.id === input.seriesId) ?? null

  if (tList.length === 0 && sList.length === 0 && !input.seriesId) return null

  function applyTemplate(templateId: number | null): Partial<PostInput> {
    const t = tList.find((x) => x.id === templateId)
    if (!t) return { templateId: null }
    return {
      templateId: t.id,
      ...(t.input.titleTpl ? { title: t.input.titleTpl } : {}),
      ...(t.input.descriptionTpl ? { description: t.input.descriptionTpl } : {}),
      ...(t.input.tags.length ? { tags: t.input.tags } : {})
    }
  }

  const text = `${input.title}\n${input.description}`
  const preview = hasPostVariables(text)
    ? renderPostVariables(input.title, {
        ...(chosenSeries ? { n: String(chosenSeries.input.nextNumber) } : {}),
        ...(input.publishAtUtc
          ? {
              date: postDateLabel(
                new Date(input.publishAtUtc),
                Intl.DateTimeFormat().resolvedOptions().timeZone
              )
            }
          : {}),
        channel: channelTitle
      })
    : null

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Template</Label>
          <Select
            value={input.templateId ? String(input.templateId) : NONE}
            onValueChange={(v) => onChange(applyTemplate(v === NONE ? null : Number(v)))}
          >
            <SelectTrigger className="w-full" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {tList.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.input.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Series</Label>
          <Select
            value={input.seriesId ? String(input.seriesId) : NONE}
            onValueChange={(v) => {
              const s = sList.find((x) => x.id === Number(v))
              onChange(
                s ? { seriesId: s.id, ...applyTemplate(s.input.templateId) } : { seriesId: null }
              )
            }}
          >
            <SelectTrigger className="w-full" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {sList.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.input.name} (next {s.input.nextNumber})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {preview !== null || chosenSeries ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Hash className="size-3.5 shrink-0" aria-hidden />
          <span>
            When you add it to the queue the title becomes{' '}
            <span className="font-medium text-foreground">{preview ?? input.title}</span>
            {chosenSeries ? ` and #${chosenSeries.input.nextNumber} of the series is used.` : '.'}
          </span>
        </p>
      ) : null}
    </div>
  )
}
