# Product specification

Status: approved product direction, with proposed design details explicitly marked. Recorded October 20, 2026 from [Ian's clarification in this session](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024); [decision record](adr/0001-product-direction.md).

## Purpose and audience

Help 2,000+ students and thousands of coaches/parents navigate tournament day with little explanation. Attendance is not a measured concurrency figure. The site is a useful companion, not the competition timer or the sole emergency communication channel. Preserve current event/next event, full schedule, live updates, maps, emergency/Wi-Fi/info-desk/restroom information, subscriptions, and existing working functions during migration.

Visitors may use small/older phones, different browsers, campus Wi-Fi, mobile data, large text, or assistive technology. Design for unfamiliar and less technically confident users without stereotyping their capabilities. Premium means legible, predictable, responsive, and carefully composed; it does not mean more visual effects.

## Requirement and acceptance matrix

Every implementation slice must name its requirement IDs. The current-state column is a code-reading baseline, not a new test report.

R08 also includes the subsequently accepted [Lemon-equivalent Google staff behavior](adr/0003-lemon-staff-parity.md): account authorization, tab policy, People, live revocation and sidebar identity. This is approved, not implemented.

| ID | Approved requirement | Acceptance criteria | Current gap |
| --- | --- | --- | --- |
| R01 | Multipage public site with a clear home gateway | Home visibly links to schedule/updates, maps, personal rooms, lost-and-found, FAQ, guide. Destination names remain consistent; no mandatory visitor-role choice. | Today + some separate routes exist; target navigation/layout not implemented. |
| R02 | Announcements, now/next and full schedule remain central | Date/time zone and delays are correct; upcoming, active and completed states differ; important notices are prominent without obscuring reading; full schedule is independently reachable. | Date-aware Today and planner exist; dedicated schedule/updates routes proposed. |
| R03 | Personalized schedule/location/guide from ContestDojo; ID only | An ID returns only its assigned rooms joined to public event times, map links and guide content. No check-in code or account; no names, school/team identities, contacts or bulk roster disclosure. | Current lookup requires a code and uses demo/private-import providers, not live ContestDojo sync. |
| R04 | Best practical interactive wayfinding; complexity is not the scope limit | Search a room/building, choose an origin, get campus + indoor guidance, floor transitions and readable steps. Accessible routing must be based on verified routes; missing data is explicit. | Search/text directions/maps/sample floor asset exist; verified indoor routing graph and guidance do not. |
| R05 | Every static public text/image editable in admin and repository files | Normal edits need no code/JSON expertise; admin and direct file edits change the same canonical sources. Includes navigation, labels, help, FAQ, guide, map assets, alt text and notices. No private data in that source. | Much content is file-backed; remaining hard-coded copy, all-image publication and editor coverage need inventory. |
| R06 | GitHub is authoritative for public content; AI-assisted edits possible | An authorized operator can request a natural-language change, review its exact diff, push valid files, and see that revision served. Admin publication uses the same pipeline; stale writes cannot overwrite other work. Invalid revisions never become live. | Optional dedicated local Git publication exists; automatic GitHub pull and same-repository content workflow do not. |
| R07 | English authoring/source of truth; automatic translations | English loads by default; visitor explicitly selects a language; all public interface/editorial text is covered. Non-English pages disclose machine translation and give an easy English switch. IDs, numbers, URLs and proper room identifiers are preserved. | No integrated localization pipeline. Provider/language list proposed, not configured. |
| R08 | Only Admin and Super admin as staff roles | Both are named, authorized staff identities; there are no Dispatcher/Crisis/Info-desk roles. Backend checks every protected operation. Account administration follows the agreed two-role matrix. | Four demo-era roles, local accounts/owner fallback; no super-admin role or People editor. |
| R09 | Lemon-style staff navigation with links; separate services | Staff can move between apps via labeled links; identity/service/storage/timers are not silently shared. Live changes never adjust Lemon timers. | Separate linked shell exists; new role model and final visual alignment remain. |
| R10 | Replicate Lemon's ContestDojo setup and sync behavior | Settings for event ID/token, manual + background sync, complete student/team/org joins, per-test room mappings, diagnostics, read-only roster and atomic local snapshot; visitor lookup never calls ContestDojo directly. | No implemented API sync/settings/roster management. See verified parity specification. |
| R11 | Private lost-and-found inbox + confirmation email from berkeley.mt | Store report privately, return a receipt, send one confirmation through a verified sender, and show honest delivery status. Retries do not duplicate reports/emails; staff can search and resolve reports. | Private inbox/receipt/idempotency exist; confirmation email does not. Existing announcement email code is not proof of this feature. |
| R12 | General guide, FAQ and practical help reduce repeated questions | Searchable concise answers with direct links; emergency/info desk/Wi-Fi/restrooms easy to find from every public page; general tournament guide readable/printable without a map. | Partial editorial/UI foundation; verified November content missing. |
| R13 | Natural, minimal, premium UX across devices | Meets [design acceptance checklist](design-system.md); no essential hover/gesture-only controls; no untested claims of cross-browser support. | No final public design approval or recorded event-ready browser/device/accessibility rehearsal. |
| R14 | Recovery infrastructure is not a current priority | Do not block quality-of-life work on HA, DR drills, on-call provisioning or a large recovery project. Still avoid data loss, secret leaks and false publication/delivery claims. | Basic deployment exists; recovery enhancements explicitly deferred. |

## Boundaries

- ID-only disclosure is intentional. Student IDs are not authentication; room assignments associated with an ID can still be sensitive when linked to other information. Keep the full roster private and describe the limited disclosure honestly.
- Translation is assistance, not another canonical source. A disclaimer does not justify translating IDs incorrectly or exposing private submissions to a translation vendor.
- ContestDojo is the roster source; Live owns public schedule/map/guide content. Model the relation between ContestDojo test/room columns and Live schedule IDs explicitly.
- Matching Lemon does not mean importing its PM/TO roles, proctor controls, bathroom logs or timer write APIs.
- No full roster, API key, contact address from a submission, staff account record or sensitive draft enters the content repository/export. The application repository is currently private; do not confuse public-facing content with permission to change its visibility.
- Preserve TakeTransit navigation instead of rebuilding off-campus transit routing.

## Not settled by these answers

Google-only authentication and the Admin/Super admin split are now approved with Lemon behavior parity. Translation vendor/budget, launch language set, sender/reply-to mailbox and private-data retention still need the decisions in [the register](status/decisions.md). Map assets, routing permissions and verified event information are inputs, not facts to invent.
