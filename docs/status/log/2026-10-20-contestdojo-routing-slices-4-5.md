# 2026-10-20 — ContestDojo/My rooms and practical directed wayfinding

## Scope and source

Authorized continuation from Live baseline `6293bbe7c2ba2317ab4e849ba5ed9aec70ae74b3` on `devin/1792480636-live-next-slices`, consuming the preceding public-hub, Google/People and remote-content stages. R03/R10 and practical R04: implement private ContestDojo settings/sync/mapping and ID-only public projection, plus configurable route/floor mechanics, without breaking legacy functionality. User explicitly prohibited real provider access, browser/E2E, push/PR/deploy and Lemon changes. [ADR 0004](../../adr/0004-private-roster-and-route-graph.md) distinguishes implemented decisions from missing operational approvals.

## Changes

- `server/src/contestdojo.rs`: separate opt-in private SQLite settings/snapshot, Super-only secret replacement/redaction through existing policy, bounded fixed-origin read-only requests, required students/optional enrichment, flattening/join/size limits, atomic last-good replacement, event provenance, one sync lock, minute-boundary auto-sync with bounded cooldown, private diagnostics/50-row pages/mappings/clear, generic ID-only public projection and attempt-based limits. Normalized duplicate/missing IDs never become guessed public matches. Oversized enrichment is omitted rather than discarding valid students.
- Server state/router/capability integration in `main.rs`, `routes.rs`, `staff.rs`; settings/roster writes require explicit intent as well as existing session/role/CSRF/origin policy. New public endpoints carry private/no-store/referrer headers. Secrets and raw fields stay out of public content, exports, response allowlists and provider errors.
- `IdLookup.tsx`, `RosterWorkspace.tsx`, `rosterApi.ts`, shared routes/sidebar: ID-only My rooms with memory-only input, clear/hide/unmount behavior, bounded no-retry transport, stale/unmatched/help states, mapped and raw private views, per-test/None/shared-column/participation mappings, aliases and explicit clear. Secret draft removal on tab hide also cancels replacement intent so a later Save cannot accidentally delete the token. Private subtrees opt out of translation. Scheduled times are explicitly labeled and link to live delay information.
- `route_graph.rs`, wayfinding types/validation/editor, `routing.ts`, `RoutePlanner.tsx`: optional public directed graph through existing canonical content/publication, bounded references/geometry/costs, origin/destination, image/schematic layers, equivalent written steps, closure/verification/step-free filters, missing/no-route/fallback states. Existing written routes/editor remain intact. Page explains that graph closures do not rewrite separately authored directions and offers reload.
- `content/wayfinding.json` adds only a fictional demo network tied to the existing fictional rooms; no November campus route, schedule or accessibility facts invented. Demo instructions now use synthetic `DEMO-1001` without a new code. Legacy endpoint/file loader remain available and existing compatibility tests still pass.
- `.env.example`, [setup/migration](../../setup-contestdojo.md), [protocol](../../protocol.md), [graph/content contract](../../wayfinding.md), [plan](../../development-plan.md), [status](../STATUS.md), and ADR updated. Removed stale claims that setup/routes are not wired; legacy documentation is labeled compatibility/history rather than the production design.

## Verification

Executed locally against synthetic fixtures, temporary SQLite/files/content repositories and loopback HTTP only:

- `npm test`: **32 passed**, including directed routing/closures/step-free/missing data and private no-retry request tests, plus existing schedule/public/staff/content checks.
- `npm run lint`: passed.
- `npm run build`: TypeScript and Vite passed.
- `npm run test:api`: **70 passed**, including actual-server Super/Admin/intent/privacy/redaction, shared room columns/None/participation, unmatched room, invalid mapping/conflict, event change, clear/rate limit and legacy lookup tests; existing public/editor/remote publication/inbox/staff regressions remain covered.
- `cargo test --locked --manifest-path server/Cargo.toml`: **50 passed**. New local provider fixtures cover token refusal, unknown event, timeout, malformed/non-array/oversized bodies, optional failures, flattening limits, duplicate/missing/leading-zero IDs, room ambiguity, atomic storage-failure retention, sync serialization/cooldown and restart. Graph test rejects dangling references, false step-free stairs and non-demo metadata misuse.
- `cargo fmt --manifest-path server/Cargo.toml -- --check` and `cargo clippy --locked --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings`: passed. Formatting was applied before checking.
- `git diff --check`: passed.

During verification, strict Clippy caught router items after the Rust test module; moved those definitions before tests. The first new API run exposed that the shared staff middleware did not itself require `X-Staff-Request`; added an explicit intent guard on the new private router instead of weakening the test or changing existing clients. Re-ran the targeted test and full suites successfully. No new dependency installation or dependency-security remediation was included.

These checks are unit/static/browserless/HTTP checks, **not** browser interaction, responsive layout, keyboard/assistive-technology, provider, field/accessibility or production rehearsal evidence. Existing API tests perform Git writes only to temporary local fixture remotes, not the real project remote. No real ContestDojo request, secret, email, production roster, external push, deployment, PR, patch export or Lemon edit was performed. Changes remain on the requested branch for parent review.

## Remaining work

- Deliberately provision/review private storage, backups/encryption/retention, real provider authorization and event/ID/participation/room mapping before enabling imports. Settings defaults do not activate the adapter without private DB configuration. Retire old code-file imports only through an approved migration.
- Obtain real November graph/floor images/entrances/room targets and verify access restrictions/step-free paths, verifier/date notes, directional edges and closure procedures on site. **Slice 5 is not operationally complete.** Supplied geometry is demonstration-only; the page snapshot is not live emergency closure monitoring. Independently authored written directions need coordinated updates.
- Review ID-enumeration tradeoffs, trusted-proxy/shared-campus rate limiting, one-process private SQLite operation and authorized capacity rehearsal. Current rate limits are bounded and process-local, and IDs deliberately are not authentication. Separately fetched public content is not an atomic cross-request snapshot; missing room references fail honestly.
- Obtain separately approved browser/device/keyboard/large-text/a11y work. Finish remaining public editorial coverage, confirmation email and translation slices under their own approvals. No deployment/readiness/approval claim follows from passing local tests.
