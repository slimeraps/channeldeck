import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Clapperboard, Plus, Smartphone, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AutopostFormat, AutopostMode, PickOrder } from '@shared/constants/enums'
import {
  type RuleInput,
  ruleInputSchema,
  type RulePreviewInput,
  type RuleView
} from '@shared/schemas/autopost'
import {
  CLIP_TEMPLATE_VARS,
  DEFAULT_DESCRIPTION_TEMPLATE,
  DEFAULT_TITLE_TEMPLATE,
  unknownVariables
} from '@shared/templates'
import { LayoutEditor } from '@renderer/components/autopost/LayoutEditor'
import { TagInput } from '@renderer/components/post-editor/TagInput'
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
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import { useAccounts } from '@renderer/hooks/useAccounts'
import { useLayouts, useRulePreview, useSaveRule } from '@renderer/hooks/useAutopost'
import { useTwitchAccounts } from '@renderer/hooks/useTwitch'
import { invoke } from '@renderer/lib/ipc'
import { formatLocal, formatRelative } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'

const WEEKDAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun']
] as const

const PICK_LABELS: Record<PickOrder, string> = {
  oldest: 'Oldest unposted first',
  newest: 'Newest first',
  most_viewed: 'Most viewed first'
}

const NONE = '__none__'

function Section({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return out
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function RuleEditor({
  rule,
  onClose
}: {
  rule: RuleView | null
  onClose: () => void
}): React.JSX.Element {
  const accounts = useAccounts()
  const twitch = useTwitchAccounts()
  const layouts = useLayouts()
  const save = useSaveRule()
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false)

  const channels = accounts.data ?? []
  const [draft, setInput] = useState<RuleInput>(
    () =>
      rule?.input ?? {
        name: '',
        youtubeAccountId: channels[0]?.id ?? 0,
        twitchAccountIds: twitch.data?.length === 1 && twitch.data[0] ? [twitch.data[0].id] : [],
        slots: ['12:00', '18:00'],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        pickOrder: 'oldest',
        filters: {},
        format: 'short',
        layoutPresetId: null,
        titleTpl: DEFAULT_TITLE_TEMPLATE,
        descriptionTpl: DEFAULT_DESCRIPTION_TEMPLATE,
        tags: [],
        categoryId: null,
        playlistId: null,
        madeForKids: false,
        mode: 'review',
        lookaheadDays: 3,
        enabled: true,
        nextNumber: 1
      }
  )
  // A brand-new rule posts to the first channel until you pick another.
  const input: RuleInput = {
    ...draft,
    youtubeAccountId: draft.youtubeAccountId || (channels[0]?.id ?? 0)
  }
  const set = <K extends keyof RuleInput>(key: K, value: RuleInput[K]): void =>
    setInput((prev) => ({ ...prev, [key]: value }))
  const setFilter = (patch: Partial<RuleInput['filters']>): void =>
    setInput((prev) => ({
      ...prev,
      filters: Object.fromEntries(
        Object.entries({ ...prev.filters, ...patch }).filter(([, v]) => v !== undefined)
      )
    }))

  const accountId = input.youtubeAccountId || null
  const categories = useQuery({
    queryKey: ['youtube', 'categories'],
    queryFn: () => invoke('youtube:categories', { accountId: accountId as number }),
    enabled: accountId !== null,
    staleTime: Infinity
  })
  const playlists = useQuery({
    queryKey: ['youtube', 'playlists', accountId],
    queryFn: () => invoke('youtube:playlists', { accountId: accountId as number }),
    enabled: accountId !== null,
    staleTime: 5 * 60_000
  })
  // Games seen in the chosen channels' clips, for the game filter.
  const gameSearch = useQuery({
    queryKey: ['clips', 'games', input.twitchAccountIds],
    queryFn: () =>
      invoke('clips:search', {
        twitchAccountIds: input.twitchAccountIds,
        sort: 'oldest',
        includeHidden: false,
        limit: 1,
        offset: 0
      }),
    enabled: input.twitchAccountIds.length > 0,
    staleTime: 60_000
  })
  const games = (gameSearch.data?.games ?? []).map((g): [string, string] => [g.id, g.name])

  const parsed = ruleInputSchema.safeParse(input)
  const previewInput = useDebounced<RulePreviewInput | null>(
    input.youtubeAccountId && input.twitchAccountIds.length > 0 && input.slots.length > 0
      ? {
          ...(rule ? { ruleId: rule.id } : {}),
          youtubeAccountId: input.youtubeAccountId,
          twitchAccountIds: input.twitchAccountIds,
          slots: input.slots.filter((s) => /^\d\d:\d\d$/.test(s)),
          weekdays: input.weekdays.length ? input.weekdays : [1],
          pickOrder: input.pickOrder,
          filters: input.filters,
          format: input.format,
          layoutPresetId: input.layoutPresetId,
          titleTpl: input.titleTpl || '{{clip_title}}',
          descriptionTpl: input.descriptionTpl,
          lookaheadDays: input.lookaheadDays,
          nextNumber: input.nextNumber
        }
      : null,
    300
  )
  const preview = useRulePreview(previewInput)
  const unknown = [
    ...new Set([...unknownVariables(input.titleTpl), ...unknownVariables(input.descriptionTpl)])
  ]
  const ruleLayouts = (layouts.data ?? []).filter((l) =>
    input.twitchAccountIds.includes(l.twitchAccountId)
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{rule ? `Edit “${rule.input.name}”` : 'New autopost rule'}</DialogTitle>
          <DialogDescription>
            Fills your chosen time slots with clips from the bank, as scheduled YouTube posts.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-[1fr_300px]">
          <div className="min-w-0 space-y-4">
            <Section title="Basics">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-name">Name</Label>
                  <Input
                    id="rule-name"
                    value={input.name}
                    placeholder="MW4 daily Shorts"
                    onChange={(e) => set('name', e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Post to YouTube channel</Label>
                  <Select
                    value={input.youtubeAccountId ? String(input.youtubeAccountId) : ''}
                    onValueChange={(v) =>
                      setInput((p) => ({
                        ...p,
                        youtubeAccountId: Number(v),
                        playlistId: null
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          <span
                            className="size-2 rounded-full"
                            style={{ background: c.color }}
                            aria-hidden
                          />
                          {c.channelTitle}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Clips from</Label>
                <div className="flex flex-wrap gap-2">
                  {(twitch.data ?? []).map((a) => {
                    const on = input.twitchAccountIds.includes(a.id)
                    return (
                      <Button
                        key={a.id}
                        size="sm"
                        variant={on ? 'default' : 'outline'}
                        onClick={() =>
                          set(
                            'twitchAccountIds',
                            on
                              ? input.twitchAccountIds.filter((id) => id !== a.id)
                              : [...input.twitchAccountIds, a.id]
                          )
                        }
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ background: a.color }}
                          aria-hidden
                        />
                        {a.displayName}
                      </Button>
                    )
                  })}
                  {twitch.data?.length === 0 ? (
                    <span className="text-sm text-muted-foreground">
                      Connect a Twitch channel on the Channels page first.
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Mode</Label>
                <RadioGroup
                  value={input.mode}
                  onValueChange={(v) => set('mode', v as AutopostMode)}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {(
                    [
                      ['review', 'Review', 'Each autopost waits for you to approve it.'],
                      ['auto', 'Auto', 'Autoposts go straight into the upload queue.']
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label
                      key={value}
                      className={cn(
                        'flex cursor-pointer gap-2 rounded-md border p-3 text-sm',
                        input.mode === value && 'border-primary bg-primary/5'
                      )}
                    >
                      <RadioGroupItem value={value} className="mt-0.5" />
                      <span>
                        <span className="font-medium">{label}</span>
                        <span className="block text-xs text-muted-foreground">{hint}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
            </Section>

            <Section title="Schedule" hint="Times are in your Mac’s time zone.">
              <div className="flex flex-wrap items-center gap-2">
                {input.slots.map((slot, i) => (
                  <div key={i} className="flex items-center rounded-md border">
                    <Input
                      type="time"
                      value={slot}
                      aria-label={`Time ${i + 1}`}
                      className="h-8 w-28 border-0"
                      onChange={(e) =>
                        set(
                          'slots',
                          input.slots.map((s, j) => (j === i ? e.target.value : s))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="px-2 text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${slot}`}
                      onClick={() =>
                        set(
                          'slots',
                          input.slots.filter((_, j) => j !== i)
                        )
                      }
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={input.slots.length >= 24}
                  onClick={() => set('slots', [...input.slots, '20:00'])}
                >
                  <Plus aria-hidden /> Add time
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(([n, label]) => {
                  const on = input.weekdays.includes(n)
                  return (
                    <Button
                      key={n}
                      size="sm"
                      variant={on ? 'default' : 'outline'}
                      className="w-12"
                      aria-pressed={on}
                      onClick={() =>
                        set(
                          'weekdays',
                          on ? input.weekdays.filter((d) => d !== n) : [...input.weekdays, n]
                        )
                      }
                    >
                      {label}
                    </Button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Label htmlFor="rule-lookahead">Plan</Label>
                <Input
                  id="rule-lookahead"
                  type="number"
                  min={1}
                  max={14}
                  className="h-8 w-16"
                  value={input.lookaheadDays}
                  onChange={(e) =>
                    set('lookaheadDays', Math.min(14, Math.max(1, Number(e.target.value) || 1)))
                  }
                />
                <span className="text-muted-foreground">days ahead</span>
              </div>
            </Section>

            <Section title="Which clips">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Order</Label>
                  <Select
                    value={input.pickOrder}
                    onValueChange={(v) => set('pickOrder', v as PickOrder)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PICK_LABELS) as PickOrder[]).map((o) => (
                        <SelectItem key={o} value={o}>
                          {PICK_LABELS[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-min-views">At least this many views</Label>
                  <Input
                    id="rule-min-views"
                    type="number"
                    min={0}
                    placeholder="Any"
                    value={input.filters.minViews ?? ''}
                    onChange={(e) => setFilter({ minViews: numberOrUndefined(e.target.value) })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Length (seconds)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Min"
                      aria-label="Shortest length"
                      value={input.filters.minDurationSec ?? ''}
                      onChange={(e) =>
                        setFilter({ minDurationSec: numberOrUndefined(e.target.value) })
                      }
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Max"
                      aria-label="Longest length"
                      value={input.filters.maxDurationSec ?? ''}
                      onChange={(e) =>
                        setFilter({ maxDurationSec: numberOrUndefined(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Switch
                    checked={input.filters.featuredOnly ?? false}
                    onCheckedChange={(on) => setFilter({ featuredOnly: on || undefined })}
                  />
                  Featured clips only
                </label>
              </div>
              {games.length > 0 ? (
                <div className="grid gap-1.5">
                  <Label>Games (none picked = all games)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {games.map(([id, name]) => {
                      const on = input.filters.gameIds?.includes(id) ?? false
                      return (
                        <Button
                          key={id}
                          size="sm"
                          variant={on ? 'default' : 'outline'}
                          aria-pressed={on}
                          onClick={() => {
                            const current = input.filters.gameIds ?? []
                            const next = on ? current.filter((g) => g !== id) : [...current, id]
                            setFilter({ gameIds: next.length ? next : undefined })
                          }}
                        >
                          {name}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </Section>

            <Section title="Format">
              <RadioGroup
                value={input.format}
                onValueChange={(v) => set('format', v as AutopostFormat)}
                className="grid gap-2 sm:grid-cols-2"
              >
                {(
                  [
                    ['short', 'Short (vertical)', Smartphone],
                    ['regular', 'Regular video (landscape)', Clapperboard]
                  ] as const
                ).map(([value, label, Icon]) => (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm',
                      input.format === value && 'border-primary bg-primary/5'
                    )}
                  >
                    <RadioGroupItem value={value} />
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {label}
                  </label>
                ))}
              </RadioGroup>
              {input.format === 'short' ? (
                <div className="grid gap-1.5">
                  <Label>When Twitch has no portrait version</Label>
                  <div className="flex gap-2">
                    <Select
                      value={input.layoutPresetId ? String(input.layoutPresetId) : NONE}
                      onValueChange={(v) => set('layoutPresetId', v === NONE ? null : Number(v))}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Blurred fill (default)</SelectItem>
                        {ruleLayouts.map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>
                            {l.name} ({l.twitchName})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={input.twitchAccountIds.length === 0}
                      onClick={() => setLayoutEditorOpen(true)}
                    >
                      <Plus aria-hidden /> New layout
                    </Button>
                  </div>
                </div>
              ) : null}
            </Section>

            <Section title="Title, description and details">
              <div className="flex flex-wrap gap-1">
                {CLIP_TEMPLATE_VARS.map((v) => (
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
                <Label htmlFor="rule-title">Title template</Label>
                <Input
                  id="rule-title"
                  value={input.titleTpl}
                  onChange={(e) => set('titleTpl', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rule-description">Description template</Label>
                <Textarea
                  id="rule-description"
                  rows={4}
                  value={input.descriptionTpl}
                  onChange={(e) => set('descriptionTpl', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The channel’s description footer is added at the end.
                </p>
              </div>
              {unknown.length > 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  Unknown: {unknown.map((u) => `{{${u}}}`).join(', ')}. They’ll appear as typed.
                </p>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="rule-tags">Tags (empty = the channel’s default tags)</Label>
                <TagInput
                  id="rule-tags"
                  value={input.tags}
                  onChange={(tags) => set('tags', tags)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Category</Label>
                  <Select
                    value={input.categoryId ?? NONE}
                    onValueChange={(v) => set('categoryId', v === NONE ? null : v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Channel default</SelectItem>
                      {(categories.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Playlist</Label>
                  <Select
                    value={input.playlistId ?? NONE}
                    onValueChange={(v) => set('playlistId', v === NONE ? null : v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Channel default</SelectItem>
                      {(playlists.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Made for kids</Label>
                  <RadioGroup
                    value={input.madeForKids ? 'yes' : 'no'}
                    onValueChange={(v) => set('madeForKids', v === 'yes')}
                    className="flex gap-4 pt-1"
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value="no" /> No
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value="yes" /> Yes
                    </label>
                  </RadioGroup>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rule-n">Next {'{{n}}'}</Label>
                  <Input
                    id="rule-n"
                    type="number"
                    min={1}
                    value={input.nextNumber}
                    onChange={(e) => set('nextNumber', Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              </div>
            </Section>
          </div>

          <aside className="space-y-3 md:sticky md:top-0 md:self-start">
            <div className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Next up</h3>
                {preview.data ? (
                  <span className="text-xs text-muted-foreground">
                    {preview.data.eligibleClips} clips available
                  </span>
                ) : null}
              </div>
              {!previewInput ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Pick a YouTube channel, a Twitch channel and a time to see what gets posted.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {(preview.data?.slots ?? []).map((slot) => (
                    <li key={slot.atUtc} className="flex gap-2 text-xs">
                      {slot.clip?.thumbUrl ? (
                        <img
                          src={slot.clip.thumbUrl}
                          alt=""
                          className="aspect-video w-20 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="aspect-video w-20 shrink-0 rounded bg-muted" />
                      )}
                      <div className="min-w-0">
                        <div className="text-muted-foreground">
                          {formatLocal(slot.atUtc)} · {formatRelative(slot.atUtc)}
                        </div>
                        {slot.clip ? (
                          <>
                            <div className="line-clamp-2 font-medium">
                              {slot.clip.renderedTitle}
                            </div>
                            {slot.clip.needsRender ? (
                              <Badge variant="outline" className="mt-0.5 text-[10px]">
                                Vertical render
                              </Badge>
                            ) : null}
                          </>
                        ) : (
                          <div className="text-amber-400">No clip left for this slot</div>
                        )}
                      </div>
                    </li>
                  ))}
                  {preview.data && preview.data.slots.length === 0 ? (
                    <li className="text-xs text-muted-foreground">
                      All slots in the next {input.lookaheadDays} days are already filled.
                    </li>
                  ) : null}
                </ul>
              )}
              {preview.data?.titleTooLong ? (
                <p className="mt-2 text-xs text-amber-400">
                  Some titles run over 100 characters and will be cut.
                </p>
              ) : null}
            </div>
            {preview.data?.slots[0]?.clip ? (
              <div className="rounded-lg border p-3">
                <h3 className="text-sm font-semibold">Description preview</h3>
                <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
                  {preview.data.slots[0].clip.renderedDescription}
                </p>
              </div>
            ) : null}
          </aside>
        </div>

        <DialogFooter className="items-center">
          <label className="mr-auto flex items-center gap-2 text-sm">
            <Switch checked={input.enabled} onCheckedChange={(on) => set('enabled', on)} />
            Rule is on
          </label>
          {!parsed.success ? (
            <span className="text-xs text-muted-foreground">{parsed.error.issues[0]?.message}</span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!parsed.success || save.isPending}
            onClick={() =>
              parsed.success &&
              save.mutate(
                { ...(rule ? { id: rule.id } : {}), input: parsed.data },
                { onSuccess: onClose }
              )
            }
          >
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </DialogFooter>

        {layoutEditorOpen ? (
          <LayoutEditor
            layout={null}
            {...(input.twitchAccountIds[0]
              ? { defaultTwitchAccountId: input.twitchAccountIds[0] }
              : {})}
            onClose={() => setLayoutEditorOpen(false)}
            onSaved={(layout) => set('layoutPresetId', layout.id)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
