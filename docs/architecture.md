# Architecture and data boundaries

Status: current-state inventory plus remaining target; slice 3 implements the opt-in remote-first public bundle path described below. [Requirements](specs.md) govern scope; [ADR 0002](adr/0002-github-content-publication.md) records the publication recommendation.

## Current system

React/TypeScript/Vite serves public/staff routes; Rust/Axum owns validation and APIs. SQLite stores legacy operations/subscriptions and private lost-and-found data. File-backed event/site/wayfinding stores coexist with optional `LIVE_CONTENT_REPO` operations publishing, which can include an editorial bundle. Local-first Git commits can be served before remote push. The separate opt-in `LIVE_CONTENT_REMOTE_REPO` mode uses a dedicated bare repository, remote confirmation, complete validation and one durable last-good bundle; it never checks out application code. Google Admin/Super staff access is implemented with explicit legacy/demo compatibility. See [publication/migration guide](git-publishing.md).

See [main router](../server/src/main.rs), [operations](../server/src/operations.rs), [site](../server/src/site.rs), [lookup](../server/src/wayfinding.rs), and [current feature notes](README.md). These are migration inputs, not a reason to silently remove working subscriptions, editors, routes or data.

## Target ownership

| Data | Authoritative source | Publicly served? |
| --- | --- | --- |
| English UI/editorial text, event/date/timezone, schedule/delays, guide/FAQ/help, notices | Live GitHub repository | Yes, subject to scheduled display rules |
| Buildings/floors/rooms, route graph, public images, alt text, map attribution | Same repository | Yes; verified metadata required |
| Derived translations and validated render bundles | Rebuildable cache keyed by source revision | Only public fields; never a new source of truth |
| Full ContestDojo import, mappings, local lookup index | Private persistent storage | Only the explicit room-only lookup projection |
| Lost-and-found reports, contacts, staff notes, email outbox | Private persistent storage | Submitter's opaque receipt/delivery state only; no public inbox |
| Subscription addresses and delivery history | Private existing store | No; preserve unsubscribe semantics |
| Staff accounts/roles/sessions, credentials, private audit metadata | Private storage/secrets | Authenticated least-privilege endpoints only |

The application repository is currently **private** (verified via GitHub metadata in this docs pass); “public content” means data intended for visitors, not a change to repository visibility. Committed scheduled announcements are visible to repository readers before their display time. If the repository ever becomes public, its history also becomes exposed. Keep sensitive drafts and private operational data out of publishable content files. Wi-Fi credentials may only be published if organizers intentionally authorize them as public guest information.

## Recommended file layout

Keep the existing `content/` directory in `berkeleymt/live.berkeley.mt` rather than rename to `contents/` or require another repository. Ian allowed an equivalent file format/folder; migration churn offers no visitor benefit. Target layout (not all files exist):

```text
content/
  manifest.json          # content schema version and supported bundle inputs
  event.json             # identity, date, timezone, event metadata
  operations.json        # schedule, delays and public notices
  site.json              # navigation, help, FAQ and general content
  guide/*.md             # English long-form sections
  ui/en.json             # remaining public UI labels and messages
  wayfinding.json        # buildings, floors, rooms and route graph references
  maps/*.json            # public route geometry/verified connections
  media/*                # approved images/floor plans with metadata
```

Use JSON/Markdown initially to match the existing validators and human-editable files. A content schema migration replaces the current duplicated editorial bundle; do not leave multiple authoritative copies. An admin form must cover every editable public field, including alt text, upload replacement and structured route data, while preserving direct file edits. UI structure/behavior remains application code; text and images do not require a code edit.

The implemented slice-3 v1 bundle is deliberately narrower than this future layout: manifest, operations, event, site and wayfinding JSON plus hash-named PNG/JPEG/WebP media. Long-form Markdown and current editable copy stay in `site.json`; separate guide/ui/map-graph formats are not accepted yet. Existing schema constraints remain, and remaining hard-coded public copy still needs editorial migration. No automatic migration rewrites current files.

## Publication pipeline

```text
admin form or authorized human/AI file edit
 -> preview + full validation against base content revision
 -> Git commit / branch workflow allowed by repository protection
 -> successful push/merge to canonical GitHub ref
 -> background content fetch, validate complete revision and assets
 -> atomic immutable bundle activation
 -> cache revalidation -> public reads
```

