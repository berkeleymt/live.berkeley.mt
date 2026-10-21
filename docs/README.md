# BMT Live documentation

Start here. This is the product and engineering handbook for the November 14, 2026 tournament, not a claim that the current demo meets every requirement.

## Read in this order

1. [Status](status/STATUS.md): what exists, what is verified, what remains.
2. [Requirements](specs.md): Ian's approved scope and observable acceptance criteria.
3. [Public experience](public-ux.md) and [design system](design-system.md): visitor journeys and the design bar.
4. [Architecture](architecture.md), [API contracts](protocol.md), and [permissions](permissions.md): boundaries and invariants.
5. [Implementation plan](development-plan.md): small server + web slices, not a backend-only batch.

## Reference by job

| Job | Read |
| --- | --- |
| Author Markdown pages or migrate legacy Guide/Help | [Markdown syntax/editor/API/recovery](markdown-pages.md), [ADR 0007](adr/0007-markdown-pages-with-shortcodes.md) |
| Design public pages or maps | [Public UX](public-ux.md), [design system](design-system.md), [localization](localization.md) |
| Connect ContestDojo | [Verified Lemon parity reference](setup-contestdojo.md) |
| Configure/deploy through GitHub without SSH | [GitHub Variables/Secrets and owner checklist](github-deployment.md) |
| Change staff access | [Permissions](permissions.md), [current staff implementation](staff-access.md) |
| Operate the current application | [Staff guide](guide.md), [runbook](runbook.md), [demo walkthrough](demo.md) |
| Verify a change | [Testing](testing.md), [change workflow](CLAUDE.md) |
| Understand why a choice was made | [Approved product decisions](adr/0001-product-direction.md), [proposed content publication](adr/0002-github-content-publication.md), [accepted Lemon staff parity](adr/0003-lemon-staff-parity.md) |
| Pick up unfinished work | [Status tracking rules](status/README.md), [open decisions](status/decisions.md), [session log](status/log/2026-10-20-documentation-baseline.md) |

## Source of truth and terminology

- **Approved requirement** means Ian explicitly requested it. An ADR records the source; it is not an implementation receipt.
- **Proposed design** means an engineering recommendation or delegated design choice not yet implemented. Do not present it as a user approval.
- **Implemented** requires code evidence; **verified** requires a recorded check on a named revision/environment. A green build is not a usability, scale, privacy, or content review.
- When older feature notes conflict with the approved target, use `specs.md` for the target and source code for current behavior. Do not change working behavior merely to make the docs consistent.
- The seven original feature/demo documents remain useful implementation references. Their builder-stage TODOs and old role/lookup decisions are not the current product plan.

This handbook describes Live only. Lemon and TakeTransit remain separate applications. No secrets, roster rows, private reports, or production credentials belong in these docs.
