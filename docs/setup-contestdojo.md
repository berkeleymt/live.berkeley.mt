# ContestDojo: Lemon parity specification

Status: verified reference behavior and Live implementation target. **Live does not yet implement this setup/sync flow.** Do not follow this as if adding the variables alone enables Live import.

Source inspected: Lemon [roster implementation](https://github.com/berkeleymt/proctor-suite/blob/77721d0/server/app/roster.py), [API and sync loop](https://github.com/berkeleymt/proctor-suite/blob/77721d0/server/app/api.py), [startup](https://github.com/berkeleymt/proctor-suite/blob/77721d0/server/app/main.py), [Roster screen](https://github.com/berkeleymt/proctor-suite/blob/77721d0/web/src/screens/Roster.tsx), [Settings screen](https://github.com/berkeleymt/proctor-suite/blob/77721d0/web/src/screens/Settings.tsx), [per-test room ADR](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/adr/0041-roster-rooms-per-round.md).

Lemon's older setup guide mentions `/super` and pre-event-only sync. Current code has `/admin/settings` and minute-based background sync; code takes precedence for replication. No real ContestDojo requests or credentials were used in this docs pass.

## Required setup and synchronization behavior

1. Super admin configures API token and event ID in Settings, or deployment configuration provides `CONTESTDOJO_API_TOKEN` and `CONTESTDOJO_EVENT_ID`. Persisted settings override environment values. Secrets stay server-side/private, never in public content Git. Live should show configured/redacted status and accept replacement secrets, not echo keys into ordinary diagnostics.
2. Admin opens Roster and presses Sync. Provide pending/success/error states, counts and last successful/check time. A missing token/event configuration explains where to fix it.
3. Server fetches `https://api.contestdojo.com/events/{event_id}/students/`, `teams/`, and `orgs/` with bearer authentication and bounded requests (Lemon uses 20 seconds).
4. Students are required. Team/org requests are enrichment: Lemon tolerates their failure and reports unresolved links. Join by IDs; retain every returned student. Never convert a failed students fetch into an empty successful roster.
5. Flatten nested values to dotted column names; join `team.*` and `org.*`; lists become text cells; synthesize `name` from first/last only when absent. Full imported fields remain private.
6. Replace the stored roster atomically after successful import. If unchanged, update checked time without needless rewrite. Failures preserve the last good snapshot. Lookup reads the local snapshot, not ContestDojo.
7. Match Lemon's background loop at second zero of each minute, disabled with `ROSTER_AUTO_SYNC=0`; skip when configuration is absent or a sync is already running. A single lock serializes manual and automatic syncs. Work must not block public request handling.
8. Roster is read-only: staff adjust column mappings, not individual imported student records. Clear roster asks explicitly; document that enabled auto-sync can repopulate it. Disable syncing before intentional retirement/clear if data must stay removed.

## IDs, columns and rooms

- ID default: configured column, then `number`, `id`, `user`; trim/collapse whitespace and uppercase while preserving leading zeros. Keep all rows internally: Lemon uses `ROW<n>` for absent IDs and disambiguating suffixes on collisions. Those internal fallbacks are not permission to guess a public match; ambiguous user-facing IDs need diagnostics and a safe no-result outcome.
- School: configured column, then `org.name`, then `customFields.school`. Team: configured column, then `team.name`/`team.number`. These fields are useful privately but not part of Live public lookup.
- Columns UI maps ID/name/tests/school/org/team/contact and **one room column per test**. “None” is valid. Reject a mapping to an unknown source column. Changing a mapping reinterprets the stored rows; it does not refetch or edit ContestDojo.
- Lemon normalizes room labels by collapsing whitespace and stripping trailing parenthesized sections: `Dwinelle 155 (B)` becomes `Dwinelle 155`. Use explicit aliases for map matching; never silently merge actually distinct buildings/floors.
- Live needs stable public schedule/test IDs and their source room columns. Do not copy Lemon's timer-round IDs blindly or assume one room applies to every test. Changes to schedule labels must not destroy mappings.
- Preserve the imported test-participation distinction where available; do not show a test merely because it appears in the public schedule if no assignment applies to the student.

## Public projection: deliberately different from Lemon's staff roster

ID-only lookup returns assigned public room identifiers plus associated public schedule and guidance, nothing else. No names, school/team membership, contact data, custom source columns, raw rows, bulk ID search, autocomplete over IDs or exposed roster download. The roster and lookup index do not belong in Git/content exports even though some answers are public by ID; the application's private repository visibility is not a substitute for this separation.

Do not place IDs in URLs, analytics events, logs or external translation requests. Use a bounded request body and private/no-store responses. Do not add a check-in code: Ian explicitly rejected it. Review enumeration abuse and campus shared-network behavior without treating an ID as authentication or punishing all users behind one campus IP.

## Diagnostics and acceptance tests

- Required-source failures: invalid token, unknown event, timeout, invalid JSON and wrong response shape; last good data survives.
- Optional-source failures: students retained, enrichment omissions visible to staff.
- Every row accounted for; leading-zero IDs, missing/duplicate IDs and mixed-case lookup tested.
- Per-test columns, multiple tests sharing a room column, None mappings and unmatched map rooms covered.
- Manual/background overlap causes one coherent import, never partial snapshots.
- Restart loads a stored snapshot; changing mappings changes only intended results.
- Anonymous public output is an allowlist; names/contacts/raw columns never leak, including error paths.
- Switching event ID must not silently present the previous event's assignments as the new event. Clear provenance and explicit replacement are required.
- Test Clear with auto-sync enabled/disabled so the operator understands repopulation.

Read official ContestDojo documentation before implementing new provider API behavior. Parity here is based on inspected Lemon source, not a claim that every external API edge case has been verified live.
