# Public experience and information architecture

Status: slice-1 hub/routes implemented under Ian's follow-up direction; prototype/device/browser acceptance remains pending. The table distinguishes the current route jobs from later room/import/interactive-routing targets. Implements R01–R05, R07, R12–R13 in [the specification](specs.md).

## Navigation and home

Use a common public header with BMT identity, Home, Schedule, Maps, My rooms, and Help. Desktop shows labels directly. On phones keep Home/Schedule/Maps/My rooms/Help discoverable with text, not a horizontally hidden list or unexplained icons. Help exposes Guide, FAQ and Lost & found immediately. Staff sign-in is secondary. Prototype the navigation at small widths before fixing the component pattern.

The home page is a short gateway, not the complete guide pasted into one scroll:

1. Applicable urgent notice with publication time and action; no decorative alert when nothing is wrong.
2. Current/next public event, including any changed time and link to the full schedule. Before/after the event, say so rather than showing a misleading countdown.
3. Prominent Find my rooms and Explore maps entries.
4. Clear links to updates, FAQ, tournament guide, lost-and-found, and practical help. Use a restrained list/grid of labeled destinations, not many equal-looking decorative cards.
5. A few latest notices and contact/help information; longer feeds belong on their own page.

There is no student/parent/coach gate, onboarding tour, forced geolocation prompt, app-install prompt or account requirement to read public information.

## Public destinations

| Destination | Visitor's job | Content and primary action |
| --- | --- | --- |
| `/` Home | Decide where to go next | Now/next, urgent notice, all destination links |
| `/schedule` | Know when and where things happen | Full day, changed times, event detail; jump to current event |
| `/updates` | Understand what changed | Timestamped/pinned notices, priority and relevant links; no forced auto-scroll |
| `/map` Map | Find a building/room and a route | Current published search/directions and optional maps; connected interactive routing/origin selection remains a later slice |
| `/rooms` My rooms | Find my assigned locations | Existing ID + code lookup and directions retained; approved ID-only/per-test import remains a later slice |
| `/guide` Tournament guide | Read practical tournament guidance | Short sections, contents/search, print and direct section links |
| `/faq` FAQ | Get a short answer | Searchable event questions and answers; categorization remains future content work |
| `/help` Help | Find the right help channel | Emergency/info-desk/Wi-Fi/restroom information; guide/FAQ/report links |
| `/lost-found` Lost & found | Submit a report | Existing private form and receipt; confirmation-email state remains a later slice |

All table paths now exist; `/my-rooms` is not introduced or advertised. `/rooms` retains compatibility instead of relocating its private lookup in the shell slice. Legacy root fragments redirect, and subscriptions live on `/updates`; `/classic` retains the old layout/map/tools. Guide/FAQ search is local component state (not persisted across leaving/re-entering a route); broader Back/context restoration is still a UX follow-up. Public room/guide links may be shared; personal IDs must not appear in share URLs.

## Personal rooms journey

Enter ID -> see per-test assigned rooms in event-time order -> select Directions -> map + readable route steps. Use the ID normalization and room-column mapping from [ContestDojo parity](setup-contestdojo.md). Do not show imported names, schools, team membership, email, arbitrary custom fields or raw import data.

Show distinct states for not yet configured, lookup unavailable, ID not found, and a found assignment whose room has not been matched to verified map data. Do not substitute a plausible room or borrow another student's assignment. Unknown IDs get a neutral help path, never nearest-match suggestions. Do not persist the ID/response across shared-device sessions by default; offer a visible Clear action.

## Wayfinding target: interactive campus and indoor guidance

Build a connected routing model, not just pins on a map. Public data contains buildings, floors, entrances, rooms, waypoints, corridors, stairs/elevators, connections, closures and route notes. A route can cross outdoor paths, entrances and floors. Each published edge needs a known provenance/status; an illustration is not evidence of a traversable corridor.

- Origin: search a building/room, choose a known entrance, or optionally use device location for outdoor position. Never imply indoor GPS knows a floor/room.
- Destination: searchable room with building, floor, entrance and recognizable landmarks. Keep room identifiers in their canonical language across translations.
- Presentation: map with current leg/floor, highlighted path, plain-language steps, floor/entrance transitions and an always-accessible text alternative.
- Accessibility: verified step-free paths, elevator availability and closures; no stairs in a step-free result. If the graph cannot produce a verified accessible route, say so and link to staff assistance rather than claim it is accessible.
- Mobile: map must not trap ordinary page scrolling. Search, zoom/floor controls, Back and close actions have visible labels/accessible names; swipe is optional, never required.
- Data gaps: show the verified part and the missing section explicitly. Text guidance is a fallback, not permission to call incomplete routing complete.
- Routing calculations operate on published public data, not third-party calls on every tap. Basemap attribution/license and floor-plan publication rights must be documented.

This is the intended best-experience target; it is not restricted to the current demo map. Acquire real floor plans and verify paths before drawing confident routes. The project cannot manufacture that evidence from aesthetic choices.

## Forms, help and updates

Use short forms with persistent labels, examples, inline actionable errors, a stable submit button and a clear success state. A lost-and-found receipt must not disclose other reports or say an email was sent before provider acknowledgement. Translated form labels do not cause the visitor's private input to be sent to a translation service.

Live changes preserve reading position, keyboard focus and expanded answers. Offer a modest updated indicator; urgent notices are visible but do not create repeated screen-reader announcements or unexpected modal dialogs. If data is stale, show when it was last received and what action is safe. Public content should remain readable without motion, map tiles or a working translation vendor.

## Prototype acceptance before implementation expansion

Walk through arrival -> find room; delayed test -> revised schedule; parent -> restroom/help; lost item -> confirmed receipt; language switch -> English fallback. Test both touch and keyboard, large text, a small phone and a desktop. Ask a student and a less technically confident adult to find these without instructions. Record observed confusion, not just whether the reviewer likes the appearance.
