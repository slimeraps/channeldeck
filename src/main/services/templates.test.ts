import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, seedAccount, type TestDb } from '../../../tests/helpers/db'
import { createTemplatesService, type TemplatesService } from './templates'

let t: TestDb
let service: TemplatesService

beforeEach(() => {
  t = createTestDb()
  service = createTemplatesService({ repos: t.repos, emitChanged: vi.fn() })
})
afterEach(() => t.close())

describe('templates and series', () => {
  it('saves templates and shows a series’ next title', () => {
    const account = seedAccount(t.repos, { channelTitle: 'Helmsy' })
    const tpl = service.saveTemplate({
      name: 'MW4',
      accountId: account.id,
      titleTpl: 'MW4 Day {{n}}',
      descriptionTpl: 'Day {{n}}',
      tags: ['mw4', 'MW4 ']
    })
    expect(tpl).toMatchObject({ channelTitle: 'Helmsy', input: { tags: ['mw4'] } })
    const series = service.saveSeries({
      name: 'MW4 days',
      templateId: tpl.id,
      accountId: null,
      nextNumber: 9
    })
    expect(series).toMatchObject({ nextTitle: 'MW4 Day 9', templateName: 'MW4', numbered: 0 })
    expect(service.listTemplates()[0]?.seriesCount).toBe(1)
    // Editing the counter.
    expect(service.saveSeries({ ...series.input, nextNumber: 12 }, series.id).nextTitle).toBe(
      'MW4 Day 12'
    )
  })

  it('refuses to delete a template a series uses', () => {
    const tpl = service.saveTemplate({
      name: 'MW4',
      accountId: null,
      titleTpl: 'Day {{n}}',
      descriptionTpl: '',
      tags: []
    })
    const series = service.saveSeries({
      name: 'S',
      templateId: tpl.id,
      accountId: null,
      nextNumber: 1
    })
    expect(() => service.deleteTemplate(tpl.id)).toThrow(/used by the series "S"/)
    service.deleteSeries(series.id)
    expect(service.deleteTemplate(tpl.id)).toEqual({ ok: true })
    expect(service.listTemplates()).toEqual([])
  })
})
