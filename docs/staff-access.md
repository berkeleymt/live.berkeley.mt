# BMT Live staff access

> **Local implementation, not production certification.** Slice 2 implements [ADR 0003](adr/0003-lemon-staff-parity.md): Google GIS/FedCM sign-in, Live's own authorized People list, **Admin** and **Super admin**, a role-filtered workspace, identity/connectivity footer and Super-only People management. This is a local implementation, not an authorized production migration or real-Google/browser certification.

Live and [Lemon](https://lemon.berkeley.mt) remain separate services, accounts, cookies and sessions. The Lemon link opens a new tab requiring separate sign-in; it grants no Live access or timer controls.

## Authentication modes

| Configuration | Behavior |
| --- | --- |
| `GOOGLE_CLIENT_ID` set | Google mode; passwords/owner Basic/demo cannot bypass it |
| `STAFF_AUTH_MODE=google`, client unset | Explicit not-configured Google screen; no password fallback |
| Client unset, `STAFF_AUTH_MODE=legacy` or mode unset | Existing local accounts/owner compatibility; UI explicitly labels legacy mode |
| Client unset, literal `DEMO_MODE=true` | Isolated synthetic demonstration; never use with private production records/credentials |

`STAFF_AUTH_MODE` accepts only `google` or `legacy`. Configured Google plus `legacy`, or Google mode plus demo, fails startup rather than downgrading access. Legacy is retained until a deliberate operator transition, not silently promoted into the two-role People list.

## Google operator setup (not executed by this change)

1. Provision a Google web-client ID for Live with its actual authorized JavaScript origin. Keep Lemon's configuration separate. The client ID is public configuration, not a client secret; Live does not need a Google client secret.
2. Provision an existing private directory outside **all Git checkouts and the configured remote-content bare cache**, static mounts, media and public/editorial content directories. Example: `/var/lib/bmt-live/private`, owned by the Live service account, mode `0700`. Set `STAFF_STATE_PATH=/var/lib/bmt-live/private/staff.sqlite3`. The absolute path's parent must exist. The server creates a `0600` database or rejects an existing non-regular/symlink/group/world-readable file on Unix. Never commit/export/back up this database into a public content checkout.
3. Configure:
   ```sh
   STAFF_AUTH_MODE=google
   GOOGLE_CLIENT_ID=YOUR_LIVE_WEB_CLIENT_ID
   STAFF_STATE_PATH=/var/lib/bmt-live/private/staff.sqlite3
   SUPER_ADMIN_EMAILS=approved-super@example.org,backup-super@example.org
   STAFF_PUBLIC_ORIGIN=https://live.berkeley.mt
   STAFF_COOKIE_SECURE=true
   DEMO_MODE=false
   ```
   Emails above are placeholders, not authorized accounts. Bootstrap addresses are normalized, seeded as Super on startup and protected while configured. Google mode always requires bootstrap email(s) and a private state path, including when the client ID is missing and the UI intentionally shows the not-configured state.
4. Serve HTTPS with same-origin `/api` routing; do not enable credentialed cross-origin CORS. An insecure-cookie override is rejected outside explicit demo mode. Keep auth/session JSON private and logs free of ID tokens, cookies and contact data. Apply deployment-level abuse limits; the global 30-attempt/minute login guard is not per-client protection.
5. In an approved rollout/rehearsal, sign in as a bootstrap Super, add approved staff via **People**, assign Admin for operations and Super only where explicitly authorized. Test a separate Admin account's allowed operations and denied People requests before retiring any existing login.

SQLite contains authorized email, role, remembered safe avatar URL, who added an account, and hashed session token/CSRF/expiry records. Sessions survive a restart; presence does not. Use one Live service instance for this slice: local SQLite and per-process presence/key caches are not a distributed auth/HA design. No schema rollback of a modified private store is automatic.

### Deliberate migration and rollback

- Inventory the old local accounts and required access **without exporting passwords/hashes or private contacts into Git**. Obtain approved email-to-Admin/Super mapping. Old `administrator` is not automatically Super; existing capability overrides do not grant People/settings.
- Rehearse using synthetic local accounts first; keep the legacy account file/environment available privately until replacement access is verified. This patch does not change a running service, remove an old account file or migrate credentials.
- Configure Google/People as above and verify a bootstrap Super plus normal Admin. Old local cookies are not accepted in Google mode. No fallback password form or Basic bypass is offered after the switch. Never enable demo to recover production access.
- To remove an ordinary person, confirm removal in People: sessions are deleted with the account. Re-adding that email does not resurrect old sessions. Role changes apply to the next protected request. No restart is required for People changes.
- To change an environment-fixed Super, first establish another approved Super. Then deliberately update `SUPER_ADMIN_EMAILS` and restart through the approved deployment process. Removing an address from the environment **only removes its fixed protection**; its existing database account remains Super until another Super changes/removes it in People. It is re-promoted if configured again at startup.
- Rollback to legacy requires a deliberate operator config change: remove `GOOGLE_CLIENT_ID`, set `STAFF_AUTH_MODE=legacy`, restore approved local configuration and restart. Do not assume Google sessions become local sessions or vice versa. Legacy Basic credentials may be browser-cached; use a fresh private window and verify access. Retain the private People database safely; do not publish it or silently discard it.

## Server/browser contract

[Protocol](protocol.md#staff-authentication-and-people-slice-2) lists exact requests. Implementations are `server/src/staff.rs`, `staff/google.rs`, `staff/people.rs` and `src/features/staff/`.

- GIS is loaded on sign-in only and initialized with `use_fedcm_for_prompt` and `use_fedcm_for_button`, both true; no automatic account selection. Credential submission is explicit and never stored in local/session storage. Loading, denied, missing-config, busy and retry states are visible. A provider outage cannot terminate an already valid Live session.
- The server verifies **RS256 signature**, key ID, issuer, configured audience, expiry, required subject, sane issued-at, optional authorized party and boolean `email_verified`; it normalizes and allowlists the email. A decoded claim alone is not authentication. Profile pictures must be HTTPS Googleusercontent URLs.
- Keys come only from Google's fixed HTTPS JWKS endpoint with 3-second connect/8-second total timeout, 64 KiB response/16-key bounds, bounded cache lifetime and a 60-second failed-fetch cooldown. A valid cached signing key still permits cryptographic verification; unknown/expired/unavailable keys never become a permissive bypass. Normal Live sessions do not contact Google. Tokens are not logged or echoed in errors.
- Google/two-role demo sessions have fixed **24-hour** expiry. Only SHA-256 digests of random tokens are stored; CSRF tokens are independent. Cookies are host-only, `Path=/`, `HttpOnly`, `SameSite=Strict`, `Secure` by default and fixed Max-Age. Login rotates the previous cookie, logout revokes it server-side, and removal cascades to all of the account's sessions. Sessions are bounded to 4096; People to 2000.
- Every protected request re-resolves identity/role from People. Mutations recheck the actor's Super role inside the SQLite transaction. Current-user and environment-fixed rows cannot be changed/removed. No last-Super removal is allowed. Both modern roles get the existing operational capabilities; only Super gets `people:write` and `settings:write`. Later slices use `settings:write` for publication, ContestDojo and receipt-mail configuration endpoints; normal operational access does not grant those endpoints.
- Auth/People responses are `Cache-Control: no-store`. Login and mutations require `X-Staff-Request: 1`; authenticated cookie mutations additionally require `X-Staff-CSRF`. Origin must match `STAFF_PUBLIC_ORIGIN` (exact origin, no trailing slash), or Host when not configured; cross-site Fetch Metadata is rejected. Do not trust forwarded-host claims. `identity`/`can` helpers do not replace mutation CSRF middleware.
- `StaffProvider` uses one in-flight session refresh, a 12-second timeout, 5-second healthy polls and full-jitter exponential failure backoff capped at 60 seconds. Only visible staff-workspace polls send `X-Staff-Presence: 1`. Presence is advisory, expires after 30 seconds and never grants access. On transport failure, last-known identity remains visible as disconnected; the server still enforces access. Removal/expiry clears identity, demotion refreshes navigation and leaves forbidden tabs. Mutations/credentials are not automatically retried.
- Flat role-filtered sidebar: full desktop, labeled accessible icon rail/account panel on tablet, explicit menu on phone. Footer shows email/role, avatar or initial and connection text, not color alone. People confirms removal and reports server-denied/protected rows. Public routes, `/classic`, old admin routes, report drafts, editor/media and publication behavior remain intact.

### Integration helpers

`staff::require_auth` resolves identity, enforces `capability_for_route`, CSRF/origin and inserts trusted `StaffIdentity` in request extensions. `staff::identity` and `staff::can` support operational shared reads; unknown protected routes fail closed. Site/wayfinding retain their existing validation, private inbox receives trusted `LostFoundAccess`, and only editorial mutations enter Git publishing. Private People/session state never enters public APIs or content exports.

The web exports `canStaff`, `hasAnyCapability`, `StaffCapabilityGate`, `ROLE_LABELS` and `staffReturnPath`; gates are presentation, never backend authorization. `useStaff().request` constrains paths to same-origin `/api/`, supplies credentials/intent/CSRF, times out and clears identity on 401. Preserve extra feature headers such as `X-Site-Editor`. `useStaff()` also provides `googleLogin`, `login`, `demoLogin`, `logout`, `refresh`, connection/last-check state, errors and busy state.

## Explicit local demo

For **isolated synthetic data only**, unset Google configuration and use `DEMO_MODE=true`. Local HTTP also requires `STAFF_COOKIE_SECURE=false`; HTTPS demos retain secure cookies. If Vite/proxy rewrites Host, set `STAFF_PUBLIC_ORIGIN=http://localhost:5173` to the actual frontend origin.

The sign-in and Access screens expose `demo-operator` (`admin@example.test`, Admin) and `demo-super` (`super@example.test`, Super admin). People changes are in-memory and reset on restart. Switching rotates sessions. Historical API IDs `demo-dispatcher`, `demo-crisis`, `demo-info`, `demo-admin` still work only in explicit demo mode for compatibility; they are not additional production roles or modern chooser options. Demo does not prove real Google integration and must never coexist with private production records/publishing secrets.

## Legacy local accounts (compatibility, not Google fallback)

Keep Google unset and use `STAFF_AUTH_MODE=legacy` to make the intent explicit. Existing `STAFF_ACCOUNTS_PATH` JSON and nonempty `ADMIN_PASSWORD` owner fallback remain supported; no configured account/password means access is closed. No production default password exists.

```json
{"accounts":[{"id":"staff-unique-id","username":"assigned.username","name":"Assigned display name","role":"dispatcher","passwordHash":"REPLACE_WITH_PRIVATE_ARGON2ID_PHC_HASH"}]}
```

Use a private absolute file outside public/content/Git locations, mode `0600`. Generate Argon2id hashes with trusted local operator tools, never hosted generators. Supported PHC hashes: Argon2id v19, memory 19456–262144 KiB, time cost 2–10, parallelism 1–8. Usernames are unique lowercase ASCII letters/digits/`._-@`, max 128 characters; IDs unique; `owner`/`demo-` reserved. Max file 1 MiB/2000 accounts. Plaintext passwords and unknown keys/roles/capabilities are rejected.

| Legacy capability | Dispatcher | Crisis manager | Info desk | Administrator |
| --- | --- | --- | --- | --- |
| `schedule:write` | Yes | No | No | Yes |
| `updates:read` | Yes | Yes | Yes | Yes |
| `updates:write` | Yes | Yes | No | Yes |
| `content:write`, `rooms:write`, `publishing:write` | No | No | No | Yes |
| `found:read`, `found:write` | No | Yes | Yes | Yes |
| `access:read` | Yes | Yes | Yes | Yes |

An optional `capabilities` array **replaces** legacy role defaults; it cannot grant People/settings. Include `access:read` for workspace access and `found:read` with normal inbox writes. Legacy account imports load at startup; account file edits alone do not revoke memory sessions. Restart deliberately to reload accounts/revoke local sessions. Legacy `STAFF_SESSION_TTL_SECONDS` remains 28800 by default (8 hours), allowed 60–86400; it does not shorten/extend Google sessions. Legacy Basic clients need no CSRF without cookies, but browser requests still require origin protection. Browser Basic credentials cannot be erased by logout; close the private window. Do not use Basic for normal Google staff.

## Verification and limits

Run `npm test`, `npm run lint`, `npm run build`, `npm run test:api`, `cargo test --locked --manifest-path server/Cargo.toml`, `cargo fmt --manifest-path server/Cargo.toml --check` and strict all-target/all-feature Clippy. Synthetic signed JWT unit tests exercise signature/claims/cache outage; People unit/API tests exercise lifecycle, immediate permissions, self/bootstrap/last-Super checks, expiry/rotation/logout and persistence. Browserless JSDOM tests exercise GIS options, provider failure/retry, identity/sidebar, live navigation, outage/recovery and People confirmation/errors. Existing public/editor/API regressions still run.

No real Google/provider/mail access, credentials, production account migration, browser/device/assistive-technology rehearsal, load/security audit or deployment is claimed. Authorized real-origin GIS/FedCM and phone/tablet/keyboard/large-text review remain release checks. See [status](status/STATUS.md) and the slice-2 work log for actual command outcomes and dependency advisories.
