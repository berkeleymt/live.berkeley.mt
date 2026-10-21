# ADR 0008 — GitHub-managed configuration with explicit deployment

Status: accepted configuration approach; local implementation, not production activation.

## Context and source

Ian can push the private repository but cannot access his friend's server. He approved individual GitHub Variables/Secrets and asked for an incremental patch on the last Markdown delivery. [Session](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024).

## Decision

Main pushes build only. Production requires a manually confirmed main-branch workflow run, plus any owner-configured Environment protections. Manual confirmation works without private-repository required-reviewer features; it is not independent two-person review. No real `.env` is committed or baked into the image.

The deployment uses whitelisted configuration, run-versioned immutable ConfigMap/Secret objects, exact image digests and a resourceVersion-guarded Deployment patch. It preserves owner-managed infrastructure/unmanaged settings and rejects unsuitable single-writer/storage configuration rather than creating or moving volumes. Secrets travel to kubectl on stdin; raw subprocess/API errors are not logged.

## Consequences

The owner must verify storage/content migration, bootstrap access and least-privilege deployment credentials once. Optional integrations are off unless configured; database-backed provider settings have their own migration semantics. Old configuration versions require owner-reviewed cleanup and rollback. Real Google/GitHub/cluster/provider acceptance remains outstanding. See [setup checklist](../github-deployment.md).
