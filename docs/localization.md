# Languages and translation

Approved: English is the default and sole authored source of truth; automatically translated alternatives should carry a clear accuracy notice. [R07](specs.md). No translation feature is implemented yet.

## Proposed visitor behavior

- Always begin in English unless the visitor previously explicitly selected a language. Do not silently redirect by IP or inferred ethnicity/browser language.
- Use a labeled Language control, with language names in their own script, not flags. Keep it easy to switch back to English without understanding the translated page.
- On every non-English page show: “Automatically translated. Translations may be inaccurate; English is the source of truth.” Include a direct English action and retain the notice on small screens.
- Translate all public navigation, form labels/errors, guide/FAQ, schedule descriptions, updates and route instructions. Do not translate IDs, room numbers, proper building names, URLs, email addresses, phone numbers or machine-readable fields. Dates/times may be locale-formatted without changing the instant/timezone.
- A reasonable initial set for review is Spanish, Simplified/Traditional Chinese, Korean, Vietnamese, Hindi, French and Arabic. This is not an approved audience breakdown. Add only languages with tested font/layout support; Arabic requires genuine RTL testing, not mirrored map geometry.

## Recommended architecture

Use a server-side translation provider with credentials outside the browser, a quota/budget and a queue, not a third-party widget translating the entire DOM. Translate only allowlisted public English strings. Key cache entries by source content hash, locale and translation configuration. Translation is a derived cache, never a competing editorial repository.

An English publication must not wait for the vendor. New urgent notices initially show the new English source with a translation-pending message; never leave an old translated emergency instruction looking current. If source strings are unchanged, reuse their translations. Vendor outage/quota failure falls back to clearly marked English, not a blank page. Keep provider diagnostics staff-only.

Sanitize provider output like untrusted content. Test placeholders, Markdown links, phone numbers, official names, scripts and bidirectional text. Do not submit lost-and-found text, email addresses, student IDs, roster rows, session data or admin drafts to the provider. Staff interfaces remain English initially; public automatic translation is the approved request.

## Before implementation

Confirm provider/account, budget and privacy terms, then test one full non-English journey and long/RTL layouts. The language list and vendor are open in [the decision register](status/decisions.md). No paid provider has been selected or enabled by these docs.
