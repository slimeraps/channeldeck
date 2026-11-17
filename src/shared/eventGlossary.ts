/**
 * Plain-English explanations for the event kinds the app writes to its event log, shown on the
 * Health page. Pure and static: nothing here reads the log or the database. The test next to
 * this file checks that every kind written in src/ has an entry here and no entry is dead.
 */

export interface GlossaryEntry {
  /** Short friendly name. */
  label: string
  /** One or two sentences for someone who doesn't know how the app works inside. */
  explanation: string
  /** What to look at when this event shows up. Only for events that mean something needs a look. */
  check?: string
}

export const EVENT_GLOSSARY = {
  'app.start': {
    label: 'App started',
    explanation: 'ChannelDeck opened and its database was ready.'
  },

  'post.created': {
    label: 'Post created',
    explanation: 'A new post was added, either by you or by an autopost rule.'
  },
  'post.status': {
    label: 'Post moved on',
    explanation:
      'A post changed state, for example from queued to uploading to scheduled. The text shows where it came from and where it went.'
  },
  'post.audit_lock': {
    label: 'YouTube kept it private',
    explanation:
      'You asked for a public or unlisted video, but YouTube made it private. That usually means the Google Cloud project hasn’t passed YouTube’s API audit yet.',
    check:
      'Change the video’s visibility in YouTube Studio. ChannelDeck won’t retry this one by itself.'
  },
  'post.missed': {
    label: 'Publish time passed',
    explanation:
      'The scheduled time went by before the upload started, so the video was published right away instead.'
  },
  'post.uploaded': {
    label: 'Upload finished',
    explanation: 'The video is on YouTube. The text shows its YouTube id.'
  },
  'post.rescheduled': {
    label: 'Publish time changed',
    explanation: 'You changed when an already uploaded video goes public.'
  },

  'clips.sync': {
    label: 'Clips synced',
    explanation: 'ChannelDeck checked Twitch for new clips and refreshed the view counts.'
  },
  'clips.backfill_done': {
    label: 'Clip history loaded',
    explanation: 'The first import of a channel’s older clips from Twitch has finished.'
  },
  'clips.sync_failed': {
    label: 'Clip sync failed',
    explanation:
      'ChannelDeck couldn’t get clips from Twitch. It tries again on its own after a wait.',
    check:
      'Check your internet connection and that the Twitch account still shows “Signed in” in the Channels tile.'
  },
  'cleanup.done': {
    label: 'Old files deleted',
    explanation:
      'Video files of clips that were already posted were deleted from your disk to free space, as your settings ask.'
  },
  'backup.imported': {
    label: 'Backup imported',
    explanation:
      'A backup file was loaded. Only things that were missing were added; nothing was overwritten.'
  },

  'autopost.rule_created': {
    label: 'Autopost rule created',
    explanation: 'You added a new autopost rule.'
  },
  'autopost.rule_updated': {
    label: 'Autopost rule updated',
    explanation: 'You saved changes to an autopost rule.'
  },
  'autopost.rule_synced': {
    label: 'Autopost rule synced',
    explanation:
      'You synced a rule with its settings. Its failed autoposts were put back in the queue.'
  },
  'autopost.rule_deleted': {
    label: 'Autopost rule deleted',
    explanation: 'You deleted an autopost rule, and possibly its upcoming autoposts.'
  },
  'autopost.swapped': {
    label: 'Clip swapped',
    explanation: 'You replaced the clip of an autopost with a different one.'
  },
  'autopost.bank_empty': {
    label: 'Out of clips',
    explanation:
      'An autopost rule has empty slots because no clip matches its filters. The slots stay empty until new clips arrive.',
    check: 'Loosen the rule’s filters or wait for new clips from Twitch.'
  },
  'autopost.planned': {
    label: 'Autoposts planned',
    explanation: 'A rule picked clips and created new autoposts for its upcoming slots.'
  },

  'account.needs_reauth': {
    label: 'YouTube sign-in expired',
    explanation:
      'Google no longer accepts this channel’s saved sign-in, so its uploads are paused.',
    check: 'Open Settings, find the channel and click Reconnect.'
  },
  'account.upload_limited': {
    label: 'Channel hit its upload limit',
    explanation:
      'YouTube refused an upload because this channel has uploaded as many videos as YouTube allows it for now. This is a limit on the channel, not your API quota. Only this channel waits (until midnight Pacific); the others keep uploading.',
    check:
      'Nothing to fix. Spread this channel’s posts out more, or click Try now on the banner later to test whether the limit has lifted.'
  },
  'account.added': {
    label: 'YouTube channel connected',
    explanation: 'A YouTube channel was signed in and added.'
  },
  'account.reconnected': {
    label: 'YouTube channel reconnected',
    explanation: 'A channel signed in again, so its paused uploads can continue.'
  },
  'account.removed': {
    label: 'YouTube channel removed',
    explanation: 'You removed a YouTube channel. The text says what happened to its pending posts.'
  },
  'google.client_imported': {
    label: 'Google setup imported',
    explanation: 'The Google client file (client_secret.json) was imported.'
  },
  'dryrun.call': {
    label: 'Dry Run call',
    explanation:
      'Dry Run is on, so this YouTube call was only pretended. Nothing was sent to YouTube.'
  },

  'twitch.connected': {
    label: 'Twitch account connected',
    explanation: 'A Twitch account was signed in and added.'
  },
  'twitch.needs_reauth': {
    label: 'Twitch sign-in expired',
    explanation: 'Twitch no longer accepts the saved sign-in, so clip sync is paused.',
    check: 'Open Settings, find the Twitch account and click Reconnect.'
  },
  'twitch.removed': {
    label: 'Twitch account removed',
    explanation:
      'You removed a Twitch account. Its clips were forgotten, but the video files on your disk were kept.'
  }
} as const satisfies Record<string, GlossaryEntry>

export type EventKind = keyof typeof EVENT_GLOSSARY

export const EVENT_KINDS = Object.keys(EVENT_GLOSSARY) as EventKind[]

export const FAILED_POST_CHECK = 'Open the post in the Queue to see why it failed.'

export const UNKNOWN_EVENT_LABEL = 'Unknown event'
export const UNKNOWN_EVENT_EXPLANATION = 'Unknown event, see the log'

export interface EventDescription {
  label: string
  explanation: string
  check: string | null
  /** False when the kind has no glossary entry. */
  known: boolean
}

/** A post.status message for a move into the failed state, e.g. "uploading → failed (fail): x". */
export function isFailedTransition(kind: string, message: string): boolean {
  return kind === 'post.status' && message.includes('→ failed')
}

function isKnown(kind: string): kind is EventKind {
  return Object.hasOwn(EVENT_GLOSSARY, kind)
}

/** Friendly text for one event. Unknown kinds fall back instead of throwing. */
export function describeEvent(kind: string, message: string): EventDescription {
  if (!isKnown(kind)) {
    return {
      label: UNKNOWN_EVENT_LABEL,
      explanation: UNKNOWN_EVENT_EXPLANATION,
      check: null,
      known: false
    }
  }
  const entry: GlossaryEntry = EVENT_GLOSSARY[kind]
  return {
    label: entry.label,
    explanation: entry.explanation,
    check: isFailedTransition(kind, message) ? FAILED_POST_CHECK : (entry.check ?? null),
    known: true
  }
}
