# ADR 0002 — Reload validated GitHub content without rebuilding the app

Recorded: 2026-10-20. Status: **implemented as an opt-in engineering path in slice 3**, within Ian's approved GitHub-source requirement; not production-activated. SQLite/local-first modes remain. [Configuration, explicit migration, security assumptions and limitations](../git-publishing.md). No real remote write, provider, production storage or Actions/deployment check was made.

## Recommendation

Keep English public content and assets under the existing `content/` directory in `berkeleymt/live.berkeley.mt`. Use an isolated content work area, bounded background fetching, schema validation and atomic in-memory publication. Admin forms and authorized AI/file edits converge on one canonical GitHub ref. Serve only a remotely accepted, validated content revision; do not call a failed local push “published.”

The loader reads allowlisted content only and never runs fetched application code. Content-only commits should not rebuild/restart the app once this pipeline exists; code/schema changes still deploy normally. Exact layout, concurrency, caching and media rules: [architecture](../architecture.md).

## Alternatives and trade-offs

- **Rebuild every push:** retained CI default for compatibility. A deployment-owner Actions variable enables content-only build/deploy skipping after runtime reload is verified; code/schema changes and manual builds remain.
- **Dedicated content repository:** clean separate permissions, but more setup and a second place for staff/AI to find. Current demo's dedicated local checkout is not automatically a GitHub-authoritative system. Recommend the existing repository unless protection/access requirements force reconsideration.
- **Local-first publish then remote backup:** can publish during a GitHub outage, but remote is not truly canonical and replicas may diverge. Do not carry this demo semantic into the proposed target silently.
- **GitHub-first publication:** clearer source of truth, but GitHub outage/protection can delay publication. Public readers keep last-good data. Branch rules are never bypassed; pending merge is visible.

## Acceptance before activation

Two concurrent editor/direct-file changes cannot overwrite each other; malformed bundles/assets never partly load; push failure preserves draft; no private paths exported; no Git in visitor requests; loaded vs remote SHA visible; code-only commits do not trigger content-schema surprises; a protected branch works without policy bypass. Test restore and future-announcement/email deduplication.

Local bare-repository/API tests cover editor/direct-file convergence, invalid commits, whole-content CAS, code-only preservation, retained rejected drafts, media, restore, restart/last-good and role boundaries. Browserless status/action and build-filter tests are included. The implementation uses a bare object store and durable `refs/live/{loaded,pending}` plus explicit archive refs, not a checked-out worktree. Existing schemas are reused; manifest v1 only identifies schema support, with source/digest/check time in runtime diagnostics.

Independent-review clarification (2026-10-20): keep v1 and existing image/Markdown contracts; validate local media destinations rather than searching all text for `/media/`. Reuse the existing CommonMark parser to resolve links/images, reference definitions, escapes and entities. This retains approved external HTTPS image paths and plain text while rejecting missing local assets before publication; no schema/config migration or new dependency is required. Regression tests exercise every rendered image/Markdown surface plus bare-remote editor atomicity. This is not remote image availability or browser verification.

**Operational gap:** normal fast-forward pushes only; no PR creation, signing, checks orchestration or policy bypass. Required-PR/signature/check protections may reject every editor publication until an authorized external workflow merges the retained draft. The public site continues serving last-good. Single owner/process and durable Git objects/refs are mandatory. All-copy editorial migration, real protected-branch/auth/storage verification and authorized browser/device rehearsal remain unclaimed.

This ADR does not authorize new deployment credentials, a paid Git integration or public release of confidential drafts. Resolve actual repository publishing credentials/protection through the deployment owner before activation; no credentials were requested.
