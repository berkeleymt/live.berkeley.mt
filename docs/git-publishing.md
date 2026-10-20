# Git-backed schedule, delays and announcements

> **Current implementation / historical builder notes.** This document describes the opt-in, dedicated-checkout, local-first publisher. It does not implement the newly approved GitHub-authoritative requirement. See [architecture](architecture.md) and [proposed ADR 0002](adr/0002-github-content-publication.md) for the same-repository runtime-reload target. Do not point the existing `LIVE_CONTENT_REPO` at the app checkout; that requires an implementation change. Git history exposes future committed notices to repository readers even before their display time; the application repository is currently private.

**Integrated:** the real application now enforces named staff permissions, and the complete demo adds optional `editorial: { event, site, wayfinding }` to `operations.json`. A restore replaces this complete bundle too; operations-only files remain compatible. Exact-revision multi-event preview/apply is implemented in Git and SQLite modes. The integration instructions/follow-ups below are historical builder-stage notes, not the current status. See [demo.md](demo.md) for the unified workflow and remaining launch gates. `npm run test:api` now runs all feature and real-router integration suites.

This is an **opt-in local publisher**, not automatic remote backup. With `LIVE_CONTENT_REPO` unset, existing SQLite CRUD, subscription and email behavior remain the default. Operations-only Git files leave editorial content file-backed; the integrated optional `editorial` bundle also versions event details/FAQ, site and wayfinding content. It never controls Lemon timers.

## Enable or migrate

1. Use the authenticated staff **Download operations.json** action. This exports schedule, delays and all announcements, including future editorial drafts. It does **not** export email subscribers, email delivery logs, staff accounts, lost-and-found reports or student records.
2. Review the export. Create a **separate dedicated Git checkout**, commit `operations.json` at its root, and keep that checkout on durable storage. Never point at the application checkout. The app rejects checkouts containing application manifests. A normal checked-out branch and an existing valid committed file are required; an unborn/detached checkout or invalid startup HEAD fails closed.
3. Have an operator configure the server's Git identity and any noninteractive remote authentication through the normal deployment process. The application never configures an identity. Do not put credentials in files, Git URLs, content or browser bundles. Exactly one `origin` push destination is supported; a separate `pushurl` is verified at its actual destination.
4. Set `LIVE_CONTENT_REPO` to the absolute checkout root and configure named staff authentication as described in [staff access](staff-access.md). The existing legacy `ADMIN_PASSWORD` fallback remains implemented pending an agreed access migration. Restart through the deployment owner, not an editor. `PORT` can be overridden for local isolated tests. Do not configure production credentials for a demo.
5. Inspect **Schedule & update publishing**. Verify the local SHA and clean status. A browser save writes `operations.json`, commits it, and only then makes the snapshot public on this server. Other clients see it on their normal refresh.
6. If a remote is desired, configure `origin` outside the app and explicitly press **Push current publication to origin & verify**. Success means a normal, non-force push completed and `ls-remote` confirmed the pushed branch at that instant. No background push/fetch occurs. A local commit, stale tracking ref or merely configured remote is never reported as a verified backup.

Keep SQLite on durable storage too: subscribers and email deduplication remain there even in Git mode. Switching back to SQLite does not import Git changes; SQLite retains its own last schedule/update state. Before switching back, perform a deliberate data migration rather than assuming automatic reconciliation.

## File schema and visibility

`operations.json` contains `schedule`, `delays` and `announcements`, plus an optional `editorial: { event, site, wayfinding }` bundle, using the existing camelCase API models. Maximum serialized content size is 1 MB; limits are 300 schedule entries, 300 delays and 1,000 announcements. IDs are unique, nonempty ASCII letters/digits/`-`/`_` (up to 100 bytes). Titles and bodies support Unicode. Unknown nested fields are rejected, not silently dropped. IDs, content fields, timestamps, categories and effective start/end times are validated before writing.

- Schedule entries require a title, location string, `startTime`/`endTime` in `HH:mm` with end after start, and `general`, `individual`, `team` or `ceremony` category. A PUT is a **full object**, not a one-field patch. Optional descriptions are preserved by the editor.
- A delay references an existing event and has at least one replacement time. There is at most one delay per event; effective end must follow start. Stored title/original times must agree with the event. Deleting a schedule entry removes linked delays. Updating its title/original times keeps those fields consistent.
- Announcements require nonempty title/body, RFC3339 timestamp and `normal`/`urgent` priority; `pinned` and `scheduledAt` are optional. Scheduled announcements become public when due, without another commit. Staff creation uses an explicit date/time input labeled with the browser's time zone, rather than silently scheduling on today's date.
- Public `at` and `include_future` parameters cannot bypass scheduling. Authenticated staff can preview future editorial content. Future delay timestamps are also kept from public responses.
- Schedule and update ordering matches legacy API expectations. Markdown continues to render with raw HTML disabled.

