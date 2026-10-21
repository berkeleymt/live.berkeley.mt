# ADR 0006: Historical floor-plan guidance

Status: implemented engineering decision within Ian's approved interactive-map request. This is not field/accessibility approval.

## Decision

Use Leaflet `CRS.Simple` for indoor plans, preserving image proportions and percentage coordinates. Keep OpenStreetMap outdoors; do not stretch schematic drawings onto geographic coordinates. Preserve written directions and searchable room lists alongside drag/zoom/Fit, selectable markers and route overlays.

Add `mapped` to the building/edge verification vocabulary. It means transcribed from a supplied historical drawing, not an on-site check. Ordinary routing accepts mapped edges. Step-free routing rejects them even if a client supplies `stepFree:true`; server validation also rejects that combination. Existing demo/unverified/verified content remains supported. Deploy the updated validator/client before publishing content using the new enum value; older servers do not understand it.

The corrected source set is Dwinelle C/D/E, Wheeler basement/1/2 and VLSB 2 (2050/2060). No inferred stair/elevator connections between floors, walking-time estimates or verified entrance/accessibility claims. Map glyphs and historical room numbers are not November assignments. Staff must reconcile closure flags with separately authored written directions.

## Source preservation

Original PNG bytes are retained in `content/media/`; filenames are SHA-256 hashes. Floor images are lossless WebP crops; removed page titles/legends are replaced by attributed captions, not new geometry. Coordinates below refer to each original scaled to its logical width, not actual bitmap pixel dimensions; scale crop coordinates by actual width / logical width and round to pixels.

| Source | Original asset | Logical width |
| --- | --- | --- |
| Dwinelle | `f3fa8223d578074df76f3b9ff2ba03862a1b796fbb0cfbfcf696827125f547a4.png` | 1212 |
| Wheeler | `fe9df8b04074e6f0a6616592f0b1e4ae743211b019192dc7eda9942210aab212.png` | 1212 |
| VLSB 2050/2060 | `e69ca1c5340969d735933fef3bbfe9d1a087fbbd39f624dee5b5fcb3e08ed775.png` | 1568 |

| Floor ID | Crop: left, top, right, bottom |
| --- | --- |
| dwinelle-d | 175, 575, 945, 1080 |
| dwinelle-e | 35, 35, 815, 578 |
| dwinelle-c | 340, 1058, 1048, 1535 |
| wheeler-1 | 218, 525, 825, 1038 |
| wheeler-2 | 218, 0, 825, 526 |
| wheeler-b | 218, 1038, 825, 1544 |
| vlsb-2 | 50, 100, 1310, 710 |

The corresponding image URLs, room markers, graph nodes/edges and captions live in `content/wayfinding.json`; edit there or through Rooms. Visual marker placement changes only a room hotspot, not the route graph. Numeric placement and raw JSON remain available. Retain immutable hashed assets for publication history/recovery.

## Verification and limits

Seven mapped floors / 60 source-plan rooms plus one preserved synthetic floor / two rooms; total graph 106 nodes / 198 edges. Automated checks cover asset hashes, mapped-route eligibility, bidirectionality and absent cross-floor inference. Browser checks cover search, floor changes, persistent pan/Fit, keyboard pan/zoom, image failure/retry and staff save/public visibility. [Detailed evidence](../status/log/2026-10-21-interactive-floor-plans.md).

Release still requires authoritative event assignments, permission/current-condition review and field verification of entrances/routes/accessibility. Historical source-plan guidance must not be relabeled verified merely because the software tests pass.
