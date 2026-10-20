# Staff guide

## Today: current application

The [synthetic demo walkthrough](demo.md) is the runnable training environment. Do not use real student data or visitor contacts there. The deployed app and the demo are not automatically the same content/configuration.

1. Sign in with a configured named staff account. Current accounts/roles are in a private file; there is no implemented Google/People flow yet. Demo role switching must not be enabled on production.
2. Check event name/date, notices and the visible schedule before editing. Current public data may still be April material; never infer November readiness from a successful deployment.
3. Use the Operations schedule planner for multi-event delay/absorption changes. Preview affected start/end times, then apply against that exact revision. If there is a conflict, keep the intention/draft and re-preview against current data.
4. Edit event/site/guide/room content in the appropriate workspace. Save conflicts are intentional protection, not permission to repeatedly overwrite.
5. In current opt-in Git mode, distinguish the locally published commit from remote push status. The proposed GitHub-first flow below is not yet installed.
6. Work lost-and-found reports only in the private inbox. Current report submission returns a receipt but does not send the newly requested confirmation email.
7. Open Lemon for timer/proctor work; authenticate there separately. Live edits never control its timers.

## Target publishing workflow

Admin/Super admin opens the task -> edits readable fields -> previews exact changes -> publishes -> sees separate remote and loaded revisions. Conspicuous confirmation is appropriate for schedule shifts, restore, clearing roster or deleting content, not every minor text edit. A success toast is not enough: the workspace must say whether the public app has loaded the requested revision.

For AI-assisted file edits, review the diff and validation output before pushing to the authorized branch. Treat allowlisted Markdown/assets as publishable, regardless of repository visibility. Do not paste lost-and-found contacts, roster files or credentials into the change. If GitHub rejects a push, the action is not live; preserve the draft and resolve the reason.

## Target roster workflow

Super admin configures ContestDojo -> Admin runs Sync -> checks counts/warnings -> chooses ID and per-test room columns -> resolves unmatched map rooms -> tests a few authorized known IDs without showing private fields publicly. Subsequent automatic syncs update the local snapshot. See [exact parity](setup-contestdojo.md).

## Target lost-and-found workflow

- Visitor submits item description, where/when it was lost or found, and a required contact email for confirmation; optional contact name/phone only if needed. Exact field changes need schema tests. Do not request a home address, ID document, password or payment.
- Persist the report and an email job transactionally, then return an opaque receipt. Send a Berkeley-domain confirmation via a verified sender. The confirmation acknowledges receipt, not a promised match or verified ownership.
- Staff inbox searches/filters current statuses, reviews details, records a private note and moves the report through the documented status choices. Preserve existing status/audit behavior during the email addition rather than inventing a second workflow.
- Staff manually contacts the visitor when appropriate. Do not automatically claim “we found it,” publish matching reports or expose a public contact directory. Physical handover still needs staff judgment.
- A durable outbox handles bounded retries and provider failures, with a stable idempotency/deduplication strategy. SMTP/provider acceptance is not proof of inbox delivery. Do not mark an email delivered merely because a send task started.
- UI distinguishes report saved / confirmation pending / provider accepted / failed. If sending fails, retain the report and receipt; do not make visitors submit a second report.
- Validate recipient and fixed template; rate-limit submissions/confirmation sends to avoid turning the form into a spam relay. Never reflect arbitrary HTML/links or attach submissions to confirmation mail unchecked.

Postmark is a reasonable provider because announcement sending already uses it, but lost-and-found needs its own verified transactional path. `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_ADDRESS` and `SITE_BASE_URL` already exist; their presence does not prove this flow works. Sender/reply-to ownership and private-data retention remain [open decisions](status/decisions.md).

## After the event

Stop roster auto-sync before clearing data if it must remain deleted. Follow an approved retention schedule for reports, contacts, outbox and logs; until one is approved, do not claim an automatic 30-day purge exists. Unsubscribe still works independently. No large recovery exercise is required by this pass.
