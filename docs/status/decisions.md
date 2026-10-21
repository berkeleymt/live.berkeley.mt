# Open decisions and required inputs

Approved answers are in [ADR 0001](../adr/0001-product-direction.md); do not ask Ian to re-approve ID-only lookup, two roles or separate Lemon services. Proposed defaults below are not approvals. No unanswered item blocks completing this documentation pass.

## Resolved in Ian's follow-up

- **GitHub deployment configuration accepted:** individual Actions Variables/Secrets, explicit production confirmation and preflight checks; incremental delivery over the latest Markdown patch. Private repository status does not justify committing `.env`. No deployment authorization was given. The owner must still provide/verify storage, approved accounts and RBAC. [ADR 0008](../adr/0008-github-managed-deployment.md).

- **D1/D2 accepted:** Google-only sign-in, Admin operational work and Super-only People/provider settings, behaving/functioning like Lemon. See [ADR 0003](../adr/0003-lemon-staff-parity.md) for the exact target. Implementation and account migration remain outstanding; do not re-ask these questions.

## Remaining product/system decisions

| ID | Question | Recommended default | When needed |
| --- | --- | --- | --- |
| D3 | Which translation provider/account and spending/privacy policy? | A bounded server-side provider over public strings, revision cache and English fallback; no auto-translating DOM widget. No paid vendor selected. | Before translation implementation; get explicit spend approval |
| D4 | Which launch languages? | Review the proposed common-language list in [localization](../localization.md); English stays default regardless. | Before translations/layout rehearsal |
| D5 | Which Berkeley sender/reply-to and who monitors replies? | Slice 6 implements an opt-in Postmark outbox with explicit validated berkeley.mt sender/reply-to and no fallback. Actual mailboxes, Postmark verification, reply monitoring and controlled delivery testing remain **unapproved/unverified**; no production activation. | Before enabling real confirmation mail |
| D6 | When should roster/report/contact/outbox data be deleted, and are exceptions needed? | Clear roster after event with auto-sync disabled; propose lost-and-found contact deletion 30 days after event unless an active case needs an agreed exception. Neither retention policy is approved or implemented; slice 6 adds **no automatic deletion**. Include report/status/mail action history, backups and provider records in the decision. | Before collecting real data; define what logs/provider retention also contain |

## Inputs rather than design questions

Historical floor plans supplied: corrected Dwinelle/Wheeler/VLSB 2050–2060 sources are integrated under [ADR 0006](../adr/0006-historical-floor-plan-guidance.md). This resolves source selection, not current route/accessibility approval or November room assignments. Indoor pixel coordinates remain separate from outdoor OSM; no inferred cross-floor links.

- Confirm final November event/schedule/help/FAQ/guide content and its editorial owner. April/demo data is not a substitute.
- Supply permitted floor plans, known room lists and route/entrance/accessibility verification ownership. A publication-rights and route-validation check is necessary even if interactive navigation is technically complete.
- Provide authorized ContestDojo event/configuration when implementation is ready, then choose actual per-test columns from the private import. Never reuse an old documented event ID without checking it belongs to the intended event.
- Establish a scoped Git publisher identity/installation and branch policy. Current protection and runtime credentials must be inspected, not inferred. No credential is requested merely to write docs.
- Agree on a separate rehearsal environment and realistic traffic mix before running a load test. 5,000 concurrent visitors is a proposed stress target, not a measured attendance/concurrency conversion.

## Delegated engineering recommendations already documented

Use the existing `content/` in the application GitHub repo, validate/reload content without routine rebuilds, design a multipage hub and interactive campus/indoor guidance, keep private DB storage and preserve last-good public data. The multipage hub is implemented in slice 1 under Ian's follow-up instruction to continue from the docs. Canonical GitHub publication is now an opt-in slice-3 runtime/UI with locally tested failure recovery; activation and full public-copy coverage remain open; practical interactive routing is now locally implemented in slice 5 but still needs verified November data and field/device review; this is not approval of a new provider or production rollout. Raise a new question only when evidence forces a material trade-off, not for every routine layout choice.

### Slice-1 engineering decisions (2026-10-20)

- Keep `/rooms` for the existing private lookup and directions; introduce `/map` by reusing the public wayfinding renderer without a second lookup form. Do not invent a `/my-rooms` contract or silently switch the code-gated lookup policy in the shell slice.
- Keep site schema v1 and normalize old homepage links on read. Fill missing core links from shipped defaults; persist migration only when a staff editor explicitly requests/saves it. Existing authored labels and custom links survive.
- Own one site/live poller in the public shell. Compose guide and room content without nested main landmarks, and preserve report unload protection through document navigation. Use existing real APIs; do not manufacture current-event data from bundled fallback copy.

### Slice-3 engineering decisions (2026-10-20)

- Dedicated bare content cache, not app worktree reuse. Same-repository `content/` allowlist and no executable checkout; existing schema validators, file/local Git modes and private data stores remain.
- Remote-confirmed normal push + complete validation before activation. Durable loaded/pending/archive refs, full-content CAS with code-only parent preservation; never automatic force-push, reset, rebase or branch-protection bypass.
- Protected-branch rejection retains drafts; no automatic PR/check/signing integration. Authorized external merge is required where policy disallows direct saves. Super sees deployment-owned setup guidance; credentials remain outside content/API.
- Keep content-only CI build/deploy skipping behind an off-by-default repository variable, enabled only after runtime migration/reload verification. Local fixtures and browserless tests do not establish provider/device/production acceptance.
- R05 all-copy coverage remains explicit follow-up, not a claim that every public literal/image now has an editor. [Scope, checks and open work](log/2026-10-20-github-publication-slice-3.md).

### Slice-1 retained compatibility note

- Keep subscriptions on `/updates` and old map/time tools under `/classic`. No API removal, identity change, roster/report migration, remote publishing or deployment. Human/device/accessibility acceptance remains pending; local tests do not grant it.
