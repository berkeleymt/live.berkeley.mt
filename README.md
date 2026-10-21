# BMT Live

[live.berkeley.mt](https://live.berkeley.mt/) — the tournament-day companion for the [Berkeley Math Tournament](https://berkeley.mt/): schedule, live updates, maps, FAQ and help.

It is a static [Zola](https://www.getzola.org/) site built the same way as [berkeley.mt](https://github.com/berkeleymt/berkeley.mt). There is no server or database: **every change is a file edit, and pushing to `main` deploys it in about two minutes.**

## Editing on tournament day

| To… | Edit |
| --- | --- |
| Post an announcement | Add `content/updates/YYYY-MM-DD_HHMM_slug.md` (see below) |
| Change a round's time | `data/schedule.toml` — set `start`/`end`, move the old time into `was_start`/`was_end`, add a `note` |
| Change the banner on every page | `[extra.advisory]` in `config.toml` (delete the table to remove it) |
| Edit a page | `content/*.md` (map, guide, faq, help, lost-found, home) |
| Swap a floor plan | `static/maps/*.png`, referenced from `content/map.md` |
| Link the lost & found form | `form_url` in `content/lost-found.md` |
| Refresh room assignments | Actions → **Sync rooms** → Run workflow (also runs hourly) |
| Point room lookup at another event | `event_id` in `data/rooms.toml` |

An update looks like this:

```markdown
+++
title = "Team Round begins at 1:45 PM sharp"
date = 2026-04-12T13:11:53-07:00

[extra]
urgent = true   # optional; shows the red urgent style
+++

Please finish eating at 1:30 PM and return to your classrooms.
```

**No Git needed for announcements:** Actions → **Post an update** → Run workflow, fill in title, text and urgent, run. It writes the file, commits and deploys.

You can do all of this in the GitHub web editor — open the file, press `.` or the pencil icon, commit to `main`. Pages refresh themselves in visitors' browsers every minute, so a push is all it takes.

Markdown plus the shortcodes from berkeley.mt: `{% alert(status="info", title="…") %}…{% end %}`, `{% details(title="…") %}…{% end %}`, `{% button_link(href="…") %}…{% end %}`.

## Room lookup

`/rooms/` asks `/api/rooms?id=302A`, answered live from ContestDojo by `server/rooms_api.py`, a 100-line stdlib Python service that runs next to nginx in the same container (`start.sh`). It returns room names only, caches each ID for 5 s, and reads the token from `/app/data/contestdojo.token` — the deploy job writes that file into the pod's existing data volume with `kubectl exec`, so no cluster configuration changes. If the file is missing the API answers 503 and the page falls back to `static/rooms.json`, which `scripts/sync_rooms.py` builds from the same API (`data/rooms.toml` names the event). Whatever `roomAssignments` keys ContestDojo returns become the round columns, so nothing is hard-coded per tournament; rename or reorder them in `rooms.toml` if needed. The file holds only `sha256(ID) → rooms`; no names or emails. Both need the `CONTESTDOJO_API_TOKEN` repository secret. Locally: `ROOMS_TOKEN_FILE=/path/to/token ROOMS_CONFIG=data/rooms.toml python3 server/rooms_api.py` (port 3002) or `CONTESTDOJO_API_TOKEN=… python3 scripts/sync_rooms.py`.

## Running locally

Needs the `zola` (0.21) and standalone `tailwindcss` (3.4) binaries — the same as berkeley.mt.

```sh
tailwindcss -i static/input.css -o static/style.css --watch &
zola serve
```

Open http://127.0.0.1:1111/. Add `?at=2026-04-12T10:00` to any page to preview it as of a Pacific date-time (for the "happening now" state).

## Deploying

`.github/workflows/build-and-push.yaml` builds the `Dockerfile` (Zola + Tailwind → nginx + rooms API on port 3001), pushes `ghcr.io/berkeleymt/live.berkeley.mt:latest`, restarts the `live` deployment in the `bmt` namespace, and writes the ContestDojo token into the pod's data volume. No configuration lives outside this repo and the existing Kubernetes manifest.

## Layout

```
config.toml          site config + site-wide advisory banner
data/schedule.toml   the schedule
data/rooms.toml      ContestDojo event for the room lookup
server/rooms_api.py  live room lookup API (same container as nginx)
scripts/             sync_rooms.py (static fallback)
.github/workflows/   build-and-push (deploy), sync-rooms, post-update
content/             Markdown pages; content/updates/ holds announcements
templates/           Tera templates (base.html, index.html, schedule.html, updates.html, page.html)
static/              live.js (now/next + auto-refresh), input.css, fonts, logo, maps
```

The full previous app (Rust API, React admin, ContestDojo room lookup, lost-and-found mailer) is preserved on the `archive/full-app` branch.
