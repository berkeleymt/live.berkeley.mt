# 2026-10-21 — Markdown foundation and design stages

## Scope and source

Ian explicitly approved **“Markdown + shortcodes within Live (recommended)”** and requested a working full-stack foundation, not a backend-only batch. The target remains a production application: berkeley.mt-like public presentation and a Lemon-like staff workspace, without Zola/Typst execution. This follows the [reference review](2026-10-21-content-driven-direction.md) and addresses page-composition portions of R01/R02/R05/R06/R12/R13, not complete tournament readiness. [ADR 0007](../../adr/0007-markdown-pages-with-shortcodes.md) records the accepted runtime decision.

Requested incremental baseline is tree `c557c650bbbc269c03b978dd7a6d9d9116a57e70`, not remote main. Working HEAD observed during verification: `d6977b615ade6bfa5e1d5e6dfecd19275d5adc39`. Existing dirty/untracked work was preserved. Reference repositories were read-only; no staging, commit, branch switch, push, PR, production change, real provider or real email was performed by this stage. Synthetic tests create commits/pushes only in disposable local fixtures.

## Changes

- Actual [Home](../../../content/pages/home.md) and [Guide](../../../content/pages/guide.md) Markdown files with TOML metadata; one safe parser/validator and bounded allowlisted block registry inside the existing Rust/Axum + React runtime. Rust `toml` and frontend `smol-toml` handle frontmatter. Existing Markdown libraries render prose; no raw HTML, arbitrary templates/components or shortcode arguments execute.
- [Page API/store](../../../server/src/pages.rs): full-set revision/CAS saves, validation-only preview and deliberate draft-only Home/Guide/Help conversion. Limits include filenames/routes, UTF-8 sizes, counts, parts/headings, nesting, links/images, duplicate routes/blocks/anchors and symlinks. File-mode staged replacement and durable last-good retain valid pages across invalid direct edits/restart; recovery cache bounds account for JSON escaping, not only source size.
- Local-Git and optional v1 remote page blobs are real individual `.md` files. Existing bundle media/digest/CAS/pending/archive/restore semantics apply; older repositories without pages remain valid. Local `refs/live/local-loaded` retains valid content across an invalid HEAD/restart. Page saves immediately synchronize shared editorial revisions, fixing a regression where a following event edit falsely conflicted until polling.
- [Public renderer](../../../src/features/pages/PageRenderer.tsx), page index polling and navigation support authored core/custom routes, headings/contents/search/print and explicit loading/error/stale/404/legacy-fallback states. Invalid transport shapes retain last-good data. Preview replaces **every** operational block with a noninteractive placeholder. Report forms reuse the private report flow and embedded heading mode; navigation guards remain.
- [Generic staff editor](../../../src/features/pages/PageEditor.tsx): file list, create/delete, metadata/source, shortcode insertion, preview, full publication and recovery. Session drafts survive errors; switching/deletion/leaving guards and explicit current-revision reconciliation prevent silent draft loss. Shared branding/Event/FAQ/copy/media remain in separate Site settings; authored Guide/Help ownership is enforced on structured site saves.
- Demo copies shipped pages only on new disposable sandbox initialization; rerunning a sandbox preserves edits. Docker already copies the content tree; it does not add a startup migration. File-mode mounts must include writable durable recovery storage. Existing installations are not automatically seeded by application startup.
- [Exact syntax/API/migration/recovery](../../markdown-pages.md), [publication guide](../../git-publishing.md), [protocol](../../protocol.md), [site-content scope](../../site-content.md), environment guidance, ADR and status/plan updated. Operational records, roster, reports, People, mail and private settings remain structured/private; no November schedule or accessibility-route facts were invented.

## Verification

Local Linux checks against the dirty working tree, with synthetic data only:

