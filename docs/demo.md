# Integrated BMT Live demo

This is a local, synthetic rehearsal for **November 14, 2026**, not a live tournament publication. All five feature slices are wired through the actual Rust router and React application. The earlier feature documents describe their individual contracts; this guide supersedes their “integration still required” notes.

## Run and restart

Prerequisites: Node 22.18+, npm, Git, stable Rust/Cargo and the native prerequisites needed by the Rust dependencies. From the repository root:

```sh
npm ci
npm run demo
# If port 3091 is occupied, use another port; do not stop the other process:
DEMO_PORT=3092 npm run demo
```

Open `http://127.0.0.1:3091/`. The launcher builds `dist/` and the server, probes the selected port and starts exactly one child server on loopback. Ctrl-C stops that child. The launcher never searches for or kills unrelated servers. Its child Git commands use a synthetic demo identity and ignore global/system Git configuration; they do not modify your Git identity. It refuses an existing non-Git content directory and refuses any origin other than its local bare repository.

`npm run demo -- --prepare-only` seeds missing sandbox data without building or starting a server. `npm run demo -- --no-build` reuses existing binaries; use it only after a successful current build. `DEMO_ROOT=/absolute/private/sandbox npm run demo` creates another persistent sandbox. Prefer a new `DEMO_ROOT` to destructive reset commands. Existing reports/edits are not reseeded or overwritten on restart.

## Walkthrough

1. **Public Today.** Visit `/`, read the synthetic-event notice, schedule, updates, quick help and FAQ. Use `/guide` to search visitor guidance and print it. The event is in the future until November 14, so Today correctly shows the upcoming state rather than pretending a round is currently running. `/classic` retains the old public interface and its original map/time controls.
2. **Demo staff.** Visit `/staff/sign-in` and choose **Administrator**. The visible banner identifies synthetic mode. `/admin` shows the publication source and operational links. The shell follows Lemon's Today/Operations/Content/Rooms/Inbox/Access grouping but does not share Lemon authentication or timers. Sign out before trying another role.
3. **Schedule adjustment.** Open `/admin/operations`. In the multi-event planner choose **Individual round**, delay **30**, choose **Lunch break**, absorb **15**, and enter a public reason. Preview before applying; inspect every before/after row, tick the review confirmation, and apply once. On the initial seed the individual round moves from **10:00–11:00 to 10:30–11:30**, lunch from **11:00–12:00 to 11:30–12:15**, the team round from **12:00–13:00 to 12:15–13:15**, and awards from **15:00–16:00 to 15:15–16:15**. Competition/ceremony durations are preserved. Only a `general` break can absorb time, and it must retain at least five minutes. Preview creates no publication. Apply requires the exact preview token/revision and commits the complete change once; another intervening edit produces a conflict rather than a partial adjustment. SQLite mode applies the same plan in one transaction. Existing single-event editing/delay/undo controls remain available.
4. **Updates and publication.** Create a normal or urgent update, optionally pinned or scheduled. Future updates are visible to authorized staff but not leaked by public preview query parameters. A Git-mode save publishes locally only after commit. In Publishing inspect the local SHA/history, download the complete public bundle, then explicitly push and verify. The demo's “origin” is only `.demo/backup.git`, on the same machine: useful for demonstrating the workflow, **not off-host disaster recovery**. Restore requires a separate confirmation and makes a forward commit, never a reset/force-push. It replaces the full bundled public content, including editorial documents; previously sent email cannot be recalled.
5. **Public editorial content.** Open `/admin/content`. Edit event metadata/FAQ and the site document's copy, branding, links, images, help or searchable guide. The site editor supports its structured fields plus complete JSON for the full schema. Publish, then refresh the public view. In the demo, these edits commit `editorial.event` / `editorial.site` inside the same `operations.json`. One shared revision prevents a stale tab from overwriting a newer schedule or editorial change; retain the draft, load current content, compare and publish deliberately. Uploaded raster images are stored separately, with validated safe references in the public document.
6. **Directions and room lookup.** `/rooms` searches buildings, floors and rooms, with text directions, a campus map, and a clearly illustrative floor image/marker. Enter student ID **`DEMO-1001`** and check-in code **`DEMO-CHECKIN-2026`** together for synthetic assignments. Incorrect credentials get generic guidance. IDs/codes are submitted in POST bodies, never URL query strings; responses are private/no-store and do not expose the roster. `/admin/rooms` edits the public wayfinding JSON with validation/revision checks. Real roster import remains a separately approved, private offline process.
7. **Private lost and found.** Submit a synthetic report at `/lost-found`, including an email and description. It receives a receipt without revealing existing reports. As Info Desk or Administrator, open `/admin/lost-found`, search/filter the private inbox, update status and inspect its audit history. The same submission UUID retries safely without duplicates. “Email” drafts use the operator's email client; no message is sent automatically. Inbox records and contact details never enter public responses, image metadata or the Git bundle.
8. **Roles and recovery.** Dispatcher can manage schedule/updates, Crisis Manager updates plus inbox reads, Info Desk the private inbox, and Administrator all current capabilities. The Access screen documents effective permissions, not an account-management/SSO integration. The backend rejects missing sessions, insufficient capabilities, stale sessions and invalid CSRF/origins independently of navigation. If the API is unavailable, public views retain last-good data and show stale/error guidance; staff saves do not optimistically claim success or queue writes offline. Reload/review before explicitly retrying an unconfirmed mutation.
9. **Restart persistence.** Stop the launched child and run `npm run demo` again. Git publications, private reports/status audit, and local SQLite data remain. Session cookies do not restore server-memory sessions: sign in again. Confirm the private report still exists and is absent from the downloaded public bundle.

