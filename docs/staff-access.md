# BMT Live staff access

**Integrated:** the actual server router and all staff editors now use these sessions/capabilities/CSRF checks. Demo role selection is available only in literal demo mode. The adaptation instructions below are retained builder-stage notes, not outstanding work. See [demo.md](demo.md) for current operation and verification; shared Lemon SSO remains intentionally unimplemented.

This module provides BMT Live's own named staff accounts and sessions. It does **not** connect to Lemon authentication, set Lemon cookies, or control Lemon timers. The Lemon link opens `https://lemon.berkeley.mt` in a new tab and requires a separate sign-in. Shared SSO remains an unimplemented, credential-dependent integration requiring an agreed identity provider and cross-application authorization design.

## Integration contract

The builder owns only `server/src/staff.rs`, `src/features/staff/**`, `tests/staff.test.mjs`, and this document. Shared routing and existing editor fetch calls must be adapted during integration.

### Server state and startup

```rust
// main.rs
mod staff;

// routes.rs, inside the existing #[derive(Clone)] AppState:
pub staff: std::sync::Arc<crate::staff::StaffStore>,

// main.rs, before constructing AppState:
let staff = std::sync::Arc::new(
    staff::StaffStore::from_env().expect("Invalid staff access configuration")
);
// Include `staff` in the AppState initializer.
// Keep the existing admin_password: Option<String> for legacy owner fallback.
```

No additional runtime dependencies are needed: this uses the declared Argon2, SHA-256, UUID, Axum, Tokio, Reqwest URL, Base64 and Serde dependencies.

Constructor: `StaffStore::from_env() -> Result<StaffStore, String>`. Invalid account files or unsafe configuration stop startup. No accounts, no `ADMIN_PASSWORD`, and no explicit demo mode means **nobody** has administrative access, not an open admin panel. Replace the old startup log that says an unset admin password leaves routes unprotected.

### Routes and middleware

