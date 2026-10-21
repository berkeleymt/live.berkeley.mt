# Staff identity and permissions

## Approved product boundary

Live has exactly two staff roles: **Admin** and **Super admin**. Public visitors are not an extra staff role. Public report submission remains allowed; “only staff can edit” refers to protected editorial/operational actions, not the public lost-and-found form.

Ian subsequently approved Google-only sign-in and the operational/settings split, with the requirement that they behave and function like Lemon. [ADR 0003](adr/0003-lemon-staff-parity.md) defines that accepted behavior; slice 2 now implements it in the server and staff web shell with local synthetic tests. Real-Google/device verification and an authorized production account migration remain outstanding.

Lemon navigation links are enough. Live keeps its own service, accounts, sessions and authorization. Never reuse a Lemon cookie, account database or API token as implicit Live access.

## Verified Lemon model to follow

Reference: [ADR 0048](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/adr/0048-roles-and-google-sign-in.md), [ADR 0049](https://github.com/berkeleymt/proctor-suite/blob/77721d0/docs/adr/0049-identity-footer-and-shared-reads.md), [tab policy](https://github.com/berkeleymt/proctor-suite/blob/77721d0/server/app/protocol/constants.py).

- One Google staff sign-in, one workspace; account list assigns a role.
- Tab access means full use of that tab, not a bespoke capability matrix shown to users. Backend enforcement remains mandatory.
- Super admins manage Settings/People; environment-configured supers cannot be removed in the UI. A user's own account row is protected from accidental lockout.
- Role is re-read from the account list on requests; removal/revocation takes effect without waiting for a stale session to expire. Navigation reflects access changes.
- Identity footer includes account/role and connectivity. Shared reads exist only where needed by authorized screens.
- Lemon additionally has `pm` and `to`; **do not copy those roles to Live**.

## Approved Live tab matrix

| Tab/action group | Admin | Super admin |
| --- | --- | --- |
| Today / public-state overview | Full | Full |
| Schedule, updates, preview/publish/restore public content | Full | Full |
| Site, guide, FAQ, translations status, public images | Full | Full |
| Maps and room data | Full | Full |
| Roster sync, mapping, diagnostics, clear confirmation | Full | Full |
| Private lost-and-found inbox and resolution | Full | Full |
| People, staff role changes, provider/Git credentials, application settings | No | Full |
| Restricted access/audit administration | No | Full |

This maps Lemon's tab-level model to Live. Operational publish actions use clear confirmation where consequential, not an invented mandatory second-approver role. Shared reads needed by operational tabs are available to both staff roles; credentials/settings remain Super-only. Do not invent per-control read-only roles or require Settings access to load an operational tab.

## Implementation and migration constraints

Current [staff code](../server/src/staff.rs) supports Google GIS/FedCM with Live-only private People/persistent sessions, per-request Admin/Super role resolution, Super-only People and reserved settings capability. Both roles retain all existing operational reads/writes. Provider/settings screens themselves are later slices, not fabricated endpoints. The explicit Google-unconfigured legacy/demo path retains old named accounts/owner Basic and four historical roles for compatibility, never as a Google bypass. The modern demo chooser exposes only Admin/Super. [Operator instructions](staff-access.md) cover configuration, deliberate migration and rollback.

Before changing access, inventory configured accounts without exporting secrets. Decide migration to Admin/Super admin explicitly; do not grant Super admin to every old role or remove the only usable login. Verify allowed and denied actions in the real router, immediate revocation, CSRF/origin protection, logout and expired sessions. No demo login on production. Do not remove working auth until a tested replacement and authorized migration are ready.

Private roster columns and report contacts are available only to the protected screens that require them, never to translation services, public caches or Git exports. Failed/forbidden operations must leave data unchanged.
