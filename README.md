# BMT Live

A public tournament-day companion and role-aware staff workspace: React 19 / TypeScript / Vite, Rust / Axum, SQLite, and an optional dedicated Git content checkout. Lemon timers and TakeTransit remain separate applications.

## One-command local demo

Use Node 22.18+, Git, a current stable Rust toolchain and the native build prerequisites for the Rust dependencies. From the repository root:

```sh
npm ci
npm run demo
```

Open **http://127.0.0.1:3091/**. At `/staff/sign-in`, choose a synthetic demo role; no password or production credentials are needed. `DEMO_PORT=3092 npm run demo` selects another port without stopping any existing process. Ctrl-C stops only the launched server. Restarting preserves edits and private reports in ignored `.demo/`.

The launcher builds the frontend/server, sets literal `DEMO_MODE=true`, disables email sending, seeds a clearly fictional **November 14, 2026** schedule and guide, enables synthetic room lookup/reports, and creates a dedicated local Git checkout plus local bare backup. It does not deploy, open network Git remotes, connect to Lemon/ContestDojo, or change the application checkout's branch.

See **[docs/demo.md](docs/demo.md)** for the guided walkthrough, feature matrix, persistence, recovery and honest launch limitations.

## Public and staff routes

- `/`: Today, schedule, updates, help and FAQ, with automatic refresh and last-good/stale states.
- `/guide`: searchable Markdown visitor guide, images, links and print layout.
- `/rooms`: searchable campus/building/floor/room directions, sample floor image, private student assignment lookup.
- `/lost-found`: private lost/found report submission. `/lost-and-found` is an alias.
- `/classic`: previous public UI retained, including its original map and development time controls.
- `/staff/sign-in`: local named-account login or explicitly enabled synthetic demo role selection.
- `/admin`: staff Today and navigation aligned with Lemon. Operations, content, rooms, private inbox and access screens are capability-gated; the API independently enforces permissions and CSRF.

## Non-demo local development

```sh
# Set a local owner password in your shell, or configure a private named-account file.
export ADMIN_PASSWORD='<your-local-password>'
cargo run --locked --manifest-path server/Cargo.toml
# In another terminal:
npm run dev
```

Vite proxies `/api` to port 3001. For a single production-style local process, run `npm run build` and open port 3001 instead. `STATIC_DIR`, `HOST`, `PORT` and the storage paths are configurable; see `.env.example`. Normal staff cookies require HTTPS; use the isolated demo for plain-HTTP sessions. The legacy owner login/Basic API fallback remains available. **No credentials means staff APIs deny access**; there is no longer a no-password development bypass.

Non-demo defaults deliberately retain archived April data in `content/event.json` and the existing SQLite seed. Do not relabel it as November tournament information. Only `npm run demo` creates the synthetic November dataset. Never point a development server at production storage.

## Public content and publishing

- File mode: `content/event.json` holds event metadata/FAQ; `content/site.json` holds public branding, copy, guide/help, navigation and image references; `content/wayfinding.json` holds public directions. Staff editors write these same validated documents atomically. Valid direct file edits reload; invalid edits retain the last valid in-memory publication and block conflicting saves.
- SQLite remains the default for schedule, delays and updates. Subscription/email delivery records stay in SQLite in both modes. The private inbox uses a separate private database.
- Git mode: `LIVE_CONTENT_REPO` points to a **dedicated content repository**, not the application repository. Its committed `operations.json` contains schedule/delays/updates and, in the full demo, an `editorial` bundle with event/site/wayfinding documents. Staff saves validate and commit before public snapshots change. Direct edits require a valid commit to become public.
- Older operations-only Git files still work without adding keys to their exports. Their separate editorial files remain file-backed until explicitly migrated to a complete bundle.
- Publishing offers revision/status diagnostics, download, a separately confirmed forward restore commit, and explicit push plus remote verification. A local save is not a remote backup. Images uploaded to `SITE_MEDIA_DIR` need a separate durable backup; Git versions their references, not their bytes.
- Private inbox reports, student records, account hashes, subscriptions and secrets must never enter the public checkout or static directory. Store any Git remote with future announcements privately until those drafts can be disclosed.

One server writer per content checkout. Persist **directories**, not individual mounted JSON files, because saves use atomic rename. In containers persist all configured databases, content checkout/documents and media separately from `dist/`. The Dockerfile includes the public files needed by both builds and Git in the runtime image; this work does not change or run production deployment.

## Checks

```sh
npm test
npm run test:api
npm run build
npx tsc -b --pretty false
npm run lint
cargo test --locked --manifest-path server/Cargo.toml
cargo fmt --manifest-path server/Cargo.toml --check
```

API suites use temporary databases/checkouts, random ports and local bare remotes. Integration tests exercise the real `main.rs` router, role/CSRF boundaries, private report flow, room lookup, complete Git publication, atomic schedule plans and restart persistence. No browser-driven E2E or real email/SSO/provider deployment is implied. Six pre-existing full-lint errors remain in `ExpandableOverlay.tsx` and `LiveFeed.tsx`; no lint rules were disabled.

Detailed contracts: [publishing](docs/git-publishing.md), [staff access](docs/staff-access.md), [editorial content](docs/site-content.md), [wayfinding](docs/wayfinding.md), [lost and found](docs/lost-found.md). Those documents retain builder-stage implementation details; [the demo guide](docs/demo.md) records the current integrated behavior.
