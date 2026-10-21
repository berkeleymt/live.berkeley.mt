# API and content contracts

Status: API inventory from Live `0d56ff0`, with slice-1 public route/content compatibility changes on baseline `6293bbe`, slice-2 Google/People staff contracts, opt-in slice-3 remote-first publication, and slice-4 private ContestDojo/ID-only lookup, practical slice-5 graph content and slice-6 private receipt mail, followed by remaining target rules. This is not a generated OpenAPI specification, and proposed endpoints must not be presented as currently callable.

## Current endpoint inventory

Wayfinding verification now accepts `demo|unverified|mapped|verified` for buildings and graph edges. `mapped` is historical source-plan guidance: ordinary routing may use it; step-free routing must not. The server rejects mapped edges with `stepFree:true`. No new endpoint, private-data field or inferred inter-floor link is introduced. Deploy enum support before publishing mapped content. [ADR 0006](adr/0006-historical-floor-plan-guidance.md).

Exact request/response types and validation live in the linked source and existing feature notes. Preserve existing clients during migration unless a replacement/removal is agreed.

| API family | Current routes | Evidence |
| --- | --- | --- |
| Live operations | `GET /api/live`; schedule, delays, announcements mutations | [main router](../server/src/main.rs), [routes](../server/src/routes.rs) |
| Event metadata | Protected `GET/PUT /api/content`; public event metadata is included in `/api/live` | [main router](../server/src/main.rs), [event content](../server/src/content.rs) |
| Authored pages | Public `GET /api/pages`; staff `GET/PUT /api/pages/editor`, `POST /api/pages/preview`, `POST /api/pages/adopt` | [Exact syntax/API/CAS/migration](markdown-pages.md), [page server](../server/src/pages.rs) |
| Editorial | `GET /api/site`; `GET/PUT /api/site/editor`; `GET/POST /api/site/media` | [site router/types](../server/src/site.rs), [feature notes](site-content.md) |
| Map/lookup | `GET /api/wayfinding`; `POST /api/wayfinding/lookup`; `GET/PUT /api/wayfinding/editor` | [wayfinding](../server/src/wayfinding.rs), [current notes](wayfinding.md) |
| Private roster/settings | `GET/PUT /api/settings/contestdojo`; `GET /api/roster`; `POST /api/roster/{sync,mapping,clear}`; public `GET /api/rooms/status`, `POST /api/rooms/lookup` | [adapter](../server/src/contestdojo.rs), [setup](setup-contestdojo.md) |
| Lost-and-found | `POST /api/lost-found`; `GET /api/lost-found/staff`; `PATCH /api/lost-found/staff/{id}`; `POST /api/lost-found/staff/{id}/mail`; Super-only `GET /api/settings/lost-found-mail` | [report store](../server/src/lost_found.rs), [outbox](../server/src/lost_found_mail.rs), [contract/setup](lost-found.md) |
| Staff identity | session read, Google/legacy/demo login, logout and Super-only People under `/api/staff` | [staff router/types](../server/src/staff.rs) |
| Git publication | `GET /api/publishing` (status/history), `GET /api/publishing/export`, `POST /api/publishing/push`, `POST /api/publishing/restore`; remote-first `POST /api/publishing/sync`, `GET /api/publishing/pending`, `POST /api/publishing/archive`; Super-only `GET /api/settings/publication` | [publisher](../server/src/publishing.rs), [main router](../server/src/main.rs) |
| Schedule plan | `POST /api/schedule/plan/preview` and `/apply` | [planner](../server/src/planner.rs) |
| Subscriptions | `POST /api/email/subscribe`; `GET /api/email/unsubscribe` | [routes](../server/src/routes.rs), [email](../server/src/email.rs) |

Subscription responses preserve `{ok,message}` and add `emailDeliveryEnabled` (boolean): whether announcement mail is configured in this server, not a delivery guarantee. Disabled/demo instances still save subscriptions but return a saved/unavailable message, including repeat submissions. Public clients use allowlisted editable copy rather than rendering server text; old responses without the flag receive a neutral saved confirmation. Receipt mail remains a separate configuration and delivery flow.

