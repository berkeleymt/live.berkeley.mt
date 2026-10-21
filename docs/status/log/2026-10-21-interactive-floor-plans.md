# Interactive floor plans — implementation and local browser evidence

## Source and scope

Ian supplied historical tournament plans and requested professional pan/zoom/search/floor selection/routing, prioritizing UI quality. His corrected three-image upload selected **Dwinelle C/D/E**, **Wheeler basement/1/2**, and **VLSB 2 with 2050/2060**. Earlier 2040 VLSB variants are superseded. No new November assignments or on-site accessibility verification was supplied. User messages are in [the session](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024).

## Design and implementation

- Reuse Leaflet with a pixel-based indoor coordinate system, preserving image proportions. Do not georeference a schematic floor plan onto street-map coordinates. Keep the optional outdoor OSM view separate.
- Retain original PNGs and cropped lossless WebP floor images as hash-named public `content/media/` assets. Crops omit repeated event titles/legends but preserve building geometry; captions retain source attribution. Room coordinates, captions and guidance remain editable in the existing wayfinding document/editor.
- Add `mapped` provenance for source-plan guidance, distinct from `verified` (on-site), `unverified` and `demo`. Map-derived edges never claim step-free access, even if a malformed client sets that flag. Existing demo/verified routes remain supported. Contract, source/crop provenance and migration order are recorded in [ADR 0006](../../adr/0006-historical-floor-plan-guidance.md).
- Source-plan routes currently stay on their own floor. The montage does not identify matching stair flights/elevator stops; no invented inter-floor connections or walking-time claims. Arrival instructions use building signs and the named floor. Room-route endpoints stay beside rooms rather than crossing walls at assumed doors.
- Public search/floor tabs, labeled pan/zoom/Fit and keyboard markers complement written guidance. The route planner reuses the indoor viewer. Staff visual placement saves hotspots with numeric/raw-JSON fallback; it does not silently move graph nodes.

## Evidence and remaining work

The previous stopped browser run passed subscription delivery-state feedback, sequential FAQ/Guide publication and public visibility, Guide search, Help and homepage navigation. It found selected-tab hover contrast, now corrected but awaiting retest. It did not test these maps.

The new mapped-routing regression failed before implementation and passed afterward. Initial viewer TypeScript/build and ESLint passed. A first Rust pass found two media-fixture tests now lacking the newly referenced assets; fix test setup without weakening asset validation.

Image/geometry inspection found and corrected initial wall-crossing paths in the source transcription (Wheeler basement, Dwinelle D, VLSB). Review all seven floors and route overlays again before presenting them. This is not routing acceptance or a physical survey.

## Completed corrective verification

- Generated bundle: **8 floors, 62 rooms, 106 nodes, 198 edges** (seven historical floors/60 rooms plus preserved synthetic content); ten hash-named assets. Graph tests cover mapped ordinary routes, mapped step-free refusal, bidirectionality and no inferred cross-floor connection; media tests validate actual assets rather than weakening URL checks.
- Fresh sandbox at :3095 confirmed all eight floor images load. Searched Dwinelle 155 and switched D/E/C; selected Wheeler 108/220/basement 20 and VLSB 2050/2060. Ordinary route line and written steps displayed; unsupported cross-floor/step-free requests offered staff help. Source-image failure and Retry/recovery passed.
- Browser audit exposed pan snapping back after a selected-point object was recreated by polling. A DOM regression failed with three `panTo` calls instead of one. Stable coordinate dependencies fix it; selected coordinates still recenter when edited. Drag and Fit each persisted through separate 12-second waits in-browser.
- Map controls worked at 390/820 CSS pixels with no measured horizontal overflow. Keyboard +/- changed scale; ArrowRight after zoom/focus moved the map 80 CSS pixels without moving page scroll. These are desktop Chromium viewport checks, not real mobile touch/pinch acceptance.
- Lazy Leaflet CSS initially overrode marker grid display, leaving labels top-left. Scoped map selectors preserve centered labels in 48px targets; final browser pass confirmed centered 2050/2060 and selected-room updates.
- Staff visual placement, numeric editing, raw JSON preservation and saved room-name/public visibility passed. Exact public hotspot coordinates were not separately measured. ID-only DEMO-1001 → Individual Directions selected the sample room without putting the ID in the URL.
- Primary corrected-map video and latest screenshots are retained in [the session](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024). Earlier interrupted runs are defect evidence, not acceptance.

Geometry was reviewed against drawings and corrected where routes crossed walls; this is still not a physical survey. Field accuracy, current entrances/restrictions, authoritative assignments, step-free connections, comprehensive accessibility, Safari and real-device touch remain unverified. Production unchanged; no push or deployment.
