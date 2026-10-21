# 2026-10-21 — Berkeley public design and content-driven pages

## Scope and source

R01, R05, R06, R09 and R13. [Ian's session](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024), messages `event-01a15ce6011772f7bb868f2bb8039cfe` and `event-01a15cea334b74c48b8b8c2ef8af47fa`:

- **Accepted:** minimal, intuitive, responsive composition; fix spacing, hierarchy and palette rather than adding explanatory text or more controls.
- **Accepted:** public UI as close as possible to berkeley.mt, with a similar/same content-driven architecture. Admin stays close to Lemon.
- **Accepted:** editable page composition, not just editable strings inside fixed page structures; preserve working features.
- **Accepted delivery change:** the next patch applies **on top of** the last delivered `live-combined-20261021.patch`, not directly to remote main. That delivered tree is `c557c650bbbc269c03b978dd7a6d9d9116a57e70`. Preserve it as the export/apply-check baseline.

## Reference inspection

Updated the already-cloned berkeley.mt reference, cleanly fast-forwarding to [769770a](https://github.com/berkeleymt/berkeley.mt/commit/769770aa0d0a5398ea15183e118905bf1adc8300). No authored changes to that repository or Lemon.

- berkeley.mt uses Zola, Tera templates and Tailwind; Markdown with `+++` TOML frontmatter supplies page content and metadata. Shared templates provide the shell; shortcodes embed buttons, details, grids and interactive tools. It is not a completely freeform no-template system, and its README still describes a visual/git-less editor as future work.
- Inspected the live homepage and BMT 2026 event page. Reference traits: centered logo/name/navigation, pale gray background, IBM Plex Sans, subtle dividers, blue prose links, compact content column and a desktop contents rail for long documents. The shell uses `max-w-4xl`, responsive padding and a common section gap. Reuse the visual language, not registration copy or every marketing module.
- Lemon's `docs/design-skill.md` explicitly says it is adapted from Notion's principles. Use its cognitive-load, hierarchy, feedback and one-job-per-screen guidance for staff. Its stray dark-mode checklist conflicts with the light-only design system; light-only remains controlling.

## Proposed architecture — awaiting confirmation

Recommend the same **authoring pattern**, while retaining Live's Rust/React runtime rather than introducing a Zola build/deployment dependency:

1. Individual Markdown page files with TOML frontmatter for route/title/navigation and a small shared layout vocabulary. Allow adding pages and rearranging their content without editing route-specific React components.
2. A generic renderer and a small allowlisted shortcode/live-block registry: schedule/now-next, announcements, room lookup, map and report form, plus reusable editorial elements. No arbitrary JavaScript, JSX or executable templates in staff-authored content. Interactive behavior and private data stay in application code/services.
3. One page-list/editor workspace with formatting/insert tools, rendered preview, source access and publish feedback. Do not create another bespoke form for every page. Operational editors (schedule, room graph, roster, inbox, People) remain task-specific where they enforce real data/permission rules; editorial flexibility does not turn private staff operations into public documents.
4. Preserve Git authority, validation, last-good content, revision/CAS protection and media checks across direct file edits and staff publishing. Keep structured operational data separate from editorial Markdown. Existing URLs, anchors, Classic and public/private boundaries must survive an explicit migration, without silently overwriting installed content or maintaining two competing sources of truth.
5. Markdown is preferred over Typst for responsive website authoring and compatibility with the existing BMT workflow. Exact Zola/Tera compatibility would require a different implementation decision; the proposed parser must not be advertised as a full Zola replacement.

## Visual implementation plan — not yet implemented

- Start with a vertical slice: Berkeley-style public shell + an actual file-driven Home/Guide + the generic staff editor/preview/publish path. Expose this rendered slice early, then migrate the remaining editorial pages and composable live blocks.
- Home: urgent notice only when applicable, a clear room-finding entry, compact now/next and a short set of task links. Remove repeated welcome text and repeated full navigation, not essential destinations.
- Map/rooms: promote assignments and selected map; collapse secondary browsing only with a visible way back. Allow a shared wider layout for maps instead of squeezing them into a prose column.
- Staff: use Lemon's tokens, flat task navigation and clear action feedback; replace the fixed Guide/Help/etc. editor tabs with a page list.
- Review spacing, type, alignment, palette and all critical states at 390/820/1440 widths, with keyboard and narrow reflow checks. Preserve substantive route/accessibility disclosures, but write them for visitors.

## Verification

Partial read-only baseline browser audit completed before the new reference was supplied: Home, My rooms and Map at 390 and 1440 in a fresh synthetic sandbox. Synthetic ID lookup and room selection worked. Observed redundant navigation, excessive mobile preamble and selected maps/results too far below their triggering controls. Guide, Help and staff Content were **not inspected** before stopping; this is diagnosis, not acceptance of the redesign.

New work in this pass is reference research and documentation only. No application implementation, new acceptance tests, provider calls, push or deployment. Earlier test results do not establish this proposed migration's safety.

## Remaining work

Confirm retained Live runtime + Markdown/shortcodes versus adopting Zola itself before changing content storage or rendering. Then implement/test the vertical slice, migrate remaining pages, run functional/visual regression checks and export one incremental patch against the last delivered tree. Existing provider, authoritative-content, translation, physical-route and real-device release gates remain open.
