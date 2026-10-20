# Public site content and visitor guide

> **Current implementation reference.** This describes the existing schema/editor, not completion of the all-public-copy/images requirement. [Architecture](architecture.md) specifies the proposed canonical GitHub files/media pipeline; [localization](localization.md) specifies English-source automatic translation. Both need implementation. Use [status](status/STATUS.md) rather than builder-stage TODOs below.

**Integrated:** shared state/routes and session/CSRF editor transport are now wired. The complete demo stores this document in the Git editorial bundle; file mode remains supported. The wiring instructions below are retained builder-stage notes, not outstanding work. See [demo.md](demo.md) for current operation and verification.

This slice owns `server/src/site.rs`, `content/site.json`, `src/features/site/`, and `tests/site.test.mjs`. It does **not** wire shared application files, change schedules, connect Lemon, deploy, or operate Git. The shipped public guide explicitly labels all unconfirmed November information as a **demo**. It contains no accounts, roster, private contacts, credentials, invented check-in times, or Wi-Fi credentials. November 14, 2026 is the event date; the existing event/schedule data still needs the integration stage's November configuration.

## Server integration (required)

Add `mod site;` to `server/src/main.rs`. Add this exact field to `routes::AppState` (existing fields remain):

```rust
pub site: std::sync::Arc<crate::site::SiteStore>,
```

Construct before creating `AppState`; paths are configurable and must not point at production while rehearsing:

```rust
let site_path = std::env::var("SITE_CONTENT_PATH")
    .unwrap_or_else(|_| "content/site.json".into());
let media_path = std::env::var("SITE_MEDIA_DIR")
    .expect("Set SITE_MEDIA_DIR to a writable directory outside the source checkout");
let site = std::sync::Arc::new(site::SiteStore::open(
    site_path.into(), media_path.into(),
).expect("Invalid public site content or media directory"));
// Include `site` in the AppState initializer.
```

For a disposable local demo, `SITE_MEDIA_DIR=/tmp/bmt-live-demo-media` is sufficient. For a deployment use a persistent directory such as `/var/lib/bmt-live/media`, with permissions for the server user. `open` creates the media directory but never creates/replaces a missing or invalid content document. Mount the **parent directory** of `site.json`, not a single file, because save uses an atomic sibling-file rename. Back up media separately from Git.

The module uses already-declared `sha2`, `uuid`, `reqwest`, `axum`, `tokio`, `serde`, and `serde_json`; **no new dependency is required**.

Merge these routers **before** the SPA fallback:

```rust
use axum::{middleware, Router};
use tower_http::services::ServeDir;

let media = Router::new()
    .nest_service(
        "/media",
        ServeDir::new(state.site.media_dir()).append_index_html_on_directories(false),
    )
    .layer(middleware::map_response(site::media_headers));

let app = Router::new()
    // Existing routes/merges stay in place.
    .merge(site::public_router())
    .merge(site::admin_router())
    .merge(media)
    // Existing SPA fallback, middleware, with_state(state), etc.
    ;
```

