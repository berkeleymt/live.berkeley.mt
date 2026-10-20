# API and content contracts

Status: documented inventory at Live `0d56ff0`, followed by target contract rules. This is not a generated OpenAPI specification, and proposed endpoints must not be presented as currently callable.

## Current endpoint inventory

Exact request/response types and validation live in the linked source and existing feature notes. Preserve existing clients during migration unless a replacement/removal is agreed.

| API family | Current routes | Evidence |
| --- | --- | --- |
| Live operations | `GET /api/live`; schedule, delays, announcements mutations | [main router](../server/src/main.rs), [routes](../server/src/routes.rs) |
| Event metadata | Protected `GET/PUT /api/content`; public event metadata is included in `/api/live` | [main router](../server/src/main.rs), [event content](../server/src/content.rs) |
| Editorial | `GET /api/site`; `GET/PUT /api/site/editor`; `GET/POST /api/site/media` | [site router/types](../server/src/site.rs), [feature notes](site-content.md) |
| Map/lookup | `GET /api/wayfinding`; `POST /api/wayfinding/lookup`; `GET/PUT /api/wayfinding/editor` | [wayfinding](../server/src/wayfinding.rs), [current notes](wayfinding.md) |
| Lost-and-found | `POST /api/lost-found`; `GET /api/lost-found/staff`; `PATCH /api/lost-found/staff/{id}` | [lost-and-found](../server/src/lost_found.rs) |
| Staff identity | session read, login, logout and demo login under `/api/staff` | [staff router/types](../server/src/staff.rs) |
| Git publication | `GET /api/publishing` (status/history), `GET /api/publishing/export`, `POST /api/publishing/push`, `POST /api/publishing/restore` | [publisher](../server/src/publishing.rs), [main router](../server/src/main.rs) |
| Schedule plan | `POST /api/schedule/plan/preview` and `/apply` | [planner](../server/src/planner.rs) |
| Subscriptions | `POST /api/email/subscribe`; `GET /api/email/unsubscribe` | [routes](../server/src/routes.rs), [email](../server/src/email.rs) |

Current `useLiveData` polls at 5 seconds with an 8-second request timeout and a stale indication after three failures. It preserves last-good data. That is not a cross-browser, offline-cache or scale guarantee. [Source](../src/data/useLiveData.ts).

## Target public schemas — proposed, not implemented

| Entity | Essential fields/invariants |
| --- | --- |
| Content manifest | schema version, source commit SHA, loaded timestamp, content digest; full-bundle validation |
| Event/schedule | stable event/test IDs, event date + IANA timezone, ordered intervals, explicit delay references; never rely only on time of day |
| Notice | stable ID, English title/body, severity, publication/display/expiry times and public links; future display does not hide a commit from repository readers |
| Building/floor/room | stable IDs, canonical label/aliases, floor/entrance references, map asset + alt text, verification provenance |
| Routing graph | stable nodes/edges, geometry, directionality, floor/entrance connections, stairs/elevators, closure and accessibility metadata; no dangling references |
| Lookup response | assigned test/room references plus public bundle provenance; never a raw roster row |
| Receipt | opaque report reference and honest confirmation-email state; never public retrieval of report contact/details |

Example target lookup payload (illustrative keys; final schema must be reviewed with the implementation):

```json
{
  "assignments": [{ "testId": "power", "roomId": "example-room" }],
  "contentRevision": "example-public-commit"
}
```

Names, team/school identifiers, contact fields and the lookup ID itself are intentionally absent. Joining those room references to public schedule/maps should be consistent with the returned content revision; report an unresolved reference rather than show a wrong location.

## Target mutation and error rules

- Server authenticates and authorizes every protected action. Hidden buttons are not authorization. Cookies require secure deployment, appropriate SameSite/HttpOnly protections, CSRF and origin checks.
- Editorial mutations carry a base revision; stale changes return conflict and preserve the browser draft. Never last-write-wins a schedule change silently.
- Public report submission and retriable protected mutations use stable idempotency keys. Same key with different content is a conflict, not a second action. Scope keys so one user's action cannot collide with another's.
- Bound bodies, text, lists, search results and uploads; enforce content types and structured validation before writing. Return field errors without echoing secrets or private rows.
- Use stable semantic errors for not configured, unauthorized/forbidden, invalid input, stale revision, rate limit and upstream failure; include retry guidance when safe. `200` means success, not a swallowed mutation failure.
- Keep report/roster/session responses private and no-store. Shared HTTP caches may contain public bundles only. Cache time-sensitive notice representations no longer than their next display transition.
- Version incompatible public content schemas, stage readers before switching writers, and test rollback compatibility. Publish schema/type changes with server + client + fixtures together; this docs pass adds no fictitious `PROTOCOL_VERSION` to code.

## Contract tests required with implementation

Cover allowed/denied roles, malformed and oversized input, stale revision, repeated requests, source/schema mismatch, public projection privacy, old/new content compatibility, invalid bundles, future notices and failures after persistence but before a client receives the response. Exact endpoint methods and JSON keys become normative only when the code and tests land together.