- Use the existing application repository as origin, but a separate read/write work area for content. Never pull into the running application source tree or execute code/hooks from fetched content.
- The private repository requires authenticated server-side fetches; grant the reader only needed repository access and separate publishing permissions where possible. Store credentials privately, verify webhook signatures, and never give browser visitors GitHub credentials or a raw clone endpoint.
- Fetch at a bounded interval; authenticated webhook notification may accelerate it but is not the sole mechanism. No Git command in visitor requests. Proposed freshness objective: valid remote content visible within 30 seconds normally; measure before claiming an SLA.
- Validate allowed paths, supported schema, all files, asset references, cross-file IDs, dates/timezone, schedule intervals and map graph before activation. Reject traversal/symlinks escaping the bundle, unsafe Markdown/URLs, unbounded files and unknown private fields. No half-updated schedule/map/guide.
- Source commit SHA identifies the bundle. Optimistic editing also uses a content digest so a code-only commit need not lose an unrelated draft. Compare the relevant base files, never force-push over someone else's edit.
- Serialize admin publishers. A non-fast-forward push retains the draft, reports conflict and requires refresh/reconciliation. Direct authorized file pushes go through the same consumer validation.
- Repository branch protection remains authoritative. Slice 3 supports permitted normal pushes and retains a pending draft on rejection. It does **not** create PRs, sign commits or automate required checks; a required-PR branch needs the approved external merge workflow. Automatic proposal creation remains future work. Never bypass policy or pretend a pending commit is live.
- GitHub is canonical: a local commit is not “published.” During a failed push, keep the draft and existing public revision. Display Draft / Awaiting merge or push / Remote revision / Loaded revision separately, with a useful failure reason. This deliberately differs from the current local-first demo.
- Roll back by a new validated revert/restore commit; no rewriting history or deleting unrelated code. Out-of-order fetch jobs must not activate an older candidate after a newer one.
- Content-only changes need no image build/restart in remote mode. CI filtering is separately opt-in via Actions variable `LIVE_CONTENT_RUNTIME_RELOAD=true`, only after verifying runtime migration. Default build-on-push remains compatible; opted-in content-only changes skip build/deploy, while code/dependency/schema-support changes and manual dispatch build. No workflow/deployment run was performed in slice 3.

## Media, translation and AI editing

Persist public images/maps in Git alongside metadata and validate limits/rights before publishing. Current runtime uploads must be migrated; an uncommitted container file is not a portable publication. Large asset limits and any later object-storage exception need a measured decision, not an implicit alternate source of truth.

Translated strings are generated from public English content and cached by source hash/locale/provider version. Never send roster or form contents for translation. Missing translation displays clearly labeled English. See [localization](localization.md).

An external authorized AI can edit files on behalf of staff; this is not a request for an autonomous agent embedded in production. For “delay 30, absorb 15 in lunch,” use the same deterministic planning rules as the admin preview, validate minimum durations and affected tests, show before/after, and commit one atomic change. A natural-language instruction is not a substitute for a reviewed diff. Do not give the public app a general shell or permit content to become executable instructions.

## Private operations and load

Retain a private database rather than eliminating storage required for reports, email, subscriptions, roster and access. Changing SQLite or replication topology is a later evidence-based decision; do not add multiple uncoordinated writers around local SQLite/in-memory sessions.

Public reads use immutable memory/cached content. Serve bundled assets with immutable hashed URLs; public JSON supports validators/cache semantics after auditing time-sensitive notice visibility. Private APIs and ID lookups are no-store and never shared-cacheable. Compute now/next locally from dated schedule + timezone; don't poll the origin just to tick a clock. Pause/back off/jitter refreshes as appropriate, keep one in-flight request and bounded timeouts. Do not introduce a stale service worker that masks urgent changes.

At 5,000 simultaneous open tabs, the current five-second live poll alone would average about 1,000 requests/second before other APIs/retries; this is arithmetic, not a load-test result. Measure traffic, payload sizes, cache hit rate and p95 latency on a separate environment before choosing polling/CDN/SSE changes. Recovery/HA is deferred, but preserving last-good content and honest stale state is basic correctness.
