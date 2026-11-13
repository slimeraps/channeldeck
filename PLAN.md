# ChannelDeck — Build Plan

A personal macOS app (Electron) that banks Twitch clips on disk and schedules YouTube uploads across several channels using YouTube's native `publishAt`.

**Every phase ends with the same gate (in addition to its own acceptance criteria):**

- `npm run typecheck`, `npm run lint`, `npm test` all pass
- `npm run dev` launches the app with no console errors
- A short "test by hand" list is posted for Cody
- One git commit for the phase on its own branch (`phase-N-<slug>`), pushed, with a pull request into `main` (no secrets, no tokens, no `client_secret.json`)
- README updated: finished features ticked, changelog entry added under Unreleased (no version numbers until all phases are done)
- Stop and wait for "go"; the PR is merged into `main` once Cody approves the phase
- After the merge: check the other dev's release branch for new feature branches, summarize them, and ask Cody what to implement before the next phase

---

## Decisions made while planning (please confirm or veto)

1. **Twitch auth: Authorization Code flow with a Confidential Twitch app is the primary flow.** The current Twitch docs say public-client refresh tokens (Device Code flow) are one-time use and "become inactive after 30 days", after which the user must sign in again. Confidential-client refresh tokens don't have that 30-day limit. So: redirect `http://localhost:17563/twitch/callback`, client secret stored encrypted with `safeStorage`. Device Code flow stays as a fallback when no secret is entered, with a UI note that it needs re-auth roughly monthly.
2. **Google consent screen must be "In production".** If it's in "Testing" with External users, Google expires refresh tokens after 7 days. The README and first-run checklist will say to publish the app (unverified is fine for personal use; you click through the "unverified app" warning).
3. **Never-twice index ignores canceled posts:** `UNIQUE(clip_id, account_id) WHERE clip_id IS NOT NULL AND status <> 'canceled'`. This lets "Unschedule before upload" return a clip to the bank, as the brief asks. "Delete from YouTube" also ends in `canceled`, so the clip becomes postable again. "Keep as private" leaves the clip counted as posted.
4. **One extra post state, `needs_decision`,** for "If the publish time passes before upload finishes → Ask me". The post waits there until you pick Publish now / Reschedule / Cancel.
5. **`published` is the terminal success state for all visibility modes.** For Public now, Unlisted now and Private, it means "uploaded and processed, with its final visibility". The UI label shows the actual visibility.
6. **Default upload lead time: 24 h before `publishAt`** (`upload_after_utc = publish_at_utc − lead`). This is configurable in Settings. Manual posts with Public/Unlisted/Private upload as soon as they're queued.
7. **Tests run on Electron's own Node** (`ELECTRON_RUN_AS_NODE=1`), so `better-sqlite3` only needs one native build (the Electron ABI).
8. **Local video/thumbnail preview uses a custom `cdmedia://` protocol.** It is registered in main and serves only files under the clip folder, the render folder, or a path referenced by a post. The renderer never gets `file://` access.
9. **Time library: Luxon** for IANA time zones and DST-safe slot math. All stored times are UTC ISO-8601 strings ending in `Z`.
10. **API mocking: msw** (intercepts both `fetch` used by the Twitch client and gaxios used by `googleapis`).
11. **Vertical renders** go to `<clipsRoot>/_renders/<clip_id>_<preset_id>.mp4`. They're kept until the post is published, then cleaned up by the same "delete N days after posting" setting.

---

## Phase 0 — Scaffold

