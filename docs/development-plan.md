# Implementation plan

Status: proposed sequence for approval, **not authorization to begin a redesign**. This pass changes Markdown only. Use small vertical slices with a working server/API + visitor/staff path and relevant tests in each; don't build every backend subsystem first.

## Slice sequence and exit criteria

| Slice | Deliverable | Exit evidence / dependencies |
| --- | --- | --- |
| 1. Public shell and navigation | Prototype Home + dedicated Schedule/Help destinations using real existing APIs; corresponding editable English labels | All old functions remain reachable; no long-page dependency; small-phone/keyboard/large-text journeys reviewed. Confirm prototype before expanding. R01/R02/R12/R13 |
| 2. Two-role staff access | Approved Lemon-equivalent Google login and Admin/Super admin policy in server and shell, People and revocation path | [ADR 0003](adr/0003-lemon-staff-parity.md) parity tests, existing-account migration rehearsal, no production demo backdoor. R08/R09 |
| 3. One GitHub publication path | Editor -> GitHub -> validated runtime content bundle including files/media; direct-file edits take same path | Atomicity/conflicts/invalid commits, protected-branch behavior, remote vs loaded status, no app rebuild for a pure content edit. Inventory and migrate all remaining public copy. R05/R06 |
| 4. ContestDojo and My rooms | Settings + manual/background import + per-test mapping + ID-only room response + public page | Sanitized provider fixtures, parity and privacy tests, unmatched-room UX, real authorized setup check. Independent of Lemon timer control. R03/R10 |
| 5. Interactive wayfinding | Search/origin -> campus + floor routes -> readable step guidance, with staff route/asset editing | Verified graph/asset inputs; standard/step-free routes, closures and no-route cases tested on site. Text fallback alone is not completion of interactive guidance. R04 |
| 6. Lost-and-found confirmation | Required email, private stored report + outbox, visitor receipt/email state, staff delivery diagnostics | Controlled Berkeley-sender delivery and failure/retry/idempotency tests; approved retention policy. Preserve existing inbox. R11 |
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
