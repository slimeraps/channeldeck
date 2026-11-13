# ChannelDeck

A personal macOS app for running several YouTube channels from one place. It does two jobs:

1. **Scheduler**: queue videos for any connected YouTube channel, choose when each goes public, and let the app upload them with thumbnails and playlists, then track their status.
2. **Twitch clip bank + autoposter**: connect your Twitch accounts, pull every new clip once a day, keep all clips on disk sorted oldest to newest, and post them to YouTube automatically in daily time slots you choose.

Scheduling uses YouTube's own scheduled publishing: videos upload as private with a `publishAt` time and YouTube makes them public at that moment. The Mac only needs to be awake to sync clips and upload, not at publish time.

Everything runs locally on your Mac (Apple Silicon, recent macOS). It talks to YouTube and Twitch with your own Google Cloud project and Twitch app. Sign-in tokens are encrypted with the macOS Keychain and never leave the machine.

> **Status:** in active development, built in phases. Features marked ✅ are done; the rest list the phase that builds them. See the [changelog](#changelog) at the bottom.

---

## Features

### YouTube channels

- ✅ Connect any number of channels with Google sign-in (system browser, loopback redirect, PKCE)
- ✅ Brand-account channels: run **Add channel** again and pick the other channel in Google's picker
- ✅ One row per channel with avatar, handle, status (OK / Needs re-auth), pending and scheduled counts, next publish time
- ✅ Per-channel calendar color, on/off switch, and defaults for new posts (category, tags, playlist, made for kids, languages, license, description footer)
- ✅ Expired or revoked sign-in is detected: banner, macOS notification, and that channel's uploads pause until **Reconnect**
- ✅ Remove a channel: revokes its Google access and asks what to do with posts not yet uploaded (cancel, keep as drafts, or move to another channel)
- ✅ Clear setup guidance and plain error messages (e.g. YouTube Data API not enabled in your Cloud project)

### Post editor

- ✅ New post from the **New post** button, **⌘N**, or by dropping a video anywhere on the window
- ✅ Video facts read with ffprobe: duration, resolution, size, aspect ratio (phone rotation handled)
- ✅ **Short** detection (vertical or square, 3 minutes or less) and a warning for videos over 15 minutes
- ✅ Title (100 characters), description (5000 bytes) and tags (500 characters) with live counters measured the way YouTube measures them
- ✅ Category and playlist pickers loaded from your channel, cached, with refresh
- ✅ Custom thumbnail (JPG or PNG up to 2 MB) with preview
- ✅ Made for kids, notify subscribers, license, embedding, default and audio language, altered or synthetic media
- ✅ Visibility: **Schedule** (public at a time you pick), **Public now**, **Unlisted now**, **Private**
- ✅ Publish time in your local time zone, with the UTC value and "in 3h 20m" underneath
- ✅ If the publish time passes before the upload finishes: **Ask me** (default) or **Publish now**
- ✅ Save as draft, or add to the queue with every YouTube requirement checked and shown inline
- 🔜 Templates with `{{n}}`, `{{date}}`, `{{channel}}`, and numbered series like "MW4 Day {{n}}" (Phase 8)
- 🔜 Duplicate a post to another channel (Phase 8)

### Queue

- ✅ Every post for every channel in one table: preview, title, channel color, source, publish time, status, upload progress
- ✅ Filter by channel, status and source; sort by publish time
- ✅ Edit, Duplicate, Reveal file in Finder, Unschedule, Delete draft
- ✅ Live upload progress, **Upload now**, **Retry**, **Open in YouTube Studio**, and the reason a post failed
- ✅ **Check status** button to ask YouTube for the latest state right away
- 🔜 Approve (autoposts in Review mode) and Swap clip (Phases 7–8)

### Uploading

- ✅ Background job runner: checks every 30 seconds, at launch, and when the Mac wakes; keeps the Mac awake while uploading
- ✅ Scheduled posts upload ahead of time (24 h before publish by default, adjustable); "now" posts upload right away
- ✅ Resumable uploads: a dropped connection resumes where it stopped
- ✅ Each step (video → thumbnail → playlist) is tracked and retried on its own; a video is never uploaded twice
- ✅ Network errors and YouTube 5xx retry with exponential backoff (5 attempts)
- ✅ Out of quota or over the daily upload limit: the post waits until midnight Pacific instead of failing
- ✅ "File missing" check before uploading; quitting mid-upload restarts cleanly next launch
- ✅ **Dry Run**: logs exactly which YouTube calls would run, with their data, without uploading anything
- ✅ Up to 3 uploads at once (default 1)
- ✅ Status sync: Processing → Scheduled → Published, checked every 2 minutes while YouTube is processing and every 15 minutes otherwise; rejected, failed and deleted videos reported with the reason
- ✅ Change an uploaded video's publish time (updated on YouTube too), "Keep as private", "Delete from YouTube"
- ✅ "Needs decision" when a publish time passed before the upload: publish now, pick a new time, or unschedule

### Calendar

- 🔜 Week and month views colored by channel, clip icon on autoposts (Phase 8)
- 🔜 Drag to reschedule (updates YouTube if already uploaded); click an empty slot to create a post (Phase 8)

### Twitch clip bank

- ✅ Connect Twitch channels as the broadcaster or an editor
- ✅ Daily clip sync at a time you choose, plus on launch/wake if overdue, plus **Sync now**
- ✅ Full backfill from a start date, resumable after a quit
- ✅ Downloads landscape and portrait files, thumbnail and metadata, named so Finder sorts oldest to newest
- ✅ Clips page: sort, filter (game, length, views, featured, posted, dates, title), preview, bulk actions, disk usage
- ✅ Add clips as draft posts to any YouTube channel; a clip can never be added twice to the same channel

### Autoposting

- 🔜 Rules mapping Twitch accounts to a YouTube channel, with daily time slots and weekdays (Phase 7)
- 🔜 Pick order (oldest, newest, most viewed) and filters (Phase 7)
- 🔜 Shorts from Twitch's portrait file, or converted with a layout preset: blurred fill, center crop, or facecam-on-top split drawn in a crop editor (Phase 7)
- 🔜 Title and description templates with clip variables; Review mode (approve first) or Auto (Phase 7)
- 🔜 Never posts the same clip twice to the same channel (already enforced by the database)

### Mac app

- ✅ Native dark UI; macOS notifications for uploads, failures, quota pauses and sign-in problems
- ✅ Logs in `~/Library/Logs/ChannelDeck` with secrets scrubbed
- 🔜 Menu bar icon with pending count and next publish time; close to tray; launch at login (Phase 9)
- 🔜 Quota meter and disk usage meter (Phase 9)
- 🔜 Backup export/import (no tokens) (Phase 9)
- 🔜 Downloadable `.dmg` for Apple Silicon and a first-run checklist (Phase 10)

---

## Getting started

### Requirements

- A Mac with Apple Silicon and a recent macOS
- [Node.js](https://nodejs.org) 22 or newer (LTS recommended)
- Xcode Command Line Tools (`xcode-select --install`) for git

### Install and run

```bash
git clone https://github.com/slimeraps/channeldeck.git
cd channeldeck
npm install
npm run dev
```

### Connect Google (one time)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable **YouTube Data API v3**.
2. Under **Google Auth Platform → Audience**, set the user type to External and click **Publish app** so the status is **In production**. In Testing mode Google signs you out of every channel after 7 days. You don't need verification for personal use; you'll click **Advanced → Go to ChannelDeck** on the warning screen.
3. Under **Clients**, create an OAuth client ID of type **Desktop app** and download its JSON.
4. In ChannelDeck, open **Channels** (or Settings) → **Import Google client file**, then **Add channel**.

The client file is copied into `~/Library/Application Support/ChannelDeck/` with owner-only permissions. It is never stored in this repository.

### Connect Twitch (one time)

1. In the [Twitch developer console](https://dev.twitch.tv/console/apps/create), click **Register Your Application**.
2. Add the OAuth Redirect URL `http://localhost:17563/twitch/callback`, set **Client Type** to **Confidential**, and create it.
3. Open **Manage**, click **New Secret**, and paste the Client ID and Client Secret into ChannelDeck (**Channels → Twitch accounts**).
4. Click **Connect Twitch**, choose whether you're the broadcaster or an editor, and pick how far back to backfill.

Without a secret, ChannelDeck uses Twitch's device-code sign-in instead, but those sign-ins expire after 30 days.

Clips are saved to `~/Movies/ChannelDeck/Clips/<channel>/<year>/<year-month>/` (changeable in Settings) as `2026-11-12_204512_<clip id>_<title>_landscape.mp4`, so Finder sorts them oldest to newest. A thumbnail and a `.json` file with the clip's details sit next to each video.

### Your data

| What               | Where                                                          |
| ------------------ | -------------------------------------------------------------- |
| Database           | `~/Library/Application Support/ChannelDeck/channeldeck.db`     |
| Google client file | `~/Library/Application Support/ChannelDeck/google-client.json` |
| Logs               | `~/Library/Logs/ChannelDeck/main.log`                          |
| Sign-in tokens     | Inside the database, encrypted with the macOS Keychain         |
| Twitch clips       | `~/Movies/ChannelDeck/Clips` (changeable in Settings)          |

### YouTube quota

Quota belongs to your Google Cloud project and is shared by all your channels. Uploads have their own daily allowance (100 per day); everything else shares 10,000 units per day (a thumbnail or playlist add costs 50, a list call costs 1). Both reset at midnight Pacific. It's free; going over just pauses until the reset.

---

## Development

| Command               | What it does                                             |
| --------------------- | -------------------------------------------------------- |
| `npm run dev`         | Run the app with hot reload                              |
| `npm run typecheck`   | TypeScript checks for main, preload, shared and renderer |
| `npm run lint`        | ESLint                                                   |
| `npm run format`      | Prettier (`format:check` to verify)                      |
| `npm test`            | Vitest, run on Electron's own Node                       |
| `npm run db:generate` | Generate a SQL migration from `src/main/db/schema.ts`    |
| `npm run build`       | Typecheck and build                                      |
| `npm run dist`        | Build the macOS `.dmg` (Phase 10)                        |

**Stack:** Electron, TypeScript (strict), React, electron-vite, Tailwind CSS + shadcn/ui, TanStack Query, Zustand, SQLite (better-sqlite3 + Drizzle), Google's official YouTube client, Vitest + msw.

**Layout:** `src/main` (database, Google and Twitch clients, job runner, media, IPC), `src/preload` (the only bridge to the window), `src/renderer` (React UI), `src/shared` (types, validation, constants). The plan lives in [PLAN.md](PLAN.md) and the working notes in [CLAUDE.md](CLAUDE.md).

**Security:** the window is sandboxed with no Node access; it can only call a typed, validated set of functions. Local videos are previewed through a restricted `cdmedia://` protocol. Secrets are never committed or logged.

---

## Changelog

No version numbers yet; the first version is tagged when all phases are complete. Newest first.

### Unreleased

#### Phase 6: Twitch connect and clip bank (2026-11-12)

- Added Twitch sign-in as the broadcaster or as an editor, with your own Twitch app (Client ID + Secret kept in the Keychain) or device-code sign-in without a secret.
- Expired Twitch sign-ins are detected: notification, "Needs re-auth" badge, and that channel's sync pauses until **Reconnect**.
- Added the clip bank: a full backfill week by week from a start date (resumes after a quit), then a daily sync at a time you choose, plus **Sync now**.
- Busy weeks are split automatically so Twitch's ~1,000-clips-per-query limit never hides clips; rate limits are respected.
- Clips download as landscape and portrait files with a thumbnail and a `.json` sidecar, verified with ffprobe before they're kept; failed downloads retry with backoff.
- Added the Clips page: tab per channel, sorting, filters, preview, disk usage, and bulk actions (add as drafts to a channel, hide, re-download, delete local files).
- Added Settings → Clip bank: clip folder and daily sync time.
- Secrets are now encrypted with Electron's newer async Keychain API.

#### Phase 5: Scheduling and status sync (2026-11-12)

- Added status sync: uploaded posts move Processing → Scheduled → Published on their own, with a "Published" notification.
- YouTube rejections and processing failures are reported with the reason in plain words; videos deleted in YouTube Studio are detected.
- Publish times changed in YouTube Studio are picked up; a schedule removed there counts as "kept private".
- Added Change publish time (updates YouTube), Keep as private, and Delete from YouTube, each with confirmation.
- Added "Needs decision" actions when a publish time passed before upload: publish now, pick a new time, or unschedule.
- Added a Check status button to the queue.
- Dry Run videos move through Scheduled and Published locally, without calling YouTube.

#### Phase 4: Upload engine (2026-11-12)

- Added the background job runner (30-second ticks, on launch, on wake) that keeps the Mac awake while uploading.
- Added resumable YouTube uploads with live progress; dropped connections resume where they stopped.
- Uploads run as video → thumbnail → playlist steps, each retried on its own; a video is never uploaded twice.
- Quota and daily-upload-limit errors wait until midnight Pacific instead of failing, and pause the rest of the queue.
- Added Dry Run, Upload now, Retry, Open in YouTube Studio, and failure reasons in the queue.
- Added Settings → Uploads: Dry Run, uploads at once, upload lead time.
- Interrupted uploads restart cleanly after a quit or crash.
- Missed publish times follow the post's "ask me" or "publish now" setting.
- Added this README.

#### Phase 3: Post editor and queue (2026-11-12)

- Added the post editor with drag-and-drop video, ffprobe metadata, Short detection, YouTube-accurate counters, category/playlist pickers, thumbnail, and all upload options.
- Added the Queue table with filters, sorting and row actions.
- Drop a video anywhere on the window to start a post.
- Fixed: database migrations that rebuild a table could have deleted related rows; migrations now run with foreign keys off.
- Fixed: long file names overflowed the editor's video column.

#### Phase 2: Google sign-in and YouTube channels (2026-11-12)

- Added Google sign-in for channels (loopback + PKCE), encrypted token storage, and the Channels page.
- Added re-auth detection with banner and notification, Reconnect, and Remove with token revocation.
- Added per-channel defaults, colors and on/off switch.
- Clear message when the YouTube Data API isn't enabled in the Cloud project.

#### Phase 1: Data layer (2026-11-12)

- Added the SQLite database with all tables, migrations, and the post status rules.
- Enforced "never post the same clip twice to the same channel" in the database.
- Added the settings store, event log, and Keychain-backed secret storage.

#### Phase 0: Scaffold (2026-11-12)

- Created the Electron + React + TypeScript app shell with a secure, sandboxed window.
- Added typed, validated IPC, scrubbed logging, the sidebar, and placeholder pages.
