# Private lost-and-found and confirmation mail

> **Slice 6 implementation reference.** The integrated form at `/lost-found` saves a private report and requests a receipt email. The private inbox at `/admin/lost-found` retains status, notes, audit and manual contact drafts, and now shows separate email diagnostics and reviewed recovery actions. This is locally tested scaffolding, **not verified production mail delivery**. D5 (real sender/reply-to/reply monitoring) and D6 (retention) remain open. English remains authoritative; D3/D4 are untouched.

## Data boundary and startup

`PRIVATE_DB_PATH` must be a durable SQLite file in a private directory **outside STATIC_DIR, the checkout and public content Git**. Its parent must exist; directory mode 0700 is recommended. The server restricts the DB file to 0600 on Unix; operators must also protect WAL/journal files, backups and provider logs. This is not encryption. Run **one Live process/receipt worker per private database**; do not share this outbox between rolling replicas. SQLite work in request handlers and the worker runs through `spawn_blocking`.

Startup adds `phone TEXT NOT NULL DEFAULT ''` to old report tables if missing, plus `lf_outbox` and `lf_mail_actions`; it does not delete, re-fingerprint or overwrite old reports, status history, contacts or notes. `lf_reports`, `lf_history` and `lf_meta` remain. Legacy reports have `delivery: null`; there is no automatic backfill/send. `LostFoundStore::open(path, demo)` retains its disabled-mail behavior; main uses `MailConfig::from_env` / `open_with_mail` for explicit configuration and starts one bounded worker.

Report, random receipt and requested outbox job commit **in one transaction before success is returned**. Failed outbox insertion rolls back the report. Provider sending happens after commit, never on the public request's critical path. Neither these private rows nor mail actions enter Git, public content, media, roster APIs or public exports.

## Explicit configuration (not production approval)

Receipt mail needs all of these, configured privately at deployment and read at startup:

| Variable | Meaning |
| --- | --- |
| `LIVE_LOST_FOUND_MAIL_ENABLED=true` | Explicit opt-in, exact lowercase value; default off |
| `POSTMARK_SERVER_TOKEN` | Existing secret; never put it in content, client code, docs, logs or Git |
| `LIVE_LOST_FOUND_MAIL_FROM` | Approved, Postmark-verified plain mailbox at exactly `berkeley.mt` |
| `LIVE_LOST_FOUND_MAIL_REPLY_TO` | Approved, monitored plain mailbox at exactly `berkeley.mt` |

There is **no default/guessed sender or reply-to** for receipt mail. Both must pass email syntax and exact-domain checks (no display-name syntax, subdomains, CRLF or alternate domains). Token controls/oversize are rejected. Missing/disabled settings produce `not_configured`; invalid supplied values produce `invalid_configuration`. `ready` means local syntax/configuration is present, **not** that Postmark verified the sender or delivered mail. `DEMO_MODE=true` disables the worker regardless of credentials; synthetic seeded rows and new demo submissions cannot be sent, even after a non-demo restart. Do not enable real mail during local tests.

The inbox exposes sanitized `mailConfiguration` to `found:read`. Super-only `GET /api/settings/lost-found-mail` (`settings:write`) returns `{status, from, replyTo, provider:"Postmark", deliveryTracking:false}`; sender/reply-to are null unless ready, and no token is returned. The inbox's **View Super mail configuration** control displays this read-only deployment configuration. Admin and Super can operate the inbox; only Super sees the provider configuration route.

Existing announcement/subscription configuration and sending in `server/src/email.rs` are unchanged, including their legacy `POSTMARK_FROM_ADDRESS` behavior. Receipt mail does not subscribe a reporter, unsubscribe them, mark announcements emailed, or reuse that sender fallback. The token is shared only when explicitly configured; consider provider-level permissions/monitoring before activation.

## Public submission and receipt contract

`POST /api/lost-found`, JSON, maximum **12 KiB**:

```json
{
  "idempotencyKey": "<client-generated UUID v4>",
  "kind": "lost",
  "description": "Synthetic example: blue bottle with a star sticker",
  "location": "Demo room entrance",
  "occurredAt": "November 14, 2026, about 9 am Pacific",
  "name": "",
  "email": "synthetic-person@example.invalid",
  "phone": "",
  "confirmationEmail": true
}
```