`public_router() -> Router<AppState>` and `admin_router() -> Router<AppState>` are independent. No shared `routes.rs` handlers are needed. Apply `site::media_headers` **only** to the media router: it sends `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. Never serve the content directory, repository root, private uploads, or a SPA fallback under `/media`. `/media/` must return 404, not an index listing.

Add a periodic last-good reload like the existing event-content poller:

```rust
let site = state.site.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
    let mut previous_error = None;
    loop {
        interval.tick().await;
        let site = site.clone();
        let error = tokio::task::spawn_blocking(move || site.reload())
            .await.expect("site reload task").err();
        if error != previous_error {
            if let Some(ref message) = error {
                eprintln!("[site] Keeping last valid public content: {message}");
            }
            previous_error = error;
        }
    }
});
```

Public reads use `snapshot()` only. Disk I/O for editor reads/saves/uploads is dispatched through `spawn_blocking`. The initial file must be valid; after startup, invalid/missing/oversized file edits preserve the last good public document. A repaired file can reload normally. One process is assumed; saves/reloads serialize within `SiteStore`. External file writers should use atomic replacement and avoid racing active saves.

### Authorization and staff roles

The module currently enforces existing staff Basic Auth **inside every private handler**, independently of the legacy admin middleware. Missing/empty `ADMIN_PASSWORD` gives 403; missing/incorrect credentials give 401. This is deliberate: the legacy middleware alone fails open when a password is not configured.

**Named-role integration gate:** replace only the authentication portion of `site.rs::authorize` with the staff module's server-side `content editor/admin` capability check. Do not merely hide `SiteEditor`, remove the internal guard, or leave a session-authenticated editor behind a second Basic-only check. Keep the mutation checks: `X-Site-Editor: 1`, reject `Sec-Fetch-Site: cross-site`, and reject an `Origin` whose authority differs from `Host`. Ensure a reverse proxy preserves the external Host. The frontend uses same-origin credentials and never reads/stores passwords. Test an unauthorized role against GET, PUT, image GET/list, and image POST after adapting auth.

### API contract

| Method/path | Input | Result |
|---|---|---|
| `GET /api/site` | Public | `{ revision, content }`, public data only, `Cache-Control: no-store` |
| `GET /api/site/editor` | Authenticated | `{ revision, content, reloadError }`; reloads disk, returns last-good document plus a staff-only error when invalid |
| `PUT /api/site/editor` | Authenticated, `X-Site-Editor: 1`, JSON `{ revision, content }` | Saved `{ revision, content }` or 409 conflict / 422 validation / 503 write failure |
| `GET /api/site/media` | Authenticated | `{ assets: [{url, bytes}], truncated }`, at most 200 entries |
| `POST /api/site/media` | Authenticated, `X-Site-Editor: 1`, **raw bytes**, `Content-Type: image/png`, `image/jpeg`, or `image/webp` | 201 `{ url: "/media/<uuid>.<extension>", bytes }`; 413 over 5 MiB, 415 for mismatched/disallowed signatures/types |

The content file is the **plain SiteConfig**, not the `{revision,content}` envelope. It has `schemaVersion: 1`; unknown fields are rejected in typed objects. Arrays and string lengths are bounded; complete site content is limited to 512 KiB. Stable lowercase/hyphen IDs must be unique per list. Revisions are SHA-256 of exact file bytes and survive restart. A save checks both the editor revision and current disk bytes, writes/fsyncs a randomized sibling temp file, renames, then updates memory. Directory fsync is best effort. No timer state is involved.

Image URLs may be HTTPS without credentials, known bundled assets (`/bmt-logo.svg`, `/favicon.svg`, `/bg-doodles.png`, `/campus-map.png`), or a single safe raster filename under `/media/` or `/demo-guide/`. Traversal, scheme-relative URLs, `data:`, `javascript:`, arbitrary source paths, SVG/HTML uploads, and original client filenames are not accepted. HTTPS URLs are rendered by the browser; the server never fetches them. Uploads perform MIME/signature checks, **not** full image decoding, transcoding, virus scanning, or EXIF stripping. Staff must remove private metadata and use licensed non-sensitive images. Image-load failure is visible in the UI. Uploaded images become public immediately, independently of saving their use in content. No deletion API is included: removing a URL from content does not delete files or break an older publication. Prune unreferenced assets deliberately after checking all published revisions.

## Frontend integration (required)

Import from `src/features/site/index.ts`:

```tsx
import {
  GuidePage, SiteEditor, useSite, siteDefaults, siteText,
  SafeSiteMarkdown, SiteImage,
} from './features/site';
```

- Route `/guide` to `<GuidePage />` in `SiteRoutes.tsx`. It owns a public header/back link, loading/error/retry/stale state, demo notice, guide search, section TOC, help, useful links and print styling. Print clears the current search so the complete guide prints.
- Mount `<SiteEditor />` in a staff `Site content` screen, using the same staff navigation/role pattern as the rest of the demo. It edits branding, navigation, every copy key, guide sections, help blocks, links and image fields. Each list supports add/remove/reorder. Its Images tab uploads, lists, previews and assigns images. Raw JSON provides full file parity; Preview renders the actual guide.
- The editor shows unsaved state; keeps failed/conflicting drafts; confirms publication; reports saved success; can download draft/latest JSON; and offers explicit latest-versus-draft conflict reconciliation. It keeps a **public-content-only** draft in tab-local `sessionStorage` and warns before closing with changes. Storage-disabled browsers still retain the in-memory draft. JSON download works without a backend.
- `useSite()` returns `{ document, content, loading, error, stale, refresh }`. `content` is the last-good API content, or public bundled defaults until the first load. `document === null` distinguishes defaults from confirmed server content; do not label defaults as a successful publication. One request is in flight per mounted hook; requests time out after 15 seconds, normal polling is every 30 seconds, failures use full-jitter exponential backoff up to 60 seconds. For Today call it once and pass `content` to children, rather than starting a hook per label.
- `siteText(content, key, values?)` uses the configured key or the same key from bundled defaults. It replaces only plain-text `{eventTitle}` / `{count}` values; it does not evaluate code or HTML. All default content comes from `content/site.json?raw`, so no separate hardcoded TS default fixture can drift.
- Module-local types: `SiteConfig`, `SiteDocument`, `SiteLink`, `GuideSection`, `HelpBlock`, `HelpKind`, `MediaAsset`, `MediaList`. Runtime validators and URL helpers are also exported. `GuideContent` is the preview renderer.
- CSS is under `.bmt-site*`, uses the existing `--live-*` palette with self-contained fallbacks, supports mobile/tablet/desktop, and does not modify global Today or staff CSS. No external assets/fonts are requested by this module unless a staff-configured HTTPS image is used. Markdown uses `react-markdown` with `skipHtml`, safe URL transforms, and **no** `rehype-raw`.

### Today/App editorial mapping

Keep computed times, event titles, schedule/delay records and announcement bodies in their existing operational source; do not turn them into static site text. Keep `event.date`, `event.title`, `event.subtitle`, `event.notice`, `event.timeZone`, `event.eventUrl`, `event.travelUrl`, and FAQ question/answer content in the existing `content/event.json` + Event Editor. The site document adds all remaining public editorial copy from the current `App.tsx`:

| Current App area | Site fields / copy keys |
|---|---|
| Header/logo/brand caption, loading logo | `branding.{title,shortTitle,caption,logoUrl,logoAlt,homeUrl}`; `staff.signIn` |
| Skip link and nav accessibility labels | `a11y.skip`, `a11y.navigation`, `a11y.next` |
| Public navigation links | `navigation[]` (`id`, `label`, `href`); includes `/guide` |
| Location and hero image | `hero.{location,imageUrl,imageAlt}`; omit image element when URL empty |
| Title's Live suffix | `brand.live` |
| Unpublished/before/up-next/after headlines | `hero.unpublished`, `hero.before`, `hero.nextPrefix`, `hero.after` |
| Unpublished/after summary | `hero.unpublishedSummary`, `hero.afterSummary` with `{eventTitle: event.title}`; before summary stays `event.subtitle` |
| Before/complete/now/overview eyebrow | `hero.beforeLabel`, `hero.afterLabel`, `hero.nowLabel`, `hero.overviewLabel` |
| Schedule action/next panel | `hero.scheduleAction`, `hero.firstLabel`, `hero.nextLabel`, `hero.noDetails`, `hero.noMoreEvents`, `hero.nextEmpty` |
| Updated-time label, original time prefix, Pacific label | `status.timeUpdated`, `status.timeWas`, `status.timeZone` |
| Disconnection/reconnect/refresh status | `status.stale`, `status.reconnecting`, `status.refresh` |
| Map/travel/help quick links | `quick.{mapTitle,mapDescription,travelTitle,travelDescription,helpTitle,helpDescription}`; travel destination remains `event.travelUrl` (TakeTransit) |
| Schedule header/empty/details/current badge | `schedule.{eyebrow,title,timeZone,empty,details}`; current badge is `hero.nowLabel` |
| Updates header/empty/urgency/pin/show-more | `updates.{eyebrow,title,empty,urgent,pinned,older}` with `{count: sorted.length - visible.length}` |
| Map header/external label/introduction/loading | `map.{eyebrow,title,externalLabel,intro,loading}`; external URL is `usefulLinks.find(link => link.id === 'campus-map')?.href` |
| Help header and public help blocks | `help.eyebrow`, `help.title`, `help.faqTitle`; `content.help[]` rendered with `SafeSiteMarkdown` instead of hardcoded help prose |
| Footer | `footer.{credit,website,classic,staff}`; destinations retain their current routes / event URL |
| Initial loading/error/fallback view | `loading.{title,failure,mismatch,pending,retry,classic}` |
| EmailSubscribe public UI (`InfoCard.tsx`) | `subscription.{label,placeholder,action,pending,failure}`; keep subscription endpoint/state and its server result messages unchanged |
| Guide UI | `guide.*`; guide title/intro/notice/sections are structured `guide` fields |

Use `SiteImage` with `key={url}` and accurate alt text when adding the hero/logo rendering; the key resets failure state when an editor selects a new image. To preserve existing help while migrating, choose one canonical source per screen. Do not display both archived `live.info` and new demo `site.help` as if they are independently confirmed November instructions. The existing Event Editor remains the FAQ authority; do not silently drop existing FAQs.

## Git publishing boundary (integration work still required)

This store publishes an atomic **file** save; it does not commit, push or rollback Git. The editor explicitly says so. The in-progress `OperationsStore` currently versions only `operations.json`, and its clean-worktree check rejects unrelated modified files. **Do not point `SITE_CONTENT_PATH` inside `LIVE_CONTENT_REPO` and claim its existing Push/Restore controls handle this document.** That would dirty the checkout and can block operational publishing.

The integration stage must choose and implement a shared public-content publication boundary: validate/version `site.json` alongside operations and event metadata, serialize their writes with the publisher, expose revision/history/rollback semantics, and keep media URLs stable with separately durable media. On Git restore, reload the site store (and the event store) from the restored validated files. Until that is built, keep `SITE_CONTENT_PATH` outside the dedicated operations checkout and describe site saves as file-backed, not Git-published. No private inbox or roster belongs in that public checkout.

## Verification

Run from the repository root:

```sh
cargo build --locked --manifest-path server/Cargo.toml
node --experimental-strip-types --test tests/site.test.mjs
npx tsc -b --pretty false
npx eslint src/features/site
cargo test --locked --manifest-path server/Cargo.toml
rustfmt --edition 2021 --check --config skip_children=true server/src/site.rs src/features/site/server-test-harness.rs
```

The Node suite compiles the **real** `site.rs` in `src/features/site/server-test-harness.rs`, with only the anticipated AppState fields. It uses existing dependency artifacts, fresh temporary content/media directories and short-lived localhost children, never an existing server or production. It exercises authentication, CSRF checks, save/file/public parity, conflicts, validation, direct edits, last-good reload, uploads, limits, nosniff/CSP headers and media-directory 404s. Seven embedded Rust unit tests exercise persistence/restart, unsafe URLs/schema, stale writers, invalid file fallback, missing/oversized files and randomized uploads. A standalone Vite library build and React static-render unit test exercise the feature bundle and safe Markdown/TOC rendering without browser automation. Pure TypeScript tests cover schema, fixture labeling, URL safety, search and text substitution.

Builder verification passed: 13 Node tests (including the seven embedded Rust unit tests and standalone feature/static-render checks), full-project TypeScript checking, scoped site ESLint, Rust formatting with `skip_children=true`, and the current shared server's 12 existing Rust tests. These results do not mean the unwired feature is already available in the running app. Use `--locked` for Cargo and `skip_children=true` for the isolated Rust host to avoid unrelated lockfile or imported-module formatting changes.

After main/AppState wiring, `cargo test` includes the site tests naturally; the isolated harness remains useful as module-level coverage. Existing app API tests which launch a fresh server must now provide a temporary `SITE_CONTENT_PATH` and `SITE_MEDIA_DIR`, because startup intentionally does not invent a fallback document. The full baseline lint issues in ExpandableOverlay/LiveFeed are unrelated and not suppressed here. Browser keyboard, mobile visual, print-dialog, session-role, deployment durability and production integration checks remain unverified by this slice.
