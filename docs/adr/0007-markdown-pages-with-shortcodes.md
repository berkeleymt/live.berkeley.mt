# ADR 0007 — Markdown pages with allowlisted live blocks

Date: 2026-10-21. Status: **accepted direction; foundation implemented locally, not production/browser acceptance**.

## Source and context

Ian explicitly approved “Markdown + shortcodes within Live (recommended)” and requested a working full-stack foundation, not a backend-only contract. The production target remains the existing React/TypeScript and Rust/Axum application, with a berkeley.mt-like public presentation and Lemon-like staff tools. This supersedes the unconfirmed runtime choice in the [reference review](../status/log/2026-10-21-content-driven-direction.md). The incremental delivery baseline is `c557c650bbbc269c03b978dd7a6d9d9116a57e70`; pre-existing dirty work is retained.

## Decision

- Canonical page source is bounded, flat `content/pages/*.md`, beginning with `+++` TOML frontmatter. Use maintained `toml` and `smol-toml` parsers, not an improvised TOML subset. Markdown validation uses `pulldown-cmark`; rendering uses `react-markdown`/`remark-gfm` without raw HTML.
- Frontmatter controls title, public path, navigation label/order/visibility and shared prose/wide layout. Arbitrary scripts, templates, JSX, raw HTML and arbitrary routes are not accepted.
- A small registry composes existing React live components through standalone allowlisted shortcode lines. Preview shows inert placeholders instead of mounting live blocks. There is no Zola, Typst, Tera evaluation, MDX or user-supplied component execution.
- Home and Guide ship as actual Markdown files. Existing installations without a page directory retain legacy public routes. Explicit conversion prepares Home/Guide/Help as a draft from loaded site content; only a subsequent publish adopts it. No startup overwrite or automatic conversion of installed content.
- Staff Website content is a generic page list/source/metadata/preview/publish workspace. Event/FAQ, shared branding/copy, navigation, media and other structured settings remain separate. Guide/Help compatibility fields are not alternate writable sources once authored routes exist.
- File mode stages complete directories with CAS and durable last-good recovery; local Git commits individual page files; remote v1 bundles optionally include regular `pages/<slug>.md` blobs and retain existing remote-confirmed activation, pending/archive and restore protections.

## Boundaries and consequences

Schedules, delays, announcements, maps/graph, room lookup, roster, private reports, accounts, subscriptions and mail remain their existing structured subsystems. No names/roster rows enter public page APIs. Exactly Admin/Super, live revocation, draft/receipt/privacy rules and legacy URLs remain compatibility constraints. English remains authoritative; the page system does not invent event facts, verified routes or a translation rollout.

This deliberately small authoring surface is not a rich-text page builder. A publication replaces the complete page set; conflicts require explicit reconciliation. Images use the existing media uploader/allowlist. Original source formatting is preserved until the user edits metadata, which normalizes TOML formatting. File-mode recovery requires writable durable parent storage and one runtime writer; read-only/multi-writer deployments require deployment-owner review. A file-system operator must repair invalid direct edits before a file-mode editor can replace them.

[Exact syntax, API, migration and recovery](../markdown-pages.md). [Foundation evidence and remaining acceptance](../status/log/2026-10-21-markdown-STAGE.md). No production, real-provider, browser/device/a11y or release approval is implied.