- `kind`: `lost` or `found`. Unknown fields/types rejected. Description 5–2000 characters; location 2–200; occurredAt 2–120. Approximate time/“Unknown” are plain text, not invented timestamps.
- Name defaults empty, maximum 100 characters. Email remains required, maximum 254 ASCII bytes; syntax is checked, not ownership. Parent/guardian email is welcome. Optional phone defaults empty, maximum 80 characters; contact capability is not removed. Whitespace is trimmed; control characters are rejected except ordinary text newline/tab; email cannot contain header injection. React renders escaped text, not raw HTML/Markdown.
- `confirmationEmail` is optional/default false for compatibility. **Existing clients that omit it still receive exactly `{"receipt":"<random UUID>"}` and do not unexpectedly send mail.** Empty phone/default false are omitted from the fingerprint serialization, preserving pre-slice submission hashes. Changing any normalized supplied field, including the confirmation request, under the same key is 409.
- The current public form clearly explains confirmation and sends `confirmationEmail:true`. Success is **201** with exactly `{"receipt":"<random UUID>","emailState":"queued"}` when configured, or `not_configured` when disabled/invalid/demo. No report ID, contact, item details, provider ID, diagnostics or staff notes are returned.
- An identical retry returns the **same receipt and current email-state snapshot**, including after restart or staff updates. No second job is enqueued. There is no public listing, receipt readback or status-by-receipt endpoint. The receipt is a staff reference, not a bearer readback secret.
- The frontend keeps the original payload/key **in memory only**, locks editing after uncertain submit results, and retries the same body. After success, **Check confirmation status** explicitly replays that same request; it neither creates a second report nor forces mail retry. No polling, offline queue, automatic submit retries, URL contacts or browser storage. Reload loses the in-memory status-check context; save the receipt and ask staff rather than resubmitting.
- Report saved, provider accepted and inbox delivered are separate claims. The UI never says “delivered.” Rejection/timeout of a status refresh does not discard the saved receipt.
- Invalid extraction is 400/422, semantic validation 422, oversize 413, request limit 429, storage failure 503. Errors are generic; no private paths/other reports. Saving a report does not promise a match, return or follow-up.

### Email states and provider semantics

