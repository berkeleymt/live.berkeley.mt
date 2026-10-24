# live.berkeley.mt

Welcome! This is the tournament-day companion site for the
[Berkeley Math Tournament](https://berkeley.mt/), served at
[live.berkeley.mt](https://live.berkeley.mt/). Students, coaches, and parents
use it on the day of the event to check the schedule, read live updates, find
their rooms, and get around campus.

The site is built the same way as [berkeley.mt](https://github.com/berkeleymt/berkeley.mt):
[Zola] renders Markdown and TOML files into static pages, styled with
[Tailwind CSS]. There is no database. Every change is a file in this repository,
and pushing to `main` puts it on the site within a couple of minutes.

Staff who don't use Git can make all everyday edits from the staff editor at
[live.berkeley.mt/admin](https://live.berkeley.mt/admin).

## Editing content

### With the staff editor

Sign in at [live.berkeley.mt/admin](https://live.berkeley.mt/admin) with the
shared staff password. The sidebar lists:

| Section      | What you can edit                                                   |
| ------------ | ------------------------------------------------------------------- |
| Live updates | Announcements, newest first. Mark one as urgent to highlight it.    |
| Data         | The schedule, room lookup settings, and the banner on every page.   |
| Pages        | Home, guide, schedule, rooms, map, FAQ, help, and lost and found.   |
| Images       | Floor plans and other pictures used on the pages.                   |

The right half of the screen is a live preview that updates as you type. When
you press **Publish**, the editor asks for your name (a GitHub username is
preferred) and a short note on what you changed. The change is committed to
`main` as `content: <your note>` and appears on the site within seconds.

### With Git

Most content lives in the `content/` and `data/` directories:

| Path                       | Controls                         | Notes                                                    |
| -------------------------- | -------------------------------- | -------------------------------------------------------- |
| `content/updates/*.md`     | Live updates                     | Name files `YYYY-MM-DD_HHMM_slug.md`                     |
| `content/*.md`             | Pages                            | `_index.md` is the home page                             |
| `data/schedule.toml`       | The schedule                     | Times are 24-hour Pacific                                |
| `data/rooms.toml`          | Room lookup                      | ContestDojo event, round columns, and failure messages   |
| `config.toml`              | Banner on every page             | Delete the `[extra.advisory]` table to hide it           |
| `static/images/`           | Floor plans and pictures         | Referenced from pages such as `content/map.md`           |
| `static/images/campus.svg` | Wayfinding map                   | Figma export of the campus graph, see below              |
| `data/map.toml`            | Wayfinding map                   | Where `campus.svg` sits on the real map (`tools/georef.py`) |

A live update looks like this:

```markdown
+++
title = "Team Round begins at 1:45 PM sharp"
date = 2026-04-12T13:11:53-07:00

[extra]
urgent = true
+++

Please finish eating at 1:30 PM and return to your classrooms.
```

To move a round, change its `start` and `end` in `data/schedule.toml`, copy
the old times into `was_start` and `was_end`, and add a `note`. The site shows
the old time crossed out next to the new one.

Pages already open in visitors' browsers check for changes every minute, so a
push is all it takes.

## Writing Markdown

Content files are written in Markdown. If you've sent bold text on Discord,
you've already used it. A cheat sheet is available
[here](https://commonmark.org/help/).

Every file starts with a block of _front matter_ between `+++` lines, which
sets properties such as the title or date. When in doubt, copy the front
matter from a similar file.

In addition to standard Markdown, the following _shortcodes_ are available:

| Shortcode   | Example                                                          |
| ----------- | ---------------------------------------------------------------- |
| Alert       | `{% alert(status="info", title="Wi-Fi") %}...{% end %}`          |
| Details     | `{% details(title="Parking") %}...{% end %}`                     |
| Button      | `{% button_link(href="/map/") %}Open the map{% end %}`           |
| Room search | `{{ room_lookup() }}` on its own line                            |
| Wayfinding  | `{{ wayfinding() }}` on its own line                             |

Alert, Details, and Button work the same as on berkeley.mt. Room search can go
on any page.

## Room lookup

## Wayfinding map

`{{ wayfinding() }}` routes between any two points of the campus graph in `static/images/campus.svg`, a Figma export. Groups named `Building (Floor X)` hold a `Graph` group (circles, typed by fill: red door, yellow stairs, green elevator, purple exit, blue bathroom, cyan info) and a `Paths` group (hallway lines); `Links` sits at the top level. Outdoors, routing uses OpenStreetMap walkways from `static/osm-paths.json` (refresh with `python3 tools/osm-paths.py`; `highway=steps` count as stairs for step-free routes and way names appear in the directions), so an `Outdoor Paths` group is optional and only needed for shortcuts OSM lacks; named circles outside buildings (Sather Gate, an info desk) stay as outdoor landmarks. Same-named stairs and elevators join floors, exits and landmarks snap to the nearest outdoor path within 25 m, and door nodes named like the ContestDojo room (`Dwinelle 155 (Door 1)`) become the destination `Dwinelle 155`, which is what the Directions links from the room lookup use. Floor drawings and room polygons are optional cosmetic layers; routing never reads them. The graph is drawn on OpenFreeMap tiles; `data/map.toml` says where the Figma canvas sits on the real map (re-run `tools/georef.py` if the canvas moves). Open `/map/?debug` to see the file checks in the browser console; `?osm=0` routes on the SVG's `Outdoor Paths` only and `?osm=only` ignores them, to compare.

The room search box sends the student ID to `/api/rooms?id=302A`, which is
answered by `server/rooms_api.py`, a small standard-library Python service
running next to nginx in the same container. It looks the student up live on
ContestDojo, returns room names only, and caches each answer for 5 seconds.

`data/rooms.toml` sets the ContestDojo event. Whatever room assignments
ContestDojo returns become the columns, so nothing is hard-coded per
tournament; columns can be renamed or reordered in the same file. The messages
shown when a lookup finds nothing are also there, where `{id}` stands for the
ID that was typed.

## Staff editor

`server/admin.py` is a standard-library Python service that serves `/admin`.
It reads and writes files through the GitHub Contents API, builds previews
with `zola build` in a scratch directory, and rebuilds the live pages in place
after each save.

It commits through the **BMT Live editor** GitHub App, owned by the berkeleymt
organization and installed on this repository only with Contents read and
write access. The staff member's name is the commit author and the App's bot
is the committer. Templates, `config.toml`, and code are deliberately not
editable there; change those through Git.

## Running the site locally

Install the [Zola] (0.21) and standalone [Tailwind CSS] (3.4) binaries, the
same as for berkeley.mt. Then run:

```bash
tailwindcss -i ./static/input.css -o ./static/style.css --watch &
zola serve
```

A development server should now be running at http://localhost:1111. Add
`?at=2026-04-12T10:00` to any page to preview it at a given Pacific date and
time, for example to see which round shows as happening now.

To run the room lookup locally (port 3002):

```bash
ROOMS_TOKEN_FILE=/path/to/token ROOMS_CONFIG=data/rooms.toml python3 server/rooms_api.py
```

To run the staff editor locally (port 3003), point it at a scratch branch so
that test publishes don't reach the live site:

```bash
ADMIN_SITE_DIR=$PWD ADMIN_LIVE_DIR=$PWD/public \
ADMIN_PASSWORD_FILE=... GITHUB_APP_ID_FILE=... GITHUB_APP_KEY_FILE=... \
ADMIN_BRANCH=some-branch ADMIN_BASE_URL=http://127.0.0.1:3003 \
python3 server/admin.py
```

Then open http://127.0.0.1:3003/admin.

## Deploying

Commits to `main` are deployed automatically by
`.github/workflows/build-and-push.yaml`. It builds the `Dockerfile` (the Zola
site served by nginx on port 3001, plus the room lookup and staff editor),
pushes `ghcr.io/berkeleymt/live.berkeley.mt:latest`, restarts the `live`
deployment in the `bmt` namespace, and writes the runtime secrets into the
pod's data volume. Look out for little green check marks next to commits on
GitHub!

The workflow uses these repository secrets:

| Secret                        | Used for                                  |
| ----------------------------- | ----------------------------------------- |
| `KUBECONFIG_B64`              | Restarting the deployment                 |
| `CONTESTDOJO_API_TOKEN`       | Room lookup                               |
| `LIVE_ADMIN_PASSWORD`         | Staff editor sign-in                      |
| `LIVE_GITHUB_APP_ID`          | Staff editor commits (GitHub App)         |
| `LIVE_GITHUB_APP_PRIVATE_KEY` | Staff editor commits (GitHub App)         |

To change the staff password, update `LIVE_ADMIN_PASSWORD` and re-run the
**Build and Push** workflow.

## Repository layout

| Path                  | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `content/`            | Markdown pages; `content/updates/` holds live updates       |
| `data/`               | Schedule and room lookup settings                           |
| `templates/`          | Tera templates and shortcodes                               |
| `static/`             | Styles, fonts, images, and `live.js` (now/next, refresh)    |
| `static/wayfinding.js`| Campus graph parser and router, MapLibre + OpenFreeMap tiles |
| `tools/`              | `georef.py` fits `campus.svg` onto real coordinates, `osm-paths.py` refreshes the OSM walkways |
| `server/`             | Room lookup API and staff editor                            |
| `config.toml`         | Site settings and the banner on every page                  |
| `Dockerfile`          | Production image                                            |

The previous version of this site (Rust API and React admin) is preserved on
the `archive/full-app` branch.

[Zola]: https://getzola.org/
[Tailwind CSS]: https://tailwindcss.com/blog/standalone-cli
