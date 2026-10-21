# 2026-10-21 — Rendered Markdown layout refinement

## Scope and source

Continues Ian's approved Markdown/shortcode architecture, Berkeley public reference and Lemon staff reference in [this session](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024). Incremental delivery baseline is tree `c557c650bbbc269c03b978dd7a6d9d9116a57e70`, not remote main. No pushing, deployment or reference-repository changes.

The first read-only browser review used a fresh synthetic sandbox at 390/820/1440 px. It found a weak primary room action, excessive preamble/utilities, tall schedule rows, duplicate map/route displays, mobile editor ordering and preview styles leaking from staff CSS. It did not establish final functional acceptance.

## Changes

- Safe reusable `button_link(label="…", href="…")` composition, rather than a Home-specific hard-coded widget. All nine destinations stay authored files. Fresh Home promotes room lookup; My rooms appears in primary navigation. Installed content is not overwritten.
- Scoped Berkeley public palette (near-black headings, muted supporting text, blue actions, pale neutral background), compact mobile masthead and one shared content edge. Staff access stays in the footer. Classic styling remains scoped separately.
- Longer authored documents get desktop contents and a compact mobile disclosure. Short Help/FAQ content is first. Search/print remain available after the content rather than being removed.
- Schedule rows retain current/completed/changed semantics, times, locations and expandable details without repeating Upcoming. Timezones use human-readable names; before-event now/next shows the first event once.
- Selected destinations switch between Floor plan and Plan a route in the same space. No second planner below the selected map. Graph origins/destinations, step-free filtering, written guidance and refresh remain available; general routing, floor-room lists and campus browsing are secondary disclosures. Historical images still do not certify physical/accessible routes.
- Editor offers a compact phone page picker, secondary New page, selected-file state, persistent Edit/Preview/Publish actions, recovery/download actions and desktop split view. Source/preview remain one draft with existing revision/conflict protections.
- Preview lives in a sandboxed iframe document using the app's public CSS, preventing staff style leakage and allowing actual phone-width media queries. Content is still rendered through the safe React Markdown renderer; no author scripts/HTML execute and live blocks remain inert. Preview links open published destinations separately.

## Verification

Initial post-edit build/lint and 71 Rust tests passed. The changed iframe preview required updating the DOM test to inspect its document rather than the surrounding staff document; the focused 17-test suite then passed. Added regressions cover safe/bounded button links, content-before-utilities, preview isolation and switching the single selected-room workflow with inaccessible-route fallback.

Full shell checks passed: 77 API/integration tests, 72 Rust tests on both the default toolchain and Rust 1.87, strict all-target/all-feature Clippy, formatting and whitespace checks. `npm audit` reports zero vulnerabilities. Two updated assertions initially failed because the parser preserves leading Markdown whitespace and the shortened demo disclosure now capitalizes “Not”; corrected those assumptions without dropping safety assertions.

The next synthetic browser pass verified Home → ID-only lookup → selected room, VLSB 2050/2060 marker selection, zoom/drag persistence, single route map/text, and step-free fallback. It reproduced a real editor defect: publishing successfully cleared preview state without retriggering its source-dependent effect. The preview vanished while its status still claimed current. Removed the unnecessary clear (source matching still prevents stale previews), added a failing-then-passing regression preserving the iframe identity, and made stale preview status conditional. Preview placeholders are shorter; selected Edit/Preview/Split styling now wins over shared staff button styles. After the fix, all **74 frontend/DOM tests**, lint and TypeScript/Vite build passed. Existing >500 kB chunk warning remains.

Lemon's design-review checklist was applied as guidance, using Live's own tests/lint/build and browser widths rather than running or modifying Lemon's Vitest/gallery infrastructure.

### Final browser evidence