Unknown-field validation is not a privacy scrubber: never put private records into the content checkout at all. Restoring a later public file does not remove private information from earlier Git history. Git remotes containing future announcements must be staff-only until those drafts can be disclosed.

## Concurrency, failures and recovery

The server serializes its Git writes and checks a full `If-Match` SHA, the configured branch, HEAD, the index lock and the entire working tree. It rechecks for intervening edits before the atomic file rename. A stale/dirty save returns 409; missing `If-Match` returns 428 and malformed revisions return 412. Validation errors return 422. Full successful CRUD responses carry `ETag`; the live response also includes `operationRevision` and `ETag`. An unchanged PUT or identical restore is a successful no-op with no empty commit.

Use **one server writer per checkout**. External operators may edit and commit files, but must coordinate with staff: no concurrent manual Git/index/worktree writes during an API save. A filesystem checkout cannot make arbitrary uncooperative external writes transactional. Do not use sparse checkout, assume-unchanged/skip-worktree flags, content-altering filters or hooks for this file.

- A direct valid commit becomes public on the five-second reload poll. An uncommitted edit is never used as public data. Dirty/staged/untracked files block API writes and push, and are never reset or discarded by the app.
- A bad later commit leaves the last valid in-memory publication visible. Staff status distinguishes invalid HEAD, pending reload, dirty tree, branch changes, unavailable Git/history, index locks and the last failed save. **Restarting with invalid HEAD does not recover an old commit automatically**: fix/restore it first.
- Git commands have a five-second local timeout, push/remote verification twenty seconds each, and lock acquisition five seconds. On Unix, timed-out Git process groups (including hooks) are killed so a sleeping hook cannot later make an unexpected commit. Git can leave an index lock on timeout. The app reports it and **never removes it automatically**. An operator must first verify that no Git process remains, then remove only a confirmed stale lock using the normal Git recovery procedure.
- Write/commit failure may leave the intended new file staged or unstaged. Keep the browser draft and inspect the retained checkout changes. Review and commit them deliberately; do not use reset/checkout/clean to make the warning disappear. Refresh the public revision before retrying a timed-out request, because a commit may have completed before the response was lost.
- **Restore** takes the HEAD shown in staff status as `If-Match` (which may differ from the published SHA when HEAD is invalid), validates an ancestor's file, and creates a forward commit on the same branch. This can repair a clean invalid/missing operations file. It refuses a dirty/locked checkout and never resets, switches branches or force-pushes. Only the latest 15 operation-file commits are offered in the UI.
- Restore replaces all three lists. Previously sent email cannot be retracted. Old scheduled announcements may now be due. The existing SQLite email log prevents resending already-sent announcement IDs; Git-mode due announcements are picked up by the existing fifteen-second email task. Postmark delivery itself is not exercised by these tests.

Admin saves use one mutation in flight, bounded fetches and no automatic resend. Each draft captures its own operation revision; the separate EventEditor cannot change that revision. Enter only blurs an inline field, so Enter plus blur cannot double-submit. Non-2xx/timeouts do not close or clear drafts. Refresh keeps drafts, including the active editor for an externally removed item; compare current values and explicitly accept the reviewed revision before retrying. Undo is still available for delete actions, and includes announcement scheduling/pinned fields. Legacy event-delete Undo re-adds the event with a new ID; it does not recreate deleted linked delays.

## API and integration wiring

The assigned shared files already contain this wiring; retain it while adding other modules:

- `main.rs`: `mod operations; mod publishing;`.
- `AppState`: `pub operations: Option<Arc<crate::operations::OperationsStore>>`.
- Constructor: `OperationsStore::open(PathBuf).await` wrapped in `Arc`, only when `LIVE_CONTENT_REPO` is nonempty; otherwise `None`. Preserve the five-second `reload()` task and the Git-aware announcement-email polling branch.
- `GET /api/publishing` → `publishing::status`; `GET /api/publishing/export` → `publishing::export`; `POST /api/publishing/push` → `publishing::push`; `POST /api/publishing/restore` → `publishing::restore` with JSON `{ "revision": "<full target SHA>" }`.
- Existing schedule/delay/announcement CRUD routes are intercepted by `publishing::operations_mutation` only in Git mode. Keep authentication **outside** this middleware so it executes first. All staff routes and live responses use `routes::no_store`.
- `get_live` overlays one immutable operations snapshot and emits the same revision in body/header. Preserve its authenticated future-preview gate. It currently checks Basic Auth; named-role integration must replace this with the actual staff identity/permission check, not just hide UI controls.
- Keep staff mutation/export/push/restore protected by backend authorization when roles are introduced. Publishing currently has the same administrative privilege as legacy CRUD. The existing no-password SQLite development behavior is unchanged; do not deploy it without the integrating staff-auth gate.
- CORS is now same-origin (Vite already proxies `/api`). Do not restore credentialed wildcard/reflected-origin CORS around staff routes.
- Frontend: named export `PublishingPanel` from `src/components/PublishingPanel.tsx`; props `{ request: (method, path, body?, expected?) => Promise<boolean>, disabled: boolean, revision?: string }`. It is already imported/rendered by `Admin`. `LiveData.operationRevision?: string` already exists. `EventEditor` remains separately mounted and unchanged by this slice.

No new dependencies were added by this work. The shared lockfile was initially stale, then changed during parallel work; the final normal `cargo test --locked` passed. Integration should retain/review that shared lockfile update. This builder did not edit either dependency manifest or lockfile.

## Verification

Normal commands after the shared dependency lock is regenerated:

```sh
cargo test --locked --manifest-path server/Cargo.toml
cargo build --locked --manifest-path server/Cargo.toml
node --test tests/api.test.mjs tests/git-publishing.test.mjs
npx eslint src/Admin.tsx src/components/PublishingPanel.tsx
npm run build
```

**Package script follow-up:** change `test:api` from only `tests/api.test.mjs` to `cargo build --manifest-path server/Cargo.toml && node --test tests/api.test.mjs tests/git-publishing.test.mjs` (or equivalent). No package script was edited in this builder stage.

For builder verification without changing a shared stale lockfile:

```sh
LIVE_PUBLISHING_ISOLATED_BUILD=1 node --test tests/git-publishing.test.mjs
```

That test option copies sources, content fixtures and manifests into a temporary build project; only its lockfile is updated. It runs Rust unit tests and builds the test binary offline from cached dependencies using the existing target directory. API tests use disposable checkout/database directories, the existing global Git identity, an ephemeral local server port and a **local bare remote only**. They never override identity, use production credentials, access the network for Git, or stop an existing server. The temporary test servers are stopped by their own cleanup hooks.

Builder verification passed: 12 Rust tests, 18 combined Node API tests, 9 existing schedule tests, changed-file ESLint, TypeScript and the Vite production build. Full ESLint still reports exactly the six known errors in `ExpandableOverlay.tsx` and `LiveFeed.tsx`; none were suppressed. The first timeout-recovery test exposed a retained Git index lock; the implementation now diagnoses it and the test exercises explicit operator recovery rather than deleting locks automatically.

Coverage includes legacy CRUD in both modes, no-op/validation/Unicode, authentication and future-post privacy, subscriber isolation, atomic visibility while a hook holds a commit, stale/concurrent writers, invalid later commits, invalid startup, retained dirty drafts, hook timeout/lock diagnosis, direct valid commits, due-time visibility without a new commit, restart persistence, restore including a missing operations file, and explicit push success/rejection/verification. No browser-driven end-to-end tests or real Postmark/Git-host integration are claimed.

## Required follow-ups, not claimed complete

- Add the pure multi-event plan/preview for **“delay 30 minutes, let lunch absorb 15”**, then an explicitly reviewed atomic application flow. The existing single-event delay and “apply to next event” tools are preserved; they are not an absorption planner.
- Integrate named staff roles/session checks with the routes and future-preview gate above. Only the integration owner commits/pushes or changes deployment files.
- Rehearse actual deployment storage mounts, remote authentication/permissions, approved email delivery, and browser/mobile/keyboard behavior with the relevant approvals. Confirm the public schedule and event metadata for **November 14, 2026** with the editorial/fixture owners; this slice does not invent a real November timetable.
