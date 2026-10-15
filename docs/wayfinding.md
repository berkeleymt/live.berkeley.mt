# Rooms, entrances and private student lookup

**Integrated:** public/staff routes, private lookup and capability checks are now wired. The complete demo publishes public directions through the Git editorial bundle; private assignments never enter it. The wiring instructions below are retained builder-stage notes, not outstanding work. See [demo.md](demo.md) for current operation and verification.

This slice is a self-contained Rust module plus React screens. It does not change schedule, delay, announcement, subscription or email code. The builder has **not wired the shared application routes**; the integration owner must complete the wiring below. No new dependency was required.

## Public data and editorial workflow

`content/wayfinding.json` is the public source. `WAYFINDING_CONTENT_PATH` selects a different file when the application constructs the store. The file contains page copy, buildings and aliases, `[latitude, longitude]` coordinates, entrances and their access notes, floors, rooms, standard/step-free route steps, optional floor-plan images and optional percentage-based room hotspots. All building/floor/entrance/room IDs are stable, unique ASCII letters/digits/`-`/`_` (1–64 bytes). Private assignments reference **room IDs**, not room names: do not rename or delete assigned room IDs without coordinating the private import.

- Buildings carry `demo`, `unverified` or `verified` status and a required verification note. Mark verified only after an authorized on-site check of the entrances, routes, access restrictions and image. Record who checked it and when. This is an editorial assertion, not an automatic accessibility certification.
- The supplied Demo Learning Center and A101/A102 are fictional. Its illustrative SVG repeatedly says demonstration, not Dwinelle, and not to scale. Dwinelle and Wheeler are only approximate unverified building markers, with no invented floors or rooms. Replace these with checked information before a real event.
- A step-free route must reference an entrance explicitly marked accessible; missing step-free information is displayed as unavailable, never inferred from the standard route.
- Images need nonempty alt text and a caption. Accepted URLs are HTTPS without credentials, or `/media/…` and `/demo-maps/…` paths using only ASCII letters, digits, slash, dash, underscore and dot, with no `..`, encoding, query or fragment. `data:`, `javascript:`, protocol-relative and credential-bearing URLs are rejected. Any `/demo-maps/` image must be marked `demonstration: true`. Use approved images; remote images can disclose visitors' IPs to their hosts. Self-host real floor plans in `/media/` when possible.
- Limits: 512,000-byte JSON file, 50 buildings, 12 entrances/building, 20 floors/building, 100 rooms/floor, 1,000 rooms total, 12 steps/route and 500 bytes/step. Fields and aliases also have bounded sizes. Unknown fields are rejected at every level. The browser prevalidates raw JSON; the server is authoritative.
- Staff can edit form fields or raw JSON and download a draft. Neither editor mode accepts private roster fields. Schema validation is **not** a privacy scrubber: staff must never put private information into names, descriptions or images.

The server reloads valid direct file edits on public/editor reads. Invalid later edits keep the last valid in-memory public snapshot visible with a warning; invalid startup content fails startup. `PUT` includes the revision from the initial `GET`. The server checks that revision against disk, validates, takes a cooperative `wayfinding.json.lock`, writes a temporary file, syncs it, rechecks disk and atomically renames it. Stale/invalid disk content returns 409 without overwriting it. One server writer per file is recommended. External file writers must coordinate and use the same lock or avoid concurrent saves: arbitrary uncooperative disk writers cannot be made transactional by a file API. After a crash, an operator must confirm that no writer remains before removing a stale `.json.lock`; the app never removes an existing lock automatically.

**This editor saves the public JSON file; it does not commit, push or claim Git backup.** The separate operations Git publisher handles `operations.json`, not this file. Operators may review and commit public wayfinding files through the normal source/content deployment workflow. Do not place this editor's file inside the operations checkout without designing the shared publishing transaction: uncommitted files there correctly block operations publication. A timed-out save may have completed: download the draft and load the latest revision before trying again. A conflict keeps the draft and requires an explicit replacement/reconciliation.

The public room finder searches building names/aliases, floor names and room names/codes. The optional campus map loads only when requested; it makes OpenStreetMap tile requests and never requests geolocation. Written directions remain usable if the map/image is unavailable. The TakeTransit link delegates transit planning to `https://taketransit.berkeley.mt/`; this feature does not duplicate a transit planner.

## Student privacy and demo mode

`POST /api/wayfinding/lookup` requires `{ "studentId": "…", "checkInCode": "…" }`. A student ID alone is **not authentication**. Successful responses contain only source metadata and assignments: `{ "source": { "mode": "private_import", "sourceLabel": "…" }, "assignments": [{ "round": "…", "roomId": "…" }] }`. Demo source metadata also contains the intentionally public synthetic credential. Real names, contacts, teams, check-in codes, roster arrays and provider tokens never leave the provider. Unknown IDs and bad codes receive the same generic denial. Unknown IDs still perform a dummy code-hash calculation.

