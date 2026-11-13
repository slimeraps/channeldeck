import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, seedTwitchAccount, type TestDb } from '../../../tests/helpers/db'
import { createSecretBox } from '../secrets/secretBox'
import { createBackupService } from './backup'

const secrets = createSecretBox({
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (s) => Buffer.from(`enc:${s}`, 'utf8'),
  decryptStringAsync: async (b) => ({
    result: Buffer.from(b).toString('utf8').slice(4),
    shouldReEncrypt: false
  })
})

const YT_TOKEN = '1//0g-youtube-refresh-token-SECRET'
const TW_TOKEN = 'twitch-refresh-token-SECRET'
const TW_SECRET = 'twitch-client-secret-SECRET'

let source: TestDb
let target: TestDb

async function seed(t: TestDb): Promise<void> {
  const channel = t.repos.accounts.create({
    channelId: 'UC123',
    channelTitle: 'Helmsy Shorts',
    color: '#ec4899',
    encRefreshToken: await secrets.encrypt(YT_TOKEN),
    defaultsJson: { categoryId: '20', descriptionFooter: 'Follow!' }
  })
  const twitch = seedTwitchAccount(t.repos)
  t.repos.twitchAccounts.update(twitch.id, {
    color: '#22c55e',
    encRefreshToken: await secrets.encrypt(TW_TOKEN)
  })
  t.repos.settings.update({ twitchClientId: 'public-client-id', dryRun: true })
  t.repos.settings.setSecret('twitchClientSecret', await secrets.encrypt(TW_SECRET))
  const template = t.repos.templates.create({
    name: 'MW4',
    accountId: channel.id,
    titleTpl: 'MW4 Day {{n}}',
    descriptionTpl: 'Day {{n}}',
    tagsJson: ['mw4']
  })
  const series = t.repos.series.create({ name: 'MW4 days', templateId: template.id, nextNumber: 9 })
  const layout = t.repos.layoutPresets.create({
    twitchAccountId: twitch.id,
    name: 'Cam top right',
    kind: 'facecam_split',
    cropsJson: {
      facecam: { x: 1, y: 2, width: 3, height: 4 },
      gameplay: { x: 0, y: 0, width: 9, height: 9 }
    }
  })
  t.repos.autopostRules.create({
    name: 'Daily Shorts',
    youtubeAccountId: channel.id,
    twitchAccountIdsJson: [twitch.id],
    slotsJson: ['18:00'],
    weekdaysJson: [1, 2, 3],
    filtersJson: { minViews: 10 },
    layoutPresetId: layout.id,
    titleTpl: '{{clip_title}}',
    descriptionTpl: 'by {{clipper}}',
    enabled: true
  })
  t.repos.posts.create({
    accountId: channel.id,
    status: 'queued',
    source: 'manual',
    title: 'MW4 Day {{n}}',
    seriesId: series.id,
    filePath: '/Users/test/Movies/day9.mp4'
  })
}

beforeEach(async () => {
  source = createTestDb()
  target = createTestDb()
  await seed(source)
})
afterEach(() => {
  source.close()
  target.close()
})

describe('backup', () => {
  it('exports no tokens or secrets in any form', () => {
    const json = JSON.stringify(createBackupService({ repos: source.repos }).exportBackup())
    for (const secret of [YT_TOKEN, TW_TOKEN, TW_SECRET]) {
      expect(json).not.toContain(secret)
      expect(json).not.toContain(`enc:${secret}`)
      expect(json).not.toContain(Buffer.from(`enc:${secret}`).toString('base64'))
    }
    expect(json).not.toMatch(/refresh|encRefreshToken|secret\.|twitchClientSecret|clientSecret/i)
    // The public Client ID is a normal setting and does come along.
    expect(json).toContain('public-client-id')
  })

  it('round-trips into a fresh install, signed out, with rules switched off', () => {
    const exported = createBackupService({ repos: source.repos }).exportBackup()
    const report = createBackupService({ repos: target.repos }).importBackup(
      JSON.parse(JSON.stringify(exported))
    )
    expect(report).toEqual({
      added: {
        youtubeChannels: 1,
        twitchChannels: 1,
        templates: 1,
        series: 1,
        layouts: 1,
        rules: 1,
        drafts: 1
      },
      skipped: 0
    })
    const [channel] = target.repos.accounts.list({ includeRemoved: false })
    expect(channel).toMatchObject({
      channelId: 'UC123',
      color: '#ec4899',
      tokenStatus: 'needs_reauth',
      encRefreshToken: null
    })
    expect(target.repos.twitchAccounts.list()[0]).toMatchObject({
      tokenStatus: 'needs_reauth',
      encRefreshToken: null,
      color: '#22c55e'
    })
    expect(target.repos.settings.getSecret('twitchClientSecret')).toBeNull()
    expect(target.repos.settings.get()).toMatchObject({
      twitchClientId: 'public-client-id',
      dryRun: true
    })
    const rule = target.repos.autopostRules.list()[0]
    expect(rule).toMatchObject({
      name: 'Daily Shorts',
      enabled: false,
      filtersJson: { minViews: 10 }
    })
    expect(rule?.layoutPresetId).toBe(target.repos.layoutPresets.list()[0]?.id)
    const [draft] = target.repos.posts.list({})
    expect(draft).toMatchObject({ status: 'draft', title: 'MW4 Day {{n}}' })
    expect(draft?.seriesId).toBe(target.repos.series.list()[0]?.id)

    // Exporting again gives the same setup (rules now off, channels signed out).
    const again = createBackupService({ repos: target.repos }).exportBackup()
    expect({ ...again, exportedAt: '' }).toEqual({
      ...exported,
      exportedAt: '',
      rules: exported.rules.map((r) => ({ ...r, enabled: false }))
    })
  })

  it('skips what is already there and rejects files that are not backups', () => {
    const service = createBackupService({ repos: source.repos })
    const report = service.importBackup(service.exportBackup())
    expect(report.added).toMatchObject({ youtubeChannels: 0, templates: 0, rules: 0, drafts: 0 })
    expect(report.skipped).toBe(7)
    expect(() => service.importBackup({ app: 'Other' })).toThrow(/isn't a ChannelDeck backup/)
  })
})
