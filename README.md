# ChannelDeck

A personal macOS app for running several YouTube channels from one place. It does two jobs:

1. **Scheduler**: queue videos for any connected YouTube channel, choose when each goes public, and let the app upload them with thumbnails and playlists, then track their status.
2. **Twitch clip bank + autoposter**: connect your Twitch accounts, pull every new clip once a day, keep all clips on disk sorted oldest to newest, and post them to YouTube automatically in daily time slots you choose.

Scheduling uses YouTube's own scheduled publishing: videos upload as private with a `publishAt` time and YouTube makes them public at that moment. The Mac only needs to be awake to sync clips and upload, not at publish time.

Everything runs locally on your Mac (Apple Silicon, recent macOS). It talks to YouTube and Twitch with your own Google Cloud project and Twitch app. Sign-in tokens are encrypted with the macOS Keychain and never leave the machine.

> **Status:** version 1.1.0. Every feature below is built; see the [changelog](#changelog) at the bottom.

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
- ✅ Templates with `{{n}}`, `{{date}}`, `{{channel}}`, and numbered series like "MW4 Day {{n}}" (the number is only used up when a post is queued, never by a draft, and never twice)
- ✅ Duplicate a post to another channel (queue row or editor), with that channel's playlist

### Queue

- ✅ Every post for every channel in one table: preview, title, channel color, source, publish time, status, upload progress
- ✅ Filter by channel, status and source; sort by publish time
- ✅ Edit, Duplicate, Reveal file in Finder, Unschedule, Delete draft
- ✅ Live upload progress, **Upload now**, **Retry**, **Open in YouTube Studio**, and the reason a post failed
- ✅ **Check status** button to ask YouTube for the latest state right away
- ✅ **Approve** autoposts made in Review mode, one at a time or all at once per rule
- ✅ **Swap clip** for autoposts before upload: pick from the rule's next clips; the old clip is skipped from then on

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

- ✅ Week and month views colored by channel, clip icon on Twitch posts, channel filter
- ✅ Drag to reschedule with a confirmation (updates YouTube if already uploaded); click an empty slot to create a post at that time

### Twitch clip bank

- ✅ Connect Twitch channels as the broadcaster or an editor
- ✅ Daily clip sync at a time you choose, plus on launch/wake if overdue, plus **Sync now**
- ✅ Full backfill from a start date, resumable after a quit
- ✅ Downloads landscape and portrait files, thumbnail and metadata, named so Finder sorts oldest to newest
- ✅ Clips page: sort, filter (game, length, views, featured, posted, dates, title), preview, bulk actions, disk usage
- ✅ A color per Twitch channel (picked on the Channels page, like YouTube channels), shown on clip cards, Clips tabs, autopost rules and layouts
- ✅ **All channels** view on the Clips page: sort, filter and bulk-select clips from every channel at once, or pick a few channels to show
- ✅ Add clips as draft posts to any YouTube channel; a clip can never be added twice to the same channel

### Autoposting

- ✅ Rules mapping Twitch accounts to a YouTube channel, with daily time slots and weekdays, planned up to 14 days ahead
- ✅ Daylight-saving safe: a time skipped in spring moves to the next valid minute; a repeated time in fall is used once
- ✅ Pick order (oldest, newest, most viewed) and filters (games, length, views, featured)
- ✅ Shorts made from the horizontal clip with a layout (blurred fill, center crop, or facecam-on-top split drawn in a crop editor with a live preview and an 8-second test render), or from Twitch's own vertical version if the rule prefers it
- ✅ **Format** switch in the post editor: any clip post (or horizontal video) can be horizontal, Twitch's vertical version, or a vertical render with a layout, and **Render now** previews the Short
- ✅ Title and description templates with `{{clip_title}}`, `{{game}}`, `{{broadcaster}}`, `{{clipper}}`, `{{clip_date}}`, `{{clip_url}}`, `{{twitch_url}}`, `{{views}}`, `{{n}}`; titles trimmed safely to 100 characters
- ✅ Review mode (approve first) or Auto; unapproved autoposts are dropped at their publish time and the clip goes back to the bank
- ✅ Unscheduling an autopost refills its slot with the next clip; that rule never picks the skipped clip again
- ✅ Never posts the same clip twice to the same channel (enforced by the database)
- ✅ "Out of clips" notification (once a day per rule) and a quota warning when your rules would go over YouTube's daily limits

### Mac app

- ✅ Native dark UI; macOS notifications for uploads, failures, quota pauses and sign-in problems
- ✅ Logs in `~/Library/Logs/ChannelDeck` with secrets scrubbed
- ✅ Menu bar icon with the pending count; its menu shows the next publish time and has Open, Sync clips now, Pause jobs and Quit
- ✅ Keep in menu bar: closing the window leaves uploads and syncs running; launch at login (installed app)
- ✅ Quota meter (today's uploads / 100 and units / 10,000, resets at midnight Pacific) in the sidebar and Settings
- ✅ Disk usage per Twitch channel, and "delete local files N days after posting"
- ✅ Backup export/import as JSON, never with tokens or secrets (channels come back signed out, rules switched off)
- ✅ App icon
- ✅ `.dmg` for Apple Silicon (`npm run dist`) and a first-run setup checklist

---

## Getting started

### Install the app

1. Build the `.dmg` (see [Building the app](#building-the-app)), or use one you built before.
2. Open `ChannelDeck-<version>-arm64.dmg` and drag **ChannelDeck** to **Applications**.
3. Open it. A copy you built on this Mac opens normally. A copy that was downloaded is blocked the first time, because it's ad-hoc signed rather than notarized by Apple. Go to **System Settings → Privacy & Security**, scroll down to the ChannelDeck message, click **Open Anyway**, and confirm. (On macOS 15 and later, right-click → Open no longer skips this.)
4. Follow the **Set up ChannelDeck** checklist at the top of the Queue. The two sections below walk through the Google and Twitch steps.

### Run from source

Requirements: a Mac with Apple Silicon, [Node.js](https://nodejs.org) 22 or newer (LTS recommended), and Xcode Command Line Tools (`xcode-select --install`) for git.

```bash
git clone https://github.com/slimeraps/channeldeck.git
cd channeldeck
npm install
npm run dev
```

Running from source and the installed app share the same database, so only one can be open at a time.

### Connect Google (one time)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable **YouTube Data API v3**.
2. Under **Google Auth Platform → Branding**, fill in the app name and your email for **User support email** and **Developer contact**, plus these links (Google won't let you publish without them; leave the logo empty):
   - **Application home page:** `https://slimeraps.github.io/channeldeck/`
   - **Application privacy policy link:** `https://slimeraps.github.io/channeldeck/privacy.html`
   - **Authorized domains:** `slimeraps.github.io`

   Then under **Audience**, set the user type to External and click **Publish app** so the status is **In production**. In Testing mode Google signs you out of every channel after 7 days. You don't need verification for personal use; you'll click **Advanced → Go to ChannelDeck** on the warning screen.

3. Under **Clients**, create an OAuth client ID of type **Desktop app** and download its JSON.
4. In ChannelDeck, click **Import…** in the setup checklist (or **Settings → Google and Twitch apps**) and pick the downloaded `client_secret_….json`. Then **Add channel**, once per channel. A Brand Account channel is picked in Google's chooser.

The client file is copied into `~/Library/Application Support/ChannelDeck/google-client.json` with owner-only permissions. It is never stored in this repository (`client_secret*.json` is gitignored).

Sign-in opens your browser and returns to ChannelDeck on a temporary `127.0.0.1` address, so there's nothing to configure for redirects.

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

### Backups

**Settings → Backup → Export backup…** saves a JSON file with your settings, channels, Twitch channels, templates, series, layouts, rules and posts not yet on YouTube. It never contains sign-in tokens or secrets. When you import it on a new Mac, click **Reconnect** on each channel and turn the rules back on. Clips come back from Twitch on the next sync.

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
| `npm run dist`        | Build the macOS `.dmg` into `release/`                   |

**Stack:** Electron, TypeScript (strict), React, electron-vite, Tailwind CSS + shadcn/ui, TanStack Query, Zustand, SQLite (better-sqlite3 + Drizzle), Google's official YouTube client, Vitest + msw.

**Layout:** `src/main` (database, Google and Twitch clients, job runner, media, IPC), `src/preload` (the only bridge to the window), `src/renderer` (React UI), `src/shared` (types, validation, constants). The plan lives in [PLAN.md](PLAN.md) and the working notes in [CLAUDE.md](CLAUDE.md).

### Building the app

```bash
npm run dist
```

This produces `release/ChannelDeck-<version>-arm64.dmg` (Apple Silicon, ad-hoc signed, not notarized) and the app itself in `release/mac-arm64/`. ffmpeg, ffprobe and SQLite's native module are unpacked from the app archive so they can run, and the database migrations ship in `Contents/Resources/drizzle`.

To check a build without touching your data, run its self-test. It uses a throwaway folder: it applies every migration, makes a test video with the bundled ffmpeg, reads it with ffprobe, renders a vertical version, and runs a Dry Run upload through the real upload job. It prints a report and exits 0 when everything works:

```bash
CHANNELDECK_SELF_TEST="$(mktemp -d)" release/mac-arm64/ChannelDeck.app/Contents/MacOS/ChannelDeck
```

**Icons:** `swift scripts/draw-icons.swift <dir>` draws the app icon and the menu bar template images with CoreGraphics; `build/icon.icns` is made from the PNG with `sips` + `iconutil`.

**Security:** the window is sandboxed with no Node access; it can only call a typed, validated set of functions. Local videos are previewed through a restricted `cdmedia://` protocol. Secrets are never committed or logged.

---

## Changelog

No version numbers yet; the first version is tagged when all phases are complete. Newest first.

### 1.1.0 (2026-11-13)

- Clip posts keep the horizontal clip as their source. The post editor's new **Format** switch changes a post between horizontal, Twitch's vertical version and a vertical render (blurred fill, center crop or your layouts); **Render now** shows the Short before it uploads.
- Autopost rules make Shorts from the horizontal clip with their layout. A new switch, **Use Twitch's own vertical version**, brings back the old behavior. "Add as drafts" on the Clips page starts horizontal.
- Fixed: confirm buttons (Unschedule, Delete, Remove…) showed white text on a light background; they're now pink with readable text.
- Added a homepage and privacy policy (GitHub Pages, from `docs/`) for Google's Branding page, which now needs both before the consent screen can be published.

### 1.0.0 (2026-11-13)

All ten phases are done; this is the first version with a number.

#### Phase 10: Packaging (2026-11-13)

- `npm run dist` builds an Apple Silicon `.dmg` (ad-hoc signed, not notarized), with ffmpeg, ffprobe and SQLite unpacked and the migrations bundled.
- Added the **Set up ChannelDeck** checklist: Google client file → consent screen In production → add a channel → Twitch app → connect Twitch → clip folder. You can hide it, and bring it back from Settings.
- Added a build self-test (`CHANNELDECK_SELF_TEST`) that checks an installed app end to end in a throwaway folder.
- Older backups (from before a setting existed) still import.
- README: installing and opening the app, building it, and the self-test.

#### Phase 9: Mac polish (2026-11-13)

- Added the menu bar icon: pending count beside it; menu with the next publish time, Open, Sync clips now, Pause jobs and Quit.
- Closing the window keeps ChannelDeck running in the menu bar (Settings → Keep in menu bar). Added launch at login.
- Added the quota meter to the sidebar and Settings, and disk usage per Twitch channel.
- Added "Delete local files after posting": video files of clips whose posts are all published (and vertical renders) are removed after the days you choose.
- Added backup export/import. The file never holds sign-in tokens or secrets; imported channels need Reconnect, and imported rules start switched off.
- Settings now has everything in one place, including the Google client file, the Twitch app, Mac options and backups.
- The re-auth banner now covers Twitch channels too.
- New app icon.

#### Phase 8: Calendar, templates and series (2026-11-13)

- Added the Calendar: week and month views of every channel's posts, colored by channel. Drag a post to move it (YouTube is updated if it's already uploaded), or click an empty slot to start a post there.
- Added the Templates page: templates for title, description and tags with `{{n}}`, `{{date}}` and `{{channel}}`, and series that number posts automatically ("MW4 Day 9", 10, 11…). You can edit a series' next number at any time.
- The post editor has Template and Series pickers and shows what the title becomes when queued.
- Added Duplicate to another channel, in the queue and the editor.
- Added Swap clip for autoposts that aren't uploaded yet.

#### Clips patch: Twitch channel colors and All channels view (2026-11-13)

- Added a color for each Twitch channel, chosen from the same palette as YouTube channels (Channels page → ⋯ → Color). Existing channels got different starting colors.
- Clip cards show a strip in their channel's color, and the channel name in the All channels view.
- Added an **All channels** tab to the Clips page (the default with more than one channel). Sorting, filters and bulk actions work across channels, and **Show** chips narrow it to the channels you pick.
- Autopost rules and layouts show their Twitch channels' colors.

#### Phase 7: Autoposting (2026-11-13)

- Added the Autopost page: rules that turn banked Twitch clips into scheduled YouTube posts on daily time slots, with a live preview of the next posts.
- Added vertical conversion with ffmpeg (blurred fill, center crop, facecam split) as a render step before upload, and a crop editor to draw the facecam and gameplay boxes on a real frame.
- Added Review and Auto modes; **Approve** and **Approve all** in the queue.
- Added clip title/description templates, a running number per rule, and safe trimming to YouTube's limits.
- Added a quota warning when enabled rules plus queued uploads would exceed 100 uploads or 10,000 units in a day.
- The queue shows which rule made an autopost and whether it still needs its vertical render.

#### Fixes from the release branch (2026-11-13)

- Fixed: saving an edited post to the queue or back to drafts now saves the edits and the status change together, so a failed status change can't leave half-saved edits.
- Removed an unused npm package (`cn`).

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
