# Markdown pages: authoring and composition contract

Implemented inside Live's existing React/TypeScript and Rust/Axum runtime. [ADR 0007](adr/0007-markdown-pages-with-shortcodes.md) records the approved direction. This is not blanket R05 completion, production activation or browser/device acceptance.

## Canonical files and syntax

Pages are flat UTF-8 `content/pages/<slug>.md` files. Filenames are 1–64 lowercase ASCII letters, digits or hyphens followed by `.md`. No subdirectories, traversal, symlinks, executable Git modes or arbitrary files. Page metadata is TOML, parsed by maintained libraries (`toml` on the server, `smol-toml` in the editor):

```markdown
+++
title = "Visitor information"
route = "/pages/visitor-information"
nav_label = "Visitor information"
nav_order = 60
nav_visible = true
layout = "prose"
+++

Welcome. [Find your room](/rooms).

{{ anchor(id="arrival") }}

## Arrival

Write ordinary Markdown here.

{{ schedule() }}
```

Both delimiter lines must stand alone, with a newline after the closing delimiter. CRLF is accepted. TOML strings, escapes, comments and multiline strings are supported; unknown/duplicate fields and wrong types are rejected. `title` and `route` are required. Defaults: empty `nav_label`, `nav_order=0`, `nav_visible=false`, `layout="prose"`. Visible navigation requires a nonblank label. Limits are UTF-8 bytes: title 200, navigation label 100, frontmatter 4 KiB, whole file 64 KiB, all source files 512 KiB, 32 pages, 128 parsed parts and headings, Markdown nesting 16; order -1000…1000. Layout is `prose` or `wide`, not arbitrary CSS.

Accepted authored paths: `/`, `/schedule`, `/updates`, `/map`, `/rooms`, `/guide`, `/faq`, `/help`, `/lost-found`; or one slug beneath `/pages/`, `/guide/`, `/help/`. Routes are unique across the page set. `/classic`, staff/admin, API/media, arbitrary paths, aliases (`/directions`, `/lookup`, `/lost-and-found`), encoded/traversal paths and multilevel paths cannot be claimed. Existing aliases and homepage hash redirects remain implemented outside authored pages.

Markdown supports headings, lists, emphasis, code, tables, task lists, links and images. Raw/inline HTML, JSX and executable/template syntax are rejected outside literal code. Links must pass Live's HTTPS/public-route/anchor allowlist; images use its existing HTTPS/bundled-image/`/media/` allowlist. `/media/` references must resolve to regular local files or validated remote bundle assets. Reference-style/entity-encoded Markdown destinations are checked after parsing. JavaScript/data/protocol-relative URLs are not accepted. External URLs are not fetched by validation. No Zola/Typst/Tera/MDX is run.

## Live blocks and stable anchors

These calls must be standalone top-level body paragraphs, separated from surrounding prose or other calls with blank lines. Calls inside lists/quotes or adjoining a prose paragraph are rejected rather than being lifted out of their Markdown container:

| Syntax | Existing component/data |
| --- | --- |
| `{{ now_next() }}` | Calendar/timezone-aware live now/next |
| `{{ announcements() }}` | Published announcement list |
| `{{ urgent_updates() }}` | Urgent published notices only; nothing when there are none |
| `{{ subscribe() }}` | Existing email subscription form/status |
| `{{ schedule() }}` | Structured schedule/delays |
| `{{ room_lookup() }}` | Focused ID-only lookup, assignments, Change ID and `/map?room=` directions; never names/roster |
| `{{ map() }}` | Existing map/search/room selection/route UI and text fallbacks |
| `{{ report_form() }}` | Existing private lost-and-found report/receipt flow |
| `{{ anchor(id="stable-id") }}` | Empty stable fragment target |
| `{{ button_link(label="Find my rooms", href="/rooms") }}` | Reusable primary link; bounded label and the same safe destination allowlist as Markdown links |

Unknown names, nesting, arguments on live blocks, duplicate occurrences of one live block and malformed delimiters are rejected. Anchor IDs are 1–128 lowercase letters, digits or hyphens; duplicates, reserved `main`/`now-heading`/`page-search` and generated `section-*`/`preview-*`/report-form `lf-*` namespaces are rejected. Auto heading IDs are `section-<part-index>-<line-in-part>`; moving headings can change them. Use explicit anchors for enduring external links. Guide conversion preserves `guide-main` and `guide-<legacy-section-id>`; Help conversion preserves section IDs such as `wifi`; FAQ conversion preserves `faq-1`, `faq-2`, etc.

`src/features/pages/PageRenderer.tsx` owns the component registry and safe rendering, contents/search/print. `PageRenderer preview` never mounts live blocks: no report submission, lookup, subscription or operational request. Links in preview open published destinations; anchors use a `preview-` prefix. Shared shell links entering or leaving any authored `report_form` route use document navigation (including query/fragment destinations), so Back cannot bypass the existing before-unload guard through an SPA entry. While a report page is open, the shell holds its page publication stable; later page edits/deletion show an explicit reload notice rather than unmounting a private draft. Site/live operational data still refresh independently. Live blocks have stable semantic keys so inserting/reordering prose does not reset lookup/map/subscription/form state. Report contact data remains memory-only, not page-editor storage.

