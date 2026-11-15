# ChannelDeck

**Website: [slimeraps.github.io/channeldeck](https://slimeraps.github.io/channeldeck/)**: features, install and setup guides, your data, the changelog and the privacy policy.

A personal macOS app for running several YouTube channels from one place. It does two jobs:

1. **Scheduler**: queue videos for any connected YouTube channel, choose when each goes public, and let the app upload them with thumbnails and playlists, then track their status.
2. **Twitch clip bank + autoposter**: connect your Twitch accounts, pull every new clip once a day, keep all clips on disk sorted oldest to newest, and post them to YouTube automatically in daily time slots you choose.

Scheduling uses YouTube's own scheduled publishing: videos upload as private with a `publishAt` time and YouTube makes them public at that moment. The Mac only needs to be awake to sync clips and upload, not at publish time.

Everything runs locally on your Mac (Apple Silicon, recent macOS). It talks to YouTube and Twitch with your own Google Cloud project and Twitch app. Sign-in tokens are encrypted with the macOS Keychain and never leave the machine.

> **Status:** version 2.0.0. Every feature below is built; see the [changelog](#changelog) at the bottom.

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
- ✅ **From clip library**: pick any banked Twitch clip as a post's video (search, channel and unposted filters); the post stays linked to the clip so it's never posted twice to a channel
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
- ✅ Select several posts (checkbox on each row) for bulk **Approve**, **Upload now**, **Retry**, **Duplicate**, **Unschedule** and **Delete drafts**; **Select all** appears once something is selected

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

### Analytics

- ✅ Views, watch time, average view duration and subscribers for the last 7, 28 or 90 days, per channel or **All channels** added together
- ✅ Views per day chart (hover a day for its numbers) and the top 10 videos, marked when ChannelDeck posted them
- ✅ Uses the YouTube Analytics API, which has its own quota, so it doesn't use your 10,000 daily units

### Twitch clip bank

- ✅ Connect Twitch channels as the broadcaster or an editor
- ✅ Daily clip sync at a time you choose, plus on launch/wake if overdue, plus **Sync now**
- ✅ Full backfill from a start date, resumable after a quit
- ✅ Downloads landscape and portrait files, thumbnail and metadata, named so Finder sorts oldest to newest
- ✅ Clips page: sort, filter (game, length, views, featured, posted, dates, title), preview, bulk actions, disk usage
- ✅ A color per Twitch channel (picked on the Channels page, like YouTube channels), shown on clip cards, Clips tabs, autopost rules and layouts
- ✅ **All channels** view on the Clips page: sort, filter and bulk-select clips from every channel at once, or pick a few channels to show
- ✅ Add clips as draft posts to any YouTube channel; a clip can never be added twice to the same channel
- ✅ **Post…** on any clip (card or preview) opens the post editor with that clip; **Select all** in the selection bar once a clip is selected

### Autoposting

- ✅ Rules mapping Twitch accounts to a YouTube channel, with daily time slots and weekdays, planned up to 14 days ahead
- ✅ Daylight-saving safe: a time skipped in spring moves to the next valid minute; a repeated time in fall is used once
- ✅ Pick order (oldest, newest, most viewed) and filters (games, length, views, featured)
- ✅ Shorts made from the horizontal clip with a layout (blurred fill, center crop, or facecam-on-top split drawn in a crop editor with a live preview and an 8-second test render), or from Twitch's own vertical version if the rule prefers it
- ✅ **Styles for autoposts:** in the Editor, **Save as style** keeps the look of an edit (text layers, stickers, caption style) without its footage. A rule's **Style** picker puts that look on every clip it posts, with the text variables filled in and **auto captions** made on your Mac from each clip's speech just before it uploads
- ✅ **Format** switch in the post editor: any clip post (or horizontal video) can be horizontal, Twitch's vertical version, or a vertical render with a layout, and **Render now** previews the Short
- ✅ Title and description templates with `{{clip_title}}`, `{{game}}`, `{{broadcaster}}`, `{{clipper}}`, `{{clip_date}}`, `{{clip_url}}`, `{{twitch_url}}`, `{{views}}`, `{{n}}`; titles trimmed safely to 100 characters
- ✅ Review mode (approve first) or Auto; unapproved autoposts are dropped at their publish time and the clip goes back to the bank
- ✅ Unscheduling an autopost refills its slot with the next clip; that rule never picks the skipped clip again
- ✅ **Sync…** in a rule's ⋯ menu re-queues its failed autoposts: their clips go back in the pool and get re-uploaded on schedule. **Duplicate…** carries the original's skipped and queued clips over, so deleting the original doesn't re-post them
- ✅ Never posts the same clip twice to the same channel (enforced by the database)
- ✅ "Out of clips" notification (once a day per rule) and a quota warning when your rules would go over YouTube's daily limits

### Mac app

- ✅ Native dark UI; macOS notifications for uploads, failures, quota pauses and sign-in problems
- ✅ Logs in `~/Library/Logs/ChannelDeck` with secrets scrubbed
- ✅ Menu bar icon with the pending count; its menu shows the next publish time and has Open, Sync clips now, Pause jobs and Quit
- ✅ Keep in menu bar: closing the window leaves uploads and syncs running; launch at login (installed app)
- ✅ Hide post titles (for streaming): notifications and the menu bar say "a video" instead of a post's title
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

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable **YouTube Data API v3** and **YouTube Analytics API** (the second is only for the Analytics page).
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

**Settings → Backup → Export backup…** saves a JSON file with your settings, channels, Twitch channels, templates, series, layouts, rules and posts not yet on YouTube. It never contains sign-in tokens or secrets. When you import it on a new Mac, click **Reconnect** on each channel and turn the rules back on. Import restores your settings except Dry Run and “delete local files after posting”, which keep the values already set on that Mac. Clips come back from Twitch on the next sync.

### YouTube quota

Quota belongs to your Google Cloud project and is shared by all your channels. Uploads have their own daily allowance (100 per day); everything else shares 10,000 units per day (a thumbnail or playlist add costs 50, a list call costs 1). Both reset at midnight Pacific. It's free; going over just pauses until the reset.

The Analytics page uses the separate YouTube Analytics API, which has its own quota and doesn't count against these numbers. Its reports are kept for an hour unless you click Refresh.

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

**Screenshots for UI work:** from source, `npx electron-vite build && CHANNELDECK_SCREENSHOTS="$(mktemp -d)" ./node_modules/.bin/electron .` opens the app on a throwaway folder with Dry Run on, captures every page empty, fills it with demo channels, clips, rules and posts in every status, captures every page again (plus the editors and the smallest window size), and quits. The PNGs are in `<folder>/shots`. It starts no jobs and calls neither Google nor Twitch.

**Logo and icons:** the logo artwork lives in `design/logo/`. `swift scripts/trace-logo.swift design/logo/mark.webp design/logo/logo-light.webp` traces it into vector outlines with Apple's Vision framework: `resources/brand/mark.svg`, `resources/brand/wordmark.svg` and `src/renderer/src/components/brand/paths.ts` (used by the sidebar logo). `swift scripts/draw-icons.swift <dir>` then draws the app icon and the menu bar template images from `mark.svg` with CoreGraphics; copy them to `build/icon.png`, `resources/icon.png` and `resources/trayTemplate(@2x).png`, and make `build/icon.icns` from the PNG with `sips` + `iconutil`.

**Security:** the window is sandboxed with no Node access; it can only call a typed, validated set of functions. Local videos are previewed through a restricted `cdmedia://` protocol. Secrets are never committed or logged.

---

## Changelog

Newest first. The website's [changelog page](https://slimeraps.github.io/channeldeck/changelog.html) has a shorter version of each release.

### Unreleased

- **Queue filters stay reachable:** if all your posts are published or canceled, the Queue now shows "No active posts" with a **Show finished posts** button instead of the first-run "Nothing in the queue yet" screen, which hid the status filter. The first-run screen appears only when you have no posts at all.

### 2.0.0 (2026-11-15)

- **Branding on vertical layout presets:** edit an existing preset and choose **Saved branding style** to attach a vertical editor style with logos, text and captions. Each channel's preset can use its own branding.
- New autoposts inherit the selected layout's style. An explicit style on the rule takes priority. Styled posts render from the horizontal clip, even when the rule prefers Twitch's vertical version.
- Only vertical styles can be attached to layouts. Styles attached to a layout cannot be deleted or overwritten with a nonvertical style until detached.
- Existing queued posts keep their saved appearance. Layout previews and test renders show crops only; branding is applied during autopost rendering. Styles and their layout associations are not included in configuration backups yet.

### 1.9.0 (2026-11-14)

- Editor, phase E7 (2026-11-14):
  - **Edit styles for autoposts:** the Editor's **Save as style** button saves an edit's text layers, stickers and caption look (no footage) under a name. Same name updates the style.
  - A rule's new **Style** section picks one. Every autopost of that rule is then rendered from the horizontal clip with the rule's layout and the style on top: text with `{{clip_title}}` and the other variables filled in, stickers, and **auto captions**. Layers that ran to the end of the style's edit run to the end of each clip; shorter clips drop layers that would start after they end.
  - Captions are made on your Mac for each clip just before it uploads (each file is transcribed once). If the caption model isn't downloaded, the post fails with a message saying so, and the rule editor warns about it.
  - A style a rule uses can't be deleted, and stickers a style uses stay in the library. A rule without a style behaves exactly as before.
  - **Save as style** also lists your styles, so you can replace or delete one (with a confirmation).
  - Not in backups yet: a restored rule comes back without its style.

### 1.8.0 (2026-11-14)

- Editor, phase E6 (2026-11-14):
  - **Auto captions**, made on your Mac: **Captions → Make captions** listens to every video in the edit. The first time, it asks to download the speech model (whisper.cpp's small English model, 190 MB, checked after download).
  - **Looks:** **Highlight** colors the word being said, **Pop** shows one word at a time, **Plain** shows whole lines. Pick the font, size, colors, outline, position, words per line and ALL CAPS.
  - **Fixing words:** fix any line in the word list.
  - Captions follow your cuts: trimming, splitting or moving pieces keeps them in sync. Sound tags like "(gunshots)" and repeated lines are left out.
- Editor, phase E5 (2026-11-14):
  - **Stickers and logos:** **Add → Sticker or image…** opens your sticker library. Import PNG, JPG, WebP or GIF files (GIFs play); the same image is stored once. Place a sticker by dragging it on the preview; set its size, opacity and when it shows in the Sticker panel or on the timeline's sticker row.
  - **Watermarks:** **Logo watermark…** puts your logo in the top right for the whole video. **Channel name watermark** adds the streamer's name in the top left. Both stay clear of what YouTube's Shorts player covers, and you can move them.
  - Stickers render exactly where and when the preview shows them.
- Editor, phase E4 (2026-11-14):
  - **Projects:** edits save as projects while you work. The Editor page lists them with a thumbnail, the canvas, length and when you last changed them, with **Rename…** and **Delete…**.
  - **From the editor:** **Post…** opens the post editor with the edit, and the post uploads the edited video. **Export…** saves a copy of the render wherever you choose.
  - **From a post:** **Edit video…** opens the editor right over the post editor. **Done** puts the edit on the post, which then shows an "Edited video" summary with **Remove edit**.
  - **From the Clips page:** **Edit…** on any clip, and **Edit together…** for selected clips, joined oldest first.
  - **Never-twice:** a joined post stays linked to its first clip when all its clips come from one Twitch channel. The post editor warns when other clips in the edit are already posted to that channel.
- Editor, phase E3 (2026-11-14):
  - **Text:** **Text** (or T) adds text at the playhead. Pick a font (Archivo Black, Anton or Bebas Neue), size, color, an outline or a box, a shadow, alignment, and None, Fade or Pop. Drag it on the preview, and drag it or its ends on the timeline's text row. **Insert a clip detail…** adds `{{clip_title}}`, `{{game}}`, `{{broadcaster}}` and more, filled from the first clip in the edit. The preview places text exactly where the render puts it (same fonts, same sizes, same line wrapping).
  - **Crop and zoom:** for 16:9 and 1:1, the **Frame** panel zooms in, can zoom slowly over a piece, and moves the picture; you can also drag the picture in the preview.
  - **Guides** shades the parts of a vertical video that YouTube's Shorts player covers.
- Editor, phase E2 (2026-11-14): a new **Editor** page. Open a clip from your bank or any video file, then:
  - **Trim** by dragging the edges of a piece on the timeline.
  - **Split** at the playhead (S), **delete** a piece (⌫), or **drag a piece** to reorder.
  - **Add** more clips or videos to join them into one video.
  - Switch between **9:16, 16:9 and 1:1**. For vertical videos, pick a layout for one piece or every piece: blurred fill, center crop, or one of the channel's saved layouts. **New layout…** draws one on the same clip.

  The live preview plays across pieces with sound and frames them exactly like the render. The timeline shows a filmstrip and waveform for each piece, zooms with ⌘ + scroll, and snaps to the playhead and cuts. Everything can be undone (⌘Z / ⇧⌘Z). **Render now** makes the video in your renders folder, with progress and Cancel, then plays it with **Show in Finder**. Text, crop and zoom come next. Saving edits and opening the editor from a post or the Clips page come after that.

- Screenshot mode: captures no longer come out one step behind when the window is in the background, and the run now covers the editor.
- Editor, phase E1 (2026-11-14): the engine behind the coming video editor, with no editor screen yet. An edit is a list of pieces cut from one or more videos and played in order, each framed for a vertical, horizontal or square canvas (a vertical layout, or a crop with an optional slow zoom), plus text layers. ffmpeg renders it in one pass: text is drawn by libass in three bundled fonts (Archivo Black, Anton, Bebas Neue, all under the SIL Open Font License, in `resources/fonts`). A post can now carry an edit instead of a vertical layout; the upload job renders it just before uploading, checks that every video it uses still exists, and "delete local files after posting" keeps every one of them until the post is done. ffprobe now also reports the frame rate and whether a file has sound. The build self-test renders an edit with text too, which proves the installed app can find the fonts.
- Website (2026-11-14): the GitHub Pages site in `docs/` is now a full site in the app's colors: Home, Features, Install, Setup (Google and Twitch), Your data (folders, backups, quota, deleting everything), Changelog, Develop and the Privacy policy, with screenshots from the app's screenshot mode. The privacy policy now also lists the YouTube Analytics reports the Analytics page reads (kept in memory for an hour, never saved). The repository's Website link points to it.

### 1.7.0 (2026-11-14)

- Autopost: new **Sync…** item in a rule's ⋯ menu (2026-11-14). It cancels the rule's failed autoposts that have nothing on YouTube yet, puts their clips back in the pool and refills the empty slots, so those clips get re-uploaded on schedule. Clips you unscheduled or swapped out stay skipped; a failed autopost that already has a video is left for **Retry** in the queue. The menu shows how many failed autoposts the rule has.
- Autopost: **Duplicate…** no longer re-posts clips by accident. The copy starts with the original's skip list and, on the same channel, the clips of its autoposts that aren't on YouTube yet, so duplicating a rule and deleting the original no longer brings those clips back. Use **Sync…** to retry failed ones. The editor's preview shows the clips the copy will really pick.

### 1.6.0 (2026-11-14)

- New **Analytics** page: views, watch time, average view duration, subscribers gained and lost, a views-per-day chart and the top 10 videos for the last 7, 28 or 90 days. Pick one channel or **All channels**, which adds every signed-in channel together (average view duration is weighted by views; top videos are ranked across channels, each with its channel's color). A channel that can't be read is left out with the reason shown. It uses the YouTube Analytics API, which has its own quota, so it doesn't touch your 10,000 daily units; enable **YouTube Analytics API** once in your Google Cloud project. No new sign-in is needed. Titles of videos ChannelDeck didn't post cost one `videos.list` unit per load.
- Fix (2026-11-14): an autopost whose vertical file was already rendered (by an earlier post of the same clip and layout) got stuck on "Uploading" at 0%. It skipped the render, so it never learned the file's size and told YouTube the video was 0 bytes. The upload now reads the real size from the file first, refuses an empty or unknown-size file, and fails with a clear message instead of hanging.
- Fixed: an imported backup can no longer put a bad Twitch login (like `../x`) into the clip folder path. A backup with a login that isn't letters, digits and underscore (1 to 25 characters) is refused, and the clip folder code refuses it too, so downloads can't land outside your clip folder.

### 1.5.0 (2026-11-13)

- Queue: select several posts with the checkbox on each row (it shows on hover, and on every row once one is selected). The selection bar runs **Approve**, **Upload now**, **Retry**, **Duplicate**, **Unschedule…** and **Delete drafts…** on the selected posts each action applies to, with one summary message; the destructive ones ask first. Changing a filter clears the selection.
- Clips and Queue: **Select all** / **Select none** now sits in the selection bar and only shows once at least one item is selected.

### 1.4.0 (2026-11-13)

- New look: the ChannelDeck logo (the two cards with the play notch) in pink `#ffa6c9`, in the sidebar, the app icon and the menu bar icon. The dark theme uses the brand colors: ink `#10151d`, slate `#263241`, mist `#f5f7fa`, with a slightly darker pink (`#f292b8`) for main buttons and the current page, so the logo stands out.
- Autopost: **Duplicate…** in a rule's ⋯ menu opens the rule editor with a copy of its settings, named "… (copy)", to save as a new rule.

### 1.3.1 (2026-11-13)

- Fixed: "Delete local files after posting" now only deletes inside your clip folder and its `_renders` folder, and a linked folder can't point it anywhere else. Files outside are left alone, with a warning in the log. It also keeps any file an unfinished post (draft, queued, failed, waiting for quota…) still uses, including the clip a vertical render is made from (from the other developer's `fix-cleanup-delete-guard` branch, with tests).

### 1.3.0 (2026-11-13)

- Calendar: swipe sideways with two fingers on the trackpad (or Shift + mouse wheel) to move to the next or previous week or month. One swipe moves one step.
- UI pass: the queue table fits the window again. At 1280 px wide its last columns (upload progress and the ⋯ menu) were cut off; progress and Approve now sit under the status, and narrow windows drop the thumbnail and show the channel as a colored dot. Publish times stay on one line.
- UI pass: times use the same 12-hour clock everywhere (the calendar and the autopost slot lists used 24-hour). Time fields are wide enough for AM/PM. Long folder paths in Settings show their end instead of `/Users/…`. The queue's empty state fits under the setup card, Calendar and Autopost empty states get a button to the Channels page, the rule card's buttons line up, and a saved category that YouTube's list can't confirm shows its number instead of a blank box.
- Added a screenshot mode for UI work (`CHANNELDECK_SCREENSHOTS`, from source only; see Building).
- Added **Settings → Mac → Hide post titles**, for streaming: notifications and the menu bar say "a video" instead of a post's title, so private titles don't show up on stream.
- Fixed: status sync marked a post "deleted on YouTube" (and freed its clip to be posted again) the first time YouTube's answer left the video out. A video now has to stay missing for an hour, across two checks, before it counts as deleted. A video YouTube reports as deleted still counts at once.
- Fixed: importing a backup replaced every setting, so an old backup could turn Dry Run off or switch on deleting local files. Import now leaves Dry Run and "delete local files after posting" as they are on this Mac.
- Fixed: a symlink inside the clip or render folder could make the app's video player serve a file outside those folders. It now follows links and refuses any that lead outside (from the other developer's `harden-media-protocol` branch, which also adds tests for the video player and the IPC sender check).

### 1.2.0 (2026-11-13)

- Added **From clip library…** to the post editor: pick a banked Twitch clip as the video. Title and "Clipped by" credit fill in, and the post stays linked to the clip.
- Added **Post…** to every clip on the Clips page (and **Post this clip…** in the preview), opening the editor with that clip.
- Added **Select all** to the Clips page (all clips shown; "Show more" loads the rest).
- Fixed: removing a Twitch channel failed once any of its clips had been posted or canceled. Now only posts not on YouTube yet block removal; finished posts are kept and just unlinked from the clip, and autopost rules drop the channel.
- Fixed: a clip sync still running while its channel was removed logged a database error.

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