The Markdown foundation adds one `usePages` loop (30-second healthy refresh, existing 15-second site-request timeout, one in flight, full-jitter backoff capped at 60 seconds). It validates the response shape and retains last-good pages; initial error never falls back to bundled authored examples. Page ownership, file/commit revisions and explicit conversion are documented in [Markdown pages](markdown-pages.md).

The public shell mounts one `useSite` loop (30-second healthy refresh, 15-second timeout) and one `useLiveData` loop (5-second healthy refresh, 8-second timeout). Each permits one in-flight request, retains last-good data and uses full-jitter exponential failure backoff capped at 60 seconds. Live stale indication remains after three failures (or immediately when no data has loaded); the UI exposes the last successful receive time and retry. Routes consume shell context rather than mounting duplicate loops. `/classic` and staff retain their separate hooks when visited, not behind public routes. This is not a cross-browser, offline-cache or scale guarantee. [Source](../src/data/useLiveData.ts).

## Private receipt mail (slice 6)

- `POST /api/lost-found` keeps the existing required email and all original fields. Add optional `phone` (empty default, max 80 characters) and `confirmationEmail` (boolean, default false). The current public form explicitly requests confirmation; older submissions still return exactly `{receipt}` and enqueue no mail. No old report/history/contact is deleted or automatically emailed.
- With confirmation requested, the report, receipt and private outbox row commit atomically. Response 201 contains only `{receipt,emailState}`; initial state is `queued` or `not_configured`. Identical UUID/normalized payload replay returns the same receipt and **current** state without another job; changed payload is 409. Existing omitted/default-field hashes remain compatible. No public receipt/detail/status lookup route is added; explicit client status checks replay the in-memory original submission under existing quotas.
- Email states: `queued`, `not_configured`, `sending`, `retry_wait`, `accepted`, `failed`, `uncertain`, `handled`. Accepted means a valid Postmark acknowledgement, **not inbox delivery**. Malformed/unknown responses, 500/503, transport timeouts and interrupted attempts are uncertain and never automatically resent. No provider exactly-once guarantee is assumed.
- Existing `found:read` staff list adds page `mailConfiguration`, report `phone` and nullable `delivery:{state,revision,attempts,nextAttempt,updatedAt,diagnostic,providerId,history}`. `nextAttempt` is nullable Unix seconds; history is latest 20 private staff actions. Provider response bodies/tokens are never returned. Report status/notes revision and delivery revision are separate.
- `POST /api/lost-found/staff/{id}/mail`: `found:write`, usual trusted session/capabilities/CSRF/origin, plus `X-Staff-Request:1`. JSON `{idempotencyKey,revision,action,note,confirmDuplicateRisk?}` uses the **delivery** revision; action `retry|handled`, note 5–500 characters, duplicate-risk flag default false. Body cap remains 12 KiB. Only not-configured/failed/uncertain/retry-wait jobs are actionable; uncertain retry requires explicit risk acknowledgment. Retry also requires ready configuration, a non-demo/non-synthetic report and fewer than ten total attempts. Accepted/active/legacy/handled jobs cannot be resent. Atomic action/audit + UUID/actor/body replay; conflict 409; success 200 is the current private report, never a sent assertion.
- `GET /api/settings/lost-found-mail`: Super `settings:write`; read-only deployment-owned `{status,from,replyTo,provider:"Postmark",deliveryTracking:false}` with no token. Status is `not_configured|invalid_configuration|ready`; from/reply-to are null unless ready. Both explicit addresses must have exact berkeley.mt domain. Ready is local config validity, not verified sender/delivery. Legacy subscriptions remain independent and unchanged.
- One bounded worker per durable private DB; no internal HTTP retries/redirects, 12s total timeout, 16 KiB acknowledgement cap, five automatic attempts with persisted bounded jitter/backoff, ten total including reviewed retries. Disabled configuration pauses pending jobs; re-enabling does not automatically send that backlog. No automatic deletion/retention, bounce tracking or real sender verification. [Full contract/recovery](lost-found.md), [ADR 0005](adr/0005-private-receipt-outbox.md).

## Public route and editorial compatibility (slice 1)