Merge `staff::public_router() -> Router<AppState>` on the **public** router, outside staff/publishing middleware:

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/staff/session` | Optional staff cookie or legacy Basic Auth | Current session or `user: null`; safe configuration flags and demo choices |
| `POST /api/staff/login` | JSON `{ "username": "...", "password": "..." }`, `X-Staff-Request: 1` | New session; rotates an existing cookie |
| `POST /api/staff/demo` | JSON `{ "accountId": "demo-admin" }`, `X-Staff-Request: 1` | Synthetic session, **only** when `DEMO_MODE=true`; otherwise 404 |
| `POST /api/staff/logout` | `X-Staff-Request: 1`, current `X-Staff-CSRF` when a valid cookie exists | Revokes token server-side and clears cookie |

All these responses have `Cache-Control: no-store`. Session JSON uses camelCase:

```ts
{
  user: { id, name, role, capabilities, demo, authSource } | null,
  csrfToken: string | null,
  expiresAt: number | null, // Unix SECONDS, not milliseconds
  demoMode: boolean,
  demoAccounts: StaffIdentity[], // empty outside explicit demo mode
  passwordLoginEnabled: boolean,
  ownerLoginEnabled: boolean
}
```

Account hashes and the named-account list are never returned. Public session discovery returns only the caller's identity, not another user's session. The cookie is HttpOnly; only its independent CSRF token is returned to JavaScript.

Protect admin API routers with:

```rust
.route_layer(axum::middleware::from_fn_with_state(
    state.clone(), staff::require_auth,
))
```

Signature: `pub async fn require_auth(State(state): State<AppState>, request: Request, next: Next) -> Response`. It validates the session or legacy owner credentials, checks the required capability, checks mutation origin/CSRF, inserts a trusted `staff::StaffIdentity` into request extensions, then runs the handler. APIs return JSON 401/403 without a Basic Auth browser challenge. Unknown protected routes are denied even to an administrator until their policy is added. Unauthenticated protected `/admin` HTML redirects to `/staff/sign-in`.

Optional protected access endpoint: `.route("/api/staff/access", get(staff::session))` under this middleware. The Access screen already uses the provider's session and does not need an additional request.

**Remove or bypass `auth::serve_admin` for the SPA route**: its old Basic-only check cannot recognize these sessions. Serve the SPA for `/staff/sign-in` and `/admin/*` via the existing fallback, with `StaffShell` providing the sign-in redirect; all data endpoints remain server-protected. Alternatively put the SPA response behind `staff::require_auth` for `/admin` HTML. Do not retain the permissive old `auth::require_auth` as an alternative route to admin handlers.

| Protected route family | Capability |
| --- | --- |
| `GET /admin`, `/admin/*`, `GET /api/staff/access` | `access:read` |
| `/api/schedule`, `/api/schedule/*`, `/api/delays`, `/api/delays/*` | `schedule:write` |
| `GET/HEAD /api/announcements` and children | `updates:read` |
| Mutations to `/api/announcements` and children | `updates:write` |
| `GET/PUT /api/content` | `content:write` |
| `/api/site/editor`, its children including `/api/site/editor/assets` | `content:write` |
| `/api/site/media` and children (the current site module's media route) | `content:write` |
| `/api/wayfinding/editor` and children | `rooms:write` |
| `/api/room-lookup/staff` and children (reserved editor policy) | `rooms:write` |
| `GET/HEAD /api/lost-found/staff` and children | `found:read` |
| Mutations to `/api/lost-found/staff` and children | `found:write` |
| `/api/publishing`, children including export/push/restore | `publishing:write` |

The router still determines allowed HTTP methods. `capability_for_route(&Method, &str) -> Option<Capability>` does not create any endpoints. Keep **public** `/api/live`, `/api/site`, `/api/wayfinding`, `/api/wayfinding/lookup`, public lost-and-found receipt submissions, and email subscriptions outside this middleware. A public endpoint being outside this table never makes an admin endpoint public automatically.

Future-preview helper for `routes::get_live`:

```rust
let can_preview = staff::can(&state, &headers, staff::Capability::UpdatesRead);
// Keep existing public behavior: ignore `at` and `include_future` without this grant.
```

Exact helpers:

```rust
pub fn identity(state: &AppState, headers: &HeaderMap) -> Option<StaffIdentity>;
pub fn can(state: &AppState, headers: &HeaderMap, capability: Capability) -> bool;
pub fn capability_for_route(method: &Method, path: &str) -> Option<Capability>;
```

`identity`/`can` resolve authentication but **do not replace mutation CSRF checks**; mutations must still run through `require_auth`.

### Important cross-module adapters

- The site builder currently has its own Basic-only `site::authorize` guard. Adapt it to `staff::can(state, headers, Capability::ContentWrite)` after retaining the outer staff middleware, or remove the redundant Basic check once the route is protected. Otherwise a valid named/demo editor will incorrectly receive 401/403. Preserve the site's image validation and any extra `X-Site-Editor` request header.
- Lost & Found additionally requires `lost_found::LostFoundAccess` in request extensions. After the staff middleware has authenticated/authorized the request, an inner adapter can read the inserted `staff::StaffIdentity` and insert:
  ```rust
  lost_found::LostFoundAccess {
      actor: user.id.clone(),
      can_read: user.capabilities.contains(&staff::Capability::FoundRead),
      can_write: user.capabilities.contains(&staff::Capability::FoundWrite),
  }
  ```
  Do not trust a browser-provided actor/role. The adapter must run **after** `staff::require_auth` and before the lost-found handler. The existing module fails closed without this extension. Do not route private inbox changes through Git publishing middleware.
- Keep all private staff/account/session data out of Git export/publishing, public content JSON, cache manifests and request logs. Only public editorial mutations use publishing middleware.
- Preserve owner Basic Auth clients: any Basic username with the configured nonempty `ADMIN_PASSWORD` retains administrator rights. Basic-only server scripts without cookies do not need a CSRF token. Browser mutations still undergo origin validation. The staff login also accepts username `owner` with that same configured password and creates a normal revocable session.
- Basic Auth cached by a browser cannot be erased by a session logout. Use the form sign-in for normal staff. The shell explicitly warns a Basic-only owner to close its private browser window to clear cached Basic credentials.

### Frontend mounting and exports

```tsx
import {
  StaffProvider, StaffShell, StaffLogin, StaffAccess,
  StaffCapabilityGate, useStaff,
} from "./features/staff";

// Inside the existing BrowserRouter:
<StaffProvider>
  <Routes>
    {/* Existing public routes remain unchanged. */}
    <Route path="/staff/sign-in" element={<StaffLogin />} />
    <Route path="/admin" element={<StaffShell />}>
      <Route index element={<YourStaffTodayPage />} />
      <Route path="operations" element={<ExistingScheduleAndUpdatesEditor />} />
      <Route path="content" element={<YourContentAndGuideEditor />} />
      <Route path="rooms" element={<YourRoomsEditor />} />
      <Route path="lost-found" element={<YourLostFoundInbox />} />
      <Route path="access" element={<StaffAccess />} />
    </Route>
  </Routes>