Button links accept only `label` and `href`: a nonblank label of at most 100 UTF-8 bytes and an allowlisted destination of at most 2000 bytes. They render as ordinary accessible links, not executable actions. They can be repeated and arranged alongside prose on any page.

## Public loading and staff editing

`PublicFrame` owns one `usePages` polling loop alongside the existing site/live loops. Pages refresh every 30 seconds with bounded timeout/backoff and retain last-good data. `AuthoredRoute` waits for the page index before deciding whether to show authored content or a legacy core page; initial failure shows retry, never bundled example facts. A missing custom route is a 404-style page; the SPA shell still has its existing HTTP fallback behavior. Valid empty indexes fall back to existing core components. Navigation comes from page metadata for authored destinations and structured site settings for other destinations. The first three ordered entries are direct links; the rest are in a labeled, keyboard-operable More disclosure. The footer does not repeat the complete navigation. Add, hide, delete or reorder custom pages through metadata/files without editing React route lists. Deleting a core page intentionally restores its legacy fallback; hide its navigation entry instead when retaining authored ownership.

`/admin/content` mounts the generic `PageEditor`: create/select/delete files, title/path/navigation/width fields, source editing, insertion helpers, 800 ms debounced validated live preview (disable it to use manual preview) and whole-set publication. Metadata is a disclosure; the page list follows navigation order. `/admin/site-settings` retains Event, legacy FAQ when not authored, branding/navigation/links/images/public-copy/raw-JSON/preview tools. Structured operations, room tools, roster, People and report inboxes are not Markdown pages.

Drafts use tab-scoped `sessionStorage` key `bmt-page-draft-v1`: `{revision,files,selected}`. Validation, network, permission and CAS errors retain the original source/revision. Switching/deletion, in-app link clicks and document unload have confirmation guards. Browser history and programmatic staff-role redirects rely on retained tab drafts rather than a router-level blocker; verify these paths in the browser handoff. Recovery is explicit, including after retrying a failed initial load; the stored draft is not cleared by that retry. After a conflict, download the draft, load current files and reconcile every changed/deleted file before explicitly adopting the current revision. No automatic merge or force-save. Metadata fields rewrite only TOML formatting; the Markdown body is retained. The draft download is JSON for recovery, not the canonical publication format. Private data must never be typed into public source.

## API

All responses are no-store. Page reads expose public source only. Protected endpoints use existing `content:write` capability and session/origin/CSRF handling; both Admin and Super have this capability, and live revocation remains authoritative.

| Endpoint | Input | Result |
| --- | --- | --- |
| `GET /api/pages` | Public | Complete validated `Document` |
| `GET /api/pages/editor` | Staff | Same document, including source/revision/reload error |
| `PUT /api/pages/editor` | `{revision,files:{"home.md":"+++…"}}` | Persist/activate whole page set; return new document |
| `POST /api/pages/preview` | `{source:"+++…"}` | Validated `Page`; no publication/mutations |
| `POST /api/pages/adopt` | No body; only when current file set is empty | Conversion document as an **unpublished draft**, using current revision |

`Document = {revision,files,pages,reloadError}`. `pages` is keyed by filename. `Page = {meta,body,parts,headings}`. Each part is `{kind:"markdown",source}`, `{kind:"block",name}`, `{kind:"anchor",id}` or `{kind:"button",label,href}`; heading entries contain `{id,title,part}`. Metadata uses the exact snake_case TOML names. Invalid input is 422 (malformed JSON/extraction may be 400/413/422); stale/recovery conflicts are 409; storage/remote failures are 503. No success is reported before the selected publication mode confirms its save. The staff transport gives page publication the same bounded 90-second remote-confirmation budget as other Git publications; inert previews keep the ordinary short request budget. An ambiguous transport failure can occur after a save; load and compare current files rather than discarding or blindly rebasing the draft.

`reloadError` reports file-store recovery diagnostics; in Git modes use the existing publication status for invalid remote/HEAD and pending-push details. Browser transport/shape errors are shown separately and keep last-good data.

File-mode revision is SHA-256 of the complete filename/source map. Git modes use the existing full commit revision and shared CAS/publication pipeline. A page edit conflicts with another bundle edit, not only another page edit. Remote code-only commits follow existing digest-aware reconciliation; the updated root tree preserves code outside the content bundle.

The editor provides Edit/Preview and desktop Split views, a phone page picker, a secondary Formatting & inserts disclosure, and persistent publish/recovery controls. Public preview uses a sandboxed iframe document with the app's public CSS (no scripts); Fit workspace and Phone width apply real responsive media queries. Successful publication retains the validated preview and scroll state. Long pages have a contents outline; short pages show content first, with Search & print below it.

