import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  describeEvent,
  EVENT_GLOSSARY,
  EVENT_KINDS,
  FAILED_POST_CHECK,
  isFailedTransition,
  UNKNOWN_EVENT_EXPLANATION,
  UNKNOWN_EVENT_LABEL
} from './eventGlossary'

/**
 * Every kind the app writes to the event log. Keep this in step with the glossary: the test
 * below fails with a message saying which side is missing something. There is deliberately no
 * count here, so adding a kind only means adding it to this list and to the glossary.
 */
const WRITTEN_KINDS = [
  'app.start',
  'post.created',
  'post.status',
  'post.audit_lock',
  'post.missed',
  'post.uploaded',
  'post.rescheduled',
  'clips.sync',
  'clips.backfill_done',
  'clips.sync_failed',
  'cleanup.done',
  'backup.imported',
  'autopost.rule_created',
  'autopost.rule_updated',
  'autopost.rule_synced',
  'autopost.rule_deleted',
  'autopost.swapped',
  'autopost.bank_empty',
  'autopost.planned',
  'account.needs_reauth',
  'account.upload_limited',
  'account.added',
  'account.reconnected',
  'account.removed',
  'google.client_imported',
  'dryrun.call',
  'twitch.connected',
  'twitch.needs_reauth',
  'twitch.removed'
]

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

/**
 * Kinds in files that write events: `eventLog.write(` calls and the direct `insert(eventLog)`
 * in the posts repo. Each `kind: …` is searched for quoted dotted names, which also catches
 * the `id ? 'a.b' : 'c.d'` form. A kind built some other way would be missed, and the explicit
 * list above is what catches that.
 */
function kindsWrittenInSource(): Set<string> {
  const kinds = new Set<string>()
  for (const file of sourceFiles(SRC_DIR)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('eventLog.write(') && !text.includes('insert(eventLog)')) continue
    for (const line of text.split(/\r?\n/)) {
      // `kind: 'a.b', …` can sit mid-line (app.start is written on one line), so take what
      // follows `kind:` up to the next comma.
      const value = /\bkind:\s*([^,]*)/.exec(line)?.[1]
      if (!value) continue
      for (const match of value.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) kinds.add(match[1]!)
    }
  }
  return kinds
}

function difference(a: Iterable<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort()
}

describe('event glossary coverage', () => {
  it('has an entry for exactly the kinds on the explicit list', () => {
    const glossary = new Set<string>(EVENT_KINDS)
    const listed = new Set(WRITTEN_KINDS)
    expect(difference(listed, glossary), 'on the list but not in the glossary').toEqual([])
    expect(difference(glossary, listed), 'in the glossary but not on the list').toEqual([])
  })

  it('covers every kind written in src/ and has no dead entries', () => {
    const found = kindsWrittenInSource()
    const glossary = new Set<string>(EVENT_KINDS)
    expect(found.size, 'the scan found nothing; did the source layout change?').toBeGreaterThan(0)
    expect(difference(found, glossary), 'written in src/ but not in the glossary').toEqual([])
    expect(difference(glossary, found), 'in the glossary but not written in src/').toEqual([])
  })

  it('gives every entry a label and an explanation', () => {
    for (const [kind, entry] of Object.entries(EVENT_GLOSSARY)) {
      expect(entry.label.trim(), kind).not.toBe('')
      expect(entry.explanation.trim(), kind).not.toBe('')
    }
  })

  it('has a "what to check" hint on the warn-level kinds', () => {
    const warnKinds = [
      'post.audit_lock',
      'clips.sync_failed',
      'autopost.bank_empty',
      'account.needs_reauth',
      'account.upload_limited',
      'twitch.needs_reauth'
    ] as const
    for (const kind of warnKinds) {
      expect(describeEvent(kind, '').check, kind).toBeTruthy()
    }
  })
})

describe('describeEvent', () => {
  it('describes a known kind', () => {
    expect(describeEvent('post.uploaded', 'Uploaded as abc')).toEqual({
      label: 'Upload finished',
      explanation: EVENT_GLOSSARY['post.uploaded'].explanation,
      check: null,
      known: true
    })
  })

  it('falls back for a kind it does not know', () => {
    expect(describeEvent('nothing.here', 'x')).toEqual({
      label: UNKNOWN_EVENT_LABEL,
      explanation: UNKNOWN_EVENT_EXPLANATION,
      check: null,
      known: false
    })
    expect(UNKNOWN_EVENT_EXPLANATION).toBe('Unknown event, see the log')
  })

  it('does not treat inherited object names as known kinds', () => {
    expect(describeEvent('constructor', '').known).toBe(false)
    expect(describeEvent('toString', '').known).toBe(false)
  })

  it('points to the Queue for a post that moved into failed', () => {
    const message = 'queued → failed (upload): quotaExceeded'
    expect(isFailedTransition('post.status', message)).toBe(true)
    expect(describeEvent('post.status', message).check).toBe(FAILED_POST_CHECK)
  })

  it('gives no hint for other post.status moves or other kinds that mention failed', () => {
    expect(describeEvent('post.status', 'queued → uploading (start_upload)').check).toBeNull()
    expect(describeEvent('post.status', 'failed → queued (retry): retried by you').check).toBeNull()
    expect(isFailedTransition('clips.sync', 'x → failed')).toBe(false)
  })
})
