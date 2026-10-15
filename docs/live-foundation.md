# Live foundation — October 15, 2026

## Decisions and scope

- Begin with the public Today layout and a small server + staff-editor content slice, rather than replace all public storage in one patch.
- Keep the existing schedule/delay/announcement editor, SQLite data, email subscription API, campus map and help details. The old public layout remains at `/classic` for comparison/fallback; its development slider is not removed.
- Use a restrained, mobile-first public layout with visible sections instead of modal widgets. TakeTransit is the travel-planning destination, not a routing service to duplicate. Keep the public and staff designs distinct; the full Lemon-style staff workspace is still pending.
- Public current/next status uses the configured event date and `America/Los_Angeles`, not the visitor's local date/time. Delayed starts determine ordering. “Scheduled now” describes the schedule, not a connection to Lemon's timers.
- Map location permission is requested only after “Use my location.” Zoom controls, attribution and a denied/unavailable message are visible. Venue geometry and labels remain the existing April data; no indoor directions are inferred.
- Title/date/intro/notice/links/FAQ are editable in JSON and the admin. The rest of the UI copy, images, map data, schedule, announcements and help are **not yet** covered by file/admin parity.
- The first file-backed publisher operates on one server's durable filesystem. It is intentionally not advertised as a Git workflow. Disk commit precedes in-memory publication; optimistic revisions prevent stale staff saves. A directory mount is required for durable container edits.
- During this work, the existing public `/api/live` was found to honor `include_future` and arbitrary preview times without authentication. Those preview switches now require valid staff Basic Auth; normal published responses and authenticated admin previews remain supported.
- No production deployment, database migration, staff-account changes, Lemon modifications or private-data integration.

## Verification

- 9 schedule/date tests: before/after day, Pacific midnight, April DST, start/end boundaries, delays, ordering, empty schedules and date labels.
- 9 Rust content tests: validation, restart persistence, stale writers, external edits, invalid-file fallback, missing-file errors, payload limits and shipped fixtures.
- 12 Node API tests (including the containing suite): public response compatibility, authentication, file publication, validation, conflicts, auto-reload, last-good fallback, existing schedule/delay/announcement mutations, scheduled-announcement privacy, subscription and fail-closed new publishing.
- TypeScript/Vite production build and ESLint on changed TS/TSX files.
- Rust clippy completes with an existing `redundant_closure` warning in `server/src/db.rs`. Strict `-D warnings` remains blocked by that unchanged line.
- Whole-repository ESLint has pre-existing failures in `ExpandableOverlay.tsx` (4 unused variables) and `LiveFeed.tsx` (2 React hook rules). The pre-change baseline had 8 failures: unused map props and a fetch-error variable were eliminated in the changed files. The unrelated components were not rewritten to silence lint.
- Dependency lockfile is unchanged. `npm audit` reports 12 existing findings (9 high, 2 moderate, 1 low); dependency remediation needs its own validated change before launch.
- Browser preview opened for design feedback. No claim of UI-driven end-to-end coverage, email delivery, screen-reader testing or production validation.

## Next vertical slices / launch gates

1. Git publication: validated preview, commit/revision feedback, conflict reconciliation, rollback and persistent deployment rehearsal. Migrate schedule/updates only after editor, delay and email parity tests exist.
2. Complete editorial coverage: public copy/images, guide/help, verified venues and FAQs editable through both files and staff UI.
3. Staff workspace and granular named permissions; decide the sign-in handoff with Lemon without changing timer authority.
4. Confirm November schedule, help contacts, room data and accessible entrances. The supplied November JSON is explicitly a sample-data preview.
5. Private lost-and-found workflow; decide student-lookup privacy before using ContestDojo data. No private reports, rosters or tokens in Git/public bundles.
6. Browser rehearsal at 390/820/1440 widths, keyboard/screen-reader checks, offline/reconnect checks, notifications, content-mount restart/rollback and production migration rehearsal.

The first patch is a reviewable foundation, not a November launch sign-off.