- `DEMO_MODE=true` (literal, case-sensitive) activates only the synthetic provider. Unset, `1` and other values do not. Public lookup metadata then includes the visibly synthetic `DEMO-1001` / `DEMO-CHECKIN-2026` credential and a demonstration source label. These are not real student credentials.
- Demo mode refuses any simultaneous `PRIVATE_ROSTER_PATH`. Outside demo mode with no private import, lookup is explicitly unavailable; public directions still work.
- Private credentials are POSTed, not placed in URLs, local/session storage, analytics or logs. The client uses component memory, clears credentials after success, clears results/credentials on tab hiding, aborts outstanding work, and never queues or automatically retries them. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Configure reverse-proxy/APM logging to exclude lookup bodies and never cache this API.
- Lookup requests are limited to 4 KiB. Five failures/student ID, 60/peer IP or 600/global within ten minutes block further attempts, with `429` and `Retry-After: 600`. The student key is a SHA-256 digest; the fixed-window table refuses new attempts above 4,096 entries (at most three keys can be added per failure). Limits are process-local and deliberately conservative, not a distributed anti-abuse service. An attacker can temporarily deny a guessed ID; the help-desk recovery path is intentional. Restart resets limits.
- Supply Axum `ConnectInfo<SocketAddr>` when serving. Without it all callers share the conservative `unknown` peer bucket. Forwarded-IP headers are not trusted. Behind a proxy, all traffic may share its peer bucket: configure and review a trusted-proxy policy/rate limiter before a real event instead of accepting arbitrary `X-Forwarded-For`.
- Public lookup and staff mutations reject cross-site/origin-mismatched requests. Preserve the public Host through the reverse proxy. Do not add credentialed wildcard CORS. The staff session layer additionally requires its own CSRF token.

## Private import / ContestDojo boundary

`AssignmentProvider` abstracts metadata and credential verification. `PrivateImportProvider::open(path)` validates an imported snapshot and keeps it server-only in memory. `PRIVATE_ROSTER_PATH` must be an absolute regular file outside application/content Git checkouts and static assets. The loader resolves symlinks and rejects ancestor directories containing `.git`, `package.json` or `Cargo.toml`, and files under `STATIC_DIR` or `LIVE_CONTENT_REPO`. A suitable deployment location is a separately mounted, access-controlled `/run/bmt-private/assignments.json`, **not** this repository, `content/`, `public/`, `dist/`, or a Git publishing checkout. Use owner-only permissions and encrypted/private backups. Path checks are defense in depth, not a substitute for deployment permission review.

The import is at most 5 MB and 20,000 students; each student has 1–12 assignments. Imported student IDs must be uppercase ASCII letters/digits/`-`/`_` (1–64 bytes); lookup trims and uppercases IDs. Lookup trims surrounding code whitespace but otherwise compares codes exactly. Imported codes must be high-entropy random private values, not student numbers, names, birthdays, short PINs or reused passwords. Distribute them through a genuinely private channel. The private provider accepts 12–128-byte codes. Only salted SHA-256 code digests are imported; raw codes are never stored in the file. SHA-256 here is suitable only for high-entropy random codes, **not** human passwords.

Schema (values below are placeholders, not a usable import):

```json
{
  "version": 1,
  "source": "contestdojo_export",
  "generatedAt": "2026-10-15T00:00:00Z",
  "students": [
    {
      "studentId": "PRIVATE-STUDENT-ID",
      "codeSalt": "32 lowercase hexadecimal characters",
      "codeHash": "64 lowercase hexadecimal characters",
      "assignments": [{ "round": "Individual round", "roomId": "stable-public-room-id" }]
    }
  ]
}
```

`source` is `private_import` or `contestdojo_export`. `generatedAt` must parse as RFC3339. Each assigned room is checked against the current in-memory public content during lookup; missing or removed rooms yield the same generic denial instead of a broken/private detail. Restart/reconstruct the store through the deployment owner to activate a replacement import or revoke/rotate codes; the private file is not hot-reloaded.

Code digest algorithm: SHA-256 of UTF-8 `salt + ":" + uppercaseStudentId + ":" + checkInCode`, encoded as lowercase hexadecimal. Salt is exactly 32 ASCII hexadecimal characters. For example, an operator-side import generator can use Python's standard library:

```python
import hashlib, secrets
code = secrets.token_urlsafe(24)  # deliver privately; never print into CI/server logs
salt = secrets.token_hex(16)
student_id = "PRIVATE-STUDENT-ID"  # uppercase canonical ID
digest = hashlib.sha256(f"{salt}:{student_id}:{code}".encode()).hexdigest()
# Persist only studentId, codeSalt=salt, codeHash=digest, assignments in private storage.
```

The official schema was reviewed at <https://api.contestdojo.com/openapi.json> and <https://api.contestdojo.com/docs>. It describes authenticated event/student endpoints using a Firebase bearer token, including `/events/{event_id}/students/`. `EventStudent` includes `number`, `customFields` and an untyped, read-only `roomAssignments` object. That does not establish which ID BMT will use, how room keys map to stable public IDs, how organizers grant export authorization, or a private public-check-in-code issuance flow. No private token or actual event/roster was supplied or requested.

