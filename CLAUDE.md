# ChannelDeck — notes for Claude

Personal macOS (Apple Silicon) Electron app: Twitch clip bank + YouTube upload scheduler for several channels. The phased plan lives in `PLAN.md`. Build one phase at a time and stop after each one.

## Working rules

- One phase at a time. End each phase with typecheck + lint + tests passing, `npm run dev` launching cleanly, a "test by hand" list, and one git commit. Then wait for "go".
- Git: repo is public at github.com/slimeraps/channeldeck. `main` holds approved work only. Each phase is built on its own branch off `main` (`phase-0-scaffold`, `phase-1-data-layer`, …), pushed, and merged into `main` through a pull request after Cody approves the phase. Extra branches for side experiments are fine. Never force-push `main`.
- **Never commit secrets** (`client_secret*.json`, tokens, `.env*`, the DB). **Never log tokens**: logging goes through the redacting logger only.
- If unsure about a YouTube or Twitch API detail, read the official docs (developers.google.com/youtube/v3, dev.twitch.tv/docs). Don't guess.
- Don't change the core design (native `publishAt` scheduling; autoposts are ordinary posts; four visibility modes) without asking Cody.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Stack

- Electron (latest stable) + TypeScript strict + React, built with electron-vite
- Tailwind CSS + shadcn/ui (Radix) + lucide-react; dark theme default
- TanStack Query (server/IPC data), Zustand (UI state only)
- SQLite: better-sqlite3 + Drizzle ORM + drizzle-kit migrations; DB at `app.getPath('userData')/channeldeck.db` (WAL, foreign keys on)
- Google: `googleapis` + `google-auth-library`. Twitch: own typed `fetch` client for Helix
- Media: `ffprobe-static`, `ffmpeg-static`
- Time: Luxon (IANA zones, DST-safe). Store every timestamp as UTC ISO-8601 with `Z`
- Validation: zod (IPC payloads, forms, settings, imported files)
- Logging: electron-log → `~/Library/Logs/ChannelDeck`
- Tests: Vitest + msw. Packaging: electron-builder, arm64 dmg, unsigned

## Commands

```
npm install            # postinstall runs electron-builder install-app-deps (rebuilds better-sqlite3 for Electron)
npm run dev            # electron-vite dev (hot reload)
npm run typecheck      # tsc for node (main/preload/shared) and web (renderer) projects
npm run lint           # eslint .
npm run format         # prettier --write .  (format:check verifies)
npm test               # vitest run (config: vitest.config.mts), executed with ELECTRON_RUN_AS_NODE=1 under Electron's Node
npm run test:watch
npm run db:generate    # drizzle-kit generate → ./drizzle (commit the generated SQL)
npm run build          # electron-vite build
npm run dist           # build + electron-builder --mac dmg --arm64
```

Tests run on Electron's Node so better-sqlite3 has a single native build. Don't add a second plain-Node build.

## Folder layout

```
src/
  main/
    index.ts            app lifecycle, window, tray, protocol registration
    db/                 schema.ts, client.ts, migrate.ts, repos/*.ts
    domain/             PURE logic, no Electron/IO: postState, slots, picker, templates,
                        series, quota, publishAt, syncWindows, clipNaming, errors
    google/             oauth (loopback + PKCE), youtube client wrapper (quota log + Dry Run), errors
    twitch/             auth (auth code + device code fallback), helix client, rate limiter
    jobs/               runner, clipSync, backfill, clipDownload, planner, upload, statusSync, cleanup
    media/              ffprobe, render (vertical presets), frame grab, cdmedia protocol
    secrets/            safeStorage encrypt/decrypt
    ipc/                handle() wrapper + handlers per area
    notify.ts, logger.ts (redacting), power.ts (powerSaveBlocker refcount)
  preload/index.ts      exposes window.api only
  renderer/src/
    app/, pages/, components/ (ui/ = shadcn), hooks/, stores/ (zustand), lib/ipc.ts
  shared/
    ipc/                channel contract: name → zod request schema + response type; push events
    schemas/            post, rule, settings, template zod schemas (used by renderer AND main)
    constants/          quota.ts (costs), limits.ts (title/desc/tags), defaults.ts
    types/
drizzle/                generated migrations (bundled into the app)
tests/
  integration/          daily sync + download, planner run, full upload
  mocks/                msw handlers for YouTube and Helix, fixtures
```

Unit tests sit next to the file: `foo.ts` → `foo.test.ts`.

## Conventions

