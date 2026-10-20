# 2026-10-20 — Live documentation baseline

## Scope and source

Documentation-only response to [Ian's specification and twelve answers](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024). Live source baseline `0d56ff0`; Lemon reference `77721d0`. No application/CI/configuration changes, provider requests or production mutation.

## Changes

- Added a handbook and traceable R01–R14 requirements, public journeys/design system, GitHub publication architecture, roles, translation and contract boundaries.
- Added a code-grounded ContestDojo parity specification. Notable correction to older setup prose: Lemon runs automatic minute-based sync, maps rooms per test, and uses Settings under `/admin/settings`; visitor reads still use local data.
- Added staff/deployment/testing guides, incremental implementation plan, ADRs, decision register and evidence-based status.
- Retained original feature/demo notes as implementation history with explicit supersession for roles, lookup and publication. No fake claim that the target has already shipped.

## Verification

- Documentation/reference check passed: 29 Markdown files, 127 relative links/anchors, 13 commit-pinned Lemon source-file references, R01–R14 coverage and all seven legacy scope notices.
- Current route inventory checked against the Live router; ContestDojo sync/mapping/settings and staff policy checked against the cited Lemon code/ADRs. GitHub metadata confirms the Live repository is private; no visibility change is proposed.
- `git diff --cached --check` passed; all 29 changed paths are Markdown. No runtime/config/CI changes or Lemon working-tree changes.
- Combined patch applied cleanly to an isolated archive of freshly fetched remote main `0d56ff03f527b6bed00eafe6ae6c8a34cb17fc41`; all resulting files matched the worktree byte-for-byte. The Markdown ZIP passed integrity/content checks.
- No runtime, UI/device/accessibility, live-provider or load tests were run by this pass. Earlier demo checks are historical, not a new verification claim.

## Remaining work

Resolve [open decisions](../decisions.md) as their slices start, collect verified event/map inputs, then confirm the first feature/prototype scope. Recovery enhancements remain deferred. Delivery is one documentation patch against current remote main, not a production deploy.
