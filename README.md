# BMT Live

React / TypeScript / Vite public tournament companion and staff editor, served by Rust / Axum with SQLite for schedules, announcements, delays and email subscriptions.

## Run locally

Use Node 22.18+ and a current stable Rust toolchain. Run from the **repository root**:

```sh
npm install
# Set a local-only password in your shell; do not commit it.
export ADMIN_PASSWORD='<your-local-password>'
cargo run --manifest-path server/Cargo.toml
```

In a second terminal:

```sh
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). `/api` is proxied to Rust on port 3001. The default API URL is `/api/live`; `VITE_API_URL` can override it. `/admin` uses HTTP Basic Auth (any username, configured password). `/classic` retains the previous public UI and development time slider.

The server creates `data.db` in its working directory and retains the existing April seed behavior. Do not point a preview at production data. Email is disabled without `POSTMARK_SERVER_TOKEN`; no email credentials are needed locally.

For a production-style local build, run `npm run build`, then open port 3001; Rust serves `dist/`. `STATIC_DIR` overrides the asset directory, and `PORT` overrides the listen port.

## Event content: the first file-backed slice

`content/event.json` holds the event name, date, Pacific timezone, introduction, notice, website/travel links and FAQ Markdown. `/admin` edits these same fields, offers a copy preview and JSON download, and publishes via `PUT /api/content`.

- `EVENT_CONTENT_PATH` selects the file; the default is `content/event.json`, relative to the server's working directory.
- The default file deliberately matches **April's BmMT data** and marks it archived. It does **not** relabel April's schedule as November's.
- `content/bmt-2026.example.json` is a **planning preview**, not a confirmed November timetable. Its notice explicitly labels the existing schedule, updates, map and help as April fixtures. Copy it outside the repo and set `EVENT_CONTENT_PATH` to that copy for a November design preview. Never use it as a launch-ready dataset.
- Staff saves are validated, revision-checked and written by same-directory atomic rename before the public snapshot changes. A stale edit returns HTTP 409 without overwriting another publication. The editor keeps your draft: download/copy it, reload, then reconcile changes manually.
- Valid direct file changes are loaded every five seconds. Public clients poll every five seconds, so allow up to approximately ten seconds for a direct edit to appear. Use an atomic file replacement rather than saving in place; do not edit the file concurrently with a staff publication.
- Invalid external edits leave the last valid content live **in memory**, log an error, and block admin loading until repaired. An invalid file at startup fails startup rather than silently inventing content. Keep your Git/backup copy for recovery across restarts.
- New event publishing requires a nonempty `ADMIN_PASSWORD`. Existing schedule/announcement routes retain their original no-password development behavior; **always set a password before any deployment**.
- The public live endpoint ignores preview-time / `include_future` query parameters unless the request has valid staff Basic Auth. Sign in before using future-announcement or historical previews. API content responses use `Cache-Control: no-store`.

**This is file-backed local publishing, not Git publishing.** Saving in the admin does not make a commit, push to a remote, or synchronize multiple servers. Download the JSON and review/commit it to retain staff edits in Git. It is intended for one server process; don't run multiple writers on a shared directory. Version history, Git-backed publication/rollback, named roles and full content parity are later slices.

For containers, the image includes the initial `content/` directory. Before publishing staff edits on a deployment, mount a **writable persistent directory** containing the event file and set `EVENT_CONTENT_PATH` accordingly. Mount the directory, **not only the file**, because saves rename a neighboring temporary file. Otherwise edits disappear on container replacement. The existing SQLite persistence requirements still apply. No deployment configuration is changed by this patch.

## Checks

```sh
npm test                       # Date, Pacific timezone, delay and ordering cases
npm run test:api               # Builds Rust; uses isolated temporary DBs/files and random ports
npm run build                  # TypeScript + Vite
npm run lint
cargo test --manifest-path server/Cargo.toml
cargo clippy --manifest-path server/Cargo.toml
```

The API tests never inherit Postmark credentials or contact production. UI-driven end-to-end and email delivery checks are separate from these checks.

See `docs/live-foundation.md` for this slice's decisions, verification and remaining launch gates.