- **Process boundary:** all network, disk, DB and ffmpeg work runs in main. The renderer only calls `window.api`.
- **IPC:** every channel is declared once in `src/shared/ipc`. Main registers it with `handle(channel, fn)`, which zod-parses the payload and rejects bad input. Push events (upload progress, job state, sync progress) also go through typed channels. Don't add ad-hoc `ipcMain.on`.
- **Window security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, navigation and `window.open` blocked. Local media reaches the renderer only through `cdmedia://`, which only serves paths under the clip folder, the render folder, or files referenced by a post.
- **Post status:** only `postsRepo.transition(id, event)` writes `posts.status`, and it uses the pure `nextPostStatus()` in `domain/postState.ts`. States: `draft, needs_approval, queued, rendering, uploading, processing, scheduled, published, needs_decision, failed, waiting_quota, canceled`.
- **Never-twice:** partial unique index `posts(clip_id, account_id) WHERE clip_id IS NOT NULL AND status <> 'canceled'`. Don't work around it in code.
- **Pure domain layer:** time, slots, picking, templates, quota and error classification are pure functions with injected `now` and zone. Unit-test them there.
- **Time:** store UTC; display local time plus relative time ("in 3h 20m"). The quota day and `waiting_quota` retry use `America/Los_Angeles` midnight.
- **Secrets:** refresh tokens and the Twitch client secret are stored as `safeStorage` ciphertext in SQLite. Decrypt only where the value is used. Never put them in IPC responses, logs, event_log, backups or errors.
- **Logging:** use `logger` (redacts `access_token`, `refresh_token`, `client_secret`, `code`, `Authorization`). Log API calls as method + ids + status, never full auth headers.
- **TypeScript:** strict. No `any` without a comment saying why. Prefer discriminated unions for job/step results.
- **UI:** confirm dialog on every destructive action; helpful empty states; Cmd+N opens a new post; dropping a video anywhere opens the editor with it filled in.
- **Jobs:** idempotent and resumable. Persist progress (video id, backfill cursor, step status) before moving on. A job holds the power-save blocker through `power.ts` refcounting.

## YouTube API rules

- Scheduling: upload with `status.privacyStatus = "private"` and `status.publishAt` (RFC 3339 UTC, in the future). `publishAt` only works with private.
- Required on insert: `snippet.title`, `snippet.categoryId`, `status.privacyStatus`, `status.selfDeclaredMadeForKids`.
- Limits: title ≤ 100 chars, description ≤ 5000 bytes, neither may contain `<` or `>`; tags ~500 chars total.
- `videos.update` replaces the whole part you send. Always `videos.list` the current part, change what you need, and send the whole part back.
- Quota belongs to the Google Cloud project and is shared by all channels. `videos.insert` uses its own bucket (100 calls/day). Everything else shares 10,000 units/day: list = 1; `videos.update`, `videos.delete`, `thumbnails.set`, `playlistItems.insert` = 50. Both reset at midnight Pacific. Costs live only in `src/shared/constants/quota.ts`; log every call to `quota_usage`.
- Errors handled by name: `quotaExceeded`, `uploadLimitExceeded` (no retry → `waiting_quota` until next Pacific midnight), `invalidPublishAt`, `invalidTitle`, `invalidDescription`, `forbidden` on thumbnails (channel not verified), `youtubeSignupRequired`, `invalid_grant` (→ account needs re-auth, pause its jobs, banner + notification). Network errors and 5xx retry with exponential backoff + jitter, 5 attempts max.
- Unverified API projects: Google says (Nov 2, 2026) uploads are no longer forced to private. If a public/unlisted upload still comes back locked private, show the API compliance audit message and don't retry.
- Save `youtube_video_id` the moment insert succeeds; never insert a post that already has one.
- Status sync: `videos.list` part=status,processingDetails, ≤ 50 ids per call.
- OAuth: Desktop client from imported `client_secret.json` (copied to userData, gitignored), loopback on 127.0.0.1 random port, PKCE S256, `access_type=offline`, `prompt=consent`, scopes `youtube.upload` + `youtube`. Persist new tokens on the `tokens` event. The consent screen must be **In production**, or refresh tokens die after 7 days.
- Dry Run: the YouTube wrapper logs method + payload and returns a fake response. No Google HTTP calls.

## Twitch API rules

- Every Helix call sends `Client-Id` and `Authorization: Bearer <token>`.
- Auth: Authorization Code flow with a Confidential app (redirect `http://localhost:17563/twitch/callback`) is primary. Device Code flow (public client) is the fallback; its refresh tokens are one-time use and expire after 30 days. Always store the newest refresh token (rotation). On refresh failure, mark needs re-auth and pause sync.
- Scopes: `channel:manage:clips` when signing in as the broadcaster, `editor:manage:clips` when signing in as an editor. Request only the one needed.
- Get Clips: exactly one of `broadcaster_id`, `game_id`, `id`. `ended_at` defaults to `started_at` + 1 week. `first` max 100. Results are ordered by views and capped at ~1,000 per query, so always query in time windows (≤ 7 days; split further if a window gets close to the cap). Page with `after` until the cursor is empty. Upsert by clip id.
- Sync window: last successful sync − 2 days → now (`vod_offset` can take minutes to fill in; overlap also refreshes view counts).
- Get Clips Download: `GET /helix/clips/downloads?editor_id&broadcaster_id&clip_id` (1–10 ids). `editor_id` must equal the token's user id; 403 = not an editor. Clips it can't access are silently left out → mark "Not downloadable". `landscape_download_url` / `portrait_download_url` may be null and are temporary: fetch them right before downloading. 100 requests/min.
- Rate limits: read `Ratelimit-Remaining` / `Ratelimit-Reset`; back off on 429.
- Clip files: `<clipsRoot>/<login>/<YYYY>/<YYYY-MM>/<YYYY-MM-DD_HHmmss>_<clip_id>_<slug>_<landscape|portrait>.mp4` (UTC `created_at`), with thumbnail and `.json` sidecar alongside. Download to a temp file → ffprobe verify → atomic rename.

## Packaging gotchas

- `asarUnpack` ffmpeg-static, ffprobe-static and better-sqlite3. Resolve binary paths with `.replace('app.asar', 'app.asar.unpacked')`.
- Ship `drizzle/` as an extra resource and run migrations at startup.
- Unsigned dmg: first launch via right-click → Open.