</StaffProvider>
```

`StaffShell({ children?: ReactNode, title?: string, description?: string })` renders an `Outlet` by default. It has actual active navigation, a collapsible mobile menu, role-denied explanations, account identity, expiry, sign-out, demo banner and external Lemon navigation. Pass an existing view as `children` if not using nested routes. `StaffCapabilityGate({ capability: StaffCapability, children: ReactNode })` can wrap an editor; it is only presentation, never server authorization.

Also exported: `StaffContext`, `StaffContextValue`, `StaffRole`, `StaffCapability`, `StaffIdentity`, `StaffSession`, `ROLE_LABELS`, `CAPABILITY_LABELS`, `canStaff`, `hasAnyCapability`, `staffReturnPath`. `canStaff(user, capability)` is a presentation helper using **server-returned** grants, not hardcoded frontend role assumptions. Explicit per-account grants are respected.

`useStaff()` returns `{ session, status, busy, error, refresh, login, demoLogin, logout, can, request }`. Provider operations use one in-flight authentication request, a 12-second timeout, no automatic credential/mutation retries, and in-memory state only. Session expiry clears the UI identity. `request(path: string, init?: RequestInit): Promise<Response>` only accepts same-origin `/api/` paths, sends credentials, adds `X-Staff-Request: 1` and `X-Staff-CSRF`, applies a timeout, and clears an expired identity on 401.

**Adapt every existing protected mutation fetch** (Admin schedule/delays/updates, publishing, content/guide/media, rooms, private inbox) to `useStaff().request` or supply the same CSRF headers from the context. Do not weaken backend CSRF because an older editor uses raw `fetch`. For example:

```tsx
const { request, can } = useStaff();
const response = await request("/api/schedule", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(newEvent),
});
// Preserve the existing save/error/refresh behavior, including handling non-2xx.
```

Public submissions do not need staff CSRF tokens. Never attach these tokens to cross-origin URLs. The current private LostFoundInbox helper is a separate fetch wrapper and needs this integration too. Do not call staff hooks outside `StaffProvider`.

## Roles and explicit grants

| Capability | Dispatcher | Crisis manager | Info desk | Administrator |
| --- | --- | --- | --- | --- |
| `schedule:write` | Yes | No | No | Yes |
| `updates:read` | Yes | Yes | Yes | Yes |
| `updates:write` | Yes | Yes | No | Yes |
| `content:write` | No | No | No | Yes |
| `rooms:write` | No | No | No | Yes |
| `found:read` | No | Yes | Yes | Yes |
| `found:write` | No | Yes | Yes | Yes |
| `publishing:write` | No | No | No | Yes |
| `access:read` | Yes | Yes | Yes | Yes |

The account file may override a role using an explicit `capabilities` list. This **replaces**, rather than adds to, the role defaults. Include `access:read` for staff who should use the workspace; assign `found:read` alongside `found:write` for normal inbox processing. Access displays the current account's actual grants and never another account's hash or credentials.

## Demo configuration

For an isolated local demonstration only:

```sh
DEMO_MODE=true
STAFF_COOKIE_SECURE=false
# Set this only if the proxy changes Host, using the actual frontend origin:
# STAFF_PUBLIC_ORIGIN=http://localhost:5173
```

Use these values in the server's environment and visit `/staff/sign-in`. Choices are `demo-dispatcher`, `demo-crisis`, `demo-info`, and `demo-admin`; no passwords or real people. Only the literal `DEMO_MODE=true` enables this endpoint. Role switching is also available in Access, rotates the cookie and revokes the previous session. These are working permissions, not simulated hiding of buttons.

**Never set `DEMO_MODE=true` on a deployment containing private records or production publishing credentials.** Demo administrator is intentionally available without a password. HTTPS-hosted demos should keep `STAFF_COOKIE_SECURE=true` (the default). An HTTP cookie override outside explicit demo mode causes startup to fail.

## Production setup and account import

1. Keep `DEMO_MODE` unset/false. Serve BMT Live over HTTPS, retain same-origin API proxying and remove `CorsLayer::very_permissive()`. Do not add credentialed cross-origin CORS.
2. Provision a private absolute path **outside** this repository, `public`, `dist`, the content Git repository and static mounts, for example `/var/lib/bmt-live/private/staff-accounts.json`. Make the containing directory accessible only to the server account. On Unix the account file must have mode `0600` (or stricter); the loader rejects group/world-readable files.
3. Generate Argon2id hashes on a trusted operator machine, never by sending passwords to a hosted generator. One option is the standard `argon2` CLI plus `openssl` (operator tooling, **not** new application dependencies):
   ```sh
   read -rs -p 'New staff password: ' STAFF_PASSWORD; printf '\n'
   printf '%s' "$STAFF_PASSWORD" | argon2 "$(openssl rand -hex 16)" -id -t 3 -m 16 -p 1 -e
   unset STAFF_PASSWORD
   ```
   This prompts without putting the password in shell history and emits only the PHC hash. Store the resulting hash solely in the private account file, not Git. Supported hashes are Argon2id v19 with memory 19456–262144 KiB, time cost 2–10, parallelism 1–8. Bounded parameters avoid an accidental unbounded verification workload. The example uses 65536 KiB and 3 iterations.
4. Create a private JSON file using this schema (the placeholder is deliberately not a usable hash):
   ```json
   {
     "accounts": [
       {
         "id": "staff-unique-stable-id",
         "username": "assigned.username",
         "name": "Assigned staff display name",
         "role": "dispatcher",
         "passwordHash": "REPLACE_WITH_PRIVATE_ARGON2ID_PHC_HASH"
       }
     ]
   }
   ```
   Usernames are lowercase ASCII letters, digits, `.`, `_`, `-`, `@`, maximum 128 characters, and unique. The login form normalizes case. IDs must be unique. `owner` and the `demo-` namespace are reserved. The file is capped at 1 MiB and 2000 accounts. Unknown keys/roles/capabilities and plaintext passwords are rejected. Omit `capabilities` for role defaults.
5. Configure `STAFF_ACCOUNTS_PATH=/var/lib/bmt-live/private/staff-accounts.json`, `STAFF_PUBLIC_ORIGIN=https://live.berkeley.mt` (no trailing slash), and retain `STAFF_COOKIE_SECURE=true`. `STAFF_SESSION_TTL_SECONDS` defaults to 28800 (8 hours), permitted range 60–86400. Optionally retain an independently managed nonempty `ADMIN_PASSWORD` as the legacy emergency owner fallback. There is no production default password.
6. Restart the **BMT Live** server through the normal approved deployment process to import account changes. This builder does not restart running services. Accounts are loaded on startup; changing the file alone does not revoke sessions. A restart loads new grants/passwords and revokes all in-memory sessions. Run a direct named-account sign-in and verify allowed and denied operations before event day.

