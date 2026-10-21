# 2026-10-20 — Integrated security and compatibility review

## Scope and source

Ian requested an independent review of the complete implementation against `6293bbe7c2ba2317ab4e849ba5ed9aec70ae74b3`, preserving existing functionality and recording decisions/evidence. This review covers slices 1–6, their handoffs and the current shared worktree on `devin/1792480636-live-next-slices` (HEAD `f2d012f` plus uncommitted slice/review work). Relevant requirements: R01–R06 and R08–R14. No production activation or new product decision is implied. Lemon remains unchanged.

Reviewed public routes/legacy anchors/classic and earlier feature paths; server capabilities/CSRF; signed Google credentials, allowlists and live role/session revocation; private provider configuration/storage; remote Git validated atomic activation/CAS/pending recovery; ID-only lookup projections; and report/outbox durability, idempotency, uncertainty and safe optional modes. These checks supplement the separate slice evidence logs rather than replace their limitations.

## Changes

- Fixed composed staff/roster transport deadlines: `POST /api/roster/sync` now retains its 70-second budget for up to three sequential bounded provider reads, instead of being aborted by the ordinary 12-second staff transport timeout. Ordinary reads remain 12 seconds; public publication writes remain 90 seconds. Caller cancellation and no automatic mutation retries are preserved. Added browserless transport coverage in `tests/staff-web.test.mjs`.
- Added `LIVE_CONTENT_REMOTE_REPO` to the private People/session database path exclusions. A bare public-content cache is not a valid private staff database location. Added fail-closed configuration coverage in `tests/staff.test.mjs`.
- Persisted demo provenance for newly submitted lost-and-found reports, not just seeded rows. A later non-demo restart cannot make those synthetic reports eligible for receipt retry/sending or manual contact drafts. Added restart/replay/retry/manual-handling coverage in `server/src/lost_found_mail_tests.rs`; updated the existing once-only/additive seeding assertion to include user-submitted synthetic rows while retaining the two-seed check.
- Reconciled the README/demo launcher/walkthrough with ID-only `DEMO-1001`, fictional route mechanics and the retained legacy code-gated API. Corrected the staff presence header documentation to `X-Staff-Presence: 1`, clarified implemented versus proposed protocol sections, and restored the legacy feature scope notices expected by the documentation checker. Updated status and decision language without closing unresolved production approvals.

Existing older sandbox rows may lack synthetic provenance; no guessed retroactive data migration was performed. **Never reuse an old demo database for production**, or infer that an unmarked row is real. New synthetic submissions remain private and cannot send mail even after configuration changes.

## Verification

Local environment: Node `v22.23.3`, default Rust/Cargo `1.97.1`, Linux. Final checks after implementation changes:

- `npm test`: **35 passed**, including browserless route/render/GIS/People/publication and composed roster transport coverage.
- `npm run test:api`: **72 passed**, including preserved legacy CRUD/subscriptions/routes, server capability/origin/CSRF boundaries, Google/private-path setup, temporary local Git origins and fake private provider/mail integration.
- `npm run lint`: passed.
- `npm run build`: TypeScript and production Vite build passed.
- `cargo test --locked --manifest-path server/Cargo.toml`: **59 passed**. The initial full run caught the old two-synthetic-row assertion after the provenance fix; it was updated as described above and the full suite rerun successfully.
- `cargo fmt --check --manifest-path server/Cargo.toml`: passed (after formatting the updated Rust test).
- `cargo clippy --all-targets --locked --manifest-path server/Cargo.toml -- -D warnings`: passed.
- Docker declares `rust:1.87-slim`. Installed the explicit test-only toolchain using `rustup toolchain install 1.87.0 --profile minimal --no-self-update`, then ran `CARGO_TARGET_DIR=/tmp/live-msrv-review cargo +1.87.0 test --locked --manifest-path server/Cargo.toml`: **59 passed**, compiling the locked dependency tree and application under Rust 1.87.0. Default toolchain and Dockerfile unchanged. This is source/toolchain compatibility evidence, **not a container image build or deployment test**.
- `python3 /home/ubuntu/Documents/verify-live-docs.py`: passed after adding this log: **39 Markdown files, 231 local links, 12 pinned source-file references, R01–R14 and seven legacy scope notices**. The initial checker identified missing legacy scope notices; an intermediate run identified the not-yet-written link to this review log. Both were reconciled.
- `git diff --check`: passed, including the final documentation changes.
- Inspected `git status --short --untracked-files=all`, ignored-path status and private-file patterns: no unexpected private/generated file appeared among deliverable changes. Ignored `.demo/`, `dist/`, `node_modules/` and `server/target/` remain local, not deliverables. Existing `.demo/` contains sandbox content/local bare-origin scaffolding; no database/key file was found there. The MSRV target output lives outside the repository.

Responsive breakpoints, focus/reduced-motion styles, route landmarks, bounded controls and privacy request options were inspected statically. No browser/E2E, device, assistive-technology, real Google/ContestDojo/GitHub/Postmark, real mail, physical route, proxy/capacity, Actions or deployment test was run. Synthetic JWTs, loopback HTTP providers and temporary local Git remotes do not establish external acceptance.

## Remaining work

- Parent must include **all earlier slice changes and untracked source/tests/docs** in the combined patch; ordinary `git diff` alone excludes untracked files. No commit/push/PR/merge/deploy was performed in this review.
- Production Google/account migration, GitHub branch/credential/storage/merge policy, ContestDojo field/ID/participation mapping, verified November schedule/locations/routes/accessibility and approved browser/device review remain open.
- Receipt sender/reply-to/monitoring approval (D5), private/provider/outbox retention (D6), language/provider choices (D3/D4), remaining R05 editorial coverage and dependency advisory/reachability work remain open. No automatic deletion, exactly-once/inbox-delivery claim or paid translation was added.
- The parent task list was not visible to this subagent; local review tasks were used instead. The parent should update its own integration-review task with this evidence.
