# Private lost-and-found slice

**Integrated:** the public form, capability-protected private inbox and audit workflow are now wired into the real application with separate private storage. The wiring instructions below are retained builder-stage notes, not outstanding work. See [demo.md](demo.md) for current operation and verification.

Requested scope: a public lost/found report form and a private staff processing inbox for the November 14, 2026 tournament. This module does not touch Lemon, timers, email subscriptions, announcements, schedule/delays, or Git publishing. No new dependencies are required; SHA-256 uses the already-declared `sha2 = "0.10"`.

## Integrator wiring (shared files intentionally not edited)

1. Add `mod lost_found;` in `server/src/main.rs`.
2. Add this field in `routes::AppState`:
   ```rust
   pub lost_found: Arc<crate::lost_found::LostFoundStore>,
   ```
3. Provision a durable **private directory outside the checkout, content repository, and STATIC_DIR**, owned by the server account (directory mode 0700 recommended). Its parent must already exist. Read the existing shared `PRIVATE_DB_PATH` setting, or use an explicit private path, then construct:
   ```rust
   let private_path = std::env::var("PRIVATE_DB_PATH")
       .unwrap_or_else(|_| "/data/private/live.sqlite".into());
   let demo_mode = std::env::var("DEMO_MODE").as_deref() == Ok("true");
   let lost_found = Arc::new(
       lost_found::LostFoundStore::open(private_path, demo_mode)
           .expect("Cannot initialize private lost-and-found storage")
   );
   ```
   Add `lost_found` to the `AppState` initializer. `open(path: impl AsRef<std::path::Path>, demo_mode: bool) -> Result<LostFoundStore, String>` uses its own namespaced SQLite tables (`lf_reports`, `lf_history`, `lf_meta`), so the private path can also contain other private modules' tables. Initialization creates missing module tables; it does not overwrite reports. SQLite work in handlers runs through `spawn_blocking`. On Unix, the database file is restricted to 0600; secure the directory, backups, and any pre-existing journal/WAL files too. This is not application-level encryption.
4. Merge these exported, independently state-bound routers into the existing `Router<AppState>`:
   ```rust
   .merge(lost_found::public_router(state.lost_found.clone()))
   .merge(lost_found::admin_router(state.lost_found.clone())
       .route_layer(/* trusted staff-session/capability middleware */))
   ```
   Both constructors are `pub fn ...<S: Clone + Send + Sync + 'static>(store: Arc<LostFoundStore>) -> Router<S>`. Do **not** put the private routes through the Git mutation/publishing middleware; private report changes must never become public Git commits.
5. For `/api/lost-found/staff` and `/api/lost-found/staff/{id}`, trusted authentication middleware must insert this request extension after verifying the server-side session and current account capabilities:
   ```rust
   request.extensions_mut().insert(lost_found::LostFoundAccess {
       actor: authenticated_account_id_or_email, // stable trusted audit identity
       can_read: capabilities.contains("found:read"),
       can_write: capabilities.contains("found:write"),
   });
   ```
   `LostFoundAccess` has exactly these three public fields: `actor: String`, `can_read: bool`, `can_write: bool`. GET requires read; PATCH requires write. Assign read alongside write for normal processing roles. No extension → **401**, insufficient capability → **403**. Blank/oversized actor identifiers also fail closed. Never construct this extension from a public header, query, body, or client role claim. The old permissive-when-unconfigured Basic Auth middleware by itself does **not** grant access to this module. Keep the staff session's usual CSRF/origin checks, secure cookies, revocation checks, and same-origin CORS policy; hiding the sidebar is not authorization.
6. Serve using socket peer information:
   ```rust
   axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
   ```
   Missing connect information is safe but all clients share the `unknown-peer` rate bucket. Forwarded headers are deliberately ignored; see rate limits below.
7. Frontend imports:
   ```tsx
   import { LostFoundPage, LostFoundInbox, defaultLostFoundCopy } from "./features/lost-found";
   import type { LostFoundCopy } from "./features/lost-found";
   ```
   Public: route `/lost-found` under the normal public shell, with `<LostFoundPage copy={publishedCopy} helpHref="/#help" />` (adjust help link to the final help route). `copy?: Partial<LostFoundCopy>` and `helpHref?: string` are its exact props. All public editorial labels/help/privacy/success copy are supplied through the module-local `LostFoundCopy` shape and `defaultLostFoundCopy` defaults. Add these strings to the shared file/admin content schema/editor during integration; this builder intentionally did not edit shared editorial files. Technical validation/network-recovery messages are not content records.

   Staff: route `/admin/lost-found` in the existing staff shell, visible with `found:read`, rendering `<LostFoundInbox canWrite={capabilities.includes("found:write")} />`. Exact prop: `canWrite?: boolean` (default false). The backend remains authoritative. Both components also have default exports in their individual files for lazy imports, import their module CSS, and work without new providers. API base follows existing `VITE_API_URL` convention (strip the trailing `/live`, otherwise `/api`). Keep the API same-origin with staff cookies. Private data is never cached in localStorage, sessionStorage, IndexedDB, bundles, exports, logs, or service-worker caches by this module.

