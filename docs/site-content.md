# Public site content and visitor guide

> **Implementation scope:** This guide describes current editable public content and compatibility, not blanket R05 completion or production readiness. Remaining exceptions and unverified provider/browser behavior are explicit below; use [current status](status/STATUS.md) and [requirements](specs.md) for accepted direction.

## Markdown foundation

`content/pages/*.md` now supplies authored public composition, including shipped Home/Guide. `/admin/content` is the generic page-list/metadata/source/preview/publish editor. Shared structured settings moved to `/admin/site-settings`; this is not a removal of Event/FAQ/branding/copy/media. [Exact syntax, API, ownership and deliberate migration](markdown-pages.md). Legacy installations with no pages retain existing views; explicit Home/Guide/Help conversion produces only a draft. Once an authored Guide/Help route exists, server-side structured saves reject edits to its retained compatibility fields. No default overwrite or blanket R05 completion is implied.

## Current scope and canonical sources

The routed public hub, guide, room finder (ID-only and legacy check-in-code lookup), graph planner, private-report form and subscription widget use editable public copy. This is **not** a claim that every classic, browser, provider or server-generated string is editable; the remaining R05 exceptions are listed below. English remains authoritative. D3/D4 do not authorize a translation provider or language rollout.

- `content/pages/*.md`: authored public page metadata/prose and allowlisted live blocks, not operational records.
- `content/site.json`: shared branding, fallback navigation, legacy hero composition, UI `copy`, compatibility guide/help and useful links. Schema version remains **1**.
- `content/event.json` / Event Editor: event title/date/timezone/notices, event/travel URLs and FAQ questions/answers.
- Operations store: schedules, delays and announcements; do not duplicate these as static UI text.
- `content/wayfinding.json` / Room Editor: title/intro/notices/help text, buildings, rooms, entrances, coordinates, floor images/alt/captions, graph nodes/edges/verification/closures and written instructions. These remain structured operational content, not duplicated into `site.copy`.
- Private roster/settings, report/contact/receipt data, staff identity and mail outbox never belong in public files or Git.

## Copy resolution and migration

`siteText(content, key, values?)` uses an authored string when present, otherwise the bundled canonical `content/site.json` value. An intentional `""` remains blank. No automatic read/save migration mutates an older installed document. Unknown-but-valid keys survive parsing and editing.

`src/features/site/text.ts` provides `useSiteText(explicitContent?)` and `SiteTextContext`. `PublicLayout` supplies its already-loaded content; the hook starts **no requests, effects or pollers**. Standalone components and previews use the bundled defaults when no provider exists. Explicit content/copy props remain supported. The shell owns one site loop, one live-data loop and now one authored-page loop; guide preview uses the real renderer without starting another loop. Defaults are UI fallback, not confirmation that bundled event/guide facts are published.

In **Site settings → Public copy**, filter/edit individual fields or choose **Merge missing default copy keys**. This explicit draft-only action adds missing defaults, preserves overrides (including blanks) and custom keys, and disables itself if the combined key count would exceed the bound. Review and use the existing save/confirmation/publication flow; merging alone does not publish. Raw JSON can deliberately remove a key to restore fallback behavior. Navigation retains its separate explicit missing-destination/old-anchor migration.

The catalog now exceeds the old 200-key ceiling. Both TypeScript and Rust accept at most **500 copy keys**, each key 1–100 ASCII letters/digits/dots, each value at most **4000 UTF-8 bytes**. Existing **512 KiB** document/publication bounds remain. Upgrade server and client together before publishing the expanded catalog: older 200-key servers reject it. Older sparse v1 documents remain valid on the updated server/client. Back up and review authored overrides rather than replacing an installed file with the seed.

### Plain-text substitutions

Only single-pass `{letters}` replacements are supported. No HTML, expressions, eval or recursive template expansion. Unknown placeholders stay visible. React escapes the resulting text. Keep supported placeholders when editing:

