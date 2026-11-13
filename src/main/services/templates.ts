import type {
  SeriesInput,
  SeriesView,
  TemplateInput,
  TemplateView
} from '@shared/schemas/templates'
import { normalizeTags } from '@shared/schemas/post'
import { renderPostVariables } from '@shared/templates'
import type { Repos } from '../db/repos'
import type { SeriesRow, TemplateRow } from '../db/repos/catalog'
import { UserFacingError } from '../errors'

/**
 * Templates (title/description/tags with {{n}}, {{date}}, {{channel}}) and series (a
 * template plus a running number). The number is taken when a post is queued; see
 * posts service fillVariables().
 */
export type TemplatesService = ReturnType<typeof createTemplatesService>

export function createTemplatesService(deps: { repos: Repos; emitChanged: () => void }) {
  const { repos } = deps

  const channelTitle = (accountId: number | null): string | null =>
    accountId ? (repos.accounts.get(accountId)?.channelTitle ?? null) : null

  function toTemplateView(row: TemplateRow): TemplateView {
    return {
      id: row.id,
      input: {
        name: row.name,
        accountId: row.accountId,
        titleTpl: row.titleTpl,
        descriptionTpl: row.descriptionTpl,
        tags: row.tagsJson
      },
      channelTitle: channelTitle(row.accountId),
      seriesCount: repos.series.list().filter((s) => s.templateId === row.id).length
    }
  }

  function toSeriesView(row: SeriesRow): SeriesView {
    const template = repos.templates.get(row.templateId)
    return {
      id: row.id,
      input: {
        name: row.name,
        templateId: row.templateId,
        accountId: row.accountId,
        nextNumber: row.nextNumber
      },
      templateName: template?.name ?? '?',
      channelTitle: channelTitle(row.accountId),
      nextTitle: renderPostVariables(template?.titleTpl || row.name, {
        n: String(row.nextNumber)
      }),
      numbered: repos.posts.list({}).filter((p) => p.seriesId === row.id && p.seriesNumber !== null)
        .length
    }
  }

  function checkChannel(accountId: number | null): void {
    if (accountId === null) return
    const account = repos.accounts.get(accountId)
    if (!account || account.removedAt) throw new UserFacingError('That channel is not connected.')
  }

  return {
    listTemplates: (): TemplateView[] => repos.templates.list().map(toTemplateView),

    saveTemplate(input: TemplateInput, id?: number): TemplateView {
      checkChannel(input.accountId)
      const row = {
        name: input.name.trim(),
        accountId: input.accountId,
        titleTpl: input.titleTpl,
        descriptionTpl: input.descriptionTpl,
        tagsJson: normalizeTags(input.tags)
      }
      const saved = id ? repos.templates.update(id, row) : repos.templates.create(row)
      deps.emitChanged()
      return toTemplateView(saved)
    },

    deleteTemplate(id: number): { ok: true } {
      const template = repos.templates.require(id)
      const used = repos.series.list().filter((s) => s.templateId === id)
      if (used.length > 0) {
        throw new UserFacingError(
          `"${template.name}" is used by the series ${used.map((s) => `"${s.name}"`).join(', ')}. Delete or change those first.`
        )
      }
      repos.templates.remove(id)
      deps.emitChanged()
      return { ok: true }
    },

    listSeries: (): SeriesView[] => repos.series.list().map(toSeriesView),

    saveSeries(input: SeriesInput, id?: number): SeriesView {
      checkChannel(input.accountId)
      repos.templates.require(input.templateId)
      const row = {
        name: input.name.trim(),
        templateId: input.templateId,
        accountId: input.accountId,
        nextNumber: input.nextNumber
      }
      const saved = id ? repos.series.update(id, row) : repos.series.create(row)
      deps.emitChanged()
      return toSeriesView(saved)
    },

    /** Posts keep their titles and numbers; they just stop belonging to the series. */
    deleteSeries(id: number): { ok: true } {
      repos.series.require(id)
      repos.series.remove(id)
      deps.emitChanged()
      return { ok: true }
    }
  }
}
