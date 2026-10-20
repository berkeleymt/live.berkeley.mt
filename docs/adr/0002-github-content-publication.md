# ADR 0002 — Reload validated GitHub content without rebuilding the app

Recorded: 2026-10-20. Status: **proposed engineering design**, within Ian's approved GitHub-source requirement. No code/CI/storage change has been made.

## Recommendation

Keep English public content and assets under the existing `content/` directory in `berkeleymt/live.berkeley.mt`. Use an isolated content work area, bounded background fetching, schema validation and atomic in-memory publication. Admin forms and authorized AI/file edits converge on one canonical GitHub ref. Serve only a remotely accepted, validated content revision; do not call a failed local push “published.”

The loader reads allowlisted content only and never runs fetched application code. Content-only commits should not rebuild/restart the app once this pipeline exists; code/schema changes still deploy normally. Exact layout, concurrency, caching and media rules: [architecture](../architecture.md).

## Alternatives and trade-offs

- **Rebuild every push:** simpler initial infrastructure but slower routine notices and unnecessary restarts. Current CI does this; safe fallback while the new loader is not ready.
- **Dedicated content repository:** clean separate permissions, but more setup and a second place for staff/AI to find. Current demo's dedicated local checkout is not automatically a GitHub-authoritative system. Recommend the existing repository unless protection/access requirements force reconsideration.
- **Local-first publish then remote backup:** can publish during a GitHub outage, but remote is not truly canonical and replicas may diverge. Do not carry this demo semantic into the proposed target silently.
- **GitHub-first publication:** clearer source of truth, but GitHub outage/protection can delay publication. Public readers keep last-good data. Branch rules are never bypassed; pending merge is visible.

## Acceptance before activation

Two concurrent editor/direct-file changes cannot overwrite each other; malformed bundles/assets never partly load; push failure preserves draft; no private paths exported; no Git in visitor requests; loaded vs remote SHA visible; code-only commits do not trigger content-schema surprises; a protected branch works without policy bypass. Test restore and future-announcement/email deduplication.

This ADR does not authorize new deployment credentials, a paid Git integration or public release of confidential drafts. Resolve repository publishing credentials/protection during implementation.
