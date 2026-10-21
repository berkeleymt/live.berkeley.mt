# ADR 0003 — Match Lemon's staff sign-in and account behavior

Recorded: 2026-10-20. Status: **accepted; slice-2 server/web implementation present, local synthetic verification only**.

Source: [Ian's follow-up](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024): “yes but it should behave and function the same way lemon should,” confirming Google-only sign-in and Admin operations / Super admin People and settings. Resolves D1/D2; it does not add Lemon's PM/TO roles or shared services.

## Required parity

Follow Lemon [ADR 0048](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/adr/0048-roles-and-google-sign-in.md), [ADR 0049](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/adr/0049-identity-footer-and-shared-reads.md), [sign-in screen](https://github.com/berkeleymt/proctor-suite/blob/77721d0/web/src/screens/SignIn.tsx), [token verifier](https://github.com/berkeleymt/proctor-suite/blob/77721d0/server/app/google_auth.py) and [session/account API](https://github.com/berkeleymt/proctor-suite/blob/77721d0/server/app/api.py).

- One staff entry at `/admin`, using Google Identity Services with FedCM-enabled button/prompt and Google's account chooser. No separate Super login or production password form in the finished flow.
- Server verifies Google's ID token for Live's configured client, including verified email; the normalized email must be in Live's authorized account list. Signing into Google alone does not grant access. Show clear not-configured, invalid-credential and not-on-list states.
- Only `admin` and `super` roles, labeled Admin and Super admin. Role determines full tabs, not individual read-only controls. Admin gets operational tabs; Super also gets People/integration settings and restricted administration per [the matrix](../permissions.md).
- One flat staff sidebar and account footer. Show avatar or email initial, role/email and connectivity; match Lemon's desktop, tablet-rail and phone-menu behavior. The connection/presence indicator still needs an accessible name, not color alone.
- Settings › People lets Super add an email with a role, change roles and confirm removal. Protect the signed-in person's own row and environment-configured Super accounts from self-lockout. Show remembered profile pictures and staff presence as Lemon does; presence is not an authorization decision.
- Resolve the role from the account list on each protected request. A removed account loses access immediately; a changed role takes effect on the next request. Open clients receive identity/removal updates, refresh navigation, leave inaccessible tabs or return to sign-in. Server enforcement must work even if a client misses the update.
- Shared operational reads remain available to both staff roles; loading a screen must not require an unrelated privileged tab. Never expose provider credentials through those shared reads.
- Match Lemon's 24-hour staff-session lifetime, server-side logout/revocation and outage behavior: existing valid sessions keep working if Google is unavailable, but new sign-ins cannot bypass Google. Preserve HTTPS/HttpOnly/SameSite and CSRF/origin protections.

## Separation and migration

Live owns its Google configuration, account list, sessions and cookies. Links to Lemon are navigation, not shared authentication or access to Lemon's timers. Reuse interaction/security semantics, not Lemon's database, cookies or proctor-only controls.

Live now selects Google mode when a client ID is configured (or explicitly requested); that mode disables local/owner/demo fallback. Separate private SQLite People/session state supports per-request roles, fixed 24-hour sessions and transaction-checked People changes. Local named accounts, owner Basic and historical demo API IDs remain only in the documented Google-unconfigured legacy/demo path. The modern synthetic chooser exposes only Admin/Super. Existing Live URLs remain; `/admin/people` is additive. See [operator setup and deliberate migration/rollback](../staff-access.md). No old account is automatically promoted or deleted, and no deployment/account migration was performed.

## Acceptance

Test verified/unknown accounts, both role tab sets and denied direct API requests, People add/change/remove, protected self/bootstrap accounts, session expiry/logout, live revocation/navigation changes, shared-read loading, Google outage and keyboard/mobile sign-in. Test-only identity bypasses must be isolated and impossible to enable accidentally in production. Synthetic signed-JWT and People unit tests, direct API boundary/lifecycle tests and browserless GIS/identity/navigation/People tests implement these checks without a provider bypass in production. The fixed JWKS verifier has bounded responses/timeouts/cache and fails closed when credentials cannot be verified. Existing valid sessions are independent of Google availability. Desktop/sidebar, tablet rail/account panel and phone menu styles are implemented; JSDOM is not visual/device/assistive-technology verification. No real Google integration or browser parity test is claimed. Authorized real-origin GIS/FedCM, human keyboard/mobile review and real-account migration rehearsal remain release checks. [Evidence and limits](../status/log/2026-10-20-staff-google-slice-2.md).