Therefore `contestdojo_export` is honestly labeled **“Private ContestDojo export · imported snapshot, not a live connection.”** There are no ContestDojo calls on the event-day request path. An authorized operator must export, minimize, map approved round/room IDs and issue private random codes into the documented private format. A future live adapter still needs authorized credentials, event ID, agreed ID/room mapping, privacy/retention policy, failure/staleness behavior, and rehearsal approval. This slice does not claim any of those dependencies are complete.

## Exact integration contract

### Server (integration owner)

1. Add `mod wayfinding;` to `server/src/main.rs`.
2. Add `pub wayfinding: Arc<crate::wayfinding::WayfindingStore>` to `routes::AppState`.
3. Initialize once and fail startup on invalid configuration:

```rust
let wayfinding = Arc::new(wayfinding::WayfindingStore::from_env(
    std::env::var("WAYFINDING_CONTENT_PATH")
        .unwrap_or_else(|_| "content/wayfinding.json".into())
        .into(),
).expect("Invalid wayfinding configuration"));
```

4. Include it in `AppState`. Both router exports return state-resolved `Router<()>`; merge after resolving the host router's `AppState`, or use a separately assembled state-resolved router:
   - `wayfinding::public_router(state.wayfinding.clone())`: `GET /api/wayfinding`, `POST /api/wayfinding/lookup`.
   - `wayfinding::admin_router(state.wayfinding.clone())`: `GET /api/wayfinding/editor`, `PUT /api/wayfinding/editor`.
5. Apply the existing trusted staff authentication/capability middleware **outside** the admin router, and have that middleware (or an authenticated adapter) insert `wayfinding::WayfindingAccess { can_read, can_write }` into request extensions from the actual authenticated identity. Both flags can map to `Capability::RoomsWrite`, which is the current staff route policy. Do not derive access from a browser-provided role/header. Missing extension returns 401; insufficient access returns 403. If later enabling read-only staff, extend the outer GET capability policy as well as `can_read`; currently it requires `rooms:write` for both methods.
6. Serve with `.into_make_service_with_connect_info::<SocketAddr>()` for peer rate limiting. Preserve JSON/static files in deployment and make only the intended public content location writable/durable. Do not include private imports in the image/bundle.

The module's `WayfindingStore::open(path, Arc<dyn AssignmentProvider>)` is available for injected providers/tests. Staff GET/PUT return `{ revision, content }`; public GET adds `lookup` metadata and optional `contentWarning`. PUT accepts that same `{ revision, content }` envelope. The revision is SHA-256 of current file bytes, not a Git SHA or timestamp.

### Web (integration owner)

Import `{ RoomFinder, RoomEditor }` from `src/features/wayfinding` (named exports). Mount `<RoomFinder />` at the public `/rooms` route and link it from the public navigation. It supports an optional `?room=<public-room-id>` deep link, never student credentials. Mount the editor within the staff shell, and pass the staff provider's authenticated request transport:

```tsx
const { request, can } = useStaff();
<RoomEditor request={request} canWrite={can('rooms:write')} />
```

`request` is `(path: string, init?: RequestInit) => Promise<Response>` and must preserve the supplied abort signal/body while adding `X-Staff-CSRF`/session handling. Without this prop the component uses ordinary same-origin fetch (useful for an injected/basic-auth harness), which does **not** add the staff CSRF token. UI `canWrite` is convenience only; backend enforcement remains mandatory. Styles are locally imported by the screens. The current staff capability policy restricts Rooms & directions to accounts with `rooms:write`; other roles must not gain access merely through a navigation link.

## Verification and remaining review

```sh
node --test tests/wayfinding.test.mjs
npx tsc -b --pretty false
npx eslint src/features/wayfinding
rustfmt --edition 2021 --check server/src/wayfinding.rs
```

Builder verification passed: all nine Node-reported tests and the five Rust unit tests invoked by the harness, TypeScript build checking, scoped ESLint and rustfmt checking. The Node harness builds only this module in a disposable Cargo project using existing dependencies, then owns its temporary HTTP servers and synthetic files. It exercises Rust validation, atomic/conflicting saves, invalid direct edits, default-off/literal demo gating, required dual credentials, generic failures, minimal response/privacy, private hashed imports, role enforcement, cross-origin/body limits, failure throttling and frontend search/request helpers. The harness's synthetic `x-test-role` header exists **only in its test binary**, never in production code.

These shell/module/API/type checks do not prove browser usability or a live deployment. No browser-driven end-to-end or testing agent was launched. Integration must run the combined application's build/tests and inspect the role/CSRF plumbing. When separately approved, review keyboard, touch/390px/820px/1440px layouts, screen-reader announcements, slow/offline requests and the actual checked campus content. The Proctor Suite design checklist was reviewed for principles; its Python/web precheck belongs to another repository and was not run or modified here.
