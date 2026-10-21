# 2026-10-20 — Combined implementation delivery

## Scope and source

Ian requested continued implementation from freshly fetched main, preservation of existing functionality, documented decisions/progress and one downloadable combined patch. Starting revision: `6293bbe7c2ba2317ab4e849ba5ed9aec70ae74b3`; final fetch confirmed remote main still points there. Work remains on one local branch, `devin/1792480636-live-next-slices`. No push, PR, merge, deployment or Lemon change was made in this implementation pass.

## Changes

Includes the public multipage hub; Google/People two-role identity; opt-in remote-first public content publication; private ContestDojo import and ID-only room projection; synthetic route graph/planner; private durable receipt outbox and staff reconciliation; and current-public copy coverage with additive editor migration. Existing classic page, local/legacy modes, subscriptions, operational editors, private inbox and history/restore remain supported. Individual slice logs and ADRs record their contracts and limitations.

Two review passes fixed composed roster deadlines, private-state path isolation, persistent demo-report provenance, and remote-media reference validation. The copy follow-up moved visitor labels into the shared catalog without duplicate polling. See the [latest independent review](2026-10-20-independent-regression-review.md) and [copy inventory](../../site-content.md); legacy/classic and protocol-level copy exceptions are not represented as completed R05 coverage.

## Verification

- Latest independent full-tree checks: `npm test` **44 passed**; `npm run test:api` **74 passed**; `cargo test --locked --manifest-path server/Cargo.toml` **63 passed**. Lint, TypeScript/Vite build, Rust formatting and strict all-target Clippy passed. Rust 1.87 locked source compatibility passed; this is not a Docker image/deployment test. Exact commands and reproduction-before-fix evidence are in the linked review log.
- Parent ran `DEMO_ROOT=<fresh isolated directory> DEMO_PORT=3099 npm run demo -- --no-build` against those built artifacts. HTTP smoke passed for 12 public/staff SPA entry points and their assets, synthetic Super sign-in, protected publication/editor/inbox reads, ID-only `DEMO-1001` projection with no-store caching, and the 285-key public copy catalog. The sandbox server was stopped afterward. The first ad-hoc cache assertion expected exactly `no-store`; it was corrected to accept the stronger actual `private, no-store` header. No application change was needed.
- Parent reran documentation references and whitespace checks. The separate Lemon checkout remains clean.
- Parent reran `npm audit --json`: **12 advisories (1 low, 2 moderate, 9 high)** remain. No automatic or breaking dependency remediation was attempted.
- Delivery is a binary-capable cumulative Git diff from the starting revision, including all new source/tests/docs—not just the last commit. It is checked and applied to a clean archive of that revision; the resulting file contents and executable modes are compared with the final committed tree before attachment. Ignored demo databases, dependency/build caches, workflow scripts and local verification artifacts are excluded.

## Remaining work

This is implemented and locally regression-tested, **not tournament-ready or human-accepted**. Real Google/allowlist migration, GitHub publication/branch/storage activation, authorized ContestDojo data/mapping, November schedule/venues, physical route/accessibility verification, D5 Berkeley mail sender/reply monitoring, D6 retention, D3/D4 translation, browser/device/keyboard/assistive-technology rehearsal and proxy/capacity checks remain. Do not reuse demo storage for production. No real provider/mail delivery or browser/UI-driven test was performed; shell/static/HTTP checks do not establish visual or human usability acceptance.
