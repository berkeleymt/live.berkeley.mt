# ADR 0005 — Private lost-and-found receipt outbox

Date: 2026-10-20

Status: Implemented engineering choice for slice 6 under the instruction to continue from the documented plan. **Not** approval of a real sender, provider activation, retention policy, deployment or spending.

## Context

R11 requires private reports and confirmation mail from berkeley.mt without breaking the existing receipt/inbox/status/notes or email subscriptions. The report must survive provider outages. A network timeout or server crash may happen after Postmark accepts a message. Postmark's [email API](https://postmarkapp.com/developer/api/email-api) and [overview/error semantics](https://postmarkapp.com/developer/api/overview) do not establish an exactly-once send contract for this path; their HTTP 500 guidance says messages are lost “in most cases,” not always.

## Decision

1. Add `lf_outbox` and `lf_mail_actions` in the existing durable private SQLite store. A new confirmation request atomically saves report + receipt + one outbox job; commit before answering and before any provider call. Additive phone migration and legacy submission fingerprints preserve existing rows/replays. Never move contacts or notes into public Git/content.
2. Add `confirmationEmail` as a compatibility opt-in on the API. The current public form requests confirmation with explicit copy. Old clients that omit the field retain exactly `{receipt}` and no mail. Requested confirmations return only `{receipt,emailState}`; an explicit same-key/body replay refreshes the snapshot without a public receipt lookup or persistent browser contact storage.
3. Require explicit enable flag, token and **both** plain sender/reply-to addresses with exact berkeley.mt domain. Do not inherit the subscription sender fallback or invent a monitored mailbox. Demo mode never starts the worker. Settings are deployment-owned, read-only and Super-only; inbox operators see sanitized configuration state.
4. Run one bounded worker per private DB/process using existing reqwest. Disable automatic client retries/redirects, bound time/body/attempts, persist claim before sending and persist safe backoff. Accept only HTTP 200/ErrorCode 0/valid MessageID as `accepted`, not `delivered`. Connection-stage failure and explicit 429 permit bounded retry; ambiguous transport/response/provider outcomes become `uncertain` and stop automatic attempts.
5. On restart, unfinished `sending` jobs become uncertain. On config disable, pending work becomes not configured; enabling later does not mail an old backlog automatically. No exactly-once or guaranteed delivery claim: operator-approved retries of uncertain jobs may duplicate a message.
6. Both Admin and Super retain operational `found:read/write`; delivery actions enforce session/capability/CSRF/origin, UUID replay, delivery revision and private audit independently of UI. Uncertain retry requires a provider-check note and explicit duplicate-risk acknowledgment. Manual handling records staff follow-up without asserting delivery or changing report status/notes. Accepted/active/legacy/handled jobs cannot be resent through this endpoint.
7. Keep the announcement/subscription sender untouched. Do not add a paid dependency, translation, deletion scheduler, automatic contact export or delivery webhook in this slice.

## Consequences and limits

Reports remain available during mail outages and duplicate public requests do not enqueue duplicate jobs. Conservative ambiguous-outcome handling may require manual intervention even when no message was sent; that is preferable to blindly resending after acceptance. A late durable-storage failure needs restoration/restart and provider review. Multiple active worker processes or stale-backup restoration require explicit reconciliation; this is not HA infrastructure.

Only receipt reference and recipient are in provider payloads; staff notes/item details/name/phone stay private. Action/result snapshots are bounded in API output, not destructively pruned in storage. D5 still needs approved verified sender/reply-to and reply monitoring. D6 still needs retention for reports/contacts/outbox/history/backups/provider logs. D3/D4 remain open, with English authoritative. Synthetic loopback/static/API evidence is not real-mail, browser/device, accessibility or capacity evidence. See [contract/setup/recovery](../lost-found.md) and [work log](../status/log/2026-10-20-lost-found-confirmation-slice-6.md).
