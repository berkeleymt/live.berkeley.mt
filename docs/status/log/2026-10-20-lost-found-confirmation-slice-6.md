# 2026-10-20 — Slice 6: private lost-and-found receipt mail

## Scope and source

R11; Ian's instruction to continue from the docs, preserve existing features and log decisions/progress. Worked on the existing `devin/1792480636-live-next-slices` branch and integrated slices 1–5 without reset/switch/push/deploy or touching Lemon. Local synthetic fixtures only. Read the lost-found/specs/protocol/open decisions and existing subscription sender before implementing. Consulted official [Postmark email API](https://postmarkapp.com/developer/api/email-api) and [overview/errors](https://postmarkapp.com/developer/api/overview); no provider API credentials/calls, real mail, paid translation or browser-driven checks were used.

[ADR 0005](../../adr/0005-private-receipt-outbox.md) records delegated engineering choices, **not** approval of D5 sender/reply-to/reply monitoring or D6 retention. D3/D4 remain open and English authoritative.

## Changes

- `server/src/lost_found.rs`, new `lost_found_mail.rs`: additive private phone migration plus outbox/action tables; report + receipt + outbox commit atomically. Legacy clients without `confirmationEmail` keep exact `{receipt}` response/no new mail; old normalized fingerprints, private status/notes/audit, optional contact and existing rows are preserved. New confirmations expose only `{receipt,emailState}` and allow explicit same-key/body refresh, never public readback.
- Separate opt-in receipt configuration requires both validated exact-domain Berkeley sender and reply-to, plus existing Postmark secret. No guessed/fallback addresses. Disabled/missing/invalid/demo settings never claim sent. Super read-only `/api/settings/lost-found-mail` gives sanitized config; Admin/Super inbox gets configuration state, not credentials.
- Durable single-process worker commits claim before network; existing reqwest, no client retries/redirects, bounded timeout/body, one request at a time, persisted bounded jitter/backoff and attempt ceilings. Valid provider acknowledgement means **accepted, not delivered**. Timeout/malformed/unknown/500/503 and restarted sending jobs become uncertain without automatic resend. Disabled configuration pauses the backlog; enabling does not automatically mail it. Constant-only storage/client warnings contain no request/provider/private data.
- `POST /api/lost-found/staff/{id}/mail` applies trusted `found:write`, normal role/session/CSRF/origin checks, explicit staff intent, independent delivery revision, UUID idempotency and atomic action audit. Staff can record manual handling or review/retry eligible jobs; uncertain retry needs provider-check note plus duplicate-risk confirmation. Accepted/active/legacy/handled jobs cannot be resent by this endpoint. Report status/notes remain independent.
- `LostFoundPage.tsx`, `LostFoundDelivery.tsx`, `LostFoundInbox.tsx`, types/styles and editable `content/site.json`: required email + optional phone, report-saved versus mail-state distinction, explicit status check, private delivery diagnostics/action history, Super configuration view, uncertainty/read-only/manual recovery and unsaved/uncertain draft guards. Existing mailto/manual inbox flow remains. Existing tokens/focus/target styles reused; no claim of human/device/a11y acceptance.
- `main.rs` and `routes.rs`: integrated startup/config/worker/settings wiring; receipt worker starts only after full startup validation and successful listener binding, so an invalid/unbindable app cannot start sending its persisted receipt jobs. Existing announcement/subscription `server/src/email.rs` unchanged. No automatic deletion or backfill, provider webhook, new dependency or production configuration.
- New `lost_found_mail_tests.rs`; expanded standalone lost-found, integrated Admin/Super and static React tests. Updated [lost-found contract/recovery](../../lost-found.md), [protocol](../../protocol.md), `.env.example`, [plan](../../development-plan.md), [status](../STATUS.md), [open decisions](../decisions.md) and ADR 0005. Prior slices' pending changes were preserved, not reverted or committed as this slice.

## Verification

All commands below completed locally with exit 0:

| Command | Result |
| --- | --- |
| `cargo fmt --all --manifest-path server/Cargo.toml -- --check` | Passed |
| `cargo test --locked --manifest-path server/Cargo.toml` | **58 passed**, 0 failed |
| `cargo clippy --locked --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings` | Passed |
| `node --test tests/lost-found.test.mjs` | **12 passed**, 0 failed, including the actual-module Rust harness |
| `npm test` | **34 passed**, 0 failed |
| `npm run test:api` | **72 passed**, 0 failed |
| `npm run lint` | Passed |
| `npm run build` | TypeScript/Vite passed |
| `git diff --check` | Passed |

New fake-provider tests use ephemeral loopback HTTP fixtures only. They cover:

- atomic rollback on outbox failure; concurrent duplicate submissions with one report/job; changed-body conflict; pre-slice fingerprint and additive schema migration;
- required explicit Berkeley config, no secret serialization, demo/missing-config/no-backfill behavior and paused-backlog restart;
- actual request payload/header shape and minimal receipt-only text; no item/name/phone/location/internal-report-ID/staff-note leakage;
- valid acknowledgement, rejected credentials/payload, rate limit, connection refusal, redirect, ambiguous 500/503, unknown/malformed/oversize acknowledgement and timeout after receipt;
- persistent queued/accepted state, sending-to-uncertain restart, bounded automatic/staff attempts and backoff;
- rejected stale/risky actions, same-key replay, manual handling/audit and independent report-note updates;
- actual app anonymous/Admin/Super/private-settings/capability/CSRF/bad-origin boundaries and no public report/contact/notes readback;
- static required-email/optional-phone/privacy copy, accepted-versus-delivered wording and read-only/uncertain/manual staff states.

Full regression suites also exercised the existing subscription endpoint with sending disabled, schedule/delays/announcements, rooms/lookup, editorial/media/Git publication, legacy roles, navigation and `/classic`. Local bare-remote fixture pushes are test-only, not pushes to the application/GitHub remote. No real Postmark/Google/ContestDojo API, production credentials, deployment/Actions, browser/E2E/device/assistive technology, mailbox delivery or load testing was performed. Earlier dependency-audit findings in STATUS are not resolved by these checks.

## Remaining work

1. D5: name/approve actual berkeley.mt sender and reply-to, verify sender with Postmark, designate a reply monitor and separately authorize controlled mailbox delivery/bounce checks. Local `ready` only validates syntax/config presence. No real addresses are guessed or embedded here.
2. D6: approve contact/report/outbox/status/action history retention, exceptions, backups/provider log retention and operator ownership **before real collection**. No automatic deletion is implemented.
3. Verify durable private DB/storage permissions and **one active Live worker process per DB** before enabling. SQLite-backed report durability still depends on deployment storage. A post-send DB failure requires storage recovery/restart/provider review; restored stale backups require deliberate reconciliation. There is no exactly-once/HA guarantee.
4. Obtain authorized small-phone/keyboard/large-text/assistive-technology review, trusted-proxy/shared-campus abuse/capacity rehearsal and operational recovery review. API/static fixtures are not these approvals.
5. Translation still requires D3/D4; do not select/pay a vendor or silently turn demo copy into authoritative November content. Remaining public editorial coverage and prior slices' provider/map/account activation work remain separate.

No local commit was made for this slice because shared integration files also contain the preserved slices 4/5 changes; the integrating parent can review/stage the combined work deliberately. No push, PR, merge or deploy.
