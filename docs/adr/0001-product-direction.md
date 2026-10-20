# ADR 0001 — Public companion and authoritative content boundaries

Recorded: 2026-10-20. Status: **accepted product decisions**, not implementation completion.

Source: [Ian's answers to the twelve clarification questions](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024). Full requirements and acceptance criteria are in [specs](../specs.md).

## Decisions

- Multipage public experience with a homepage that clearly reaches every major destination. Ian delegates exact organization to the designer.
- Calm, light, professional, typographically strong public identity; natural and minimal for varied devices and technical comfort. Admin aligns with Lemon more closely than public pages.
- English default/authoritative source; common languages automatically translated with an accuracy disclaimer.
- Best visitor wayfinding experience, including interactive guidance if appropriate; setup complexity is not itself grounds to exclude it. Real routes/data still need verification.
- “Student lookup should only require the ID and only reveal their rooms,” joined to public schedule/map guidance. No check-in code.
- “Public content should be stored in the github repo.” Admin and authorized AI/file workflows produce Git changes; rebuild versus efficient reload is delegated.
- Only Admin and Super admin staff roles, taking Lemon's permissions as reference rather than adding operational subroles.
- Matching Lemon navigation and links is enough; services stay separate.
- Replicate Lemon's ContestDojo configuration/import behavior, including event ID and API token setup. Follow current source, not outdated setup prose.
- Public lost-and-found -> private staff inbox plus confirmation email from a berkeley.mt address.
- Recovery is explicitly lower priority; this is not competition-critical infrastructure.

## Consequences

The integrated demo is useful scaffolding, not a specification. Its four-role policy, code-gated lookup, optional/local-first Git and lack of confirmation email are known implementation gaps. Preserve existing behavior until its tested replacement is ready; don't silently apply these changes through documentation alone.

Private roster/report/session/subscription storage remains necessary even with Git-authoritative public content. Public lookup intentionally discloses rooms by ID but does not make the full roster non-sensitive. Git history exposes future committed notices to repository readers irrespective of display time; the current application repository is private, and no visibility change is requested.

## Still open

The role split and Google-only login were subsequently accepted with Lemon parity in [ADR 0003](0003-lemon-staff-parity.md). See [remaining decisions](../status/decisions.md) for translation vendor/budget/languages, sender/retention and event/map inputs. These are not accepted merely because a recommended default exists.