- [x] `git init`, `.gitignore` (node_modules, out, dist, `client_secret*.json`, `*.db`, `.env*`), public GitHub repo `slimeraps/channeldeck` (done before Phase 0)
- [x] electron-vite + React + TypeScript (strict), project layout from CLAUDE.md
- [x] Tailwind + shadcn/ui (Radix), lucide icons, dark theme by default
- [x] ESLint 10 (typescript-eslint strict, react-hooks, react-refresh) + Prettier. `eslint-plugin-react` dropped: it doesn't support ESLint 10 yet
- [x] Vitest wired to run under Electron's Node; one sample test per process (main, shared, renderer)
- [x] Secure `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP, block `window.open` / navigation
- [x] Typed IPC skeleton: contract in `src/shared/ipc`, zod-validated `handle()` wrapper in main, `window.api` in preload; one `app:getInfo` round-trip
- [x] electron-log to `~/Library/Logs/ChannelDeck` with a token-redaction hook
- [x] Sidebar shell: Queue, Calendar, Clips, Autopost, Channels, Templates, Settings (placeholder pages with empty states), "New post" button + Cmd+N
- [x] TanStack Query + Zustand providers

**Acceptance:** app opens to the sidebar shell in dark mode; every page shows a placeholder; IPC round-trip works and rejects a malformed payload (test); renderer can't reach `require`/`process` (test via preload API surface); log file appears in `~/Library/Logs/ChannelDeck`.

## Phase 1 — Data layer

- [x] Drizzle schema for all tables in the brief: `accounts`, `twitch_accounts`, `clips`, `layout_presets`, `autopost_rules`, `posts`, `post_steps`, `templates`, `series`, `quota_usage`, `event_log`, `settings`, plus a `games` cache
- [x] Partial unique index for never-twice (decision 3); indexes on `posts(status, upload_after_utc)`, `clips(twitch_account_id, created_at_utc)`
- [x] Migrations generated by drizzle-kit and applied at startup (bundled in the packaged app)
- [x] DB at `app.getPath('userData')/channeldeck.db`, WAL mode, foreign keys on
- [x] Repositories per aggregate (no raw SQL in IPC handlers or jobs)
- [x] Typed settings store with defaults (zod schema)
- [x] Event log writer
- [x] `nextPostStatus(current, event)`: a pure transition function; `postsRepo.transition()` is the only writer of `posts.status`
- [x] `secrets` module wrapping `safeStorage` (encrypt/decrypt; refuses to run if encryption isn't available)

**Acceptance:** migrations run on a fresh DB and are idempotent; transition table fully unit-tested (every valid edge, every invalid edge rejected); never-twice index rejects a duplicate active post but allows one after cancel; settings round-trip with defaults.

## Phase 2 — Google sign-in and YouTube channels

- [x] Settings → "Import Google client file": validate it's an `installed` client, copy to userData
- [x] Loopback OAuth: 127.0.0.1 random port, PKCE (S256), `state` check, `access_type=offline`, `prompt=consent`, scopes `youtube.upload` + `youtube`, system browser via `shell.openExternal`, success page that tells you to return to the app
- [x] `channels.list` (snippet,contentDetails, mine=true) → one `accounts` row per channel; reject duplicate channel ids with a clear message
- [x] Persist refreshed tokens on the client's `tokens` event (encrypted)
- [x] `invalid_grant` → `token_status = needs_reauth`, banner, macOS notification, pause that account's jobs (calls for that channel stop until Reconnect; the Phase 4 job runner also skips accounts that need re-auth)
- [x] Channels page: YouTube section with avatar, title, handle, status, color, enabled toggle, defaults editor; Add / Reconnect / Remove
- [x] UI hint: "To add a Brand Account channel, click Add channel again and pick it in Google's account picker."
- [x] Remove: revoke token, then ask what to do with queued posts (cancel them / move to another channel / keep as drafts)
- [x] Quota logging for `channels.list` starts here (cost table in `src/shared/constants/quota.ts`)

**Acceptance:** with mocked Google, a sign-in creates an account, a duplicate is rejected, `invalid_grant` flips status to needs re-auth, remove calls revoke. By hand: real sign-in adds your channel(s); token is ciphertext in the DB; nothing token-like in the log.

## Phase 3 — Post editor and queue table (no uploading)

- [x] Post editor: channel picker, file by drag-drop / picker, ffprobe metadata (duration, resolution, size, aspect ratio), Short detection (vertical or square and ≤ 3 min), > 15 min warning
- [x] Title (≤ 100 chars, counter, no `<` `>`), description (≤ 5000 bytes, byte counter, no `<` `>`), tag chips (~500 chars total, YouTube's counting incl. quotes for spaced tags), category (`videoCategories.list`, US, cached), playlist (`playlists.list` mine, cached + refresh)
- [x] Thumbnail JPG/PNG ≤ 2 MB with preview
- [x] Made for kids (required, default from channel), notify subscribers, license, embeddable, default + audio language, synthetic media
- [x] Visibility mode; publish date/time picker in local zone with UTC value and relative time ("in 3h 20m")
- [x] Missed policy: Publish now / Ask me (default Ask me)
- [x] Save as Draft / Add to Queue; shared zod schema validates in renderer (inline errors) and again in main
- [x] Dropping a video anywhere on the window opens a new post with it filled in
- [x] Queue table: thumbnail, title, channel dot, source icon, local publish time, status, progress; filter by channel/status/source; sort by publish time; row actions Edit, Duplicate, Reveal in Finder, Unschedule, Delete draft (others appear in later phases)
- [x] `cdmedia://` protocol for previews (decision 8)

**Acceptance:** validation unit tests (title, description bytes, tags, Short detection, publishAt formatting/time zones); a draft and a queued post persist and reappear after restart. By hand: drop a vertical clip and see it flagged Short; bad title shows inline error.

## Phase 4 — Upload engine

