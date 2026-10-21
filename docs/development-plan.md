# Implementation plan

Status: implementation sequence. Ian's follow-up instructed continuation from the docs without breaking existing functionality; slices 1–4, practical slice-5 graph mechanics and slice-6 receipt mail are now implemented and locally checked; full R05 editorial coverage, real provider/map acceptance and production activation remain open. Its human/browser prototype acceptance remains open, not implied by automated tests. Use small vertical slices with a working server/API + visitor/staff path and relevant tests in each; don't build every backend subsystem first.

## Markdown foundation update (2026-10-21)

Ian approved Markdown + shortcodes **inside Live**, without Zola/Typst execution. The working foundation now spans actual Home/Guide files, bounded parsing/safe public routes, generic staff metadata/source/preview/publish, deliberate conversion, separate Site settings and file/local-Git/remote persistence with CAS/last-good/pending/restore. [ADR 0007](adr/0007-markdown-pages-with-shortcodes.md), [exact contract](markdown-pages.md), [61 frontend + 77 API + 69 Rust test evidence](status/log/2026-10-21-markdown-STAGE.md).

**Exit still pending:** lead-owned browser/phone/tablet/desktop/keyboard/focus/print/accessibility review, installed-content adoption/rollback, actual durable container storage and authorized GitHub/provider verification. Automated tests do not approve the UI or production migration. This is an incremental patch over tree `c557c650bbbc269c03b978dd7a6d9d9116a57e70`, preserving existing dirty/untracked work; not a replacement patch against remote main. No new November facts, reference-repository edits or translation rollout.

## Slice sequence and exit criteria

| Slice | Deliverable | Exit evidence / dependencies |
| --- | --- | --- |
| 1. Public shell and navigation | Implemented: shared Home/Schedule/Updates/Map/Rooms/Guide/FAQ/Help/Report routes, real APIs, editable labels, legacy links | Local static-render/route/content/API checks pass; no long-page dependency. **Pending:** approved small-phone/keyboard/large-text/human prototype review. [Evidence](status/log/2026-10-20-public-hub-slice-1.md). R01/R02/R12/R13 |
| 2. Two-role staff access | Implemented: GIS/FedCM + verified Google/allowlist, Admin/Super server and shell, People, persistent 24-hour sessions and live revocation; explicit legacy/demo compatibility | Local synthetic JWT/People/API/JSDOM tests and full regressions. **Pending:** authorized real-origin Google, device/keyboard review and actual-account migration rehearsal. No production configuration changed. [ADR 0003](adr/0003-lemon-staff-parity.md), [evidence](status/log/2026-10-20-staff-google-slice-2.md). R08/R09 |
| 3. One GitHub publication path | Implemented opt-in: editor/direct commits -> remote-confirmed, validated atomic bundle/media; loaded/remote/pending/recovery UI; compatible local modes | Local bare-origin/API/browserless checks pass; [evidence](status/log/2026-10-20-github-publication-slice-3.md). **Pending:** remaining R05 copy/editorial migration, explicit data/media migration, actual branch/auth/storage/Actions verification. Required-PR publication needs an approved external merge path; no PR automation or protection bypass. R05/R06 |
| 4. ContestDojo and My rooms | Implemented opt-in private settings, bounded manual/minute imports, per-test mapping/diagnostics, ID-only public rooms and legacy compatibility | Synthetic/loopback provider/privacy/role/failure/restart tests pass; [evidence](status/log/2026-10-20-contestdojo-routing-slices-4-5.md). **Pending:** authorized real-provider field/ID/participation mapping, storage/retention activation and shared-campus abuse/capacity review. Independent of Lemon. R03/R10 |
| 5. Interactive wayfinding | Implemented practical directed graph, origin/destination, layers/step guidance, standard/step-free/closure filters and existing-editor integration; synthetic only | Local graph/routing/validation tests pass. **Not operationally complete:** verified November graph/assets/accessibility, closure procedures and approved on-site/device testing remain absent. Written routes are independent authored fallbacks, not inferred accessible paths. [Evidence](status/log/2026-10-20-contestdojo-routing-slices-4-5.md). R04 |
| 6. Lost-and-found confirmation | Implemented explicit Berkeley sender/reply-to validation, atomic private report/receipt/outbox, honest public email snapshots, bounded worker and capability-protected diagnostics/reviewed retry; old clients/inbox/subscriptions preserved | Synthetic loopback acceptance/rejection/timeout/restart/atomicity/idempotency/privacy/auth tests pass; [evidence](status/log/2026-10-20-lost-found-confirmation-slice-6.md). **Pending:** approved real sender/reply-to/reply monitoring and controlled delivery verification (D5), retention (D6), authorized browser/device review. No exactly-once or delivered claim, automatic deletion or paid translation. R11 |
| 7. Automatic translation | Language picker + cache/translation pipeline + English fallback, integrated with content editor status | Vendor/budget approved; public-only payloads, new-notice freshness, RTL/long-text journey tested. R07 |
| 8. Visitor rehearsal and readiness | Device/accessibility/content/scale checks and fixes across all journeys | Evidence in status log, verified November schedule/locations, no invented pass marks. R01–R13; recovery/HA remains deferred. |

The order can change after prototype feedback or data readiness. Do not let unavailable floor plans block unrelated small improvements; do not mark wayfinding complete without them. No date/freeze promise from Lemon is automatically imported into Live's plan.

## Before each change

1. Read the current requirement, applicable design guidance and existing implementation; name what must remain working.
2. Confirm scope/system or UX choices not already delegated. Keep an explicit pending decision rather than silently treating a demo choice as policy.
3. Define acceptance and regression tests with realistic synthetic fixtures. No real roster in fixtures.
4. Implement the smallest end-to-end path. Update API/content contracts and migration notes in the same change.
5. Run relevant checks; test denied/failure states, not just a happy-path screenshot. Get approval before UI-driven testing or external-service side effects when required.
6. Record exact revision/environment/results and unresolved items. Deliver one combined patch applicable to current remote main unless Ian explicitly requests another Git workflow. Do not push/deploy/merge merely because the docs mention it.

## Scope protection

Do not remove `/classic`, subscriptions, working schedule/announcement controls or existing account access without a deliberate approved transition. Do not modify Lemon to make Live easier to implement. Shared services/SSO, competition timer control, HA/failover and large disaster-recovery work are outside this target.
