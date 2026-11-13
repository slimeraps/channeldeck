import { DateTime } from 'luxon'
import { DESCRIPTION_MAX_BYTES, TITLE_MAX_CHARS } from './constants/limits'

/**
 * Title/description templates with {{variables}}. Pure, shared by main (autoposts) and the
 * renderer (live preview in the rule editor). Output is cleaned to YouTube's rules: no < or
 * >, title ≤ 100 characters (cut at a word, with …), description ≤ 5000 bytes.
 */

export const CLIP_TEMPLATE_VARS = [
  { name: 'clip_title', label: 'Clip title' },
  { name: 'game', label: 'Game' },
  { name: 'broadcaster', label: 'Streamer' },
  { name: 'clipper', label: 'Who clipped it' },
  { name: 'clip_date', label: 'Clip date' },
  { name: 'clip_url', label: 'Clip link' },
  { name: 'twitch_url', label: 'Twitch channel link' },
  { name: 'views', label: 'Views' },
  { name: 'n', label: 'Running number' }
] as const
export type ClipTemplateVar = (typeof CLIP_TEMPLATE_VARS)[number]['name']
export type TemplateValues = Partial<Record<ClipTemplateVar, string>>

export const DEFAULT_TITLE_TEMPLATE = '{{clip_title}}'
export const DEFAULT_DESCRIPTION_TEMPLATE =
  'Clipped by {{clipper}}\n{{clip_url}}\n\nWatch {{broadcaster}} live: {{twitch_url}}'

const VAR = /\{\{\s*([a-z_]+)\s*\}\}/g
const KNOWN = new Set<string>(CLIP_TEMPLATE_VARS.map((v) => v.name))

/** Fills in {{variables}}. Unknown ones are left as typed, so mistakes stay visible. */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(VAR, (whole, name: string) =>
    KNOWN.has(name) ? (values[name as ClipTemplateVar] ?? '') : whole
  )
}

/** Variable names in a template that aren't supported (for the editor's warnings). */
export function unknownVariables(template: string): string[] {
  const out = new Set<string>()
  for (const match of template.matchAll(VAR)) {
    const name = match[1] as string
    if (!KNOWN.has(name)) out.add(name)
  }
  return [...out]
}

export interface ClipForTemplate {
  title: string
  url: string
  creatorName: string | null
  viewCount: number
  createdAtUtc: string
  gameName: string | null
}

export function clipTemplateValues(
  clip: ClipForTemplate,
  ctx: { broadcasterName: string; broadcasterLogin: string; n: number; zone: string }
): TemplateValues {
  return {
    clip_title: clip.title,
    game: clip.gameName ?? '',
    broadcaster: ctx.broadcasterName,
    clipper: clip.creatorName ?? '',
    clip_date: DateTime.fromISO(clip.createdAtUtc, { zone: 'utc' })
      .setZone(ctx.zone)
      .setLocale('en-US')
      .toLocaleString(DateTime.DATE_MED),
    clip_url: clip.url,
    twitch_url: `https://www.twitch.tv/${ctx.broadcasterLogin}`,
    views: clip.viewCount.toLocaleString('en-US'),
    n: String(ctx.n)
  }
}

// ---- manual posts: templates and series ------------------------------------------------

export const POST_TEMPLATE_VARS = [
  { name: 'n', label: 'Series number (set when queued)' },
  { name: 'date', label: 'Publish date' },
  { name: 'channel', label: 'Channel name' }
] as const
export type PostTemplateVar = (typeof POST_TEMPLATE_VARS)[number]['name']

const POST_VAR = /\{\{\s*(n|date|channel)\s*\}\}/g

/** Whether text still has {{n}}, {{date}} or {{channel}} to fill in. */
export function hasPostVariables(text: string): boolean {
  return new RegExp(POST_VAR.source).test(text)
}

/** Fills in the post variables it has values for; the rest stay as typed. */
export function renderPostVariables(
  text: string,
  values: Partial<Record<PostTemplateVar, string>>
): string {
  return text.replace(POST_VAR, (whole, name: PostTemplateVar) => values[name] ?? whole)
}

/** {{date}}: the local publish date ("Nov 14, 2026"). */
export function postDateLabel(at: Date, zone: string): string {
  return DateTime.fromJSDate(at, { zone }).setLocale('en-US').toLocaleString(DateTime.DATE_MED)
}

/** One line, no < or >, at most 100 characters (cut at a word boundary with …). */
export function finalizeTitle(raw: string, fallback = 'Untitled clip'): string {
  const clean = raw.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
  const chars = [...(clean || fallback)]
  if (chars.length <= TITLE_MAX_CHARS) return chars.join('')
  const cut = chars.slice(0, TITLE_MAX_CHARS - 1).join('')
  const space = cut.lastIndexOf(' ')
  // Cut at the last word if that keeps most of the title; otherwise cut mid-word.
  const body = space >= TITLE_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut
  return `${body.trimEnd()}…`
}

/** No < or >, at most 5000 UTF-8 bytes, cut on a character boundary. */
export function finalizeDescription(raw: string): string {
  const clean = raw
    .replace(/[<>]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  const encoder = new TextEncoder()
  if (encoder.encode(clean).length <= DESCRIPTION_MAX_BYTES) return clean
  let bytes = 0
  let out = ''
  for (const ch of clean) {
    const size = encoder.encode(ch).length
    if (bytes + size > DESCRIPTION_MAX_BYTES) break
    bytes += size
    out += ch
  }
  return out.trimEnd()
}