- Client routes: `/`, `/schedule`, `/updates`, `/map`, `/rooms`, `/guide`, `/faq`, `/help`, `/lost-found`; `/classic` is unchanged. `/directions` → `/map`, `/lookup` → `/rooms`, `/lost-and-found` → `/lost-found` preserve query/fragment on redirect. The existing static-server SPA fallback serves dedicated pages; no new API endpoint is introduced.
- Root fragments `today`, `schedule`, `updates`, `map`, `help`, `faq` redirect to their dedicated destinations. Content-authored `#schedule` / `/#schedule` and equivalents are normalized in navigation and safe Markdown; unknown/custom fragments, external URLs and guide section links are untouched.
- `SiteConfig.schemaVersion` stays **1**. Rust and TypeScript accept `/schedule` and `/updates` in the existing safe route allowlist; arbitrary routes, scheme-relative URLs, traversal and local query strings remain invalid in authored site links. Existing documents remain valid; migration is not an automatic rewrite.
- `content/site.json` supplies shell links and new `hub.*`, `schedule.*`, `faq.*` labels. Existing authored labels/order are preserved, and missing core destinations are filled from defaults so older saved documents do not hide new pages. The editor offers explicit link migration and exposes fallback copy keys for editing. Schedule/event/FAQ/announcement facts remain in their existing API/editor sources.
- Guide/Help do not render bundled example guidance as a successful publication before `/api/site` loads. First-load errors are distinct from empty content; stale pages retain the last-good publication. Report navigation enters/leaves via document links to retain the existing private-draft unload guard. No private data enters public content or URLs.

## Public copy extension (R05 integration)

