# Public content publication

> **Implementation and compatibility reference, not production activation.** Remote-first publication is opt-in; local Git/SQLite behavior remains supported. See [current status](status/STATUS.md) for evidence and remaining GitHub/storage/migration requirements.

The Markdown foundation adds individual page files to all modes without changing manifest v1. See [exact page syntax, editor, migration and recovery](markdown-pages.md). `operations.json` remains structured; a `pages` map in an export is a backup representation, not its on-disk canonical format. Local mode retains `refs/live/local-loaded` for invalid-HEAD restart recovery.

## Remote-first mode — slice 3

Implemented as an **explicit opt-in**, alongside unchanged SQLite and local-first Git modes. [Protocol](protocol.md#remote-first-publication-slice-3), [ADR 0002](adr/0002-github-content-publication.md), [implementation](../server/src/remote_content.rs). Local bare-remote tests are not evidence of production GitHub credentials, rules, storage or deployment readiness. This work performs no production migration or remote write.

### Mode selection and deployment ownership

| Configuration | Source / save semantics |
| --- | --- |
| Neither repository variable set | Existing SQLite operations and file-backed editorial/media stores |
| `LIVE_CONTENT_REPO=/absolute/dedicated/worktree` | Existing local-first Git mode below; local commit becomes live, explicit push is separate |
| `LIVE_CONTENT_REMOTE_REPO=/absolute/dedicated/bare.git` | New remote-first mode; fetched canonical branch is authoritative, successful staff save requires confirmed push and validated activation |

Setting both repository variables fails startup. `LIVE_CONTENT_BRANCH` selects the remote branch (default `main`); only ASCII letters/digits, `-`, `_`, `/` and valid Git branch syntax are accepted. Runtime configuration is **Super/deployment-owned**, not editable by Admin or stored in browser fields. Both modern staff roles can do normal content/media/schedule/direction edits and publication recovery. `GET /api/settings/publication` is Super-only and returns mode/branch/path/operating guidance, not credentials, checkout paths or origin URLs.

Prepare a **new full, non-shallow bare Git repository** on durable private storage, outside the app checkout and public/static paths. Configure exactly one `origin` with the same fetch/push URL: `https://github.com/OWNER/REPOSITORY.git` or `git@github.com:OWNER/REPOSITORY.git`. The intended origin remains `berkeleymt/live.berkeley.mt`; no repository split is required. Do not use `--mirror`, alternates, symlinked Git internals, filters, a shared worktree or an untrusted Git configuration. Absolute canonical checkout paths are required. The loader verifies bare mode, branch and origin and refuses unexpected index/index-lock/shallow files; it never removes them. A separate push destination is refused. The server's service account needs Git, an explicitly configured commit name/email and noninteractive credentials/SSH host verification from the deployment owner's existing secret-management process. Neither this documentation nor the application requests credentials. Git stderr, commit messages, identity and remote URLs are not exposed in API diagnostics.

**Exactly one process owns a runtime repository.** The mutex serializes that process's publishers/fetches, not multiple processes or arbitrary operator changes to Git internals. Do not share the bare directory between replicas or edit its index/config/refs while Live runs. Operators/AI edit and commit in a separate authoring checkout and use the approved remote workflow. The loader uses `ls-tree`/`cat-file` and Git object/ref plumbing; it never checks out, resets or executes fetched application files, follows content symlinks, runs content hooks, force-pushes or changes branches. Root tree entries outside `content/` are preserved byte-for-byte in editor commits, including a competing code-only change.

`LIVE_CONTENT_ALLOW_LOCAL_REMOTE=true` permits absolute local-path origins **only for disposable synthetic fixtures**. It is off by default, never needed for GitHub and must not be enabled in production. Tests use this setting with temporary bare origins, not a real repository/network push.

### Explicit migration — no automatic overwrite

1. Back up existing SQLite/private data, local Git history and runtime uploads through the deployment owner's process. Inventory the actual loaded public revisions and keep editorial browser drafts. Do not replace private storage or export it to Git.
2. Export **Download operations.json**, and the loaded event/site/wayfinding documents from the existing editors. The export may contain `editorial: { event, site, wayfinding }`; split those documents into their canonical files and **remove** `editorial` from the remote `operations.json`. If the export has `pages`, write each entry as a separate `content/pages/<slug>.md` and remove `pages` from `operations.json` too; do not substitute bundled page defaults for installed content. If the export is operations-only, use the actual loaded file-store documents, not bundled demo defaults. JSON exports omit image bytes. Review scheduled announcements: repository readers can see them before public display time.
3. In an authorized authoring checkout, prepare exactly this complete bundle; unknown paths under `content/` fail validation:

   ```text
   content/manifest.json       # exactly {"schemaVersion":1}
   content/operations.json     # schedule, delays, announcements; no editorial duplicate
   content/event.json          # existing EventContent schema
   content/site.json           # shared SiteConfig v1; legacy Guide/Help retained
   content/wayfinding.json     # existing WayfindingContent v1
   content/media/<sha256>.png  # optional PNG, .jpg or .webp assets
   content/pages/<slug>.md     # optional bounded public Markdown/TOML pages
   ```

   The current source checkout is **not automatically a valid remote bundle**: `manifest.json`/`operations.json` must be prepared from reviewed data, and `content/bmt-2026.example.json` must be deliberately relocated outside the canonical tree (retain it as an example, do not delete history). Future `guide/`, `ui/`, `maps/` formats are not silently accepted by v1. Preserve existing code/schema files outside this tree.
4. Copy approved PNG/JPEG/WebP uploads into `content/media/`, naming each by the lowercase SHA-256 of its actual bytes plus `.png`, `.jpg` or `.webp`. Update all `/media/...` references, including Markdown and wayfinding images, to those names. Keep correct alt text, rights and verification provenance. Remove private EXIF/location metadata before authoring; the server checks signatures/size/hash, **not** image decoding, malware, rights or metadata privacy. SVG/HTML uploads and executable modes are rejected. Existing approved external HTTPS images and application-bundled assets remain supported; their external availability is not guaranteed by bundle validation.
5. Review/validate on a separate local fixture/staging process; arrange the allowed remote merge with the repository owner. Only then enable the new server environment. No automated importer/reset/branch switch exists. Startup requires either a valid fetched bundle or a previously validated durable `refs/live/loaded`; without either, it fails closed instead of serving demo data. Local file stores must still initialize from valid configured/bundled files, but after binding they are not remote publication sources.
6. Inspect **Public content publishing**: loaded SHA, last-observed remote SHA and time, pending draft, validation/outage issues, history and explicit sync/restore actions. Verify content and public media on every serving instance before considering migration complete. The current implementation is one writer; multi-replica coordination/HA is not provided.
7. **Only after runtime reload is enabled and verified**, set the repository Actions variable `LIVE_CONTENT_RUNTIME_RELOAD=true`. The workflow then skips image build and deployment for pushes changing only `content/**`. Code/schema/workflow/dependency changes, unknown diffs and manual `workflow_dispatch` still build normally. Without this variable, existing build-on-push behavior remains. Filtering runs before build/deploy concurrency so a skipped content update cannot cancel a code build. This workflow was edited/tested locally only; no Actions run or deployment was triggered. For rollback to a compatibility mode, first turn this variable off and deliberately migrate the latest public data; no reverse import happens automatically.

### Validation, atomicity and failure recovery

- Every consumer (direct remote file changes, editor saves, uploads, restore) validates the same complete candidate. Files must be regular `100644` blobs; symlinks/submodules/executable blobs, missing required files, unknown fields/paths, invalid schemas/cross-references and unsafe authored URLs fail. Limit: five JSON files plus 200 images, 25 MiB aggregate, 1,000,000 bytes per JSON and 5 MiB per image, plus existing tighter document/list limits. Every local `/media/` destination in structured site/wayfinding/graph images or rendered guide/help/FAQ/announcement Markdown must resolve in the bundle. Markdown destinations are parsed (including reference-style links, escapes and entities); query/fragment suffixes do not change the asset name. External HTTPS URLs containing `/media/`, plain-text mentions and inline code are not local asset references. No private tables/accounts/subscribers/reports/rosters are read by this exporter. Validation is not a scrubber: never author private information into public text or image bytes.
- An immutable in-memory bundle is swapped only after all files validate. `/api/live` obtains event metadata and operations from that same snapshot; site/wayfinding/media read the shared pointer without Git. Separate HTTP requests can naturally straddle an activation; compare returned revision tokens if a future client needs cross-request consistency. Existing JSON `no-store`, scheduled-notice gates, public refresh loops and email deduplication are unchanged; media gets immutable content-hash URLs.
- One background fetch is in flight. Healthy intervals use jitter of 0.5–15.5 seconds; failures use full jitter with an exponentially increasing cap up to 60 seconds. Each Git command has a 20-second timeout and bounded stdout; lock acquisition is 2 seconds. Unix failed/timed-out process groups are killed. No public request runs Git; staff actions do not automatically resend. Browser public-content writes allow up to 90 seconds, but uncertain responses must still be reconciled by status/refresh. No freshness SLA or load result is claimed.
- Editors send full base SHA (existing document `revision` or operations `If-Match`). The server fetches the current canonical ref and compares the **whole content digest** against the base; unrelated root/code-only changes are preserved and do not discard drafts. A content change conflicts with 409. Saves validate, create a forward commit with the fresh remote parent, retain it in `refs/live/pending`, then attempt a normal non-force push and fresh fetch. Only an exact confirmed remote SHA is activated as the successful staff save. A semantically unchanged JSON document preserves its original bytes; identical saves/restores are no-ops.
- Push rejection, outage after commit or a race retains the Git draft and leaves last-good public data. A failure before a commit exists leaves the browser draft; download it rather than navigating away. `refs/live/pending` and `refs/live/loaded` survive restarts and protect their objects from normal GC. Startup revalidates loaded data and tolerates fetch/validation failure only with that last-good state. Preserve the entire bare repository on durable storage; losing it loses pending/archive/last-good state. Corrupt loaded objects fail closed and need operator recovery; this is not disaster recovery.
- Status is last observed, not a claim of current GitHub availability. Invalid remote revisions are shown separately from loaded SHA; pending is not remote-published. Refresh diagnostics, **Fetch and validate remote**, download retained JSON, retry retained publication, or explicitly archive it. Archive creates `refs/live/drafts/<sha>` and clears the pending slot without deletion/publication. The JSON download omits media bytes; an authorized operator can recover them from the retained commit's `content/media` in the dedicated repository. Archived refs are operator-managed, not an automatic garbage-collection policy or in-app draft browser.
- A non-fast-forward pending draft is not rebased/merged automatically. Download it, retain/archive the commit, load current content and reconcile deliberately, or have an authorized operator merge it externally. A valid newer remote revision can load while a pending draft remains. The pending slot clears automatically only when the exact pending SHA is observed at the canonical ref; an external squash/rebase/descendant merge requires explicit archive after review.
- **Protected branch limitation:** Live does not create PRs, wait for check suites, sign commits or bypass required reviews/signatures/checks. Normal pushes that policy allows work; required-PR/signature/check policies may reject every staff save. Drafts remain recoverable and the public bundle stays valid, but direct editor-to-live publication under such policies needs an approved external merge workflow. Resolve policy before activation, without weakening protection merely to make the UI succeed.
- Restore chooses a valid ancestor and creates a new forward remote commit, preserving current root application files. Its `If-Match` is the last observed remote SHA, even if that SHA has an invalid bundle; this allows repairing invalid content. Restore is blocked by a pending draft until explicitly resolved. Prior email cannot be retracted; old scheduled announcements may now be due and normal delivery deduplication still applies.

### Evidence and honest remaining scope

`tests/remote-content.test.mjs` uses only temporary bare origins: automatic direct-file poll, editor commit/confirmation, code-only preservation, full-bundle CAS, invalid/symlink/private-field commits, media, local rejection, restart/last-good, non-fast-forward, outage, retained/archive recovery and role boundaries. Existing SQLite/local Git fixtures remain in `npm run test:api`. Browserless publishing component checks and build-filter unit/CLI tests run in `npm test`. See the [stage log](status/log/2026-10-20-github-publication-slice-3.md) for exact runs. No browser/E2E, GitHub/provider/protection or production storage/Actions test was performed.

All existing editable event/site/operations/wayfinding fields and uploads use this path when enabled, including the optional route graph added in practical slice 5. Routed public copy integration is implemented, but **R05 is not fully complete**: see the [explicit classic/server email/library/bootstrap exceptions and migration](site-content.md). Translation and real route/accessibility verification remain open. This loader does not pretend arbitrary new schema/layout files are editable. Publication settings remain deployment-owned guidance, not a Git credential-management UI; private ContestDojo settings use their separate capability-protected store.

## Local-first Git mode — retained compatibility / historical builder notes

The following describes `LIVE_CONTENT_REPO`, **not** the remote-first mode above. Never point it at the app checkout. Git history exposes future committed notices to repository readers even before their display time; the application repository is currently private.

**Integrated:** the real application now enforces named staff permissions, and the complete demo adds optional `editorial: { event, site, wayfinding }` to `operations.json`. A restore replaces this complete bundle too; operations-only files remain compatible. Exact-revision multi-event preview/apply is implemented in Git and SQLite modes. The integration instructions/follow-ups below are historical builder-stage notes, not the current status. See [demo.md](demo.md) for the unified workflow and remaining launch gates. `npm run test:api` now runs all feature and real-router integration suites.

This is an **opt-in local publisher**, not automatic remote backup. With `LIVE_CONTENT_REPO` unset, existing SQLite CRUD, subscription and email behavior remain the default. Operations-only Git files leave editorial content file-backed; the integrated optional `editorial` bundle also versions event details/FAQ, site and wayfinding content. It never controls Lemon timers.

## Enable or migrate

1. Use the authenticated staff **Download operations.json** action. This exports schedule, delays and all announcements, including future editorial drafts. It does **not** export email subscribers, email delivery logs, staff accounts, lost-and-found reports or student records.
2. Review the export. Create a **separate dedicated Git checkout**, commit `operations.json` at its root, and keep that checkout on durable storage. Never point at the application checkout. The app rejects checkouts containing application manifests. A normal checked-out branch and an existing valid committed file are required; an unborn/detached checkout or invalid startup HEAD fails closed.
3. Have an operator configure the server's Git identity and any noninteractive remote authentication through the normal deployment process. The application never configures an identity. Do not put credentials in files, Git URLs, content or browser bundles. Exactly one `origin` push destination is supported; a separate `pushurl` is verified at its actual destination.
4. Set `LIVE_CONTENT_REPO` to the absolute checkout root and configure named staff authentication as described in [staff access](staff-access.md). The existing legacy `ADMIN_PASSWORD` fallback remains implemented pending an agreed access migration. Restart through the deployment owner, not an editor. `PORT` can be overridden for local isolated tests. Do not configure production credentials for a demo.
5. Inspect **Public content publishing**. Verify the local SHA and clean status. A browser save writes `operations.json`, commits it, and only then makes the snapshot public on this server. Other clients see it on their normal refresh.
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
