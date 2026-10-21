# 2026-10-20 — Public hub, dedicated routes and compatible editorial links

## Scope and source

Implementation-plan slice 1; R01/R02/R12/R13 and the existing R05 editorial boundary. Ian's follow-up instructed: “git clone the latest remote and check the docs and progress. move on to the next steps for us. do not change/break any existing features/functionalities. obviously, again, use the docs” and “make sure you log your decisions, current progress, and notes in the docs file.” The assigned slice explicitly includes all public destinations and forbids browser/UI-driven testing in this pass.

Worked in the existing Linux checkout on `devin/1792480636-live-next-slices`, baseline `6293bbe7c2ba2317ab4e849ba5ed9aec70ae74b3`. Integrated the parent's uncommitted `src/data/publicNavigation.ts` and `tests/public-navigation.test.mjs`; did not reset/switch the branch. Read the Live working rules/requirements/plan/status and applicable public/content/design guidance, with Lemon as read-only reference. No Lemon changes, production/provider access, real mail, push, PR or deployment.

## Changes

- `src/SiteRoutes.tsx` and `src/components/PublicFrame.tsx`: one shared public shell for Home, Schedule, Updates, Map, My rooms, Guide, FAQ, Help and Lost & found. Labeled primary navigation wraps on narrow widths; all destinations remain in the footer. Active links, skip link, a single main landmark, document titles and once-per-location focus handling are implemented. Static tests establish markup, not real browser focus behavior.
- `src/App.tsx`: replace the former long-page Home with a short gateway and separate real-data page renderers. Schedule keeps timezone/date-aware current state, delayed/original times, details and current-event anchor. Updates retain urgent/pinned ordering, older updates and the existing email subscribe component. FAQ searches real event questions/answers; Help uses published site help. No fabricated schedule is shown while `/api/live` fails.
- `src/data/publicContext.ts`, `useLiveData.ts`: the shell owns exactly one site hook and one live hook; route children consume context. Live refresh keeps the 5-second healthy interval, 8-second timeout and three-failure stale threshold, adds last-received time and full-jitter failure backoff up to 60 seconds, and preserves one in-flight request/last-good data. Classic/staff use their own hook only when mounted, not behind hub routes.
- Reuse `GuideContent` with an embedded mode, keeping search/contents/print but avoiding duplicate header/main/poller. Reuse `RoomFinder` for `/map` without the lookup form and for `/rooms` with the existing lookup. Guide/Help do not show bundled demonstration facts as a successful publication before site content loads. The private report form and APIs are unchanged; document links entering/leaving reports retain its unload warning. `/classic` and its original map/time controls remain available.
- Legacy root fragments `today`, `schedule`, `updates`, `map`, `help`, `faq` resolve to dedicated destinations. Safe content links normalize those fragments; custom/external/guide-section links remain intact. `/directions`, `/lookup`, `/lost-and-found` are explicit aliases preserving query/fragment.
- `content/site.json`, `SiteEditor.tsx`, TypeScript/Rust URL validators: dedicated navigation, new editable labels, safe `/schedule` and `/updates` destinations, schema v1 retained. Older authored labels/order survive; missing core destinations receive defaults without rewriting stored content. The editor exposes fallback copy keys and explicit bounded link migration. Updated event/example links instead of inventing November facts.
- Registered the parent's navigation tests plus static React route tests in `npm test`; extended real site API save/rejection tests and integration SPA checks for dedicated pages/aliases. Updated README, protocol/content contracts, public UX, demo walkthrough, plan, decisions, testing and status.

### Decisions

Use `/map` for public browsing and retain `/rooms` for current lookup compatibility; do not introduce `/my-rooms` or change the approved future lookup policy in this slice. Keep subscriptions on `/updates` and legacy tools on `/classic`. Keep server/content contracts additive; no schema-version bump or new API endpoint is needed. Runtime content fallbacks preserve old saved documents but do not claim unpublished demo facts are live. These are implementation decisions within the assigned slice, not provider/product approvals.

## Verification

All checks ran locally against synthetic storage or static React renderers:

- The newly added dedicated-link validation test initially failed on `/schedule`; it passed after matching Rust/TypeScript allowlist changes.
- `npm test`: **19 passed** — existing schedule/timezone tests, legacy-link normalization, safe/unsafe content paths, default coverage and collision-safe migration, actual route registry, one main/heading, active links, delayed/current/next/urgent content, guide search/print and subscription markup, initial failure versus empty content, stale last-good content, authored labels.
- `npm run test:api`: **61 passed** — existing live/staff/rooms/reports/publishing/subscribe compatibility plus dedicated-link editor persistence, 409 conflicts and rejected unsafe/unimplemented destinations. Uses isolated real Rust handlers and local synthetic Git remotes; no hosted Git/provider calls.
- `node --experimental-strip-types --test tests/integration.test.mjs`: **3 passed**, rerun after extending the real-server SPA route/alias inventory. Results are local HTTP/API verification, not rendered-browser navigation.
- `npm run lint`: passed. `npm run build`: TypeScript and Vite production build passed.
- `cargo test --locked --manifest-path server/Cargo.toml`: **36 passed**.
- `cargo fmt --manifest-path server/Cargo.toml`, then `cargo fmt --check --manifest-path server/Cargo.toml`: passed.
- `cargo clippy --locked --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings`: passed.
- `git diff --check`: passed.

No browser, click/keyboard flow, actual print, screen reader, phone/tablet, production, provider or load verification was performed. Static rendering does not execute polling/focus effects and is not an accessibility-conformance claim. No dependency changes/audit remediation were attempted.

## Remaining work

- Obtain separately approved human/browser prototype review, including small-phone wrapping/reflow, keyboard/focus and Back behavior, guide search/print, subscription/report recovery, map fallback and screen-reader journeys. The implementation is complete for the assigned code slice; its human/device exit criteria are **not** checked off.
- Guide/FAQ search state is local and resets when leaving/re-entering the route; broader context restoration remains a UX follow-up. Existing wayfinding internals and classic copy are not fully migrated to site editing; future all-copy editorial coverage remains open.
- Verified November timetable/room/entrance/help content is still required. Existing demo/private-import lookup, staff identity, publication storage and report email behavior remain unchanged; later auth/ContestDojo/GitHub/interactive-routing/translation/mail slices still apply.
- Parent handles final combined patch export/review. No push/PR/merge/deploy is authorized by this slice.
