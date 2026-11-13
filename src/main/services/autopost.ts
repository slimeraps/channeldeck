import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import type { PostStatus } from '@shared/constants/enums'
import { accountDefaultsSchema } from '@shared/schemas/account'
import type { RuleInput, RulePreview, RulePreviewInput, RuleView } from '@shared/schemas/autopost'
import { normalizeTags, titleLength } from '@shared/schemas/post'
import {
  clipTemplateValues,
  finalizeDescription,
  finalizeTitle,
  renderTemplate
} from '@shared/templates'
import type { RenderSpecJson } from '@shared/types/json'
import type { Repos } from '../db/repos'
import type { AutopostRuleRow } from '../db/repos/catalog'
import type { ClipRow } from '../db/repos/clips'
import { type Clock, systemClock } from '../db/repos/common'
import type { PostRow } from '../db/repos/posts'
import { pickClips, type PickRule } from '../domain/picker'
import { forecastQuota, type QuotaDayForecast } from '../domain/quota'
import { renderFileName } from '../domain/render'
import { slotsBetween } from '../domain/slots'
import { UserFacingError } from '../errors'
import type { MediaAccess } from '../media/access'
import type { ProbeResult } from '../media/ffprobe'
import { mediaUrl } from '../media/mediaUrl'

/**
 * Autopost rules: Twitch channels → one YouTube channel, on daily time slots. The planner
 * fills every empty slot in the look-ahead with the next clip the rule picks, as an ordinary
 * post (needs_approval in Review mode, queued in Auto). publish_at is the slot; the upload
 * job does the rest, including the vertical render when a clip has no portrait file.
 */

export interface AutopostDeps {
  repos: Repos
  probe: (path: string) => Promise<ProbeResult>
  media: MediaAccess
  notify: (title: string, body: string) => void
  emitPostsChanged: () => void
  kickJobs?: () => void
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void }
  clock?: Clock
  /** IANA zone for slot times (default: the Mac's). */
  zone?: string
}

/** Slots closer than this aren't filled: there'd be no time to render and upload. */
export const MIN_SLOT_LEAD_MS = 30 * 60_000
/** A post still waiting for approval this close to its publish time is dropped. */
export const APPROVAL_CUTOFF_MS = 10 * 60_000
/** After a run that found no clips, wait this long before trying the rule again. */
const EMPTY_BANK_RETRY_MS = 10 * 60_000

const ACTIVE_STATUSES: PostStatus[] = [
  'draft',
  'needs_approval',
  'queued',
  'rendering',
  'uploading',
  'processing',
  'scheduled',
  'waiting_quota',
  'needs_decision',
  'failed'
]
const UPCOMING_STATUSES: PostStatus[] = ACTIVE_STATUSES.filter((s) => s !== 'draft')

export type AutopostService = ReturnType<typeof createAutopostService>

export function toRuleInput(rule: AutopostRuleRow): RuleInput {
  return {
    name: rule.name,
    youtubeAccountId: rule.youtubeAccountId,
    twitchAccountIds: rule.twitchAccountIdsJson,
    slots: rule.slotsJson,
    weekdays: rule.weekdaysJson,
    pickOrder: rule.pickOrder,
    filters: rule.filtersJson,
    format: rule.format,
    layoutPresetId: rule.layoutPresetId,
    titleTpl: rule.titleTpl,
    descriptionTpl: rule.descriptionTpl,
    tags: rule.tagsJson,
    categoryId: rule.categoryId,
    playlistId: rule.playlistId,
    madeForKids: rule.madeForKids,
    mode: rule.mode,
    lookaheadDays: rule.lookaheadDays,
    enabled: rule.enabled,
    nextNumber: rule.nextNumber
  }
}