## Wire contract

### Public submit

`POST /api/lost-found`, JSON, maximum **12 KiB** request body:

```json
{
  "idempotencyKey": "<client-generated UUID v4>",
  "kind": "lost",
  "description": "Synthetic example: blue bottle with a star sticker",
  "location": "Demo room entrance",
  "occurredAt": "November 14, 2026, about 9 am Pacific",
  "name": "",
  "email": "synthetic-person@example.invalid"
}
```

- `kind`: exactly `lost` or `found`; unknown keys/types rejected.
- `description`: 5–2000 characters; `location`: 2–200; `occurredAt`: 2–120. Approximate times are accepted as plain text rather than inventing an exact timestamp. “Unknown” is usable when the location/time is uncertain.
- `name`: optional, default empty, maximum 100 characters. Email is **required**, maximum 254 ASCII bytes; common email syntax is validated, not mailbox ownership/delivery. A parent/guardian email can be used. No minimum name requirement.
- Whitespace is trimmed; control characters are rejected except ordinary text newline/tab. Email does not allow whitespace/header injection. Plain text is stored and rendered as escaped React text, never raw HTML or interpreted Markdown.
- Success: **201**, exactly `{"receipt":"<opaque random UUID>"}`. No item, email, name, status, internal report id, or notes in public responses. The receipt is a reference for speaking with staff, **not** a bearer secret or unauthenticated readback token. There is no public listing/detail/readback route.
- An identical retry with the same UUID returns the same receipt, even after staff updates. Reusing that key with changed normalized input returns **409**. The frontend retains the key and original payload in memory and locks edits after uncertain results; retry resends the same report. It never queues reports for later, automatically retries in a loop, or saves contact details to browser storage. Reloading loses the in-memory key; a before-unload warning helps avoid accidental resubmission. Staff should be consulted rather than submitting a second report when the outcome remains uncertain.
- Invalid JSON/types/unknown fields generally return **400/422** (Axum extraction); semantic validation **422**; oversize **413**; rate-limited **429**; storage unavailable **503**. Errors are generic and do not expose SQLite paths or other reports. No email is sent on submission.

### Private staff list

`GET /api/lost-found/staff?q=bottle&kind=lost&status=new&limit=20&offset=0`

- Optional exact kind/status filters; statuses `new`, `found`, `contacted`, `resolved`.
- `q` maximum 100 characters; literal substring search over description/location/name/email/receipt. SQL parameters bind all input and LIKE wildcard characters are escaped. Search **URLs contain private search terms**: do not log query strings on these routes, and redact them from monitoring. This component does not put search terms in browser navigation/history.
- Default limit 20; accepted 1–50, offset 0–10000. Invalid enum/query syntax returns 400; range errors 422. Newest first, deterministic id tiebreak. Response: `{ reports, total, limit, offset, demoMode }`.
- Each report includes `id`, `receipt`, `kind`, `description`, `location`, `occurredAt`, `name`, `email`, `status`, `notes`, `createdAt`, `updatedAt`, `revision`, `synthetic`, and `history`. History contains only the **latest 20** updates per report; older audit records remain in the private database. No unbounded record endpoint or public export.

### Private update

`PATCH /api/lost-found/staff/{id}`:

```json
{
  "idempotencyKey": "<client-generated UUID v4>",
  "revision": 1,
  "status": "contacted",
  "notes": "Synthetic example: staff manually reached out."
}
```

- Status must be one of the four values. Notes are required as a string, maximum 4000 characters (and subject to the 12 KiB body cap).
- Any status can be corrected later. `found` means located; `contacted` means a staff member actually reached out; `resolved` means returned/closed. **Status never means an automatic email was sent.**
- Response 200 is the updated private report. Revision conflict 409 prevents silently overwriting another staff member's work. An exact retry of an already-committed update returns the current report without adding an audit entry. Reuse of its request key with a different actor/id/payload returns 409. Status, notes, trusted actor and revision history commit atomically.
- The staff inbox has explicit Save, Discard, refresh/retry, filters, pagination, empty/loading/error/success states, latest history, and accessible contact actions. Unsaved edits pause inbox navigation; uncertain saves retry the same request. A conflict message asks staff to preserve notes, discard the stale draft, and refresh before merging changes.
- **Open email draft** uses a URI-encoded `mailto:` link to the reporter. Nothing is sent or marked contacted on click. Synthetic demo fixtures disable the contact link. The site's Postmark integration is not used here.

