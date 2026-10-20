# Open decisions and required inputs

Approved answers are in [ADR 0001](../adr/0001-product-direction.md); do not ask Ian to re-approve ID-only lookup, two roles or separate Lemon services. Proposed defaults below are not approvals. No unanswered item blocks completing this documentation pass.

## Resolved in Ian's follow-up

- **D1/D2 accepted:** Google-only sign-in, Admin operational work and Super-only People/provider settings, behaving/functioning like Lemon. See [ADR 0003](../adr/0003-lemon-staff-parity.md) for the exact target. Implementation and account migration remain outstanding; do not re-ask these questions.

## Remaining product/system decisions

| ID | Question | Recommended default | When needed |
| --- | --- | --- | --- |
| D3 | Which translation provider/account and spending/privacy policy? | A bounded server-side provider over public strings, revision cache and English fallback; no auto-translating DOM widget. No paid vendor selected. | Before translation implementation; get explicit spend approval |
| D4 | Which launch languages? | Review the proposed common-language list in [localization](../localization.md); English stays default regardless. | Before translations/layout rehearsal |
| D5 | Which Berkeley sender/reply-to and who monitors replies? | Reuse Postmark if approved/configured with a verified berkeley.mt sender; manual staff handling, no false match promises. | Before confirmation-mail verification |
| D6 | When should roster/report/contact/outbox data be deleted, and are exceptions needed? | Clear roster after event with auto-sync disabled; propose lost-and-found contact deletion 30 days after event unless an active case needs an agreed exception. Neither policy is approved or implemented yet. | Before collecting real data; define what logs/provider retention also contain |

## Inputs rather than design questions

- Confirm final November event/schedule/help/FAQ/guide content and its editorial owner. April/demo data is not a substitute.
- Supply permitted floor plans, known room lists and route/entrance/accessibility verification ownership. A publication-rights and route-validation check is necessary even if interactive navigation is technically complete.
- Provide authorized ContestDojo event/configuration when implementation is ready, then choose actual per-test columns from the private import. Never reuse an old documented event ID without checking it belongs to the intended event.
- Establish a scoped Git publisher identity/installation and branch policy. Current protection and runtime credentials must be inspected, not inferred. No credential is requested merely to write docs.
- Agree on a separate rehearsal environment and realistic traffic mix before running a load test. 5,000 concurrent visitors is a proposed stress target, not a measured attendance/concurrency conversion.

## Delegated engineering recommendations already documented

Use the existing `content/` in the application GitHub repo, validate/reload content without routine rebuilds, design a multipage hub and interactive campus/indoor guidance, keep private DB storage and preserve last-good public data. These are proposals within Ian's delegated design space; no app implementation has started. Raise a new question only when evidence forces a material trade-off, not for every routine layout choice.