export function createAutopostService(deps: AutopostDeps) {
  const { repos, logger } = deps
  const clock = deps.clock ?? systemClock
  const zone = deps.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  /** ruleId → when its bank was last found empty. */
  const emptyBankAt = new Map<number, number>()
  /** "ruleId:YYYY-MM-DD" of bank-empty notifications already sent. */
  const notifiedEmpty = new Set<string>()

  const rendersRoot = (): string => join(repos.settings.getKey('clipsRoot'), '_renders')

  // ---- helpers ------------------------------------------------------------------------

  function pickRuleOf(rule: Pick<RuleInput, 'twitchAccountIds' | 'pickOrder' | 'filters'>) {
    return {
      twitchAccountIds: rule.twitchAccountIds,
      pickOrder: rule.pickOrder,
      filters: rule.filters
    } satisfies PickRule
  }

  function excludedFor(accountId: number, skipped: readonly string[]): Set<string> {
    const set = repos.posts.activeClipIds(accountId)
    for (const id of skipped) set.add(id)
    return set
  }

  /** Clips whose files exist (a file deleted in Finder makes a clip unusable). */
  function usableBank(twitchAccountIds: readonly number[]): ClipRow[] {
    return repos.clips
      .bankFor([...twitchAccountIds])
      .filter(
        (c) =>
          (c.portraitPath && existsSync(c.portraitPath)) ||
          (c.landscapePath && existsSync(c.landscapePath))
      )
  }

  function blockedReason(rule: AutopostRuleRow): string | null {
    const account = repos.accounts.get(rule.youtubeAccountId)
    if (!account || account.removedAt) return 'Its YouTube channel was removed.'
    if (!account.enabled) return `${account.channelTitle} is switched off.`
    if (account.tokenStatus !== 'ok') return `${account.channelTitle} needs you to sign in again.`
    const twitch = rule.twitchAccountIdsJson.filter((id) => repos.twitchAccounts.get(id))
    if (twitch.length === 0) return 'None of its Twitch channels are connected any more.'
    return null
  }

  function ruleSlots(
    rule: Pick<RuleInput, 'slots' | 'weekdays' | 'lookaheadDays'>,
    now: Date
  ): string[] {
    return slotsBetween(
      rule,
      new Date(now.getTime() + MIN_SLOT_LEAD_MS),
      new Date(now.getTime() + rule.lookaheadDays * 86_400_000),
      zone
    )
  }

  function rulePosts(ruleId: number, statuses: PostStatus[]): PostRow[] {
    return repos.posts.list({ ruleId, statuses })
  }

  /** Slots in the look-ahead without an active post from this rule. */
  function emptySlots(rule: AutopostRuleRow, now: Date): string[] {
    const taken = new Set(
      rulePosts(rule.id, ACTIVE_STATUSES)
        .map((p) => p.publishAtUtc)
        .filter((at): at is string => Boolean(at))
    )
    return ruleSlots(toRuleInput(rule), now).filter((slot) => !taken.has(slot))
  }

  function overdueApprovals(rule: AutopostRuleRow, now: Date): PostRow[] {
    const cutoff = new Date(now.getTime() + APPROVAL_CUTOFF_MS).toISOString()
    return rulePosts(rule.id, ['needs_approval']).filter(
      (p) => p.publishAtUtc !== null && p.publishAtUtc <= cutoff
    )
  }

  function render(
    rule: Pick<RuleInput, 'titleTpl' | 'descriptionTpl'>,
    clip: ClipRow,
    n: number
  ): { title: string; description: string; rawTitle: string } {
    const twitch = repos.twitchAccounts.get(clip.twitchAccountId)
    const values = clipTemplateValues(clip, {
      broadcasterName: twitch?.displayName ?? '',
      broadcasterLogin: twitch?.login ?? '',
      n,
      zone
    })
    const rawTitle = renderTemplate(rule.titleTpl, values)
    return {
      rawTitle,
      title: finalizeTitle(rawTitle, finalizeTitle(clip.title)),
      description: renderTemplate(rule.descriptionTpl, values)
    }
  }

  /** Short + no portrait file = convert the landscape file with the rule's layout. */
  function needsRender(format: RuleInput['format'], clip: ClipRow): boolean {
    return (
      format === 'short' &&
      !(clip.portraitPath && existsSync(clip.portraitPath)) &&
      Boolean(clip.landscapePath)
    )
  }

  function renderSpec(rule: AutopostRuleRow, clip: ClipRow): RenderSpecJson {
    const preset = rule.layoutPresetId ? repos.layoutPresets.get(rule.layoutPresetId) : undefined
    return {
      sourcePath: clip.landscapePath as string,
      kind: preset?.kind ?? 'blur_fill',
      crops: preset?.cropsJson ?? {},
      presetId: preset?.id ?? null
    }
  }

  /** Builds and inserts one autopost. Returns null if the clip turned out unusable. */
  async function createAutopost(
    rule: AutopostRuleRow,
    clip: ClipRow,
    slotUtc: string,
    now: Date
  ): Promise<PostRow | null> {
    const account = repos.accounts.require(rule.youtubeAccountId)
    const parsed = accountDefaultsSchema.safeParse(account.defaultsJson)
    const defaults = parsed.success ? parsed.data : {}
    const leadMs = repos.settings.getKey('uploadLeadHours') * 3600_000

    let file: {
      filePath: string
      fileSize: number | null
      fileMtime: number | null
      durationSec: number
      width: number | null
      height: number | null
      isShort: boolean
      renderJson: RenderSpecJson | null
    }
    if (needsRender(rule.format, clip)) {
      const spec = renderSpec(rule, clip)
      file = {
        filePath: join(rendersRoot(), renderFileName(clip.id, spec.presetId)),
        fileSize: null,
        fileMtime: null,
        durationSec: clip.durationSec,
        width: 1080,
        height: 1920,
        isShort: true,
        renderJson: spec
      }
    } else {
      const path =
        rule.format === 'short'
          ? (clip.portraitPath ?? clip.landscapePath)
          : (clip.landscapePath ?? clip.portraitPath)
      if (!path || !existsSync(path)) return null
      const probe = await deps.probe(path).catch((error: unknown) => {
        logger.warn(`[autopost] could not read ${path}`, error)
        return null
      })
      if (!probe) return null
      file = {
        filePath: path,
        fileSize: probe.sizeBytes,
        fileMtime: probe.mtimeMs,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        isShort: probe.isShort,
        renderJson: null
      }
    }

    const n = repos.autopostRules.takeNextNumber(rule.id)
    const text = render(rule, clip, n)
    const description = finalizeDescription(
      [text.description, defaults.descriptionFooter].filter(Boolean).join('\n\n')
    )
    const post = repos.posts.create({
      accountId: rule.youtubeAccountId,
      status: rule.mode === 'auto' ? 'queued' : 'needs_approval',
      source: 'twitch_clip',
      clipId: clip.id,
      ruleId: rule.id,
      ...file,
      title: text.title,
      description,
      tagsJson: normalizeTags(rule.tagsJson.length > 0 ? rule.tagsJson : (defaults.tags ?? [])),
      categoryId: rule.categoryId ?? defaults.categoryId ?? null,
      playlistId: rule.playlistId ?? defaults.playlistId ?? null,
      madeForKids: rule.madeForKids,
      license: defaults.license ?? 'youtube',
      defaultLanguage: defaults.defaultLanguage ?? null,
      defaultAudioLanguage: defaults.defaultAudioLanguage ?? null,
      visibilityMode: 'schedule',
      publishAtUtc: slotUtc,
      uploadAfterUtc: new Date(Math.max(now.getTime(), Date.parse(slotUtc) - leadMs)).toISOString()
    })
    deps.media.grant(file.filePath)
    if (file.renderJson) deps.media.grant(file.renderJson.sourcePath)
    return post
  }

  // ---- views --------------------------------------------------------------------------

  function toView(rule: AutopostRuleRow): RuleView {
    const account = repos.accounts.get(rule.youtubeAccountId)
    const now = clock()
    const input = toRuleInput(rule)
    const active = rulePosts(rule.id, UPCOMING_STATUSES)
    const bank = usableBank(rule.twitchAccountIdsJson)
    const eligible = pickClips(
      bank,
      pickRuleOf(input),
      excludedFor(rule.youtubeAccountId, rule.skippedClipIdsJson),
      Number.MAX_SAFE_INTEGER
    ).length
    const preset = rule.layoutPresetId ? repos.layoutPresets.get(rule.layoutPresetId) : undefined
    return {
      id: rule.id,
      input,
      channelTitle: account?.channelTitle ?? 'Removed channel',
      channelColor: account?.color ?? '#71717a',
      twitchNames: rule.twitchAccountIdsJson
        .map((id) => repos.twitchAccounts.get(id)?.displayName)
        .filter((n): n is string => Boolean(n)),
      layoutName: preset?.name ?? null,
      nextSlotUtc:
        slotsBetween(input, now, new Date(now.getTime() + 8 * 86_400_000), zone)[0] ?? null,
      pendingApproval: active.filter((p) => p.status === 'needs_approval').length,
      upcoming: active.length,
      eligibleClips: eligible,
      skippedClips: rule.skippedClipIdsJson.length,
      blockedReason: blockedReason(rule)
    }
  }

  function validateRefs(input: RuleInput): void {
    const account = repos.accounts.get(input.youtubeAccountId)
    if (!account || account.removedAt)
      throw new UserFacingError('Pick a connected YouTube channel.')
    for (const id of input.twitchAccountIds) {
      if (!repos.twitchAccounts.get(id))
        throw new UserFacingError('One of the Twitch channels is no longer connected.')
    }
    if (input.layoutPresetId && !repos.layoutPresets.get(input.layoutPresetId)) {
      throw new UserFacingError('That layout was deleted. Pick another one.')
    }
  }

  function toRow(input: RuleInput) {
    return {
      name: input.name.trim(),
      youtubeAccountId: input.youtubeAccountId,
      twitchAccountIdsJson: [...new Set(input.twitchAccountIds)],
      slotsJson: [...new Set(input.slots)].sort(),
      weekdaysJson: [...new Set(input.weekdays)].sort(),
      pickOrder: input.pickOrder,
      filtersJson: input.filters,
      format: input.format,
      layoutPresetId: input.layoutPresetId,
      titleTpl: input.titleTpl,
      descriptionTpl: input.descriptionTpl,
      tagsJson: normalizeTags(input.tags),
      categoryId: input.categoryId,
      playlistId: input.playlistId,
      madeForKids: input.madeForKids,
      mode: input.mode,
      lookaheadDays: input.lookaheadDays,
      enabled: input.enabled,
      nextNumber: input.nextNumber
    }
  }

  // ---- public API ---------------------------------------------------------------------

  const service = {
    list(): RuleView[] {
      return repos.autopostRules.list().map(toView)
    },

    save(input: RuleInput, id?: number): RuleView {
      validateRefs(input)
      const row = id
        ? repos.autopostRules.update(id, toRow(input))
        : repos.autopostRules.create(toRow(input))
      emptyBankAt.delete(row.id)
      repos.eventLog.write({
        kind: id ? 'autopost.rule_updated' : 'autopost.rule_created',
        message: `${id ? 'Updated' : 'Created'} autopost rule "${row.name}"`,
        accountId: row.youtubeAccountId
      })
      deps.kickJobs?.()
      return toView(row)
    },

    setEnabled(id: number, enabled: boolean): RuleView {
      const row = repos.autopostRules.update(id, { enabled })
      emptyBankAt.delete(id)
      if (enabled) deps.kickJobs?.()
      return toView(row)
    },

    /** Deletes a rule; optionally cancels its autoposts that aren't on YouTube yet. */
    remove(id: number, cancelUpcoming: boolean): { canceled: number } {
      const rule = repos.autopostRules.require(id)
      let canceled = 0
      if (cancelUpcoming) {
        for (const post of rulePosts(id, [
          'needs_approval',
          'queued',
          'failed',
          'waiting_quota',
          'needs_decision'
        ])) {
          if (post.youtubeVideoId) continue
          repos.posts.transition(post.id, 'cancel', { reason: `rule "${rule.name}" deleted` })
          canceled += 1
        }
      }
      repos.autopostRules.remove(id)
      repos.eventLog.write({
        kind: 'autopost.rule_deleted',
        message: `Deleted autopost rule "${rule.name}"${canceled ? `; canceled ${canceled} upcoming` : ''}`
      })
      if (canceled) deps.emitPostsChanged()
      return { canceled }
    },

    approveAll(id: number): { approved: number } {
      const now = clock().toISOString()
      let approved = 0
      for (const post of rulePosts(id, ['needs_approval'])) {
        if (post.publishAtUtc && post.publishAtUtc <= now) continue
        repos.posts.transition(post.id, 'approve', { reason: 'approved (all)' })
        approved += 1
      }
      if (approved) {
        deps.emitPostsChanged()
        deps.kickJobs?.()
      }
      return { approved }
    },

    /** What the rule would do next: its next empty slots and the clips they'd get. */
    preview(input: RulePreviewInput): RulePreview {
      const now = clock()
      const existing = input.ruleId ? repos.autopostRules.get(input.ruleId) : undefined
      const taken = new Set(
        existing
          ? rulePosts(existing.id, ACTIVE_STATUSES)
              .map((p) => p.publishAtUtc)
              .filter((a): a is string => Boolean(a))
          : []
      )
      const slots = ruleSlots(input, now)
        .filter((s) => !taken.has(s))
        .slice(0, 6)
      const bank = usableBank(input.twitchAccountIds)
      const excluded = excludedFor(input.youtubeAccountId, existing?.skippedClipIdsJson ?? [])
      const rule = pickRuleOf(input)
      const eligible = pickClips(bank, rule, excluded, Number.MAX_SAFE_INTEGER)
      let titleTooLong = false
      return {
        slots: slots.map((atUtc, i) => {
          const clip = eligible[i] as ClipRow | undefined
          if (!clip) return { atUtc, clip: null }
          const text = render(input, clip, input.nextNumber + i)
          if (titleLength(text.rawTitle.replace(/\s+/g, ' ').trim()) > 100) titleTooLong = true
          const thumb = clip.thumbPath && existsSync(clip.thumbPath) ? clip.thumbPath : null
          if (thumb) deps.media.grant(thumb)
          return {
            atUtc,
            clip: {
              id: clip.id,
              title: clip.title,
              thumbUrl: thumb ? mediaUrl(thumb) : clip.thumbnailUrl,
              renderedTitle: text.title,
              renderedDescription: finalizeDescription(text.description),
              needsRender: needsRender(input.format, clip)
            }
          }
        }),
        eligibleClips: eligible.length,
        titleTooLong
      }
    },

    /** Uploads and quota units per Pacific day for the next week, rules included. */
    forecast(): QuotaDayForecast[] {
      const now = clock()
      const rules = repos.autopostRules.list().filter((r) => r.enabled && !blockedReason(r))
      const posts = repos.posts
        .list({ statuses: ['queued', 'waiting_quota', 'needs_approval', 'failed'] })
        .filter((p) => !p.ruleId && !p.youtubeVideoId)
      return forecastQuota({
        now,
        days: 7,
        leadMs: repos.settings.getKey('uploadLeadHours') * 3600_000,
        zone,
        rules: rules.map((r) => ({
          slots: r.slotsJson,
          weekdays: r.weekdaysJson,
          playlist: Boolean(r.playlistId)
        })),
        posts: posts.map((p) => ({
          uploadAtUtc: p.uploadAfterUtc ?? now.toISOString(),
          thumbnail: Boolean(p.thumbnailPath),
          playlist: Boolean(p.playlistId)
        })),
        slotsBetween
      })
    },

    // ---- planner (called by the job) ----------------------------------------------------

    /** Rules with empty slots to fill or approvals to expire. */
    rulesWithWork(now: Date): number[] {
      return repos.autopostRules
        .list()
        .filter((rule) => {
          if (!rule.enabled || blockedReason(rule)) return false
          if (overdueApprovals(rule, now).length > 0) return true
          const empty = emptyBankAt.get(rule.id)
          if (empty && now.getTime() - empty < EMPTY_BANK_RETRY_MS) return false
          return emptySlots(rule, now).length > 0
        })
        .map((r) => r.id)
    },

    /** Fills the rule's empty slots. Returns how many autoposts it created. */
    async planRule(ruleId: number): Promise<{ created: number; unfilled: number }> {
      const rule = repos.autopostRules.get(ruleId)
      if (!rule || !rule.enabled || blockedReason(rule)) return { created: 0, unfilled: 0 }
      const now = clock()

      for (const post of overdueApprovals(rule, now)) {
        repos.posts.transition(post.id, 'cancel', {
          patch: { lastError: 'Not approved before its publish time' },
          reason: 'not approved in time'
        })
      }

      const slots = emptySlots(rule, now)
      const bank = usableBank(rule.twitchAccountIdsJson)
      const excluded = excludedFor(rule.youtubeAccountId, rule.skippedClipIdsJson)
      const candidates = pickClips(bank, pickRuleOf(toRuleInput(rule)), excluded, bank.length)
      let created = 0
      let next = 0
      for (const slot of slots) {
        let post: PostRow | null = null
        while (!post && next < candidates.length) {
          const clip = candidates[next++] as ClipRow
          post = await createAutopost(rule, clip, slot, now)
        }
        if (!post) break
        created += 1
      }
      const unfilled = slots.length - created

      if (unfilled > 0) {
        emptyBankAt.set(rule.id, now.getTime())
        const day = DateTime.fromJSDate(now, { zone }).toISODate()
        const key = `${rule.id}:${day}`
        if (!notifiedEmpty.has(key)) {
          notifiedEmpty.add(key)
          repos.eventLog.write({
            kind: 'autopost.bank_empty',
            level: 'warn',
            message: `"${rule.name}": no clips left for ${unfilled} slot${unfilled === 1 ? '' : 's'}`,
            accountId: rule.youtubeAccountId
          })
          deps.notify(
            'Out of clips',
            `"${rule.name}" has no clips left for ${unfilled} upcoming slot${unfilled === 1 ? '' : 's'}. They stay empty until new clips arrive or you loosen its filters.`
          )
        }
      } else {
        emptyBankAt.delete(rule.id)
      }

      if (created > 0) {
        repos.eventLog.write({
          kind: 'autopost.planned',
          message: `"${rule.name}": created ${created} autopost${created === 1 ? '' : 's'}`,
          accountId: rule.youtubeAccountId
        })
        if (rule.mode === 'review') {
          deps.notify(
            `${created} autopost${created === 1 ? '' : 's'} to review`,
            `"${rule.name}": approve them in the queue.`
          )
        }
        deps.emitPostsChanged()
        deps.kickJobs?.()
        logger.info(`[autopost] rule ${rule.id}: +${created}, ${unfilled} empty`)
      }
      return { created, unfilled }
    }
  }
  return service
}