- `SiteConfig` remains v1; `copy` expands from 200 to **500** keys in both validators (1–100 ASCII letters/digits/dots per key; 4000 UTF-8 bytes per value; 512 KiB document/publication bounds unchanged). Deploy client/server support together before publishing the expanded seed; older sparse documents remain valid.
- Canonical `rooms.*`, `lookup.*`, `legacy.*`, `route.*`, report-error and subscription-result keys cover current visitor UI. Plain single-pass substitutions only. Explicit empty strings and unknown valid keys are preserved; absent keys fall back to bundled canonical content. The editor's explicit missing-default merge changes only the draft, not the server document until saved.
- The optional read-only site text context uses the existing PublicLayout content and starts no pollers. Standalone/preview/bootstrap views use bundled fallback. Structured route/building/schedule/guide facts stay in their original documents.
- Public lookup/report errors select safe copy by status, never raw response/provider messages. Subscription still returns the existing `{ok,message}` contract; its widget maps fixed known results to canonical labels and never renders arbitrary message text. No HTTP shape, private storage/retry/clear behavior or legacy endpoint is removed. [Coverage and remaining exceptions](site-content.md#remaining-r05-exceptions-explicit-not-completed).

## Staff authentication and People (slice 2)

These are implemented routes, not proposals. [Operator/migration details](staff-access.md) and [ADR 0003](adr/0003-lemon-staff-parity.md) define Google vs explicit legacy/demo behavior. No Lemon token/cookie/database grants Live access.

| Method/path | Request | Success |
| --- | --- | --- |
| `GET /api/staff/session` | Optional Live cookie; visible workspace polls may send `X-Staff-Presence: 1` | Session shape below; `user: null` if absent/expired/removed |
| `POST /api/staff/google-login` | JSON `{ "credential": "GOOGLE_ID_TOKEN" }` | Verified/allowlisted Live session; rotates cookie |
| `POST /api/staff/login` | JSON `{ "username": "...", "password": "..." }`, legacy only | Legacy session; unavailable in Google mode |
| `POST /api/staff/demo` | JSON `{ "accountId": "demo-operator" }` or `demo-super`, literal demo only | Synthetic Admin/Super session; old four IDs retained only for API compatibility |
| `POST /api/staff/logout` | Current CSRF when authenticated | Revokes server session, clears cookie |
| `GET /api/staff/people` | Authenticated Super | `{ "accounts": [{ "email", "role", "picture", "fixed", "online", "addedBy" }] }` |
| `POST /api/staff/people` | Super; JSON `{ "email": "staff@example.org", "role": "admin" }` | `204`, account added |
| `PATCH /api/staff/people/{email}` | Super; URL-encoded email; JSON `{ "role": "super" }` | `204`, role changed |
| `DELETE /api/staff/people/{email}` | Super; URL-encoded email; explicit UI confirmation | `204`, account/sessions removed |

All auth/People responses use `Cache-Control: no-store`. Session JSON retains `user`, `csrfToken`, `expiresAt` (Unix seconds), `demoMode`, `demoAccounts`, `passwordLoginEnabled`, `ownerLoginEnabled`; adds `authMode: "google" | "legacy"` and `googleClientId: string | null`. User retains `id`, `name`, `role`, `capabilities`, `demo`, `authSource`, and optionally `email`/`picture`. It never returns passwords, hashes, ID tokens, session tokens, another person's CSRF or provider secrets. Demo metadata exposes only the modern two-role chooser. People metadata is Super-only and bounded to 2000 accounts.

Google roles are exactly `admin` and `super`; legacy role strings remain accepted only in legacy accounts/old synthetic APIs. Google verifies RS256 signature and bounded JWKS, issuer, audience, expiry, subject, issued-at, verified normalized email and optional authorized party before checking Live's allowlist. Normal sessions do not need Google availability. Google/modern-demo sessions have fixed 24-hour expiry; role is re-read on each protected request. Demotion is immediate for the next request; removal deletes sessions and re-adding cannot restore old tokens. Current-user/bootstrap rows and last-Super safety are enforced server-side, including transaction-time actor rechecks. Presence is advisory, only refreshed by authenticated visible-workspace polls and expires after 30 seconds; it is not authorization.

Mutation intent is `X-Staff-Request: 1`; authenticated cookie writes also require `X-Staff-CSRF`. Origin/Fetch Metadata protections apply to login, logout and People, not merely the UI. Errors use `{ "error": "actionable message" }` where handled: `400` invalid input, `401` invalid/no session or credential, `403` unlisted/forbidden or failed CSRF/origin, `404` unavailable route/account, `409` duplicate/protected row or account limit, `429` login rate limit, `503` unconfigured/verifier/storage unavailable. Framework JSON/body rejections may use framework errors; clients preserve safe fallback messaging. Unknown fields/legacy roles are rejected for People inputs. No credentials are echoed. No automatic credential or People-mutation retry is safe to assume; reconcile People after a confirmed write or refresh after uncertain transport failure.

Both modern roles retain operational capabilities (content/media, schedule/delays/updates, rooms, inbox, Git history/restore/publish). Only Super receives `people:write` and `settings:write`. `capability_for_route` protects `/api/settings` with the latter; slice 3 adds the read-only publication-configuration endpoint below. Existing operational reads never require Settings. Public projection, `/classic`, old deep links and earlier APIs remain unchanged.

## Remote-first publication (slice 3)

Opt-in `LIVE_CONTENT_REMOTE_REPO` uses the existing endpoint shapes but changes successful publication semantics deliberately: only a **remotely confirmed and fully validated** bundle becomes the successful staff save. `LIVE_CONTENT_REPO` stays local-first and unset repository variables retain SQLite/file mode. Full migration/configuration/security constraints: [git-publishing.md](git-publishing.md). No endpoint exposes Git credentials, arbitrary repository objects/files or private database rows.

| Method/path | Request / capability | Success in remote mode |
| --- | --- | --- |
| `GET /api/publishing` | `publishing:write` (Admin/Super) | Status shape below; no remote fetch, reads local diagnostics/history |
| `POST /api/publishing/sync` | `publishing:write`; staff intent + CSRF | Fetch, validate and activate the complete remote bundle; status JSON |
| `GET /api/publishing/export` | `publishing:write` | Existing loaded `Operations` JSON, with in-memory `editorial` bundle for compatibility; no media bytes; not a canonical on-disk remote bundle |
| `GET /api/publishing/pending` | `publishing:write` | `{ revision, content }`, where content is retained `Operations` plus editorial; no media bytes; 409 if no pending draft |
| `POST /api/publishing/push` | `publishing:write`; full pending SHA in `If-Match` | Retry the retained commit; `{ ok:true, revision }` only after push, fetch confirmation and activation. Local mode keeps existing push/verify contract |
| `POST /api/publishing/archive` | `publishing:write`; full pending SHA in `If-Match` | `204`; preserves commit as `refs/live/drafts/<sha>`, clears pending slot. Not publication, deletion or merge |
| `POST /api/publishing/restore` | `publishing:write`; last observed remote SHA in `If-Match`, `{ revision: "target-ancestor-sha" }` | `{ revision }` + ETag for a new forward, confirmed remote commit; preserves current application tree. Can repair an invalid remote bundle |
| `GET /api/settings/publication` | `settings:write` (Super only) | Remote `{ mode:"remote", branch, path:"content/", configuration, protection }`; compatibility modes return `{ mode, configuration }`. No mutation/settings credentials endpoint |
| Existing content/site/wayfinding `PUT` | Existing capability; `{ revision, content }` | Existing document response, revision is confirmed loaded bundle SHA; shared validator/publication path |
| Existing operations CRUD and plan/apply | Existing capability; full base SHA in `If-Match` or plan revision | Existing response/ETag shapes, one complete remote publication |
| `POST /api/site/media` | `content:write`, existing MIME/body/intent guards | Existing `201 { url, bytes }`, plus remote-only `{ revision, previousRevision }`. Append-only hash-named image commit confirms remotely before success. A matching editor can advance its CAS base only if it equals `previousRevision` |
| `GET/HEAD /media/<sha256>.<png\|jpg\|webp>` | Public | Only current loaded bundle assets; immutable cache, explicit image MIME, nosniff, restrictive CSP. No local-file fallback in remote mode |

Authenticated state/mutation responses remain no-store, with current staff capability and CSRF/origin guards. Missing `If-Match` is 428, malformed is 412; stale revision/pending/dirty-index/config conflicts 409, invalid bundle 422, bounded Git/upstream failure 503. Existing body/authorization 400/401/403/413/415 behavior remains. Plain-text bounded diagnostic bodies are allowed for publication errors; clients must not assume all errors are JSON. Unknown content and manifest fields are rejected. No authored Git message/remote stderr is returned. Retry is explicit, not an automatic mutation queue; a timeout is not proof of failure.

Status includes `mode:"remote"`, `revision` (loaded SHA), `remoteRevision` and `head` (last successfully fetched SHA, nullable), `branch`, `checkedAt` (last successful fetch RFC3339, nullable), `pendingRevision` (nullable), `digest` (loaded complete-content SHA-256), `dirty`, `locked`, `healthy`, bounded `issues`, sanitized `lastFailure`, and `history` (latest 15 content commits: revision/date/generic message). `healthy` is diagnostic, not a real-time availability guarantee; a pending commit is never shown as remote-published. Remote and loaded may differ after validation failure. Fetched/failed diagnostics reset on process restart, while loaded/pending/archive refs persist. A canonical remote advance can load without deleting a divergent pending draft.

Bundle schema v1: `content/manifest.json` contains only `{ "schemaVersion":1 }`; required `operations.json` contains schedule/delays/announcements **without** `editorial`; existing event/site/wayfinding schemas live in separate required JSON files. Optional `media/` files use SHA-256 content names, supported signatures and bounded sizes. The Markdown foundation additionally allows optional bounded regular `pages/<slug>.md` files; no other arbitrary Markdown/translation/map-graph file paths are enabled. Old v1 bundles without pages remain valid. Page source participates in the same digest/media/CAS/last-good/pending/archive/restore pipeline. Provenance/digest/check time belong to runtime status, not self-referential manifest fields. All files validate before the one loaded pointer changes. Structured site/wayfinding/graph images and rendered guide/help/FAQ/announcement Markdown require every local `/media/` destination to exist in that bundle (query/fragment suffixes excluded from the asset key). Markdown parsing resolves reference-style destinations, escapes and entities. External HTTPS URLs containing `/media/`, ordinary text and code spans do not become local asset dependencies. Missing assets return 422 before editor publication or direct-file activation. Full base SHA maps to a complete content digest for CAS, so code-only remote changes can be preserved without invalidating a draft; all content changes conflict. Separate public HTTP reads may straddle activation, and returned revision fields expose that rather than promising a multi-request transaction.

## ContestDojo and ID-only rooms (slice 4)

These routes are implemented. Private settings/rows live only in `LIVE_CONTESTDOJO_DB`, separate from staff identity and all public publication modes; no roster/token is included in public Git/export/history. Full operational bounds, activation/migration and normalization: [setup-contestdojo.md](setup-contestdojo.md). Types: [Rust](../server/src/contestdojo.rs), [client](../src/features/wayfinding/rosterApi.ts).

| Method/path | Request / authorization | Success |
| --- | --- | --- |
| `GET /api/settings/contestdojo` | `settings:write` (Super only) | `{enabled,demo,revision,eventId,tokenConfigured,autoSync,autoAllowed}`; no token echo |
| `PUT /api/settings/contestdojo` | Super, `{revision,eventId,autoSync,token?}` | `{saved:true}`; absent/null token retains, empty removes, nonempty replaces; event changes invalidate public provenance and reset mappings |
| `GET /api/roster?offset=0` | `rooms:write` (Admin/Super) | Private diagnostics below, up to 50 raw rows; offset clamped to 20,000 |
| `POST /api/roster/sync` | Admin/Super, no required body | Updated roster diagnostics after atomic successful import; required-source/storage errors keep last-good rows |
| `POST /api/roster/mapping` | Admin/Super, `{revision,mapping}` | `{saved:true}`; mapping is `{idColumn,fields,roomColumns,roomAliases}`; unknown columns/tests/targets rejected, blank/None allowed |
| `POST /api/roster/clear` | Admin/Super, `{confirm:"CLEAR"}` | `{cleared:true}`; only local rows/provenance cleared, enabled auto-sync may repopulate |
| `GET /api/rooms/status` | Anonymous, no private parameters | `{available,mode,stale,checkedAt,demoId}`; mode demo/contestdojo/legacy/unavailable; demoId is the public synthetic ID or null, no count/event/token |
| `POST /api/rooms/lookup` | Anonymous same-origin JSON `{studentId}` only, 4 KiB limit | `{assignments:[{scheduleId,round,startTime,endTime,roomId,status}],checkedAt,stale,demo}`; `roomId` null and status unmatched when no unique public target; otherwise matched |

Roster diagnostics: `mode,configured,syncing,autoSync,revision,snapshotEvent,eventMatches,stale,attemptedAt,checkedAt,syncedAt,count,notes,error,nextAttempt,columns,mapping,missingIds,ambiguousIds,unmatchedRooms,unmatchedRoomCount,missingColumns,rows,offset,schedule`. Times are Unix seconds (nullable where not yet checked). `ambiguousIds` counts duplicate normalized-ID groups; `unmatchedRooms` is bounded to 100 **private source labels**. `rows`/`columns`/settings must never be passed to public content or translation. Revision changes on settings/mapping/clear/new snapshot, not identical rows.

Protected writes require existing live staff capability/CSRF/origin checks and `X-Staff-Request: 1`; cookies use current `X-Staff-CSRF`. All protected responses are no-store. Public lookup/status responses additionally use `private` and `Referrer-Policy: no-referrer`, including errors. Module errors are `{message}`; outer staff errors retain `{error}`, and bounded framework JSON rejections remain framework errors. Expected errors: 401 absent staff, 403 role/origin/intent/CSRF, 404 generic invalid/ambiguous public ID, 409 busy or stale revision, 422 invalid settings/mapping, 429 lookup/sync cooldown, 502 required provider failure, 503 unavailable storage/config/snapshot. A timed-out mutation is not queued or retried automatically; reload private status and reconcile.

Public IDs are not authentication. No raw ID, name, team, school, contact, custom column, raw provider response or token appears in the success allowlist. Public status has no roster enumeration. Per-test participation/room cells determine which schedule items appear; start/end are published scheduled times, not delay-adjusted timer values. A removed or mismatched public room produces an unmatched/help-desk state, never a guessed map. Public responses do not currently carry an atomic cross-request public-bundle revision; separately loaded content may straddle publication and the client treats missing room references as unresolved.

The legacy `/api/wayfinding/lookup` request/response and private-file provider remain unchanged; the new UI falls back only when new import is disabled and a legacy private file exists. ID-only UI clears private details on hide/unmount, keeps them out of URLs/storage, and uses no automatic retry or external translation. New schema does not promise privacy against someone who already knows a valid student ID; review proxy/shared-campus abuse controls before activation.

## Public route graph (practical slice 5)

Optional nullable `WayfindingContent.graph` adds `{demonstration,maps,nodes,edges}` in the **existing** `/api/wayfinding` and editor/publication contracts. Absent graph preserves pre-graph files and written routes. Maps/nodes/edges have stable IDs, directed transitions, bounded geometry/costs, closures, explicit step-free metadata and verification notes. Rust validation is authoritative and shared with canonical bundle publication; raw staff JSON is not trusted. No new graph API/store or arbitrary file path is introduced. Full field/bound contract and honest missing/demo states: [wayfinding.md](wayfinding.md#configurable-route-graph-practical-slice-5).

Client routing excludes closed/unverified edges and stairs/non-step-free segments in step-free mode. Demo segments work only in demonstration graphs. Missing connectivity/images/room nodes never cause invented routing. Published graph is a page snapshot with explicit reload, not live closure monitoring. Graph closures do not rewrite independently authored written routes. Real verified map/accessible-route inputs and operational acceptance are **still absent**.

## Public schema status and remaining proposals

| Entity | Essential fields/invariants |
| --- | --- |
| Content manifest | Implemented v1 contains only `schemaVersion`; revision/check time/digest are runtime status, not manifest fields; full-bundle validation |
| Event/schedule | stable event/test IDs, event date + IANA timezone, ordered intervals, explicit delay references; never rely only on time of day |
| Notice | stable ID, English title/body, severity, publication/display/expiry times and public links; future display does not hide a commit from repository readers |
| Building/floor/room | stable IDs, canonical label/aliases, floor/entrance references, map asset + alt text, verification provenance |
| Routing graph | Practical schema implemented above; verified November data, closure operations and field/accessibility acceptance still required |
| Lookup response | assigned test/room references plus public bundle provenance; never a raw roster row |
| Receipt | Implemented above: opaque report reference and optional honest confirmation-email state; never public retrieval of report contact/details |

Future cross-bundle provenance example only (not the implemented lookup response above):

```json
{
  "assignments": [{ "testId": "power", "roomId": "example-room" }],
  "contentRevision": "example-public-commit"
}
```

Names, team/school identifiers, contact fields and the lookup ID itself are intentionally absent. Joining those room references to public schedule/maps should be consistent with the returned content revision; report an unresolved reference rather than show a wrong location.

## Target mutation and error rules

- Server authenticates and authorizes every protected action. Hidden buttons are not authorization. Cookies require secure deployment, appropriate SameSite/HttpOnly protections, CSRF and origin checks.
- Editorial mutations carry a base revision; stale changes return conflict and preserve the browser draft. Never last-write-wins a schedule change silently.
- Public report submission and retriable protected mutations use stable idempotency keys. Same key with different content is a conflict, not a second action. Scope keys so one user's action cannot collide with another's.
- Bound bodies, text, lists, search results and uploads; enforce content types and structured validation before writing. Return field errors without echoing secrets or private rows.
- Use stable semantic errors for not configured, unauthorized/forbidden, invalid input, stale revision, rate limit and upstream failure; include retry guidance when safe. `200` means success, not a swallowed mutation failure.
- Keep report/roster/session responses private and no-store. Shared HTTP caches may contain public bundles only. Cache time-sensitive notice representations no longer than their next display transition.
- Version incompatible public content schemas, stage readers before switching writers, and test rollback compatibility. Publish schema/type changes with server + client + fixtures together; this docs pass adds no fictitious `PROTOCOL_VERSION` to code.

## Contract tests required with implementation

Cover allowed/denied roles, malformed and oversized input, stale revision, repeated requests, source/schema mismatch, public projection privacy, old/new content compatibility, invalid bundles, future notices and failures after persistence but before a client receives the response. Exact endpoint methods and JSON keys become normative only when the code and tests land together.
