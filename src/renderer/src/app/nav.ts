import {
  CalendarDays,
  Clapperboard,
  FileText,
  ListVideo,
  type LucideIcon,
  MonitorPlay,
  Settings,
  Zap
} from 'lucide-react'

export const PAGE_IDS = [
  'queue',
  'calendar',
  'clips',
  'autopost',
  'channels',
  'templates',
  'settings'
] as const
export type PageId = (typeof PAGE_IDS)[number]

export interface PageDef {
  id: PageId
  label: string
  icon: LucideIcon
  /** Empty-state copy shown until the page's phase lands. */
  emptyTitle: string
  emptyBody: string
  /** The PLAN.md phase that builds this page. */
  phase: number
  /** Whether the empty state offers the "New post" action. */
  offersNewPost: boolean
}

export const PAGES: readonly PageDef[] = [
  {
    id: 'queue',
    label: 'Queue',
    icon: ListVideo,
    emptyTitle: 'Nothing in the queue yet',
    emptyBody:
      'Every post for every channel shows up here with its publish time, status and upload progress.',
    phase: 3,
    offersNewPost: true
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: CalendarDays,
    emptyTitle: 'Nothing scheduled',
    emptyBody:
      'Scheduled posts and autoposts appear on a week or month calendar, colored by channel. Drag to reschedule.',
    phase: 8,
    offersNewPost: true
  },
  {
    id: 'clips',
    label: 'Clips',
    icon: Clapperboard,
    emptyTitle: 'No clips banked yet',
    emptyBody:
      'Connect a Twitch account and ChannelDeck saves every clip to disk, sorted oldest to newest, and keeps it in sync daily.',
    phase: 6,
    offersNewPost: false
  },
  {
    id: 'autopost',
    label: 'Autopost',
    icon: Zap,
    emptyTitle: 'No autopost rules',
    emptyBody:
      'Rules turn banked clips into Shorts or videos on the daily time slots you pick, with review before upload by default.',
    phase: 7,
    offersNewPost: false
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: MonitorPlay,
    emptyTitle: 'No channels connected',
    emptyBody:
      'Connect your YouTube channels and Twitch accounts here. Brand-account channels are added by running "Add channel" again.',
    phase: 2,
    offersNewPost: false
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: FileText,
    emptyTitle: 'No templates or series',
    emptyBody:
      'Save reusable titles and descriptions, and numbered series such as "MW4 Day {{n}}" that count up for you.',
    phase: 8,
    offersNewPost: false
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    emptyTitle: 'Settings',
    emptyBody: 'Google and Twitch credentials, clip folder, sync time, Dry Run and backups.',
    phase: 9,
    offersNewPost: false
  }
]

export function getPage(id: PageId): PageDef {
  const page = PAGES.find((p) => p.id === id)
  if (!page) throw new Error(`Unknown page: ${id}`)
  return page
}
