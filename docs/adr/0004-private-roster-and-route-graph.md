# ADR 0004 — Private local roster and additive directed route graph

Status: implemented locally for the authorized slice-4/practical-slice-5 work; production activation, provider acceptance and physical route verification are not approved by this ADR.

## Context and source

Ian's implementation request against Live baseline `6293bbe` explicitly selects ID-only room lookup, ContestDojo/Lemon-style setup and per-test imports, preserved legacy endpoints, canonical public content and honest synthetic routing. No real provider calls, credentials, browser/E2E, deployment or Lemon changes are allowed. [Requirements](../specs.md), [setup](../setup-contestdojo.md), [protocol](../protocol.md).

## Decisions

- Add a separate opt-in `LIVE_CONTESTDOJO_DB` SQLite snapshot/settings store outside public/application repositories. Without it production import is disabled. Demo always uses memory and synthetic rows. Provider secrets never enter Settings responses, logs, public content/export/history or browser storage. Existing provider access/operational capabilities apply: Super settings, Admin/Super roster, intent/CSRF/origin checks server-side.
- Fixed-origin read-only provider API, bounded requests/data, one sync lock, minute-boundary background checks and bounded jittered cooldown. Required students fail atomically; optional enrichment can be omitted without discarding students. Persist the complete private value before updating memory. Unchanged rows preserve mapping revision but persist new check metadata; no separate row-diff/metadata-table optimization is claimed.
- Explicitly mapped ID is authoritative (`number` default); no silent fallback, synthetic row ID or duplicate-ID suffix becomes public access. Missing/duplicate IDs fail generically. Per-test columns and optional exact stable-ID participation tokens control projection. Match exact public room IDs or unique normalized building+room labels/explicit aliases, never fuzzy buildings. Event changes invalidate old snapshot provenance until replacement.
- New `/api/rooms/lookup` returns an allowlist of scheduled test metadata and matched public room references/unmatched status only. Preserve `/api/wayfinding/lookup` and legacy private-file semantics; fallback is deliberate only while the new adapter is disabled. ID is not authentication; successful attempts also consume rate limits. Keep private values out of URLs, caches, external translation and analytics.
- Extend existing wayfinding content with optional `graph`, using the same public editor, file/local-Git/remote-first validators and publication transaction. Directed edges, explicit costs/transitions, closures, verification notes and step-free eligibility support local route calculation. Do not infer reciprocal links, live geolocation, accessibility or physical verification.
- Keep existing written directions as an independent authored alternative; graph closure flags cannot silently rewrite them. Explain this to visitors/staff and provide explicit reload. Synthetic graph/maps are conspicuously labeled demonstration only. Operational slice 5 remains blocked on real reviewed inputs, not fabricated venue facts.

## Consequences and remaining review

The new adapter intentionally requires deliberate private-storage activation/migration; no automatic production roster exposure. Raw fields stay available only to authorized staff. Persisted settings override initial environment values; Clear does not change provider data and enabled auto-sync may repopulate it. One process/writer, storage permissions/encryption/backups/retention, provider field interpretation and shared-campus proxy/rate-limit policy require operator review. Private responses currently do not promise atomic consistency across separately fetched public bundle documents; clients show missing references as unresolved.

Real provider behavior, November schedule/rooms/maps, verified accessibility/closure procedures, approved browser/device/a11y work and capacity rehearsal are not established by local fixture tests. See the [distinct work log](../status/log/2026-10-20-contestdojo-routing-slices-4-5.md) for evidence and limits. No approval, deployment, PR or production-data migration is implied.
