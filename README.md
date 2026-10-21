# BMT Live

A tournament-day companion for [Berkeley Math Tournament](https://berkeley.mt): schedules, updates, maps, visitor guidance and a private staff workspace.

> **Contributors and agents:** start with [the working rules](docs/CLAUDE.md) and [current status](docs/status/STATUS.md). Local testing runs the application with sample data and disabled external services; the status page tracks outstanding release gates.

## Main pages

| Page | What it does |
| --- | --- |
| `/` | Short visitor hub: current/next event, urgent/latest updates and destination links |
| `/schedule` | Full schedule, changed times and event details |
| `/updates` | Timestamped updates and email subscription controls |
| `/map` | Building/room search, published directions and optional campus maps |
| `/rooms` | ID-only assigned rooms from the private roster, plus public room directions |
| `/guide` | Searchable, printable tournament guide |
| `/faq` | Searchable event questions and answers |
| `/help` | Practical help, with guide/FAQ/report links |
| `/lost-found` | Submit a private lost-and-found report |
| `/staff/sign-in` → `/admin` | Staff editing, publishing and private inbox |
| `/classic` | Previous public layout, retained during migration |

Saved homepage links (`/#today`, `/#schedule`, `/#updates`, `/#map`, `/#help`, `/#faq`) resolve to the corresponding pages. `/directions`, `/lookup` and `/lost-and-found` remain aliases. Public pages share navigation; staff editing remains under `/admin/content`.

## Repository layout

| Directory | Contents |
| --- | --- |
| `src/` | React public pages and staff workspace |
| `server/` | Rust API, validation and persistence |
| `content/` | Markdown pages, public event/site/wayfinding data and images |
| `scripts/`, `tests/` | Demo launcher and automated checks |
| `docs/` | Requirements, design, architecture, guides, ADRs and status |

## Local testing

Public pages live in `content/pages/*.md`: Markdown with TOML frontmatter and safe live shortcodes. Edit them in **Staff → Website content** or directly in files; [the authoring guide](docs/markdown-pages.md) covers blocks, preview, publishing and migration. Operational data stays in its dedicated tools.

Requires **Node.js 22.18+ with npm**, **stable Rust/Cargo**, **Git**, and native C/C++ build tools, CMake and pkg-config. No Docker, production credentials or external service accounts are needed for the demo.

On Windows, use WSL; the native Windows launcher has not been verified. These steps were tested on Linux.

```sh
git clone https://github.com/berkeleymt/live.berkeley.mt.git
cd live.berkeley.mt
npm ci
npm run demo
```

If you already cloned the repo, run the last two commands from its root. Open **http://127.0.0.1:3091/** on your computer once the terminal prints **BMT local demo**. The first run builds both frontend and server and may take a few minutes.

If installation fails with an npm cache permission error, use `npm ci --cache "$(mktemp -d)" && npm run demo` instead; do not use `sudo npm`. If `cargo` is missing, install [Rust](https://rustup.rs/), reopen your terminal and retry. macOS also needs Apple's command-line tools (`xcode-select --install`).

| Try | How |
| --- | --- |
| Staff workspace | Open `/staff/sign-in` and choose **Admin** or **Super admin**; no password |
| Student lookup | On `/rooms`, enter ID **DEMO-1001** only; the route network is fictional |
| Publishing and reports | Use synthetic data only; email is disabled and the Git remote is local |

**Ctrl-C stops the demo.** Run `npm run demo` again after code changes; it rebuilds and preserves your edits/reports in ignored `.demo/`. For a restart without code changes, use `npm run demo -- --no-build`. If the port is occupied or you want a fresh sandbox, see [demo options and walkthrough](docs/demo.md#run-and-restart)—do not delete data or stop an unrelated server.

**Trying this patch after an older local run?** Existing content is deliberately preserved, so it will not automatically acquire the new Markdown pages or floor plans. Start a separate sandbox to see the current bundled content without deleting your edits:

```sh
DEMO_ROOT="$PWD/.demo/markdown-review" DEMO_PORT=3093 npm run demo
```

Open **http://127.0.0.1:3093/**. Try **Find my rooms**, then staff page editing/preview/publish. Search Dwinelle 155, Wheeler 220 or VLSB 2060 on Map; these are historical source-plan locations, not verified November assignments. Reuse this root to keep its edits; choose another unused root for a fresh copy. To retain an older sandbox, use Website content's explicit conversion/review workflow instead of replacing its files.

The demo now exposes **Admin/Super admin** and Super-only People. Google GIS/FedCM, verified authorized accounts and 24-hour sessions are implemented separately; [operator setup/migration](docs/staff-access.md) is required before enabling production Google access. ID-only lookup and route mechanics use synthetic records; production [ContestDojo setup](docs/setup-contestdojo.md) and verified maps are separate activation steps. The legacy code-gated API remains supported. The demo does not contact Google/ContestDojo or send confirmation emails; reports show an honest not-configured mail state. `npm run dev` alone starts only the frontend, not this complete sandbox.

## Checks

```sh
npm test
npm run test:api
npm run lint
npm run build
```

The build includes TypeScript checking. API tests use isolated synthetic storage. See [verification](docs/testing.md) for Rust checks and browser/accessibility coverage.

## Deployment

Main pushes build/publish the container **without deploying**. Use the [GitHub Variables/Secrets checklist](docs/github-deployment.md), have the server owner verify storage/access once, then explicitly confirm a main-branch production run in Actions. No committed `.env` or SSH is needed for routine configuration. Content-only builds may skip only after [remote publication](docs/git-publishing.md) is migrated and verified. A green build/rollout is not tournament content or provider acceptance.

## Documentation

| Read | For |
| --- | --- |
| [Handbook](docs/README.md) | Full documentation index |
| [Status](docs/status/STATUS.md) | Implemented, verified and outstanding work |
| [Requirements](docs/specs.md) / [plan](docs/development-plan.md) | Approved scope and next vertical slices |
| [Public UX](docs/public-ux.md) / [design system](docs/design-system.md) | Journeys, accessibility and visual standards |
| [Architecture](docs/architecture.md) / [API contracts](docs/protocol.md) | Content, private-data and integration boundaries |
| [Staff permissions](docs/permissions.md) / [staff guide](docs/guide.md) | Accepted Lemon parity and operational workflows |
| [Demo](docs/demo.md) / [ContestDojo](docs/setup-contestdojo.md) | Current walkthrough versus target import setup |