- [x] Job runner: 30 s tick, immediate tick on start and `powerMonitor` 'resume'; job types registered (clip sync, clip download, planner, upload, status sync); per-type concurrency
- [x] `powerSaveBlocker.start('prevent-app-suspension')` held while any job runs
- [x] Upload concurrency setting 1–3 (default 1)
- [x] Steps per post: render (if needed) → insert → thumbnail → playlist, tracked in `post_steps`, each retried on its own
- [x] Pre-flight: file exists with same size (and mtime), else fail "File missing"
- [x] Resumable `videos.insert` from a file stream; byte progress pushed to renderer over IPC
- [x] Save `youtube_video_id` the moment insert succeeds; never re-insert a post that has one
- [x] Error classifier: network/5xx → retry with exponential backoff + jitter (max 5); `quotaExceeded` / `uploadLimitExceeded` → `waiting_quota` until next midnight Pacific; `invalidTitle`, `invalidDescription`, `invalidPublishAt`, `forbidden` on thumbnails (channel not verified), `youtubeSignupRequired`, `invalid_grant` → named messages
- [x] Crash recovery: on launch, any post in `uploading`/`rendering` without a video id goes back to `queued`
- [x] Quota logging for every call; Dry Run wraps the YouTube client and logs call + payload instead of sending
- [x] Notifications: upload finished, failed
- [x] Queue row actions: Upload now, Retry; live progress bar
- [x] Post-upload check: if a Public/Unlisted upload comes back locked private, show the compliance-audit message and don't retry
- [x] Also done early: missed publish time at upload follows the post's policy (ask → Needs decision, or publish now). Phase 5 adds the decision UI and status sync (Processing → Scheduled → Published).

**Acceptance:** integration test (mocked YouTube) uploads a post end-to-end through all steps; a 5xx on thumbnail retries only the thumbnail step; quotaExceeded parks the post in `waiting_quota` with the right Pacific-midnight time (DST-tested); killing mid-upload and relaunching requeues it; Dry Run makes zero HTTP calls to Google. By hand: upload a short private test video to a real channel.

## Phase 5 — Scheduling and sync

- [x] Schedule mode: `privacyStatus: private` + `publishAt` (RFC 3339 UTC, must be in the future at insert time)
- [x] `upload_after_utc` from lead time; runner only picks posts whose `upload_after_utc` has passed (or Upload now)
- [x] Missed policy at upload time: publish time passed → Publish now (upload public) or `needs_decision` + notification
- [x] Status sync every 15 min + on launch: `videos.list` (status,processingDetails), ≤ 50 ids per call; `processing → scheduled → published`; `uploadStatus` rejected/failed → `failed` + notification with reason
- [x] Reschedule an uploaded post: `videos.list` current status part → change `publishAt` → `videos.update` whole part
- [x] Unschedule: before upload → `canceled`; after upload → "Keep as private" (clear `publishAt`) or "Delete from YouTube" (`videos.delete`), each confirmed
- [x] Notifications: published
- [x] Row action: Open in YouTube Studio

**Acceptance:** tests for missed-policy branching, status sync batching (120 posts → 3 calls) and state moves, reschedule sends the full status part. By hand: schedule a real video 30 min out, watch it go Scheduled → Published while the app is closed for part of that window.

## Phase 6 — Twitch connect and clip bank

- [x] Settings: Twitch Client ID + Client Secret (secret encrypted)
- [x] Auth per decision 1; scope `channel:manage:clips` (broadcaster) or `editor:manage:clips` (editor), only the one needed; store broadcaster id, login, display name, avatar, `editor_id`; refresh-token rotation; failure → needs re-auth + pause sync
- [x] Typed Helix client: `Client-Id` + Bearer on every call, reads `Ratelimit-Remaining`/`Ratelimit-Reset`, backs off on 429
- [x] Daily sync at chosen time (default 04:00 local) + on launch/wake if last success > 24 h + Sync now; window = last success − 2 days → now; split into ≤ 7-day sub-windows; page with `after` until empty; upsert by clip id
- [x] Backfill on first connect from chosen start (default account creation date) in 7-day windows oldest-first; progress UI; cursor saved in `backfill_cursor_json`; resumes after quit
- [x] Adaptive windowing: if a window returns ≥ ~900 clips, split it in half and redo (guards the ~1,000 cap)
- [x] Get Games name cache
- [x] Download job: Get Clips Download right before downloading (≤ 10 ids/request), landscape + portrait when present, stream to temp → ffprobe verify → atomic move; retry with backoff; clips missing from the response → "Not downloadable"
- [x] On-disk layout and naming from the brief, plus thumbnail and `.json` sidecar
- [x] Clips page: tab per account; sort oldest (default) / newest / most viewed; filters (game, duration range, min views, featured, posted/unposted, date range, title search); card shows all listed fields + links to resulting YouTube videos; inline preview; bulk queue to channel / hide / re-download / delete local file
- [x] Notifications: sync results ("12 new clips")

