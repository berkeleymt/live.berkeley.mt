# 2026-10-21 — GitHub-managed production configuration

## Scope and source

Ian approved individual GitHub Variables/Secrets and requested an incremental patch over the latest applied Markdown delivery, not remote main. [Session](https://app.devin.ai/sessions/0f4621a2ac6c419c810bc8a367883024). Baseline tree: `c9d7960fed1943338fa36135bd5b3ff1bfa843b4`. No push, real configuration upload, production API calls or deployment was authorized/performed.

## Changes

- Main pushes build only; a confirmed manual main run gates production. GitHub's private-repository plan restrictions are documented; protected Environments can add independent review where supported. Existing branch/environment protections must not be bypassed.
- Whitelisted Variables/Secrets, Google-only secure access defaults, explicit optional provider activation, absolute/private path checks and a storage-owner acknowledgement.
- Existing deployment/container identity, single-writer Recreate strategy, no HPA, writable PVC mount coverage and Bound claims are checked. No infrastructure or data is created/migrated by the script.
- All Kubernetes mutations are server-dry-run first. Run-versioned immutable configuration plus the exact build digest enter one resourceVersion-guarded Deployment patch. Unmanaged settings/volumes/sidecars remain intact. Raw command errors are withheld; no secret payload appears in arguments/artifacts. Old versions require owner-managed cleanup/rollback.
- [GitHub checklist](../../github-deployment.md), [ADR 0008](../../adr/0008-github-managed-deployment.md) and existing README/runbook reconciled.

## Verification

- `npm test`: **120 passed**, including **45 deployment tests**. Synthetic Kubernetes/GitHub fixtures cover validation, approval/ref/source/digest guards, mounted storage, permissions, stale main, dry-run ordering, CAS conflicts, exact image/config references, unrelated settings and failed rollouts. Fake-kubectl CLI tests confirm sensitive stderr/malformed-response redaction and temporary kubeconfig cleanup.
- `npm run lint`, `npm run build`, targeted Node-script/test ESLint (`no-unused-vars`, `no-undef`), and `git diff --check`: passed.
- `rhysd/actionlint:1.7.7` against the workflow: passed.
- Documentation links/source references checked. Incremental patch is checked/applied to a clean copy of the baseline tree; the resulting complete tree is compared with the export snapshot.
- No application/server/UI behavior changed. Prior Rust/API/browser evidence is not a new production deployment test; those suites were not rerun for this workflow-only slice.

## Remaining work

Owner review of actual Kubernetes configuration/RBAC, persistent paths/permissions/symlinks/content migration, GHCR pulls, optional Environment support and Google authorization. Real workflow execution, Kubernetes server dry-runs/rollout, provider acceptance and public smoke/persistence checks remain untested. The script checks mount metadata, not actual filesystem ownership/content. Manual dispatch is an explicit operator confirmation, not two-person review. No credentials or current production manifests were available/used.