| Keys | Values supplied by renderer |
| --- | --- |
| `hero.afterSummary` | `{eventTitle}` |
| `updates.older`, `guide.results`, `rooms.firstMatches`, `rooms.matches`, `rooms.buildings` | `{count}` |
| `hub.lastReceived`, `lookup.checkedAt` | `{time}` |
| `rooms.hotspot` | `{code}`, `{name}` |
| `rooms.continue` | `{code}` |
| `rooms.coordinates` | `{latitude}`, `{longitude}` |
| `rooms.mapLabel` | `{name}` |
| `lookup.demoBody` | `{id}` (synthetic ID only) |
| `lookup.scheduled` | `{start}`, `{end}` |
| `lookup.directions` | `{round}` |
| `route.overlay`, `route.selected` | `{label}` |
| `route.result` | `{route}`, `{filter}` (resolved UI labels) |

### Coverage inventory

| Public renderer | Editable fields / keys |
| --- | --- |
| App/PublicFrame, Home/Schedule/Updates/FAQ/Help | `branding`, `navigation`, `hero`, `help`, `usefulLinks`; `a11y.*`, `hub.*`, `hero.*`, `status.*`, `quick.*`, `schedule.*`, `updates.*`, `faq.*`, `map.*`, `help.*`, `footer.*`, `loading.*`, `staff.signIn` |
| Guide and safe images | Structured `guide`; `guide.*`, including image-failure fallback used by Help Markdown |
| RoomFinder/FloorPlan/CampusMap | `rooms.*`, `map.loading`: search/empty/results, statuses, image/map failures, entrance/route controls, aria labels and privacy notices |
| IdLookup / StudentLookup | `lookup.*`, `legacy.*`: labels, demo/availability, privacy, clear/help, errors, result metadata; no private ID/code substitutions |
| RoutePlanner/layers | `route.*`: selectors, demonstration/verified notices, reload/closure caveats, no-network/no-route/same-point states, result/step labels, overlay aria and image failures |
| LostFoundPage | `lostFound.*`: form, privacy, receipt/mail states, paused editing and safe status-based error copy. Compatibility `copy` props and `defaultLostFoundCopy` export remain; defaults now derive from this catalog |
| EmailSubscribe (also reused in classic) | `subscription.*`: label/action/loading, success/already-subscribed/invalid/rate-limited/failure |

Public lookup/report errors select canonical keys by HTTP status, never render thrown/provider message text. ID-only public transport ignores error bodies. Unknown/transient failures use generic guidance; missing/unmatched ID outcomes remain non-enumerating. Subscription API keeps `{ok,message}` for compatibility; the widget recognizes only fixed existing already-subscribed/invalid results and renders canonical copy, never arbitrary response text. No private retry, visibility clearing, receipt idempotency or subscription endpoint is changed by copy edits.

## Remaining R05 exceptions (explicit, not completed)

- `/classic` retains its legacy-only cards, overlays, venue/help labels and statuses (`ClassicApp.tsx`, legacy components), apart from the shared subscription widget. No aesthetic rewrite/removal was made.
- Staff/login/editor/inbox/publication diagnostics, validation messages and browser-native required-field/password/unload/print UI are not public editorial copy. Staff UI remains English.
- Server-rendered unsubscribe HTML and outgoing announcement/receipt email subjects/bodies (`server/src/routes.rs`, `email.rs`, `lost_found_mail.rs`) are not site-editor copy. API protocol/status/validation strings and legacy `sourceLabel` remain fixed for older clients; current lookup/report/subscription UI maps safe states instead of rendering those messages. Legacy import UI identifies the private-import mode generically rather than echoing a provider source label.
- Leaflet/OpenStreetMap attribution, third-party zoom-control titles and map-library errors are library/legal text. Campus wrapper aria/fictional suffix and application fallback notices are editable; license attribution is intentionally not arbitrary HTML copy.
- Pre-shell route-loading/not-found views use bundled canonical `loading.*` defaults (there is no loaded site provider there). Editing these defaults requires a client build; installed runtime copy is not fetched by an extra poller. Initial HTML metadata/boot errors and locale-generated date/time formatting are not runtime editorial text.
- Structured operational values and authored Markdown/image descriptions remain editable in their proper source, not duplicated UI keys. Placeholder examples, safety/privacy notices and accessibility claims still require staff review: editable copy does not verify November route facts.