**Acceptance:** integration test: full daily sync + download against mocked Helix (pagination, overlap dedupe, 429 backoff, a null portrait URL, an omitted clip). Unit tests: window splitting, backfill resume from saved cursor, clip filename sorting oldest→newest. By hand: connect your Twitch account, run backfill, check the Finder folder sorts by date.

## Phase 7 — Autoposting

- [x] Autopost page: rules list + editor (Twitch accounts → one YouTube channel, slots, weekdays, pick order, filters, format, layout preset, title/description templates, tags, category, playlist, made for kids, mode, look-ahead, enabled)
- [x] Slot generator in local zone (DST-safe: skipped times move to the next valid minute; repeated times use the first occurrence)
- [x] Picker: oldest unposted (default) / newest / most viewed; filters; excludes hidden, not-downloadable, and clips already active for that channel
- [x] Planner job: each tick fill empty slots in the look-ahead; posts created as `needs_approval` (Review) or `queued` (Auto); `publish_at` = slot; render step added when needed
- [x] Template rendering with `{{clip_title}} {{game}} {{broadcaster}} {{clipper}} {{clip_date}} {{clip_url}} {{views}} {{n}}`; default description credits the clipper and links the Twitch channel; output re-validated against title/description limits (truncate title safely)
- [x] Vertical conversion with ffmpeg: use portrait file if present, else layout preset (blur fill / center crop / facecam split) → 1080×1920
- [x] Crop editor: grab a sample frame, draw facecam + gameplay rectangles, save to `layout_presets.crops_json`
- [x] Bank empty → slot left empty + one notification per rule per day
- [x] Quota warning when enabled rules + queued posts would exceed 100 uploads/day or the 10,000-unit bucket
- [x] Queue: Approve action; Approve all for a rule

**Acceptance:** integration test: planner run creates the right autoposts for 3 days × 4 slots, respects never-twice, filters and pick order. Unit tests: slots across DST changes, pick order/filters, template rendering. By hand: draw a facecam split on one of your clips and check the rendered Short.

## Next patch (after Phase 7) — Clips page polish

Requested by Cody on 2026-11-13.

- [x] Channel colors for Twitch clips: each Twitch account gets a color (picker on the Channels page, like YouTube channels), shown on clip cards, account tabs, and autopost rule sources
- [x] Easier sorting by account: an **All channels** view on the Clips page next to the per-account tabs, with an account filter and sort that work across all accounts

## Phase 8 — Calendar, templates and series

- [x] Calendar week + month views, colored by channel, clip icon on autoposts
- [x] Drag to reschedule (confirm + `videos.update` when already uploaded); click empty slot → new post at that time
- [x] Templates page: manual templates with `{{n}}`, `{{date}}`, `{{channel}}`
- [x] Series: template + next number (e.g. "MW4 Day {{n}}", next 9); number consumed only when a post is queued; editing the counter allowed
- [x] Duplicate to another channel (editor action + queue row)
- [x] Swap clip for autoposts (before upload only)

**Acceptance:** tests for series counter (no double use on draft/cancel), template rendering, reschedule path. By hand: drag a scheduled video to tomorrow and confirm YouTube Studio shows the new time.

## Phase 9 — Mac polish

- [ ] Tray icon with pending count and next publish time; menu: Open, Sync now, Pause jobs, Quit
- [ ] Close window → stays in tray (setting); launch at login (`app.setLoginItemSettings`)
- [ ] Quota meter: today's upload calls / 100 and units / 10,000, reset at midnight Pacific
- [ ] Disk usage meter per Twitch account; "delete local file N days after posting" job
- [ ] Settings page complete: Google client file, Twitch id/secret, clip folder, sync time, lead time, concurrency, launch at login, keep in tray, Dry Run, backup export/import (JSON, no tokens or secrets), open logs folder
- [ ] App icon; re-auth banner polished; empty states reviewed

**Acceptance:** quota accounting tests incl. Pacific reset across DST; backup round-trip test proves no secrets in the export. By hand: close the window, see tray, reopen; toggle launch at login.

## Phase 10 — Packaging

- [ ] electron-builder arm64 `.dmg`, unsigned; `asarUnpack` for ffmpeg/ffprobe binaries and better-sqlite3; migrations bundled
- [ ] First-run checklist screen (Google client file → consent screen in production → add channel → Twitch app → connect Twitch → clip folder)
- [ ] README: Google Cloud setup (APIs, OAuth Desktop client, consent screen In production), Twitch app setup (Confidential, redirect URL), where `client_secret.json` goes, `npm run dev`, building the dmg, opening an unsigned app (right-click → Open)

**Acceptance:** `npm run dist` produces a dmg; the installed app launches, runs migrations, finds ffmpeg/ffprobe, and completes a Dry Run upload.
