# Verification strategy

## Evidence rules

“Implemented,” “tests pass,” and “ready for tournament day” are different claims. Record revision, command/scenario, environment, result and untested gaps in [status/log](status/README.md). Code reading establishes behavior but is not a live integration test. Automated accessibility checks do not establish WCAG conformance alone.

The earlier documentation baseline used only document checks. The slice-1 implementation adds navigation/validator and static React route-render tests to `npm test`, alongside schedule tests. They assert active links, one main/heading per route, real data rendering, subscriptions/guide controls, and loading/stale states; they do **not** run effects, clicks, browser focus/printing or device/accessibility journeys. Current local command results and remaining browser/provider/load gaps are recorded in [status](status/STATUS.md).

## Current commands (from repository root)

```sh
npm test
npm run test:api
npm run lint
npm run build
cargo test --locked --manifest-path server/Cargo.toml
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --locked --manifest-path server/Cargo.toml --all-targets -- -D warnings
git diff --check
```

`npm run build` includes `tsc -b`. `npm run test:api` builds the Rust server and runs the real-router/feature tests with isolated synthetic storage. Use the existing Node/Rust setup described in the [root README](../README.md); do not point tests at production paths or silently change lockfiles/toolchains to get a pass. Lemon's Python/precheck commands belong to Lemon, not Live.

## Required test matrix as features land

| Area | Checks |
| --- | --- |
| Schedule | Date/timezone and DST boundaries, before/during/after event, delay/absorb calculation, interval validity, atomic preview/apply, concurrent editors |
| GitHub publishing | Valid/invalid direct commits, remote rejection, protected branch, dirty editor conflict, immutable full-bundle load, process restart, content-only CI filter vs code deploy, restore does not resend old notices |
| Content/media | Every public field editable, full export includes approved assets, unsafe Markdown/links/path traversal rejected, missing refs/private fields never published |
| Permissions | Both roles allowed/denied on every relevant endpoint, revoked sessions, expired sessions, CSRF/origin, no demo login in production, no privilege gain from direct URLs |
| Roster | Provider errors, partial enrichment, ID normalization/collisions, per-test columns, resync/remapping, clear + auto-sync interaction, old event never mislabeled as new |
| ID-only lookup | No code required, room-only output, no bulk search/name/contact leaks, bounded requests, neutral misses, private/no-store logs/caches, shared-network rate behavior |
| Routing | Real room/entrance/floor graph, shortest safe route, stairs excluded for step-free, closures, one-way edges, disconnected/unknown routes, no invented indoor location |
| Lost-and-found | Validation, idempotent retry, private inbox access/status/audit, report/outbox persistence, email accepted/failed/retried, duplicate suppression, no public detail retrieval |
| Translation | English default/switch, all labels covered, proper identifiers preserved, old translation never masks new notice, vendor timeout/quota, no private text sent, RTL/font/long-text layout |
| Regression | Existing updates/subscription/unsubscribe behavior, direct links/aliases, guide search/print, `/classic`, current API clients and staff workflows |

## Public browser/accessibility rehearsal

Use phone Safari, Android Chrome (including lower-end hardware), desktop Safari/Chrome/Firefox/Edge and a tablet. Select actual versions and record them; emulator screenshots alone do not test those engines/devices. Include 320px/390px-equivalent narrow layouts, landscape, tablet, desktop, text zoom, 400% browser zoom/reflow, keyboard and screen reader (VoiceOver and/or NVDA), reduced motion and high contrast.

Complete arrival -> room route, changed schedule -> notice, parent -> FAQ/practical help, report -> receipt, language switch -> English. Interrupt requests; deny geolocation; block map tiles/vendor; reload on nested routes; submit twice; sign out/revoke staff while a screen is open. Confirm focus, reading position, readable errors and clear recovery actions. Never ask a reviewer to overlook broken buttons because a feature “mostly works.”

## Load and freshness rehearsal (proposed, separate environment only)

Model a realistic mix of cached assets/public reads, lookup requests, rare reports, admin edits and reconnect bursts. Proposed starting stress target: 5,000 concurrent visitors; select arrival/think times and request rates explicitly. This is not an approved production test or a current capacity claim. Coordinate a safe test environment/budget first.

Measure p50/p95/p99, error rate, cache hit rate, peak CPU/memory, private-store contention and remote-push-to-public visibility. Starting objectives for review: mobile LCP <=2.5s, INP <=200ms, CLS <=0.1 under specified conditions; steady-state public API p95 <500ms and valid content visibility within 30s. Treat thresholds as proposed acceptance targets, not measured production performance or availability SLAs. Evaluate rate limits behind campus NAT without sending real email or calling ContestDojo at load.

Recovery chaos/HA drills are not a current launch prerequisite. Ordinary failed fetch/publish/send states are still part of feature correctness.
