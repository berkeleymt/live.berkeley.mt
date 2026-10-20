# Working on BMT Live

Applies to contributors and agents regardless of tool name.

1. Read [the handbook](README.md), [status](status/STATUS.md), [requirements](specs.md) and [open decisions](status/decisions.md) before changing behavior.
2. Before UI work, read [design system §1](design-system.md#1-principles), [public journeys](public-ux.md) and the referenced Lemon skills. Do not copy Lemon's private staff information architecture into the public site.
3. Follow [the slice checklist](development-plan.md#before-each-change). Confirm the plan for a new feature; minimize unrelated work and preserve working features. Never infer approval from an unchecked proposal or from the synthetic demo.
4. Keep public Git content separate from private data. Never commit credentials, staff hashes, visitor contacts or roster rows. Use synthetic fixtures and approved provider access only.
5. Validate server permissions independently of the UI; preserve API clients, data and URLs through deliberate migrations. Live does not control Lemon timers.
6. Run relevant [checks](testing.md). Do not mark browser/accessibility/provider tests complete from a successful build. Only use approved UI-driven tests; no production load or real-email probes without coordination.
7. Update docs/contracts, add a short ADR for major decisions, and log evidence. Humans approve product changes; agents may recommend and record actual user decisions with their source.
8. Default delivery is a single downloadable patch against freshly fetched remote main, not a surprise PR or production deployment. Follow any later explicit Git instruction. Keep all work for the slice on one branch and avoid unrelated commits.

Lemon's docs are references. Do not edit its repository, adopt its backend-only invariants verbatim, or claim shared infrastructure exists. This handbook's source snapshot is listed in [status](status/STATUS.md).