Rebuilt synthetic sandbox on port 3098; all external mail/providers disabled. The corrected publication retained its exact iframe/content and cleared the draft, then public content refreshed. Checked real two-tab HTTP 409 protection, retained/downloaded draft A versus published B, comparison and confirmed replacement; private report reload/navigation guards, successful receipt with truthful unavailable-email status; ID-only assignment/directions, offline lookup failure and recovery; Admin versus Super permissions; Classic's published November identity. Preview computed style samples matched public content, Guide image loaded, external published links opened separately, sandbox had no scripts, inserted/reordered live blocks stayed inert. Phone picker/Edit/Preview, phone-width preview and Split-to-narrow Edit worked.

Home, Schedule, Guide, Help, FAQ, Updates, selected Map, Content and Classic were swept at 390/820/1440 px. Public pages had no measured horizontal overflow. This found a 13px overflow in the phone editor's More actions menu. Bound the narrow menu to the publication bar, reduced the editor preamble, kept secondary tools in native disclosures and compacted the phone controls. The focused rebuilt retest passed at 320/390: menu/load/download/media remained usable with no horizontal overflow, safe Button link insertion/preview/discard worked, desktop Split remained usable and publication still retained the preview. Source starts around y=807 at 390 and y=860 at 320 in the tested 1000px viewport; it still requires scrolling on shorter phones, and at 320 Publish wraps without overflow. All 74 frontend tests plus lint/build passed after these changes.

One final density pass moved New page/Delete page into More actions without changing their handlers, retained the phone page picker instead of a redundant heading/sidebar, and constrained menu height with scrolling. Added a draft-only create/delete regression: **75 frontend tests** now pass, as do lint/build. A fresh isolated browser tab confirmed source is 136px earlier (y=671 at 390×844, y=723.5 at 320×667), no horizontal overflow, reachable internally scrollable menu controls, temporary page creation, delete-cancel retention, confirmed removal and unchanged published Git HEAD. Desktop 1440 Split and selected controls remain correct. On 320×667, source still needs page scrolling; reaching bottom menu controls can require both page and menu scrolling. Unexplained browser-state changes in the first tab were discarded as evidence and did not recur in the isolated tab.

Primary corrected-publish/visitor recording: `live-final-preview-edited.mp4` (before the narrow layout corrections; its completed publication/visitor assertions remain valid). Final full screenshots: `accepted-home-1440.png`, `accepted-home-390.png`, `accepted-editor-density-390.png`. The final two public files were restored through the editor to exact shipped Home/FAQ content; no appended test copy ships in this patch. Artifacts are delivered with the session, not committed into the repository.

Explicitly not covered by this browser evidence: comprehensive accessibility/real-device touch, exhaustive keyboard/map-pan and changed-origin route correctness, restore-saved-draft followed by reconciliation/republication, Classic's other calendar variants, physical route accuracy, actual providers and deployment. These are not silently marked passed. Existing automated tests cover some variants, but are not real-device acceptance.

## Remaining work

Real providers, authoritative November information, physical and accessible routes, real devices/assistive technology, translation, retention policy, capacity and deployment remain separate release gates. No production-readiness sign-off is claimed from local synthetic checks.

## Delivery

`live-markdown-redesign-incremental.patch` applies **on top of the previous combined delivery**, whose complete Git tree is `c557c650bbbc269c03b978dd7a6d9d9116a57e70`; this is not a replacement patch for clean remote main. Exported all 66 changed/new files through a separate index, checked/applied to a fresh copy of that baseline and compared the entire resulting Git tree with the final working-tree snapshot: exact match. No reference-repository changes, push, merge or deployment. Documentation path/link checks passed across 51 Markdown files and 12 pinned references.

Preserve local changes and run `git apply --check <downloaded-patch>` before `git apply <downloaded-patch>`. If the check fails, reconcile the baseline/edits instead of forcing it. Reinstall with `npm ci`; use the README's new `.demo/markdown-review` sandbox to see the shipped pages, or explicitly review/convert an existing sandbox without overwriting its edits.
