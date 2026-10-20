# BMT Live

A tournament-day companion for [Berkeley Math Tournament](https://berkeley.mt): schedules, updates, maps, visitor guidance and a private staff workspace.

> **Contributors and agents:** start with [the working rules](docs/CLAUDE.md) and [current status](docs/status/STATUS.md). The runnable demo is not the finished product.

## Main pages

| Page | What it does |
| --- | --- |
| `/` | Today, schedule, live updates and practical help |
| `/guide` | Searchable tournament guide |
| `/rooms` | Maps, room directions and demo student lookup |
| `/lost-found` | Submit a private lost-and-found report |
| `/staff/sign-in` → `/admin` | Staff editing, publishing and private inbox |
| `/classic` | Previous public layout, retained during migration |

## Repository layout

| Directory | Contents |
| --- | --- |
| `src/` | React public pages and staff workspace |
| `server/` | Rust API, validation and persistence |
| `content/` | Public event, site and wayfinding files |
| `scripts/`, `tests/` | Demo launcher and automated checks |
| `docs/` | Requirements, design, architecture, guides, ADRs and status |

## Local testing

Requires **Node.js 22.18+ with npm**, **stable Rust/Cargo**, **Git**, and native C/C++ build tools, CMake and pkg-config. No Docker, production credentials or external service accounts are needed for the demo.

On Windows, use WSL; the native Windows launcher has not been verified. These steps were tested on Linux.

```sh
git clone https://github.com/berkeleymt/live.berkeley.mt.git
cd live.berkeley.mt
npm ci
npm run demo
```

If you already cloned the repo, run the last two commands from its root. Open **http://127.0.0.1:3091/** on your computer once the terminal prints **BMT local demo**. The first run builds both frontend and server and may take a few minutes.

| Try | How |
| --- | --- |
| Staff workspace | Open `/staff/sign-in` and choose **Administrator**; no password |
| Student lookup | On `/rooms`, use ID **DEMO-1001** and code **DEMO-CHECKIN-2026** |
| Publishing and reports | Use synthetic data only; email is disabled and the Git remote is local |

**Ctrl-C stops the demo.** Run `npm run demo` again after code changes; it rebuilds and preserves your edits/reports in ignored `.demo/`. For a restart without code changes, use `npm run demo -- --no-build`. If the port is occupied or you want a fresh sandbox, see [demo options and walkthrough](docs/demo.md#run-and-restart)—do not delete data or stop an unrelated server.

The demo still uses the old roles and check-in code. **Lemon-equivalent Google sign-in, two roles and ID-only lookup are approved requirements, not implemented features.** The demo does not connect to ContestDojo or send confirmation emails. `npm run dev` alone starts only the frontend, not this complete sandbox.

## Checks

```sh
npm test
npm run test:api
npm run lint
npm run build
```

The build includes TypeScript checking. API tests use isolated synthetic storage. See [verification](docs/testing.md) for Rust checks and browser/accessibility coverage.

## Deployment

Pushes to main build/publish the container and restart the Kubernetes deployment. This is separate from the local demo. See [the runbook](docs/runbook.md) for storage precautions and post-deploy checks; a green build does not verify tournament content.

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