## Feature and storage matrix

| Feature | Main route / endpoint | Persisted source in the demo |
|---|---|---|
| Today, schedule, updates | `/`, `/api/live` | `.demo/content/operations.json` plus compatibility SQLite fields |
| Atomic schedule preview/apply | `/admin/operations`, `/api/schedule/plan/{preview,apply}` | One complete Git commit; transaction in SQLite mode |
| Event / FAQ / site / guide | `/admin/content`, `/api/content`, `/api/site` | `operations.json` → `editorial.event` / `editorial.site` |
| Maps / public room directions | `/rooms`, `/api/wayfinding` | `operations.json` → `editorial.wayfinding`; sample asset in `public/demo-maps/` |
| Student room lookup | `/api/rooms/lookup` | Synthetic in-memory records in literal demo mode only |
| Private reports and audit | `/lost-found`, `/admin/lost-found`, `/api/lost-found`, `/api/lost-found/staff` | `.demo/private.db`, never Git |
| Staff sessions / role matrix | `/staff/sign-in`, `/admin/access`, `/api/staff/*` | In-memory sessions; synthetic roles only with literal `DEMO_MODE=true` |
| Subscriptions / delivery deduplication | Existing subscribe/unsubscribe API | `.demo/data.db`; **all email sending disabled** |
| Explicit Git push | `/api/publishing/push` | `.demo/backup.git`, local machine only |
| Public uploaded media | `/api/site/media`, `/media/:filename` | `.demo/media/`, separate backup required |
| Lemon / TakeTransit | Explicit external links | No API, timer, SSO or transit-planner integration |

`.demo/event.json`, `site.json` and `wayfinding.json` are startup compatibility snapshots. With a complete Git editorial bundle, committed `operations.json` is authoritative; editing those separate files does not override the Git publication. Direct Git edits must be valid and committed. Invalid later HEAD retains the last valid in-memory publication, but restart with invalid HEAD fails closed. Dirty/staged/untracked content files block API saves; review them rather than resetting them. The app never silently discards changes or removes an index lock.

Non-demo file mode keeps the original three JSON files editable and polled; existing operations-only Git repositories remain supported without an editorial bundle. Never mix public and private data in either mode. Do not use real reports, passwords, roster identifiers or production tokens in a demo.

## Verification and remaining launch work

Integration verification passed: **36 Rust unit tests, 60 Node API/feature/integration tests, 9 schedule/date tests**, TypeScript, production Vite build, changed-file ESLint and Rust formatting. `npm run demo` built and started the real sandbox on loopback; HTTP checks returned 200 for public pages/data and 401 for anonymous publishing. `--prepare-only` also preserved the existing sandbox. Full lint retained only the six known baseline failures noted below. No browser automation or container/production deployment was run.

Automated verification includes the real application (not only builder harnesses): SPA fallback, all role boundaries, CSRF/session lifecycle, private report/idempotency/audit behavior, synthetic and private-import room lookup, stale content/publication rejection, complete editorial Git publication, local push/verification, restart persistence, SQLite atomic apply, and preserving legacy CRUD/subscriptions. Commands are in the root README. Feature SSR/render tests are not browser E2E.

Not claimed complete:

- No browser/mobile/keyboard end-to-end rehearsal was authorized or run. It still requires an approved human/browser pass before event deployment.
- No real November timetable, campus room allocations, emergency contacts or official map accuracy has been approved. Replace the labeled examples through the content workflow and obtain editorial review.
- No Lemon shared session, ContestDojo import/synchronization, TakeTransit API, Postmark delivery, network Git-host deployment or production rollout was exercised. The room lookup offers a documented private-import boundary, not a live provider connection.
- Public image bytes are outside Git. Rehearse durable content/media/private-database backup and restore, HTTPS cookie/origin configuration and named-account onboarding/credential rotation with the deployment owner.
- The guide schema supports sections/Markdown/images; richer WYSIWYG editing and shared identity management are not implied. The legacy `/classic` presentation keeps historical hardcoded map/copy rather than being a second editorial site.
- Full lint still has six pre-existing errors in `src/components/ExpandableOverlay.tsx` and `src/components/LiveFeed.tsx`. They were not silenced or folded into this integration.

## Integration decisions and progress

- **Complete public bundle, private storage split:** use an optional `editorial` field to keep older Git files compatible while making the demo's schedule/event/site/wayfinding publication and restore coherent. No subscriber, report, account or roster data is serialized there.
- **Server-authoritative permissions:** the real router composes session/CSRF authorization ahead of publishing middleware; frontend capabilities only guide navigation. `/admin` is now an SPA shell, while protected APIs fail closed (401 absent identity, 403 insufficient capability).
- **Exact reviewed plan:** preview is pure, the token binds input and revision, and apply uses one database transaction or Git commit. Competition durations cannot be chosen for absorption.
- **Safety over automatic cleanup:** demo startup preserves existing content and checks port/local-remote ownership. Failed saves retain drafts/worktree state and offer review/retry, never destructive recovery.
- **Compatibility retained:** SQLite is still the default, legacy operations-only exports keep their schema, classic UI and ordinary manual operations remain, and demo mode is the only synthetic-login/roster path. Lemon's repository, production services and timers were not changed.
