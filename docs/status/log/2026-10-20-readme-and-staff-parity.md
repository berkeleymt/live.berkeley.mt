# 2026-10-20 — Local setup and accepted Lemon staff behavior

## Request and decisions

Ian confirmed Google-only staff sign-in and the Admin/Super admin split, explicitly requiring Lemon-equivalent behavior. He requested a combined replacement patch and a clean, concise README modeled after Lemon, explaining local testing.

## Changes

- Resolved D1/D2 in the decision register, requirements, permissions, plan and status. Added ADR 0003 for Google/FedCM, allowlisted accounts, tab access, People, protected own/bootstrap rows, identity/presence, immediate revocation and separate Live sessions.
- Reorganized the README into purpose, pages, layout, local testing, checks, deployment and documentation links. Kept Live's actual Node/Rust launcher rather than copying Lemon's Docker instructions. Marked old demo roles/code lookup and unimplemented production features explicitly.
- No source, dependency, runtime configuration, deployment or Lemon repository changes.

## Verification

- Linux, Node 22.23.3, npm 10.9.9, Rust 1.97.1, Git 2.34.1. `npm ci` succeeded; it reported 12 dependency vulnerabilities (1 low, 2 moderate, 9 high), not fixed by this docs change.
- `npm run demo` built TypeScript/Vite and Rust successfully, then served port 3091. Used a fresh isolated `DEMO_ROOT` outside the repository, leaving any existing `.demo/` untouched. Email and external providers were disabled by the launcher.
- HTTP smoke passed: all seven documented SPA entry routes and entry assets, three public JSON APIs, documented student ID + code, Administrator demo sign-in, and authenticated publisher/inbox/editor endpoints. This is not browser-driven UI verification.
- `npm test`: 9 passed. `npm run test:api`: 61 passed. `npm run lint`: passed. The launcher's `npm run build` included TypeScript checking. These test the current application, not future Google parity.
- `npm run demo -- --no-build` also restarted successfully in the same sandbox; its public wayfinding API returned 200. Stopped the launched demo processes after the checks.
- Documentation validation passed: 31 Markdown files, 145 local links/anchors, 15 commit-pinned source references and R01–R14 coverage. `git diff --cached --check` passed.
- The combined patch applied cleanly to an isolated archive of freshly fetched remote main `0d56ff03f527b6bed00eafe6ae6c8a34cb17fc41`; all 31 changed files matched the worktree byte-for-byte. Every changed path is Markdown. The accompanying local Markdown archive also passed integrity/content checks.

## Boundaries

Google sign-in, real ContestDojo access and email delivery remain unimplemented/unverified for Live. No browser/device/accessibility rehearsal or load test was run. The patch replaces the previous documentation patch and includes it in full against current remote main; do not stack the two patches.
