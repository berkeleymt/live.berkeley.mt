# Browser-driven product correction

## Direction

Ian rejected the prior implementation as an unfinished product demonstration. On October 20 he authorized a browser/screenshot audit and corrective work, required Lemon's gallery/style (especially staff), and asked us to remove developer-directed public copy. He subsequently asked us to present choices before uncertain product/design decisions. This is corrective work on existing flows, not approval for new architecture or product scope. Lemon stays unchanged; delivery stays one combined patch on the existing branch.

## Initial browser evidence

An isolated synthetic demo audit confirmed that publishing FAQ in EventEditor invalidated SiteEditor's loaded bundle revision: the next Guide save conflicted. Its failure feedback was many screens above the save action. Public room guidance exposed legacy/import/graph internals. Public report → Admin inbox → resolution passed. Admin/Super identity checks passed. The initial audit was stopped to implement corrections; it did **not** cover all pages, mobile or keyboard journeys.

## Changes underway

- Content sections replace stacked independent long editors. Both remain mounted so switching sections keeps drafts.
- Before a public-document write, compare that document's loaded content with its current server content. Advance the bundle revision only if this document is unchanged; the server still enforces CAS. This fixes sequential unrelated-document edits without blindly overwriting a concurrent edit.
- Site conflicts show field comparisons rather than a raw JSON wall. Save/error/recovery controls share a sticky action area; errors focus that area.
- Staff controls use Lemon's actual light palette (#0058bd actions), system fonts, bordered surfaces, neutral active navigation and labeled tablet navigation. Viewed the live Lemon gallery, including its shell/buttons, read-only. Live's existing Phosphor icon library is retained; Settings and Access now have distinct meanings/icons.
- Public copy describes visitor actions, not implementation state. Fictional route disclosures and safe unavailable-route fallbacks remain. Demo fixture explanations become representative visitor content under the shared demo banner. Persisted demo data is never silently replaced.

## Verification so far

- Added a browserless DOM reproduction for EventEditor → SiteEditor. It failed on the old implementation (only event write succeeded) and passed after safe preflight revision reconciliation.
- TypeScript/Vite build and ESLint passed after initial editor/style changes. The known large-bundle warning remains.
- Corrective desktop browser run passed FAQ → Guide → FAQ publications and public visibility, draft retention across sections, and genuine two-tab conflict comparison/download/explicit recovery. Schedule preview remained private; reviewed Individual +30/Lunch absorb15 changes published the exact expected public times. An immediate update published successfully. The run stopped for another defect, not release acceptance.
- Browser finding: subscription confirmation promised email while sending was disabled. Added an additive `emailDeliveryEnabled` flag, safe editable saved/unavailable/legacy fallback messages, and repeat-subscription coverage. A regression failed before the fix. Operations now prioritizes schedule/updates with publication/history/recovery still accessible in a collapsed section; fixed the schedule-review checkbox alignment.
- Compatible `npm audit fix` updated only the lockfile (no major upgrades or force). Full and production-only `npm audit` now report **0 vulnerabilities**, formerly 12. This is current npm advisory coverage, not proof of no security issues.
- After these changes: **47 frontend/DOM, 74 API/integration, 63 Rust tests passed**; TypeScript/Vite, ESLint, Rust formatting and strict all-target/all-feature Clippy passed. The bundle-size warning remains.
- Subsequent browser results and remaining release gates are recorded below; the earlier counts above are historical checkpoints.

## Completed browser corrections

- Corrected maps and synthetic assignment → Directions passed; [map-specific evidence](2026-10-21-interactive-floor-plans.md). Staff room saves became publicly visible and now show concise completion feedback.
- Super added/demoted/removed a synthetic account; Admin direct People/Settings visits redirected with visible denial. Roster/provider settings accurately disclosed synthetic/not-configured status. At 390px Menu correctly toggled navigation/account controls.
- Public lost-and-found returned a receipt with honest unavailable-email feedback; Admin resolved the report and saved private notes, both retained after reload.
- A genuine final CAS race was exercised: pause A's actual PUT after successful preflight, publish B, then release unmodified A. HTTP 409 preserved A's draft and public B. Narrow comparison/recovery had no measured horizontal overflow; explicit replacement required confirmation. Review now focuses the comparison; its asynchronous-fetch branch has automated/code coverage but was not independently browser-retested in the final focused pass.
- Reviewed local history restore remained disabled until acknowledgement, then created a **forward commit** whose parent was the previous head. Public Guide/A101 reverted to reviewed content; all eight floors/62 rooms and images remained. No remote push occurred.
- Restore checkbox initially inherited `flex-direction:column`; a computed-style regression failed before explicitly setting row. Desktop and 390px browser checks confirmed checkbox and wrapped sentence align together. Selected content-tab hover stayed readable.
- Classic incorrectly hardcoded April/BmMT and claimed completion before the November event. It now uses published event identity/date/notice and event-timezone/calendar state, retains its widgets, and inherits editable subscription copy. Browser confirmed November identity, pre-event state and no-email sample disclosure; static-render tests cover today/after/unpublished variants.
- Final checks: **52 frontend/DOM, 74 API/integration, 63 Rust**, TypeScript/Vite, ESLint, formatting, strict Clippy; npm audit **0 advisories**. Existing large-bundle warning remains.

No real Google/ContestDojo/GitHub/Postmark delivery, physical routes, Safari/mobile hardware, assistive-technology or capacity acceptance is claimed. Translation/provider and retention decisions remain open. The final scoped browser pass found no new defects; this does not substitute for the production release gates.

## Acceptance clarification

Ian clarified: “you are not building a demo. you are building a live product production publish ready.” The production app is the deliverable. Synthetic data and disabled provider traffic are only local verification safeguards, never a reduced feature set or a lower quality bar. Provider activation, actual November content/route verification and the explicitly unresolved translation/retention decisions remain release gates, not unfinished screens to hand off as completed work.

## Design-review adaptation

Lemon's design-review skill is the reference, but its `web/` Vitest/design-lint/visual-baseline commands do not apply to Live's React/Rust checkout. Use Live's Node DOM/API tests, ESLint, TypeScript/Vite and approved browser testing instead. Do not edit or run mutation-producing tooling in Lemon.
