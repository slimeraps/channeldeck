import type { PostStatus } from '@shared/constants/enums'
import { accountDefaultsSchema } from '@shared/schemas/account'
import { type Backup, BACKUP_FORMAT, backupSchema, type ImportReport } from '@shared/schemas/backup'
import type { Repos } from '../db/repos'
import { type Clock, systemClock } from '../db/repos/common'
import { startBackfill } from '../domain/clips'
import { UserFacingError } from '../errors'

/**
 * Backup export/import. The export is built field by field from an allow-list, so a new
 * secret column can't leak into it by accident; tokens, the Twitch client secret and
 * `secret.*` settings are never read here.
 */

/** Posts not on YouTube yet: worth bringing back as drafts. */
const UNPOSTED: PostStatus[] = ['draft', 'needs_approval', 'queued', 'failed', 'waiting_quota']

export type BackupService = ReturnType<typeof createBackupService>

export function createBackupService(deps: { repos: Repos; clock?: Clock }) {
  const { repos } = deps
  const clock = deps.clock ?? systemClock

  function exportBackup(): Backup {
    const channels = repos.accounts.list({ includeRemoved: false })
    const channelIdOf = new Map(channels.map((a) => [a.id, a.channelId]))
    const twitch = repos.twitchAccounts.list()
    const broadcasterOf = new Map(twitch.map((t) => [t.id, t.broadcasterId]))
    const templates = repos.templates.list()
    const templateName = new Map(templates.map((t) => [t.id, t.name]))
    const layouts = repos.layoutPresets.list()
    const seriesName = new Map(repos.series.list().map((s) => [s.id, s.name]))

    return {
      app: 'ChannelDeck',
      format: BACKUP_FORMAT,
      exportedAt: clock().toISOString(),
      settings: repos.settings.get(),
      youtubeChannels: channels.map((a) => ({
        channelId: a.channelId,
        channelTitle: a.channelTitle,
        channelHandle: a.channelHandle,
        avatarUrl: a.avatarUrl,
        color: a.color,
        enabled: a.enabled,
        defaults: accountDefaultsSchema.catch({}).parse(a.defaultsJson)
      })),
      twitchChannels: twitch.map((t) => ({
        broadcasterId: t.broadcasterId,
        login: t.login,
        displayName: t.displayName,
        avatarUrl: t.avatarUrl,
        color: t.color,
        editorId: t.editorId,
        authFlow: t.authFlow,
        syncEnabled: t.syncEnabled,
        backfillFromUtc: t.backfillFromUtc
      })),
      templates: templates.map((t) => ({
        name: t.name,
        channelId: t.accountId ? (channelIdOf.get(t.accountId) ?? null) : null,
        titleTpl: t.titleTpl,
        descriptionTpl: t.descriptionTpl,
        tags: t.tagsJson
      })),
      series: repos.series.list().map((s) => ({
        name: s.name,
        templateName: templateName.get(s.templateId) ?? '',
        channelId: s.accountId ? (channelIdOf.get(s.accountId) ?? null) : null,
        nextNumber: s.nextNumber
      })),
      layouts: layouts.map((l) => ({
        name: l.name,
        broadcasterId: broadcasterOf.get(l.twitchAccountId) ?? '',
        kind: l.kind,
        crops: l.cropsJson
      })),
      rules: repos.autopostRules.list().flatMap((r) => {
        const channelId = channelIdOf.get(r.youtubeAccountId)
        if (!channelId) return []
        const layout = r.layoutPresetId ? layouts.find((l) => l.id === r.layoutPresetId) : null
        return [
          {
            name: r.name,
            channelId,
            broadcasterIds: r.twitchAccountIdsJson
              .map((id) => broadcasterOf.get(id))
              .filter((b): b is string => Boolean(b)),
            slots: r.slotsJson,
            weekdays: r.weekdaysJson,
            pickOrder: r.pickOrder,
            filters: r.filtersJson,
            format: r.format,
            layout: layout
              ? {
                  broadcasterId: broadcasterOf.get(layout.twitchAccountId) ?? '',
                  name: layout.name
                }
              : null,
            useTwitchVertical: r.useTwitchVertical,
            titleTpl: r.titleTpl,
            descriptionTpl: r.descriptionTpl,
            tags: r.tagsJson,
            categoryId: r.categoryId,
            playlistId: r.playlistId,
            madeForKids: r.madeForKids,
            mode: r.mode,
            lookaheadDays: r.lookaheadDays,
            enabled: r.enabled,
            nextNumber: r.nextNumber,
            skippedClipIds: r.skippedClipIdsJson
          }
        ]
      }),
      posts: repos.posts
        .list({ statuses: UNPOSTED })
        .filter((p) => !p.youtubeVideoId && !p.ruleId && channelIdOf.has(p.accountId))
        .map((p) => ({
          channelId: channelIdOf.get(p.accountId) as string,
          title: p.title,
          description: p.description,
          tags: p.tagsJson,
          categoryId: p.categoryId,
          playlistId: p.playlistId,
          filePath: p.filePath,
          thumbnailPath: p.thumbnailPath,
          madeForKids: p.madeForKids,
          notifySubscribers: p.notifySubscribers,
          license: p.license,
          embeddable: p.embeddable,
          defaultLanguage: p.defaultLanguage,
          defaultAudioLanguage: p.defaultAudioLanguage,
          syntheticMedia: p.syntheticMedia,
          visibilityMode: p.visibilityMode,
          publishAtUtc: p.publishAtUtc,
          missedPolicy: p.missedPolicy,
          seriesName: p.seriesId ? (seriesName.get(p.seriesId) ?? null) : null
        }))
    }
  }

  /**
   * Adds what isn't here yet; anything with the same channel id or name is left alone.
   * Channels come back signed out ("Needs re-auth"); rules come back switched off; posts
   * come back as drafts. Settings are restored except Dry Run and "delete local files after
   * posting", which keep this Mac's values.
   */
  function importBackup(raw: unknown): ImportReport {
    const parsed = backupSchema.safeParse(raw)
    if (!parsed.success) {
      throw new UserFacingError(
        `That isn't a ChannelDeck backup this version can read (${parsed.error.issues[0]?.path.join('.') || 'format'}: ${parsed.error.issues[0]?.message}).`
      )
    }
    const b = parsed.data
    const added = {
      youtubeChannels: 0,
      twitchChannels: 0,
      templates: 0,
      series: 0,
      layouts: 0,
      rules: 0,
      drafts: 0
    }
    let skipped = 0
    const now = clock()

    // Settings that decide whether anything is really uploaded or deleted stay as they are
    // on this Mac: an old backup must never quietly turn Dry Run off or start deleting files.
    const { dryRun: _dryRun, deleteLocalAfterPostingDays: _deleteDays, ...restored } = b.settings
    repos.settings.update(restored)

    const accountId = new Map<string, number>()
    for (const a of repos.accounts.list({ includeRemoved: true })) accountId.set(a.channelId, a.id)
    for (const c of b.youtubeChannels) {
      if (accountId.has(c.channelId)) {
        skipped += 1
        continue
      }
      const row = repos.accounts.create({
        channelId: c.channelId,
        channelTitle: c.channelTitle,
        channelHandle: c.channelHandle,
        avatarUrl: c.avatarUrl,
        color: c.color,
        enabled: c.enabled,
        defaultsJson: c.defaults
      })
      repos.accounts.update(row.id, { tokenStatus: 'needs_reauth' })
      accountId.set(c.channelId, row.id)
      added.youtubeChannels += 1
    }

    const twitchId = new Map<string, number>()
    for (const t of repos.twitchAccounts.list()) twitchId.set(t.broadcasterId, t.id)
    for (const t of b.twitchChannels) {
      if (twitchId.has(t.broadcasterId)) {
        skipped += 1
        continue
      }
      const from = t.backfillFromUtc ?? now.toISOString()
      const row = repos.twitchAccounts.create({
        broadcasterId: t.broadcasterId,
        login: t.login,
        displayName: t.displayName,
        avatarUrl: t.avatarUrl,
        color: t.color,
        editorId: t.editorId,
        authFlow: t.authFlow,
        tokenStatus: 'needs_reauth',
        syncEnabled: t.syncEnabled,
        backfillFromUtc: t.backfillFromUtc,
        backfillCursorJson: startBackfill(from, now.toISOString())
      })
      twitchId.set(t.broadcasterId, row.id)
      added.twitchChannels += 1
    }

    const templateId = new Map(repos.templates.list().map((t) => [t.name, t.id]))
    for (const t of b.templates) {
      if (templateId.has(t.name)) {
        skipped += 1
        continue
      }
      const row = repos.templates.create({
        name: t.name,
        accountId: t.channelId ? (accountId.get(t.channelId) ?? null) : null,
        titleTpl: t.titleTpl,
        descriptionTpl: t.descriptionTpl,
        tagsJson: t.tags
      })
      templateId.set(t.name, row.id)
      added.templates += 1
    }

    const seriesId = new Map(repos.series.list().map((s) => [s.name, s.id]))
    for (const s of b.series) {
      const template = templateId.get(s.templateName)
      if (seriesId.has(s.name) || !template) {
        skipped += 1
        continue
      }
      const row = repos.series.create({
        name: s.name,
        templateId: template,
        accountId: s.channelId ? (accountId.get(s.channelId) ?? null) : null,
        nextNumber: s.nextNumber
      })
      seriesId.set(s.name, row.id)
      added.series += 1
    }

    const layoutKey = (broadcasterId: string, name: string): string =>
      `${broadcasterId}\u0000${name}`
    const layoutId = new Map<string, number>()
    const broadcasterOf = new Map(repos.twitchAccounts.list().map((t) => [t.id, t.broadcasterId]))
    for (const l of repos.layoutPresets.list()) {
      layoutId.set(layoutKey(broadcasterOf.get(l.twitchAccountId) ?? '', l.name), l.id)
    }
    for (const l of b.layouts) {
      const owner = twitchId.get(l.broadcasterId)
      const key = layoutKey(l.broadcasterId, l.name)
      if (layoutId.has(key) || !owner) {
        skipped += 1
        continue
      }
      const row = repos.layoutPresets.create({
        twitchAccountId: owner,
        name: l.name,
        kind: l.kind,
        cropsJson: l.crops
      })
      layoutId.set(key, row.id)
      added.layouts += 1
    }

    const ruleNames = new Set(repos.autopostRules.list().map((r) => r.name))
    for (const r of b.rules) {
      const channel = accountId.get(r.channelId)
      const sources = r.broadcasterIds
        .map((id) => twitchId.get(id))
        .filter((id): id is number => id !== undefined)
      if (ruleNames.has(r.name) || !channel || sources.length === 0) {
        skipped += 1
        continue
      }
      repos.autopostRules.create({
        name: r.name,
        youtubeAccountId: channel,
        twitchAccountIdsJson: sources,
        slotsJson: r.slots,
        weekdaysJson: r.weekdays,
        pickOrder: r.pickOrder,
        filtersJson: r.filters,
        format: r.format,
        layoutPresetId: r.layout
          ? (layoutId.get(layoutKey(r.layout.broadcasterId, r.layout.name)) ?? null)
          : null,
        useTwitchVertical: r.useTwitchVertical,
        titleTpl: r.titleTpl,
        descriptionTpl: r.descriptionTpl,
        tagsJson: r.tags,
        categoryId: r.categoryId,
        playlistId: r.playlistId,
        madeForKids: r.madeForKids,
        mode: r.mode,
        lookaheadDays: r.lookaheadDays,
        // Off until you've signed back in and checked it: no surprise autoposts.
        enabled: false,
        nextNumber: r.nextNumber,
        skippedClipIdsJson: r.skippedClipIds
      })
      ruleNames.add(r.name)
      added.rules += 1
    }

    // A post counts as already here if the channel has one with the same title and video.
    const postKey = (channel: number, title: string, file: string | null): string =>
      `${channel}\u0000${title}\u0000${file ?? ''}`
    const existingPosts = new Set(
      repos.posts
        .list({})
        .filter((p) => p.status !== 'canceled')
        .map((p) => postKey(p.accountId, p.title, p.filePath))
    )
    for (const p of b.posts) {
      const channel = accountId.get(p.channelId)
      if (!channel || existingPosts.has(postKey(channel, p.title, p.filePath))) {
        skipped += 1
        continue
      }
      repos.posts.create({
        accountId: channel,
        status: 'draft',
        source: 'manual',
        title: p.title,
        description: p.description,
        tagsJson: p.tags,
        categoryId: p.categoryId,
        playlistId: p.playlistId,
        filePath: p.filePath,
        thumbnailPath: p.thumbnailPath,
        madeForKids: p.madeForKids,
        notifySubscribers: p.notifySubscribers,
        license: p.license,
        embeddable: p.embeddable,
        defaultLanguage: p.defaultLanguage,
        defaultAudioLanguage: p.defaultAudioLanguage,
        syntheticMedia: p.syntheticMedia,
        visibilityMode: p.visibilityMode,
        publishAtUtc: p.publishAtUtc,
        missedPolicy: p.missedPolicy,
        seriesId: p.seriesName ? (seriesId.get(p.seriesName) ?? null) : null
      })
      added.drafts += 1
    }

    repos.eventLog.write({
      kind: 'backup.imported',
      message: `Imported a backup from ${b.exportedAt}: ${Object.entries(added)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')}; ${skipped} already here`
    })
    return { added, skipped }
  }

  return { exportBackup, importBackup }
}
