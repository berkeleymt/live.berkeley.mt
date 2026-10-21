# 2026-10-20 — R05 current visitor-copy integration

## Scope and source

Parent final-diff review requested editable copy for the new ID-only lookup/graph planner and older RoomFinder/StudentLookup/CampusMap, an audit of App/PublicFrame/guide/report/subscription UI, explicit older-document migration, safe errors, tests and corrected operator docs. Work is local on `devin/1792480636-live-next-slices`, preserving the parent's uncommitted slices and legacy APIs. No push, PR, merge, production/provider access, deployment, real email or Lemon edits.

## Changes

- `content/site.json` now has 285 canonical copy keys. `rooms.*`, `lookup.*`, `legacy.*`, `route.*` and additional report/subscription/loading keys cover current visitor labels, instructions, aria, privacy and status/error/empty text. Operational buildings/rooms/graphs/steps stay in their structured files.
- Optional `src/features/site/text.ts` context uses existing PublicLayout content, explicit preview/standalone content or bundled defaults. It starts no pollers. `PublicCopyEditor.tsx` exposes all fallback fields and an explicit draft merge preserving authored values, intentional blanks and unknown valid keys. No read-time/server rewrite of older v1 documents.
- TypeScript/Rust copy limit raised together from 200 to 500 because the canonical inventory exceeds 200; key/value and 512 KiB document/publication bounds retained. Older sparse documents remain valid; deploy updated client/server before publishing the expanded catalog.
- Public lookup/report errors now select canonical text by status, never upstream messages. ID-only public error transport ignores response bodies. Subscription API stays `{ok,message}`; the shared widget maps recognized fixed results to canonical labels and discards arbitrary response text. Shared lost-found defaults derive from canonical site copy instead of another English object.
- Audited the existing App/PublicFrame, guide/help, reports and subscription coverage. `docs/site-content.md` inventories sources, placeholders, migration and exact R05 exceptions; reconciles obsolete builder-stage Git warnings with implemented file/local-first/opt-in remote-first modes. `docs/protocol.md` records compatibility/bounds. `.env.example` lists supported Google and remote Git knobs with commented placeholders and migration links, distinguishing the Actions-only runtime-reload variable. English-only; no translation provider configured.

## Verification

All verification was local/static or used disposable fixtures/localhost servers:

- `npm test`: **44 passed**, including 8 new public-copy helper/static-render tests and shared-shell override propagation. Tests cover default merge preservation/idempotence/limit disabling, standalone/context/explicit copy, plain substitution escaping, selected-route labels, legacy privacy, safe status mapping and non-rendering of provider payloads. No browser/DOM interaction workflow ran.
- `npm run test:api`: **74 passed**. Existing legacy, publication/media, auth/role/CSRF, lookup/report/subscription tests retained; site tests add count/value/document bounds, sparse-old-document round trips and public/editor override/blank/custom-key parity. Includes isolated Rust site harness (**8 site tests**).
- `cargo test --locked --manifest-path server/Cargo.toml`: **60 passed**. New site regression tests verify 500/501 keys, 4000-byte limit, blank/custom preservation and 512 KiB file-save boundary.
- `npm run lint`: passed.
- `npm run build`: passed (TypeScript and Vite); existing >500 kB chunk warning remains, no bundle-performance claim.
- `cargo fmt --manifest-path server/Cargo.toml --check`: passed.
- `cargo clippy --locked --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings`: passed.
- `git diff --check`: passed.

Development failures were corrected before these results: invalid underscore copy key changed to `lookup.source.privateImport`; key-inventory test constrained to a true `t(...)` call rather than matching `get(...)`; aggregate-size Rust assertion moved to the existing save boundary rather than assuming field-only validation enforces serialized size. No production contract weakened to pass tests.

## Remaining work

R05 is not blanket-complete: classic-only UI, server unsubscribe/mail templates, staff/validation/browser-native messages, Leaflet legal/control text and pre-shell bundled-only fallback/metadata remain explicit exceptions in [site-content.md](../../site-content.md#remaining-r05-exceptions-explicit-not-completed). Decide their future scope separately; this slice does not redesign `/classic`, rename/remove APIs or pretend library/legal text is editable HTML.

Review installed authored copy and use the explicit merge/save workflow after a coordinated server/client upgrade. Site copy cannot verify November map/accessibility facts or safely invent event data. Real-origin Google/GitHub/provider/sender migration, production storage/retention, branch policy, physical-route, browser/UI-driven, keyboard/assistive-technology/device and load checks remain separately authorized work. No Google/provider/device/mail-delivery/deployment or capacity success is claimed; dependency vulnerability review and the existing large-chunk warning remain open.
