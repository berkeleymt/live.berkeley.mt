# 2026-10-20 — Independent baseline-diff regression review

## Scope and source

Independent continuation of the request to review the combined Live changes against `6293bbe7c2ba2317ab4e849ba5ed9aec70ae74b3`, preserve earlier slices and fix confirmed integration/security/regression defects. Work remained on `devin/1792480636-live-next-slices`, including the pre-existing tracked/untracked patch. No reset, branch switch, commit, real remote push, PR, merge, deployment or Lemon change. Prior slice/review/copy logs and current protocol/configuration docs were reviewed alongside source and regression coverage.

This is a source and local shell/API/unit review, not proof of event readiness. Browser/E2E/UI-driven tests were expressly excluded. Static React rendering and synthetic localhost/bare-Git tests are not browser acceptance.

## Findings and changes

1. **Confirmed remote media compatibility defect.** The complete-bundle validator searched every string for `/media/`. Valid external HTTPS image/link URLs such as `https://example.org/media/photo.png`, plain-text mentions and code spans were incorrectly treated as missing local assets. This contradicted the documented external-image contract.
2. **Confirmed missing-asset validation gap.** The Markdown image destination `&#47;media/missing.png` escaped the substring check even though its destination resolves to a local missing image. Both defects were reproduced by failing tests before the implementation changed.
3. Replaced substring scanning with explicit structured site/wayfinding/graph image checks and CommonMark destination parsing for rendered guide/help/FAQ/announcement Markdown, using the existing `pulldown-cmark` dependency. Local media names exclude query/fragment suffixes; reference-style destinations, entities and escapes are resolved before validation. No schema version, endpoint shape, dependency or configuration change; SQLite/local Git behavior is unchanged. New future image/Markdown fields must be added to this typed reference traversal and its coverage.
4. Added three Rust regressions, including present/absent blobs across every current structured image and rendered Markdown field. Extended the bare-remote API scenario: valid external URLs publish; missing entity-encoded local assets return 422 and leave both the loaded revision and canonical remote branch unchanged.
5. Restored the missing `site-content` scope notice required by the documentation checker; reconciled stale slice-3 statements about graph/public-copy implementation. Updated protocol, media contract/migration guidance, ADR 0002 and current status. The explicit content/data migration is still required before activating remote-first mode; this validator fix itself needs no migration.

Implementation: [`remote_content.rs`](../../../server/src/remote_content.rs) (`validate`, `media_references`, three tests), [`remote-content.test.mjs`](../../../tests/remote-content.test.mjs). Contract: [protocol](../../protocol.md#remote-first-publication-slice-3), [Git guide](../../git-publishing.md#validation-atomicity-and-failure-recovery), [site content](../../site-content.md#api-editor-and-media-invariants), [ADR 0002](../../adr/0002-github-content-publication.md).

## Reviewed integration and security boundaries

- Public route registry, aliases/search/hash preservation, legacy anchor normalization and `/classic`; subscriptions, editorial/media/guide, Git history/restore, schedule/delays/announcements, public room search and private inbox remain covered by the rerun suites. Existing legacy account authentication remains explicit, not a Google fallback.
- Protected routes use server capabilities and mutating-request intent/origin/CSRF checks. Google verifies real RS256 signatures against fixed Google JWKS, bounded token/key data, issuer/audience/time/subject/verified-email claims; private Live allowlisting is separate from Lemon. Sessions re-resolve current roles, removal deletes sessions, and People transactions recheck the actor's Super role. Synthetic signed-key tests, not a real Google session, were rerun.
- Private ContestDojo credentials/settings/rosters and staff identity data remain outside public projections/exports. ID-only lookup returns only assignment/public freshness/demo fields, not submitted ID, names, teams, schools or contacts. Last-good provider import, bounded sync and denial/error handling are tested with synthetic/loopback fixtures.
- Remote Git uses complete candidate validation, content-digest CAS, forward commits, normal push/exact fetched confirmation and durable loaded/pending/archive refs. No private record export, force push or branch-protection bypass. Invalid drafts do not replace public last-good data. Required-PR branches still need an authorized external merge workflow.
- Private receipt/outbox persistence and idempotency remain transactional; synthetic submissions stay ineligible for real mail across mode changes. Only receipt/recipient/configured sender data reaches the mail adapter. Accepted is not delivered; interrupted/unknown outcomes are not automatically resent. Retry attempts and explicit staff reconciliation remain bounded. The older announcement subscription delivery path is not represented as the new durable receipt outbox.
- Optional/demo/file/local-Git paths retain their explicit configuration gates. Durable private storage placement/permissions, single-process ownership and actual deployment routing/replica isolation still require operator verification; this review does not claim a production filesystem audit or HA guarantee.

## Verification

Observed in this review after the fix:

- `cargo test --locked --manifest-path server/Cargo.toml remote_content::tests -- --nocapture`: before the fix, **2 failed** for the two defects above; after the fix and expanded coverage, **3 passed**.
- `cargo build --locked --manifest-path server/Cargo.toml` and `node --experimental-strip-types --test --test-name-pattern='media uploads' tests/remote-content.test.mjs`: **passed**, focused bare-remote scenario **1 passed**.
- `npm test`: **44 passed**.
- `npm run test:api`: **74 passed**.
- `npm run lint && npm run build`: **passed** (TypeScript/Vite). Existing Vite >500 kB chunk warning remains; no bundle-size or capacity claim.
- `cargo test --locked --manifest-path server/Cargo.toml`: **63 passed**.
- `cargo fmt --check --manifest-path server/Cargo.toml`: **passed**. `cargo fmt --manifest-path server/Cargo.toml` formatted the Rust change first.
- `cargo clippy --all-targets --locked --manifest-path server/Cargo.toml -- -D warnings`: **passed**.
- `CARGO_TARGET_DIR=/tmp/live-review-rust187-target cargo +1.87.0 check --locked --manifest-path server/Cargo.toml`: **passed**, matching the Dockerfile Rust version without changing the default toolchain or building/deploying a container.
- `python3 /home/ubuntu/Documents/verify-live-docs.py`: **passed**, 41 Markdown files, 248 local links, 12 pinned source references, R01–R14 and all seven scope notices. The first run identified the missing scope notice; intermediate failures were resolved after creating this log and expressing the deliberately missing image example without Markdown link syntax (the checker's regex treats even inline-code examples as links).
- `git diff --check`: **passed**.

No real Google, ContestDojo, Postmark, GitHub, sender verification or mail delivery; no browser/E2E/UI-driven, physical-route/accessibility, device, production/deployment, scale/load or human acceptance checks. No production credentials requested or used. Existing npm advisory findings were not auto-fixed or reassessed; see [current status](../STATUS.md).

## Remaining work

The parent agent must retain its main task in progress and export the **combined** patch including earlier untracked files; task 12 was not visible in this subagent's task list and was not altered. No commit was made here.

Keep the existing activation gates: authorized real-origin Google and deliberate account migration; remote branch/auth/storage/merge policy and explicit content migration; private provider/retention/mapping approval; verified November route/accessibility inputs; D5 sender/reply-to/monitoring and D6 retention; D3/D4 translation decisions; precise remaining R05 exceptions and human/mobile/keyboard acceptance. These tests do not make Live tournament-ready.
