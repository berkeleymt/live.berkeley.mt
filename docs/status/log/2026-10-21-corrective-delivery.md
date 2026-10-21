# Corrective delivery

## Scope and baseline

One cumulative binary patch against `6293bbe7c2ba2317ab4e849ba5ed9aec70ae74b3`, including all prior implementation slices, browser-driven UI corrections, source media and documentation. `git ls-remote origin refs/heads/main` reconfirmed that baseline unchanged. No push, merge, deployment or Lemon changes.

## Evidence

- `npm test`: 52 passed; `npm run test:api`: 74 passed; `cargo test --locked --manifest-path server/Cargo.toml`: 63 passed.
- `npm run build` (TypeScript/Vite), `npm run lint`, `cargo fmt --check --manifest-path server/Cargo.toml`, strict all-target/all-feature Clippy and `git diff --check`: passed. Known bundle-size warning remains.
- `npm audit --json`: zero reported vulnerabilities. Advisory coverage is not a general security guarantee.
- Browser findings, corrections and precise gaps: [UI log](2026-10-21-browser-ux-correction.md), [map log](2026-10-21-interactive-floor-plans.md). Tests used isolated synthetic data and local Git, not live providers.
- Export includes original PNGs and cropped WebPs, not links to private attachments. Delivery procedure uses an isolated Git index and clean baseline worktree to apply-check, apply and compare the resulting complete tree. The session reports the final outcome; no implementation completion claim rests only on packaging.

## Trying the update

Apply the replacement patch to a clean checkout of the baseline, not on top of older cumulative patches. Preserve any local edits first; do not reset an edited checkout. Follow the README. Existing sandbox content is deliberately preserved; use its separate-root example to see the current bundled maps without deleting earlier edits.

## Remaining launch gates

Authoritative November schedule/rooms/help content and field/accessibility review; real Google/ContestDojo/GitHub/Postmark configuration and authorized acceptance; approved sender/reply monitoring and retention; automatic translation provider/languages/privacy/spend decision and implementation; actual Safari/Android/mobile/assistive-technology and traffic rehearsal. These are not waived by the successful local run. Public-copy exceptions remain documented in site-content.md.
