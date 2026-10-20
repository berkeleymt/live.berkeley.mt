# Current status

Updated: 2026-10-20. Baseline: Live [0d56ff0](https://github.com/berkeleymt/live.berkeley.mt/commit/0d56ff03f527b6bed00eafe6ae6c8a34cb17fc41); Lemon reference [77721d0](https://github.com/berkeleymt/proctor-suite/commit/77721d0). This change is documentation-only, with no new deployment/provider access.

## Summary

The integrated synthetic demo is functional scaffolding. The November product direction is now documented; it is **not fully implemented or tournament-ready**. [Requirements](../specs.md), [plan](../development-plan.md) and [open decisions](decisions.md) define the next work.

| Area | Implemented baseline | Still required / not newly verified |
| --- | --- | --- |
| Public experience | Today, guide, room finder, report form, classic route, subscriptions | Final multipage design, all-copy editorial coverage, real-user/device/a11y review |
| Public content | File stores; optional dedicated local Git checkout, complete editorial bundle, preview/apply/history/restore/push | GitHub canonical same-repo runtime reload, complete assets, clear remote vs loaded state |
| Staff | Named local accounts/capabilities, private inbox, Lemon link | Implement accepted two-role Google/People/sidebar behavior from Lemon, with deliberate account migration |
| Student rooms | Synthetic/private-import ID + code lookup | ID-only public projection and actual ContestDojo setup/manual + auto sync/mapping |
| Maps | Search/directions, fictional room/floor example, unverified campus markers | Verified November buildings/rooms/entrances/floors and interactive routing |
| Lost-and-found | Private SQLite records, receipt, staff status/audit | Visitor confirmation email and approved retention |
| Languages | English UI/content | Automatic translation + disclaimer/fallback/layout tests |
| Deployment | Build/push + Kubernetes restart workflow; absolute content paths | Actual storage/replica audit as needed; no new production check in this docs pass |

## Verification history and limits

Earlier integrated-demo checks in this session passed build/full lint/strict Clippy, 36 Rust tests, 61 Node API/integration tests and 9 schedule tests. They exercised the **old/demo** role and code-gated lookup contracts, not the new requirements. They are historical results, not rerun in this documentation change.

The local-setup follow-up ran `npm ci`, which reported 12 dependency vulnerabilities (1 low, 2 moderate, 9 high). No dependency fixes or reachability assessment are included; review and test appropriate upgrades before claiming event readiness.

Earlier production smoke observed the new app/APIs and demo mode off, but April 12 BmMT content. No real November schedule/room data, actual ContestDojo connection, lost-and-found email, cross-device browser rehearsal or 5,000-user capacity test is claimed. Separate Lemon sign-in is intentional; shared SSO is not a missing launch requirement.

## Recent changes

- Local-setup follow-up: condensed the root README in Lemon's style; recorded accepted Google/People/tab/identity parity in [ADR 0003](../adr/0003-lemon-staff-parity.md), resolving D1/D2. Verified Linux demo build/start and HTTP smoke, 9 schedule tests, 61 API/integration tests and lint. These still exercise the existing demo, not the future auth/lookup policies. [Work log](log/2026-10-20-readme-and-staff-parity.md).
- Documentation baseline: requirements, public UX/design, architecture, role matrix, current Lemon import parity, localization, API boundaries, staff/deployment/testing guides, ADRs and implementation plan. Legacy feature notes labeled as implementation/history rather than accepted target. [Work log](log/2026-10-20-documentation-baseline.md).

## Next action

D1/D2 are resolved: implement the accepted Lemon staff behavior when that feature slice is started. Review the first public prototype scope before feature implementation. Other external inputs can be gathered alongside small approved slices. Recovery/HA work remains deferred.
