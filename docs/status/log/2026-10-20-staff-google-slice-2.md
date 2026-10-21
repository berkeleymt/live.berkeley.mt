# 2026-10-20 — Google/People staff slice 2

## Scope and source

Implements R08/R09 and accepted [ADR 0003](../../adr/0003-lemon-staff-parity.md), following Ian's request for a combined server/web slice without breaking existing functionality. Continues the local public-shell work (`2ec1424`) on `devin/1792480636-live-next-slices`, original public-hub baseline `6293bbe7c2ba2317ab4e849ba5ed9aec70ae74b3`. Lemon reference remains read-only. No branch switch/reset, push, PR, merge, deployment or production/provider/credential access.

## Changes

- `server/src/staff.rs` and `staff/google.rs`: explicit Google/legacy selection, GIS credential endpoint, RS256 verification of issuer/audience/expiry/signature/verified email/subject/issued-at/authorized party, normalized Live allowlist, safe Google avatar URL and bounded fixed-endpoint JWKS fetch/cache. Unknown keys/provider failure never bypass verification. Configured Google cannot fall back to local passwords, owner Basic or demo.
- `staff/people.rs`: private Unix-protected SQLite People/session state outside Git/static/content/media, bootstrap Supers, only Admin/Super production roles, fixed 24-hour hashed sessions, rotation/logout, role re-resolution on each protected request, immediate removal/demotion, transaction-time actor checks and protected self/bootstrap rows. Removing an account deletes its sessions. People state persists; presence is advisory/in-memory/30 seconds. Neither credentials nor private state enter editorial Git exports. Settings capability is groundwork, not a new settings endpoint.
- `src/features/staff/`: GIS/FedCM button/prompt flags, Google/unconfigured/denied/error/retry states, no password fallback in Google mode, role-filtered flat sidebar, accessible identity/avatar/connection text, desktop/tablet-rail/phone-menu styles and account panel, session/presence polling and live navigation on role/removal changes, Super-only People with removal confirmation and honest errors. Existing editors continue using CSRF-aware requests; mutations are not queued/retried automatically. Lemon remains a separate external sign-in.
- Preserved local Argon2 accounts, capability overrides and owner Basic when Google is not configured; no automatic legacy promotion. Preserved 8-hour default/configurable legacy TTL. Modern demo chooser exposes only synthetic Admin/Super; historical four demo IDs remain API-only compatibility, only under literal demo mode.
- Added synthetic RSA/JWT/People unit fixtures and browserless JSDOM tests; extended API role/migration tests and repaired the standalone site harness's dependency linkage/count assumption. Added pinned `jsonwebtoken=9.3.1` (RSA/JWK, no PEM feature) and dev-only `jsdom=26.1.0`, updating lockfiles.
- Updated [protocol](../../protocol.md), [operator setup/migration/rollback](../../staff-access.md), [permissions](../../permissions.md), ADR, demo/README, [development plan](../../development-plan.md) and current status. Live progress is tracked here/in the plan; Lemon's `phase-3.md` was not modified.

## Verification

Local Linux/Node 22/Rust checks, using synthetic files, signed tokens, DOM mocks and isolated loopback test servers only:

| Command | Observed final result |
| --- | --- |
| `npm test` | 25 passed, including 6 new browserless staff/GIS/People scenarios |
| `npm run lint` | Passed |
| `npm run build` | TypeScript + Vite passed |
| `npm run test:api` | 63 passed; full existing public/content/media/Git/private-inbox/wayfinding/legacy account regressions plus two-role/People/Google-no-fallback cases |
| `cargo test --locked --manifest-path server/Cargo.toml` | 43 passed |
| `cargo fmt --manifest-path server/Cargo.toml --check` | Passed |
| `cargo clippy --locked --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings` | Passed |
| `git diff --check` | Passed |

Coverage includes denied cryptographic claims/signatures/unverified or unlisted emails; Admin-denied People/settings capability boundaries; Super add/change/remove; self/bootstrap protection; immediate demotion/removal and no session resurrection on re-add; expiry/logout/rotation; persisted sessions/accounts; safe avatars and bounded key-cache/outage behavior with an existing Live session. JSDOM exercises GIS flags/credential submission, provider-load retry/unconfigured state, identity/sidebar/account-panel toggle, live demotion/removal navigation, transport outage/recovery, People confirmation and protected errors. These browserless tests are not real browser/provider verification.

Failures seen and fixed before the final passing runs: a SQLite query lifetime error (collect before statement teardown), mixed React runtime modes in the Vite-built JSDOM harness (restore test NODE_ENV), strict Clippy large response error (use compact auth failure tuple), and the standalone site Rust harness missing new extern crates/assuming all tests were site tests (link dependencies and count the seven actual site tests separately).

`npm install --save-dev --save-exact jsdom@26.1.0` reported **12 dependency vulnerabilities (1 low, 2 moderate, 9 high)**. No automatic audit fix or reachability assessment; existing advisory remains visible.

## Remaining work and limits

- No real Google token, GIS/FedCM/account chooser/origin rehearsal, production provider/mail/API spending, credential request, actual production migration, deployment or Lemon change occurred. Obtain separate authorization and human phone/tablet/keyboard/large-text/assistive-technology review before claiming release parity.
- Operator must approve account mapping, provision Live Google configuration/private state/bootstrap Supers, rehearse migration and verify real access before removing legacy configuration. Preserve rollback access privately; never enable demo as a production recovery path.
- Run one Live instance for this slice; SQLite/local presence/key cache is not a distributed auth/HA service. External login abuse controls/security review are still deployment responsibilities.
- Next implementation slice: canonical GitHub publication path. ContestDojo/ID-only lookup, interactive wayfinding, email confirmation, translation and event readiness remain separate work, not delivered by staff authentication.