Both routers set `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`. Keep staff page/asset/API access logging free of bodies, query strings and PII; do not add telemetry that captures form fields. A service worker must explicitly exclude `/api/lost-found*`.

## Rate limits and proxy handling

Limits are process-local (this application runs one server), bounded in memory, and reset on process restart. Public requests count before JSON extraction, including malformed/oversized attempts. Buckets are retained for at most 30 minutes and capped at 4096 entries; the cap fails closed for new keys.

- **60 requests per socket peer IP per 10 minutes**, plus **1000 public requests globally per 10 minutes**. These intentionally allow several students behind a campus NAT.
- **5 new reports per contact email per 30 minutes**. Contact keys are SHA-256 hashes with a random per-process salt, not plaintext in the limiter. Exact idempotent retries bypass the contact quota (but not request-level peer/global quotas).
- 429 includes a conservative `Retry-After: 1800`. The UI explains waiting or asking at the help desk rather than claiming success.
- `Forwarded`, `X-Forwarded-For`, and similar arbitrary client headers are **never trusted**. Behind a reverse proxy, all traffic can share the proxy's socket-peer bucket (60 requests/10 minutes for the entire proxy). This is a deliberately safe default, not a claim to detect end users. Before public launch, configure an allowlisted proxy/edge to strip incoming forwarding headers and enforce appropriately sized edge quotas; if client-IP forwarding is added later, it must be verified against trusted socket peers in server middleware and regression-tested. Never just parse the leftmost forwarded value. An attacker cannot evade the current peer quota by changing a header.

## Synthetic demo and real dependencies

`DEMO_MODE=true` (exact, lowercase) seeds **two explicitly marked fictional reports**, with `example.invalid` contacts and demo-only locations. Seeding is transactional and once per private database (`lf_meta.demo_v1`); subsequent starts never overwrite reports/status/notes. With demo mode off, a fresh database is empty. Turning demo mode off does not delete already-stored synthetic rows; each remains visibly marked so existing data is never silently destroyed.

Runnable demo after wiring: provision a private path, launch the existing app with `PRIVATE_DB_PATH=<that private SQLite file> DEMO_MODE=true`, sign in as an authorized staff account, visit `/lost-found` to submit a fictional report, then `/admin/lost-found` to search, update, audit, and resolve it. No real credentials, rosters, reports, or email-service dependency is needed. Real operation needs only the provisioned private volume, configured staff authentication/capabilities and a staffed contact process; actual contact email delivery uses the staff member's email app/account, not a claimed live API integration. Choose a retention/deletion policy, backup access and operator ownership before collecting real records; this slice deliberately has no destructive/delete/export UI.

## Verification

Run `node --test tests/lost-found.test.mjs` from the repository root. It creates a temporary Cargo harness importing **the actual Rust module**, builds/tests it with existing dependencies, launches its own loopback-only servers on ephemeral ports and temporary private databases, and removes/stops only those test-owned resources. It can run before shared main/routes integration. Its `x-test-role` header exists **only in the generated test harness**; never copy that adapter into production authentication.

Coverage: seven Rust module tests (validation, opaque/idempotent receipts, optimistic updates/audit, bounded search, read/write authorization, abuse quotas, opt-in additive demo seed); eight socket/API subtests (public privacy/readback denial, validation/body cap, capability matrix, audit/replays/conflicts, search/pagination, database reopen/demo seeds, contact limits, spoofed forwarding headers); one frontend helper test (no-store/credentials/timeout, safe error messages, mailto encoding). The API suite plus its containing test are reported by Node alongside the unit-test subtest. The test harness uses a separately named binary, not the normal server executable, and updates only its temporary Cargo manifest/lockfile.

Verified: `node --test tests/lost-found.test.mjs` (11 Node tests including the containing suite/unit-test gate, all pass; the gate runs seven Rust unit tests), `npx eslint src/features/lost-found tests/lost-found.test.mjs`, module-scoped TypeScript checking, full-app `npx tsc -b`, and `rustfmt --edition 2021 --check server/src/lost_found.rs`. Full-app TypeScript was initially blocked by a concurrently edited `src/Admin.tsx` import of the not-yet-created `PublishingPanel`; it passed on rerun once that shared work appeared. No UI-driven E2E tests, testing agents, existing process restarts, production calls, branch changes, commits or pushes were performed by this builder. Rerun the integrated production build/authentication tests after the barrier. Browser/mobile/screen-reader behavior still needs authorized rehearsal; responsive CSS and explicit labels are not a claim of browser validation.