Session tokens contain two OS-random UUIDv4 values (244 random bits); only SHA-256 token digests are kept in memory. CSRF tokens are independent random values. Cookies are host-only, `Path=/`, `HttpOnly`, `SameSite=Strict`, fixed Max-Age, and Secure by default. No session/local storage or shared Lemon domain cookie is used. Sessions have fixed expiry, are bounded to 4096, and do not survive a restart. Run one server instance or arrange a reviewed shared session store before horizontal scaling; this implementation is not a distributed auth service.

Login verification runs in Tokio blocking workers, with four concurrent Argon2 slots and a global 30-attempt/minute guard shared by password/demo sign-ins. Incorrect and unknown accounts return the same message and both execute Argon2 verification. Put deployment-level abuse limits in front of login; the small global guard is not a substitute for per-client proxy controls and can be exhausted by an attacker. No MFA or automated password recovery is claimed.

Mutations check `Origin` against `STAFF_PUBLIC_ORIGIN` when configured, otherwise against Host, and reject cross-site/same-site sibling origins via Fetch Metadata. Vite's same-origin `/api` proxy is supported; if it rewrites Host, configure the frontend's exact origin. Do not trust arbitrary forwarded-host headers. Login/demo/logout require `X-Staff-Request: 1`, preventing ordinary cross-origin form submissions; authenticated cookie mutations additionally require the current session's CSRF token. Non-browser Basic clients remain supported without an Origin header.

## Verification

Run from the repository root:

```sh
node --experimental-strip-types --test tests/staff.test.mjs
npx tsc -b --pretty false
npx eslint src/features/staff
rustfmt --edition 2021 --check server/src/staff.rs
```

The staff test creates a temporary Cargo harness that imports the real `staff.rs` with exactly the anticipated `AppState { staff, admin_password }`. It reuses existing dependencies offline and the build target, runs embedded Rust unit tests, and launches only isolated test servers on ephemeral loopback ports. It never calls an existing demo or production process. Temporary synthetic account files and processes are cleaned up. API test handlers are inert sentinels: this verifies authentication/middleware boundaries, not complete integration of the shared application's editors.

Coverage: each capability against all four roles, private explicit-grant overrides, Argon2 sign-in, absent/empty/wrong owner credentials, generic unknown-account failures, demo-disabled 404, session rotation and logout, Rust fake-clock expiry, cookie flags and hashed storage, CSRF and foreign origins, JSON 401/403, fail-closed unknown admin routes, preserved public reads/receipts, safe return URLs, bad account imports, and unsafe production cookie configuration. The return-path regression was observed failing for `/admin/../outside`, then fixed by normalization and rechecked.

Before release, the integrator must run the existing full API/type/build suite after wiring the actual routes and CSRF-enabled editors. UI-driven E2E was not authorized or performed by this builder. Responsive styles cover phone/tablet/desktop, but visual/browser verification remains unclaimed.