## Modes, migration and recovery

- **File mode:** `PAGES_CONTENT_DIR`, otherwise `pages/` beside `SITE_CONTENT_PATH`. The parent must exist, be non-symlinked and be writable durable storage; exactly one runtime writer. Missing pages on a legacy install means an empty index, not copying defaults. The first explicit save creates the directory. Complete staged regular files are validated before directory replacement. Sibling `.pages-last-good.json` is recovery data, not an editable source. Invalid direct files or an accidentally missing directory retain last-good content, including restart; no valid disk/cache at startup fails closed. Repair the directory from reviewed source (or recover the `files` map), then let polling validate it before publishing again. To intentionally remove all authored pages, publish an empty set or leave an empty directory; do not remove the directory itself. `.pages-stage-*`, `.pages-previous-*`, `.pages-cache-*` are transaction/recovery artifacts, never content to commit. Interrupted artifacts need operator review; the application does not delete unrelated drafts. Arbitrary operator writes are not locked by the server mutex.
- **Local Git:** `<LIVE_CONTENT_REPO>/pages/*.md`, committed alongside `operations.json`. JSON does not store the canonical pages. Dedicated clean-worktree, index lock, branch and CAS checks remain. `refs/live/local-loaded` retains the last valid publication across invalid-HEAD restart. Restore is a new forward commit and restores the page files too. Exported operations snapshots can contain a `pages` source map for backup; expand it into individual files and remove the map from `operations.json` before import. A repository without pages remains valid.
- **Remote-first:** existing v1 `content/manifest.json`, operations/event/site/wayfinding/media bundle additionally accepts optional regular `content/pages/*.md` blobs (mode `100644`). Empty/older v1 bundles remain valid. Page content participates in full validation, digest, media-reference checks, polling, remote-confirmed activation, durable pending/archive and forward restore. Rejected pushes keep the page files in the pending Git proposal; public content stays on last-good. Use the existing publication status/pending/retry/archive UI and approved Git workflow. Never put `pages` inside `operations.json` as the canonical representation. Unknown paths remain rejected.
- **Fresh sources/demo/Docker:** repository Home/Schedule/Updates/Map/Rooms/Guide/FAQ/Help/Lost & Found files are actual Markdown, included by Docker's existing `COPY content/`. No new page-copy startup hook exists. `scripts/demo.mjs` copies them with exclusive writes only while initializing a genuinely new disposable local-Git sandbox; rerunning an existing sandbox does not seed/overwrite pages. Existing deployments should mount the entire reviewed content directory, including recovery storage, or explicitly set `PAGES_CONTENT_DIR`; replacing only an application image is not authorization to overwrite installed content.
- **Explicit adoption:** empty legacy installations can choose **Convert existing public pages** to prepare all nine routes from currently installed site/event/wayfinding sources, including navigation labels, guide images/prose, FAQ answers, Help anchors and room help/travel copy. Preview/review every file and publish explicitly. Generated Markdown escapes literal entity-like text and uses escaped angle destinations so installed links/images with parentheses or entity-like query values retain their destination. Unsafe or oversized converted input fails validation without altering its source; reconcile that content manually rather than dropping it. Existing authored files cause adoption to reject, never merge/overwrite. Legacy `site.guide`/`site.help` and `event.faqs` remain compatibility data for older clients and deliberate rollback; server-side site/event saves reject changes to those fields while the corresponding authored route exists. Other shared site fields remain editable. Direct-file operators must also respect this ownership. Removing an authored core page restores its legacy view; review retained legacy content before doing so. Shipped authored Home does not consume old hero prose/image composition; shared site branding/copy still serve the shell and live components.

## Verification boundaries

Focused Rust parser/store tests, browserless DOM/renderer/editor tests, and synthetic file/local-Git/local-bare-remote API tests live in `server/src/pages.rs`, `tests/markdown-pages.test.mjs`, `tests/pages-api.test.mjs`, `tests/visitor-flows.test.mjs`, `tests/git-publishing.test.mjs`, `tests/remote-content.test.mjs`. Run `npm test`, `npm run test:api`, lint/build, Rust tests/format/strict Clippy. The [stage log](status/log/2026-10-21-markdown-STAGE.md) records observed results, not inferred acceptance.

The subsequent [visual refinement log](status/log/2026-10-21-markdown-visual-refinement.md) records desktop/tablet/phone browser checks, publication/conflict/report flows, screenshots and specific remaining gaps. Real-device/assistive-technology/print acceptance, actual deployment mounts/permissions, GitHub branch/credential/protection policy and migration rehearsal, real providers and authoritative November content/verified accessibility routes remain open. No external email/provider calls, production changes or reference-repository modifications were made. Search currently matches whole Markdown parts between shortcode/anchor boundaries, not ranked full-text search. Heading IDs are deterministic but not permanent without explicit anchors. Existing R05 copy exceptions and translation gates remain.