Official references reviewed before implementation: [Postmark email API](https://postmarkapp.com/developer/api/email-api) and [API overview/error semantics](https://postmarkapp.com/developer/api/overview). No undocumented provider idempotency key or exactly-once guarantee is assumed. The receipt in `Metadata` is a correlation aid, **not deduplication**.

The worker uses existing `reqwest`: `POST https://api.postmarkapp.com/email`, `X-Postmark-Server-Token`, explicit `From`, `ReplyTo`, `To`, `MessageStream:"outbound"`, `Tag:"lost-found-receipt"`, `Metadata.receipt`, plain `TextBody`, `TrackOpens:false`, `TrackLinks:"None"`. Only the recipient and receipt reference leave private storage; no name, phone, item description/location, staff note or internal report ID is in the provider payload. Message text acknowledges receipt only. No delivery/bounce webhook is implemented.

| State | Meaning / recovery |
| --- | --- |
| `queued` | Saved and eligible for a worker attempt, not provider-accepted |
| `not_configured` | Saved but no mail being sent; manual handling or reviewed retry after approved configuration |
| `sending` | Claim/attempt count durably committed before network call; outcome not known |
| `retry_wait` | Connection-stage failure or explicit HTTP 429; next eligible attempt persisted |
| `accepted` | HTTP 200 + `ErrorCode:0` + valid UUID `MessageID`; **not proof of inbox delivery**; no resend action |
| `failed` | Explicit HTTP 401/404/413/415/422 rejection, or safe retry budget exhausted; staff follow-up |
| `uncertain` | Transport/response timeout, malformed/oversize acknowledgement, other status (including 500/503), or interrupted attempt; **no automatic resend** |
| `handled` | Staff recorded manual follow-up; no message sent by that action and no delivery claim |

Postmark describes HTTP 500 messages as lost “in most cases,” not always. A timeout may occur after acceptance. These are deliberately `uncertain`; safe retry cannot be inferred from a missing acknowledgement. Unknown/malformed 200 results are also uncertain rather than fake success.

One awaited request runs at a time: 12-second total/4-second connect timeout, redirects off, **reqwest internal retries off**, acknowledgement body capped at 16 KiB. At most five automatic attempts; each retry waits `30 + uniform(0, min(30 * 2^attempts, 3600))` seconds. Worker pacing is at least two seconds between jobs with jitter; storage failures add bounded backoff (up to 62 seconds including floor). There is no unbounded task spawning. Staff can authorize individual further attempts, capped at ten total; attempt counters never reset.

On startup, any `sending` job becomes `uncertain` with `interrupted_attempt`; it is never automatically replayed. Queued/retry-wait jobs survive a configured restart. Starting with mail disabled/invalid/demo pauses them as `not_configured`; later configuration **does not automatically send that backlog**. Staff must review and retry, or record manual handling. If durable completion fails after the provider call, the job stays `sending`; the operator must restore private storage and restart the single process so it becomes uncertain. Review provider activity before resending. A restored stale backup also needs deliberate reconciliation, not automatic activation.

## Private inbox and report updates

Trusted staff middleware inserts `LostFoundAccess { actor, can_read, can_write }` from verified current capabilities, never public headers/role claims. No extension → 401, insufficient capability → 403. Blank/oversized actor identities fail closed. Legacy Basic Auth alone does not grant module access. Current Admin/Super both have `found:read` and `found:write`; existing legacy/demo role compatibility remains. Same-origin cookies, live session/role/revocation and CSRF/origin checks remain authoritative.

`GET /api/lost-found/staff?q=bottle&kind=lost&status=new&limit=20&offset=0` requires `found:read`:

- Kind/status filters; statuses `new`, `found`, `contacted`, `resolved`. `q` maximum 100, literal substring matching description/location/name/email/receipt with SQL binding and escaped LIKE wildcards. Search URLs contain private terms: **do not log query strings**.
- Limit defaults 20, range 1–50; offset 0–10000. Newest first, deterministic ID tiebreak. Response `{reports,total,limit,offset,demoMode,mailConfiguration}`.
- Reports retain existing fields `id,receipt,kind,description,location,occurredAt,name,email,status,notes,createdAt,updatedAt,revision,synthetic,history`; add `phone` and `delivery` (null for legacy/no request).
- Delivery contains `{state,revision,attempts,nextAttempt,updatedAt,diagnostic,providerId,history}`. `nextAttempt` is nullable Unix seconds; timestamps are RFC3339. Diagnostics are fixed safe codes, not provider response bodies. Delivery history is latest 20 `{at,actor,action,note}` actions; older private records remain. Provider IDs are private staff-only data.

`PATCH /api/lost-found/staff/{id}` requires `found:write`; body `{idempotencyKey,revision,status,notes}` is unchanged. Notes maximum 4000 characters. Status/notes/audit commit atomically, stale report revision → 409; exact same actor/id/body/key replays without another entry, changed replay → 409. This report revision is **independent of delivery revision**, so worker progress does not prevent saving notes. `contacted` means staff actually reached out; changing status sends no email.

**Open email draft** remains URI-encoded `mailto:`, not an automatic send or contacted-state update. Synthetic contacts (seeded or submitted in demo mode) disable this action. Optional phone is shown privately, not included in provider mail. The inbox retains explicit Save/Discard, filters, pagination, empty/loading/error/success, status history and unsaved/uncertain-action guards. All new controls use existing tokens/styles, labeled inputs, visible focus and 48px minimum targets; no animation is added. Static checks do not establish device/keyboard/screen-reader acceptance.

### Private delivery action

`POST /api/lost-found/staff/{id}/mail` requires `found:write`, `X-Staff-Request:1`, and the normal cookie-CSRF/origin protections, body cap 12 KiB:

```json
{
  "idempotencyKey": "<client-generated UUID v4>",
  "revision": 3,
  "action": "retry",
  "note": "Synthetic example: checked provider activity before retrying.",
  "confirmDuplicateRisk": true
}
```

- `revision` is the **delivery** revision. `action` is `retry` or `handled`; note is trimmed, required 5–500 characters. `confirmDuplicateRisk` defaults false. Unknown fields/types rejected.
- Eligible states are `not_configured`, `failed`, `uncertain`, `retry_wait`. No resend for legacy/no-job, queued, sending, accepted or handled jobs. Stale revision/ineligible state is 409.
- Retry requires ready configuration, non-demo/non-synthetic report and fewer than ten total attempts. From uncertain, `confirmDuplicateRisk:true` is mandatory. Staff must first check Postmark activity using receipt metadata, recipient and attempt time; prefer manual follow-up when acceptance cannot be resolved.
- `handled` records the described manual follow-up and stops automatic retries; it does not send mail or change report status/notes.
- The outbox transition and private action audit are atomic. Same actor/id/payload/key replay returns the current private report without duplicate action; conflicting replay is 409. Response 200 is the private report, not a “sent” assertion. Ambiguous client response retries use the original body/key; no automatic action loop.
- UI defaults to recording manual follow-up, offers reviewed retry only when eligible, and requires an explicit risk checkbox for uncertain retries. A conflict instructs staff to preserve their note, discard the stale action draft and refresh.

## Privacy, abuse and retention

Module routers set `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Exclude `/api/lost-found*` and settings/private APIs from service-worker caches, telemetry, query/body logging and exports. No private data is stored in browser persistence. Provider metadata and server backups still need approved access/retention policy.

Existing process-local bounds remain: **60 public requests per socket peer per 10 minutes**, **1000 globally per 10 minutes**, **5 new reports per contact per 30 minutes**; at most 4096 buckets. Exact replay bypasses new-contact quota, not peer/global quota. Contact keys are salted SHA-256 in memory. 429 includes conservative `Retry-After:1800`. Restart resets process-local limits; this is not a complete distributed abuse system. Arbitrary `Forwarded`/`X-Forwarded-For` are ignored. Behind a proxy, all visitors may share its peer bucket; separately approve/test trusted-edge quotas before launch rather than parsing attacker-controlled headers.

`DEMO_MODE=true` atomically seeds two fictional reports once (`lf_meta.demo_v1`). It never overwrites real/previous records, and turning demo off does not delete synthetic rows. No confirmation backlog is created for seeded reports. New demo submissions are persistently marked synthetic; mode changes cannot make them eligible for mail. Older user-created demo rows were not reliably marked, so never promote an existing sandbox database into production; no speculative backfill relabels old records. No new dependency or real provider credential is needed for synthetic rehearsal.

**No automatic deletion, retention scheduler, destructive inbox action or contact export was added.** D6 must define report/contact/outbox/action history, backups and provider retention, including exceptions and operator ownership, before real collection. D5 must name/verify the real Berkeley sender/reply-to and reply monitor before separately authorized delivery testing. D3/D4 are open; no paid translation/provider spending is enabled.

## Verification and limits

- `cargo test --locked --manifest-path server/Cargo.toml`: module tests include atomic rollback, concurrent duplicate receipt/job, legacy fingerprint/schema migration, restart, disabled/demo behavior, automatic/staff attempt ceilings, audit/action replay/conflict, independent notes, and loopback fake-Postmark HTTP success/rejections/429/500/503/redirect/malformed/oversize/timeout/connection failure. Fixtures assert minimal provider payload and no real provider access.
- `node --test tests/lost-found.test.mjs`: temporary generated Cargo harness imports the actual module, launches only ephemeral loopback servers/private DBs, and checks legacy API, privacy, limits, read/write boundaries, mail action intent and idempotent manual handling/restart. Its `x-test-role` adapter is test-only, never production authentication.
- `npm run test:api`: actual application Admin/Super/CSRF/origin/settings tests plus the existing report, subscription, editor/media, Git, schedule, room/roster and legacy compatibility regressions. No real subscription mail is sent.
- `npm test`: static React receipt/privacy/contact/delivery/read-only-state assertions, plus the existing public/legacy/staff tests; not browser/E2E/device verification.

Exact command results are recorded in [slice-6 work log](status/log/2026-10-20-lost-found-confirmation-slice-6.md). Real sender verification, mailbox delivery/bounce handling, production credentials/storage/proxy/capacity, browser/focus/assistive technology and retention approval are **not** established by these tests.