## Publication modes and migration

The former builder-stage “Git integration still required” warning is obsolete. Shared server/auth/editor/publication integration is implemented; activation/migration remains deliberate. See [Git publishing](git-publishing.md), [staff access](staff-access.md), [protocol](protocol.md) and [status](status/STATUS.md).

| Configuration | Actual save/authority boundary |
| --- | --- |
| No repository variable | SQLite operations plus atomic file-backed event/site/wayfinding documents; durable separate media; no Git commit/push claim |
| `LIVE_CONTENT_REPO` | Retained local-first dedicated checkout and `operations.json` editorial bundle; local commit becomes live, explicit push is separate |
| `LIVE_CONTENT_REMOTE_REPO` | Implemented opt-in bare repo / canonical `content/` manifest, operations, event, site, wayfinding and hash-named media. Staff writes/direct remote commits share validation; only confirmed remote publication activates the bundle. Last-good/pending/archive recovery remains available |

Never set both repo variables or point a private store at public/static/Git paths. Follow the Git guide's explicit data/media migration, branch protection, single-writer/durable storage and rollback steps. Runtime repo/auth knobs are deployment-owned; `.env.example` is commented guidance, not activation. `LIVE_CONTENT_RUNTIME_RELOAD` is an **Actions repository variable**, not a server environment variable; leave it off until runtime convergence is verified. No production GitHub, Google, sender, provider or deployment approval is implied.

## API, editor and media invariants

Public `GET /api/site` returns `{revision,content}`, no-store. Staff `GET/PUT /api/site/editor` retains session/capability/CSRF guards, revision-safe writes, conflict/draft preservation and safe last-good reload. Unknown object fields, unsafe URLs and invalid IDs fail validation. File mode saves plain `SiteConfig`, not an API envelope, by atomic replacement; mount the parent directory, not just the file. Remote revisions are shared bundle SHAs; mode-specific details are in the protocol/Git guide.

`GET/POST /api/site/media` remains protected and bounded (200 listed assets; 5 MiB PNG/JPEG/WebP uploads with signature checks). Public images must have safe HTTPS/known bundled or raster media URLs. No SVG/HTML, traversal, credentials-in-URLs or arbitrary local paths. Uploaded images become public; remove private metadata and obtain image rights before upload. Validation is not decoding, malware scanning or EXIF removal. No deletion API silently breaks older content. Remote media is hash-named/versioned; legacy/file media remains separately durable. Remote bundle validation resolves local image/Markdown destinations, including reference-style links and entities, rather than searching every string for `/media/`. Approved external HTTPS paths and plain-text/code mentions remain valid; missing local assets cannot publish. Markdown uses safe URL transforms and skips raw HTML.

The editor retains public-only tab-local draft backup, unsaved/unload warnings, conflict recovery and draft/latest JSON downloads. Storage-disabled environments retain in-memory drafts. Guide preview/search/contents/print and stable section anchors remain supported. Do not store private report drafts in these public backups.

## Verification

Run `npm test`, `npm run lint`, `npm run build`, `npm run test:api`, `cargo test --locked --manifest-path server/Cargo.toml` and scoped Rust format checks. `tests/public-copy.test.mjs` covers pure/static rendering, overrides, substitutions, explicit migration, blanks/custom keys and safe error classification without browser workflows. `tests/public-pages.test.mjs` covers shared-shell propagation. `tests/site.test.mjs` and embedded Rust tests cover validation bounds, sparse old documents, public/editor parity and revision safety with disposable localhost hosts. Existing integration tests cover legacy APIs, role/CSRF boundaries, publication/media and private lookup/report contracts.

See the [R05 work log](status/log/2026-10-20-public-copy-r05.md) for actual results and limitations. No browser/UI-driven, device, assistive-technology, physical-route, real-provider, Google, mail-delivery, deployment or load verification is claimed.