| Command | Observed result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run build` | TypeScript/Vite passed; existing large-chunk warning remains (main JS about 726 kB minified) |
| `npm test` | **61 passed**, including 9 new browserless Markdown model/renderer/editor scenarios |
| `npm run test:api` | **77 passed**, including file/local-Git/remote page persistence and the real application demo fixture |
| `cargo fmt --check` (in `server/`) | Passed |
| `cargo test --locked` (in `server/`) | **69 passed**, including 6 page parser/store tests |
| `cargo clippy --locked --all-targets --all-features -- -D warnings` (in `server/`) | Passed |
| `git diff --check` | Passed |

Focused evidence covers maintained TOML syntax, literal shortcode examples inside inline/fenced code, bounded heading counts, unsafe HTML/URL/template/route rejection, size/nesting/filename/symlink/media limits, explicit conversion/anchor retention, source on disk, concurrent/stale CAS, direct edits, last-good/restart, local loaded-ref recovery/forward restore, remote rejected-push proposals and archive/restore, old-bundle compatibility, draft retention after 422/503/409/401/403, guarded switching/deletion, explicit stale-draft reconciliation and suppression of all live preview blocks. Updated the demo integration test to assert authored Guide ownership, separate shared branding publication and preservation of page files on repeated setup; it also caught and now covers immediate page-to-editorial revision synchronization.

Intermediate test failures were corrected rather than counted as passes: a browserless Markdown import needed externalization consistent with the existing harness; compatibility tests needed the actual writable schema (not a response-only `reloadError`); the demo's old Guide JSON edit is now intentionally rejected; the new cache-bound fixture uses a permitted control byte rather than already-forbidden NUL. A repeated API run also exposed transient `ENOTEMPTY` during temporary remote-fixture teardown after server exit; bounded filesystem cleanup retries now allow an in-flight Git child to finish without weakening assertions. The final results above supersede those failed intermediate runs.

## Remaining work

- Lead-owned browser handoff: fresh and legacy installations, Home/Guide, custom route and navigation, staff metadata/source/preview/publish/conflict/recovery, Site settings ownership, report draft guards, and preserved Classic/map/room/schedule/subscription/private flows. Test phone/tablet/desktop, keyboard/focus/large text, print, accessibility and real rendering. **No browser, screenshot, physical device, Safari or screen-reader acceptance was performed by this stage.** Previous browser logs concern the preceding UI, not this new page renderer.
- Deliberately review installed content and adoption/rollback before deployment. Exercise actual container mounts/permissions and durable single-writer storage; real GitHub branch/credential/protection behavior remains unverified. Demo initialization is exercised locally, not a production/container rollout.
- Whole-page source is public. Authors must not put private records into prose, metadata or Git. Direct operators must respect authored/legacy ownership; API rejection is not an external Git branch policy.
- Search matches Markdown parts between blocks/anchors, not ranked full-text results. Automatic heading IDs are deterministic, not durable external-link guarantees; use explicit anchors. Static authored Home intentionally no longer consumes legacy hero composition. Remaining R05 classic/email/library/bootstrap exceptions and translation gates are unchanged.
- Actual provider approvals, retention policy, authoritative November data and verified physical/accessibility routes remain separate release gates. No human approval or production readiness is implied by the automated checks.

## Design stage — authored composition and interface refinement

This serial continuation used only the current dirty Live working tree. No reset/clean/stage/commit/push/branch switch/PR, production/provider/email action, or reference-repository modification was performed. Tests use disposable synthetic local fixtures, not installed tournament data. The foundation history above is retained rather than rewritten as current-stage evidence.

### Implemented

- Completed the nine shipped destinations as real `content/pages/*.md` composition: Home, Schedule, Updates, Maps, My rooms, Guide, FAQ, Help and Lost & Found. Guide's existing authored source was retained. Copy, links, image placement and block order belong to these files; event/site/wayfinding records and private workflows remain structured. Explicit Help/FAQ/Guide anchors and existing URLs/aliases remain.
- Expanded the registry to exactly eight parameterless live blocks: `now_next`, `announcements`, `urgent_updates`, `subscribe`, `schedule`, `room_lookup`, `map`, `report_form`. `anchor(id="...")` remains the stable-fragment primitive. Schedule is a shared operational component rather than an entire legacy page. Lookup, map and report blocks exclude broad legacy page introductions/footers. Preview keeps every live block inert. No arbitrary HTML/JS/JSX/template execution or Zola/Typst was added.
- Explicit adoption now prepares nine unpublished files from installed site/event/wayfinding content, preserving old copy, guide images, FAQ answers, Help anchors and room help/transit links. Legacy hash/alias navigation retains its labels/order. It still rejects nonempty page sets and never publishes automatically. Retained Guide/Help/FAQ compatibility fields are read-only while authored; event notices and shared site settings remain editable. Invalid conversion fails safely for manual reconciliation.
- Public shell keeps local IBM Plex Sans, centered identity, a pale neutral surface, restrained links/dividers and constrained prose. Navigation is metadata-discovered and ordered, with three direct entries plus a labeled More disclosure (including Escape support), not hardcoded primary route selection. Removed repeated full footer navigation. Long authored pages retain contents/search/print. Home promotes Find my rooms and short day-of destinations; urgent content renders only when present.
- Focused room lookup promotes assignments/Directions and Change ID above any public browsing. IDs remain in-memory POST data, never URLs/storage. Map selection promotes directions/floor plan before collapsed browsing, with Change room returning focus to search and public `?room=` support. Reduced map canvas and browse height. Existing floor-map regression confirms unrelated polling does not recenter; focused DOM tests confirm rerenders do not move search focus.
- Staff Today is a quiet divided task list without the large service/setup explanation panel. Generic editor has ordered files, collapsible metadata, source/insertion tools, optional 800 ms validated live preview and retained manual preview. Existing CAS, errors, permission handling, session drafts, dirty switching/deletion/leaving guards and explicit reconciliation remain. Site settings stays separate and hides authored compatibility fields.
- Updated `docs/markdown-pages.md` with exact syntax/API, eight blocks, nine-page migration, ownership, editor behavior and handoff caveats.

### Design-stage checks

| Command | Observed result |
| --- | --- |
| `npm test` | **67 passed**, including new browserless navigation/safety/live-preview and focused visitor-flow regressions |
| `npm run test:api` | **77 passed**; synthetic file/local-Git/local-bare-remote modes, nine-page demo, adoption and FAQ ownership |
| `npm run lint` | Passed |
| `npm run build` | Passed; Vite large-chunk warning remains (main JS about 729 kB minified) |
| `cargo test --locked --manifest-path server/Cargo.toml` | **69 passed**, including all nine shipped pages, legacy hash conversion and retained anchors |
| `cargo fmt --manifest-path server/Cargo.toml --check` | Passed |
| `cargo clippy --locked --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings` | Passed |
| `git diff --check` | Passed |

Intermediate failures were corrected, not counted as passes: preview assertions still expected six rather than eight blocks; demo assertions still expected two rather than nine files. The new browserless visitor test needed the existing harness convention of selecting test ReactDOM before importing it after Vite. Final checks above supersede those runs.

### Lead handoff — not browser acceptance

No browser/testing-agent calls or screenshots were made. Lead must exercise the final UI at **390/820/1440**, including More navigation, contents/search/print, lookup result/Change ID, map selection/Change room/pan/zoom, keyboard/focus/screen reader, staff live preview/source/draft recovery and private report leaving/receipt flows. Responsive CSS and DOM assertions do not establish visual/device acceptance. Rehearse migration/rollback against a copy of installed content and real writable deployment mounts. Production Git policy/provider approvals, real November facts and verified accessibility connections remain separate gates. Existing partial authored installs are never bulk-overwritten: review and add missing files deliberately. Existing foundation limitations (part-based search, generated heading IDs, retained legacy fallback and direct-file ownership discipline) still apply.

## Independent integration, security and maintainability review

Reviewed the current dirty Live tree only. No browser/testing-agent calls, production activity, provider/email calls, reference-repository edits or Git state changes were made. The supplied baseline remains the incremental-delivery baseline; the lead owns final patch generation/apply-check. Existing source/tests/documentation were retained.

### Reproduced defects and fixes

- **Markdown container semantics and IDs:** a shortcode on an indented list continuation was accepted and lifted into an unrelated operational block. The parser now requires the entire shortcode to occupy a top-level paragraph, separated from prose/other calls, while literal fenced/inline code remains inert. Reserved `page-search`, `preview-*` and report-form `lf-*` IDs are rejected alongside existing shell/generated IDs, avoiding duplicate control/anchor targets. Rust regression failed on the list fixture before the fix.
- **Installed-content conversion:** valid installed image/link URLs containing unbalanced parentheses or entity-like query strings were altered by interpolating bare Markdown destinations; literal `&copy;` text also became a different character. Conversion now escapes plain text and angle-delimited URLs, preserving parsed link/image destinations and visible literal text. The regression validates installed site content first and inspects parsed destinations/text, rather than matching an implementation regex. Conversion remains draft-only, whole-set validated and non-overwriting.
- **Editor recovery after an outage:** a failed first GET followed by **Load current publication** installed the baseline without checking the saved tab draft, then removed that draft. Initial load and retry now share the same explicit recovery path. A browserless regression first failed because Restore draft was absent; it now confirms retained source/revision and reconciliation requirements after retry.
- **Composed report navigation:** only the currently displayed authored report route forced document navigation. Entering a custom report page through the shell created an SPA history entry whose Back could bypass `beforeunload`. Both source and target report routes now control navigation, including query/fragment destinations. A DOM test observes that actual React Router click handling no longer intercepts either the navigation entry or public link into the report.
- **Publication polling and private drafts:** deleting/replacing an authored report page during polling unmounted the private in-memory draft without any navigation guard. The network-free `PublicFrameContent` now holds the page publication while a report page is open, keeps site/live operational updates independent, and offers an explicit reload notice for newer pages. A regression types synthetic private text, deletes the page in a simulated publication update, and verifies the same draft and unload guard remain with zero browser storage use.
- **Operational component identity:** positional React keys remounted forms when prose was inserted before a live block. Block names (unique by server validation) and anchor IDs are now semantic keys. A regression first failed on form-node identity, then verifies the exact field and entered value survive the insertion. Lookup/map/subscription/report block lifetimes use the same registry/key path.
- **Publication transport:** page PUTs inherited a 12-second staff deadline despite the outer site's 90-second Git publication budget. `/api/pages/editor` mutations now receive the same bounded remote-confirmation budget as the other publication endpoints. Reads and inert previews retain the shorter budget; cancellation and no-automatic-retry behavior remain tested.

### Integration review findings

- File, local-Git and remote-first publication tests verify real `.md` files/blobs, old page-less bundles, source-on-disk, CAS conflicts, direct edits, restart/last-good, restore, rejected-push pending retention and successful retry. No format/persistence schema change was needed in this review.
- Explicit adoption and authored Guide/Help/FAQ ownership remain server enforced; shared site/event settings remain editable. Existing API and remote bundle tests retain validation, media/symlink/path checks and private-data exclusion. Operational shortcodes accept no media arguments; their images still come from structured validated site/wayfinding data. Public Markdown uses the existing URL/media allowlist and local-media existence checks.
- Preview still never mounts any of the eight operational components. Existing role/CSRF/logout/revocation tests, ID-only lookup tests, private receipt/report tests, map selection/focus and floor-pan tests all reran. These are synthetic server/DOM checks, not browser or provider acceptance.
- Inspected the renderer → operational App/PublicFrame → model/data seams and the site/staff barrels. The registry remains a closed typed component map, not executable content. No dependency was added/updated. Existing eager staff-route imports still contribute to the large main bundle; Classic/Admin and map pieces retain their existing chunks. The current production build reports main JS **729.67 kB / 214.34 kB gzip**, with the existing >500 kB warning. No performance win or bundle-size acceptance is claimed.
- Responsive CSS remains unchanged: public contents collapse at 760 px, the editor list at 900 px and metadata at 480 px; prose/media/table overflow uses existing constrained widths and wrapping. Code inspection is not alignment, mobile-device or accessibility acceptance.

### Final review checks

| Command | Observed result |
| --- | --- |
| `npm test` | **71 passed** |
| `npm run test:api` | **77 passed**, isolated fixtures/local Git remotes only |
| `npm run lint` | Passed without warnings after making recovery callbacks stable |
| `npm run build` | TypeScript/Vite passed; existing large-chunk warning above |
| `cargo fmt --check` (in `server/`) | Passed; `cargo fmt --manifest-path server/Cargo.toml` applied formatting to the Rust changes first |
| `cargo test --locked --manifest-path server/Cargo.toml` | **71 passed** |
| `cargo clippy --locked --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings` | Passed; manifest argument is before `--` so Cargo, not rustc, receives it |
| `cargo +1.87.0 test --locked --manifest-path server/Cargo.toml --target-dir server/target/rust-1.87-review` | **71 passed**, isolated target, no default toolchain change |
| `npm audit` | **0 vulnerabilities** |
| `git diff --check` | Passed |

Focused pre-fix runs deliberately failed on the defects above. One intermediate DOM identity assertion caused excessive diagnostic expansion and the test process was killed; changing that assertion to a boolean identity assertion exposed the intended failure without serializing React's cyclic DOM/fiber graph. A subsequent clean full frontend run passed. A hook dependency warning introduced by factoring recovery was corrected, not ignored. No existing regression was deleted or relaxed.

### Remaining handoff

No implementation/test blocker remains in these checks. The lead still owns final patch/apply-check and approved browser acceptance at 390/820/1440, especially custom report entry/Back/leaving, publication while a report is open, editor initial-error/retry/reload/logout, and preserved map/lookup/Classic/private workflows. Native unload prompts, rendering/focus/print, physical devices and assistive technologies require that handoff. The large bundle, actual deployment mounts/single-writer permissions, installed-data migration/rollback rehearsal, real GitHub policy, provider approvals, translations, authoritative November data and physical/accessibility-route verification remain open release gates. No human approval, event readiness or real-world accessibility claim was added.
