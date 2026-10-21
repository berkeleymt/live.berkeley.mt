# Deploy Live through GitHub

No SSH is required for routine configuration once the server owner prepares storage and deployment access. A private repository is **not** a reason to commit credentials. Use individual GitHub Actions Variables and Secrets; no real `.env` is committed or included in the image.

## What changes

- Push/merge to **main**: builds and publishes an image; **does not deploy**. Content-only builds may still skip if the existing opt-in runtime-reload flag is enabled.
- Other branches: no build/deployment through this workflow, including manual dispatch.
- **Actions → Build and Push → Run workflow → main → check “Deploy current main…”**: builds, preflights and deploys that exact image digest. The checkbox defaults to off.
- Config-only changes: run the same confirmed workflow again. Saving a GitHub Variable/Secret does not update an already-running pod.
- This changes deployment configuration only. It does not create PVCs, migrate databases, seed content, activate Google in Cloud Console or import students.

The manual run is the universal approval gate, **not independent two-person review**. Keep main branch protection and restrict repository write/Actions access. If the repository's plan supports protected Environments, add `environment: production` to the `deploy` job, configure that Environment for main only, require reviewers, prevent self-review/bypass as appropriate, and move sensitive settings there. Do not weaken existing protections. GitHub currently limits required reviewers on private repositories to eligible Enterprise plans; environment features on private repositories also depend on plan. The default workflow does not require a paid Environment feature.

## 1. Friend/server-owner setup — once, before first deploy

Send this section to the person who controls the server. Keep existing data; do not replace volumes to pass checks.

- Confirm Kubernetes deployment **`bmt/live`**, the actual application container name, and HTTPS ingress/service routing to **port 3001**. The image serves static assets at `/app/dist`.
- Use **one replica**, **Recreate** strategy, no HPA targeting Live, and an unpaused deployment. SQLite and runtime Git storage have one writer; default rolling updates can overlap writers. Recreate entails brief downtime.
- The app container must already mount **writable, Bound PVCs** covering every configured database/content/media/Git path. `emptyDir`, hostPath, read-only mounts and dynamic `subPathExpr` mounts are deliberately not accepted by this automation. Arrange an owner-reviewed alternative before using it on another storage layout; do not blindly move data.
- Create private parent directories owned by the service user, mode `0700`. Staff/roster stores require private files (`0600`); protect SQLite sidecars/backups too. Keep these paths outside `/app`, public content, uploaded media and runtime Git repositories.
- Confirm existing data paths and back them up consistently. Seed/reconcile the writable public content directory, including Markdown pages and referenced map images, without overwriting installed edits. The **parent** of the page directory must be writable/durable for staged rename/recovery.
- The runtime image's bundled event metadata is still the archived April event; the local demo's November/sample content is **not** a production migration. Review identity, schedule, notices, help contacts and routes before public access. Never copy the demo's databases/identity state into production.
- Check image pull access to GHCR, resource limits and suitable readiness checks. Deployment rollout completion is not a Google/content/end-to-end test. Preserve existing probes, volumes, sidecars, service account, ingress and security context.
- Establish a deployment-only kubeconfig. It must be reachable from the GitHub-hosted Ubuntu runner, use trusted certificate validation, and be compatible with that runner's kubectl. Do not provide a cluster-admin kubeconfig or paste its contents into chat.

Required namespace-scoped API permissions (owner chooses RBAC/admission policy):

| Resource | Access |
| --- | --- |
| `deployments.apps`, name `live` | get, watch (rollout status), patch |
| Required `persistentvolumeclaims` | get |
| `horizontalpodautoscalers.autoscaling` | list |
| `configmaps` and `secrets` | create, including server-side dry-run |

No Secret read/update/delete, pod exec, volume creation or cluster-wide permissions are needed by the script. Kubernetes RBAC cannot constrain **create** with `resourceNames`; an owner may require admission policies limiting the generated `live-runtime-*` names and managed-by label. Do not bypass those policies. A denied preflight requires the owner's review, not broader blanket permissions.

The owner also verifies directory existence, permissions, symlinks and actual content: automated checks inspect mount/PVC **metadata**, not files inside the pod. `LIVE_STORAGE_READY=true` acknowledges this manual review; it is not evidence by itself.

## 2. GitHub configuration

Open **Repository Settings → Secrets and variables → Actions**. Create the following repository Variables/Secrets, or Environment-scoped equivalents only after attaching the protected Environment described above. Enter plain values—no surrounding quotes or `KEY=` prefixes.

### Required Variables

Use the existing deployment's actual paths; the examples are **not** a migration command.

| Variable | Value/example |
| --- | --- |
| `LIVE_CONTAINER_NAME` | Exact app container name from your friend |
| `LIVE_STORAGE_READY` | `true`, only after section 1 is complete |
| `GOOGLE_CLIENT_ID` | Actual Web application ID ending in `.apps.googleusercontent.com` |
| `SUPER_ADMIN_EMAILS` | Approved Google account email(s), comma-separated |
| `STAFF_PUBLIC_ORIGIN` | `https://live.berkeley.mt` (no trailing slash) |
| `DATABASE_PATH` | `/var/lib/bmt-live/private/data.db` |
| `PRIVATE_DB_PATH` | `/var/lib/bmt-live/private/reports.db` |
| `STAFF_STATE_PATH` | `/var/lib/bmt-live/private/staff.sqlite3` |
| `SITE_MEDIA_DIR` | `/var/lib/bmt-live/media` |
| `EVENT_CONTENT_PATH` | `/var/lib/bmt-live/content/event.json` |
| `SITE_CONTENT_PATH` | `/var/lib/bmt-live/content/site.json` |
| `WAYFINDING_CONTENT_PATH` | `/var/lib/bmt-live/content/wayfinding.json` |
| `PAGES_CONTENT_DIR` | `/var/lib/bmt-live/content/pages` |

In Google Cloud, create/configure Live's Web OAuth client and consent-screen audience/test users, and authorize `https://live.berkeley.mt` as a JavaScript origin. Live needs no client secret or OAuth callback route. Client ID alone does not allow arbitrary Google users: the bootstrap emails and Live People list authorize access. See [staff access](staff-access.md).

### Required Secret

| Secret | Value |
| --- | --- |
| `KUBECONFIG_B64` | Base64 of the owner's deployment-only kubeconfig |

The existing secret may already work, but restart-only credentials may lack the new configuration permissions. Base64 is encoding, not encryption; keep the value in GitHub Secrets. GitHub's built-in token handles the image build and current-main check; it is **not** passed to the application as Git publishing credentials.

### Optional integrations — leave off for the first controlled trial

| Setting | Store | Default / requirements |
| --- | --- | --- |
| `LIVE_CONTENT_REPO` | Variable | Empty; optional prepared local-first runtime worktree |
| `LIVE_CONTENT_REMOTE_REPO` | Variable | Empty; optional prepared remote-first bare cache, mutually exclusive with the above |
| `LIVE_CONTENT_BRANCH` | Variable | `main` |
| `LIVE_CONTENT_RUNTIME_RELOAD` | **Repository** Variable | False/unset until remote-first loading is verified; the build-filter job cannot see Environment-scoped variables |
| `LIVE_CONTESTDOJO_DB` | Variable | Empty disables the adapter; private durable file when enabled |
| `CONTESTDOJO_EVENT_ID` | Variable | Real event ID if using the provider |
| `CONTESTDOJO_API_TOKEN` | Secret | Empty; requires event ID/private DB |
| `ROSTER_AUTO_SYNC` | Variable | `0`; set `1` only after manual sync/mappings are reviewed |
| `POSTMARK_SERVER_TOKEN` | Secret | Empty disables mail; adding it **enables announcement email**, independently of receipts |
| `POSTMARK_FROM_ADDRESS` | Variable | Verified sender, required when a Postmark token is supplied |
| `LIVE_LOST_FOUND_MAIL_ENABLED` | Variable | `false` |
| `LIVE_LOST_FOUND_MAIL_FROM` | Variable | Approved `@berkeley.mt` sender for enabled receipts |
| `LIVE_LOST_FOUND_MAIL_REPLY_TO` | Variable | Approved monitored `@berkeley.mt` address for enabled receipts |

All listed application settings are authoritative on each deploy. Missing optional values become empty/disabled defaults, **overriding old settings for those same keys**, including values inherited via `envFrom`. Copy reviewed existing integration values to GitHub if retaining them. Unmanaged environment entries, `envFrom` references, sidecars and volumes remain unchanged. The script forces demo off, Google mode, secure cookies, port 3001, `/app/dist`, local-Git escape hatch off and the legacy owner password empty; it derives `SITE_BASE_URL` from the public origin.

Persisted ContestDojo settings take precedence over its initial environment defaults after first save; removing the Actions token does not erase a stored token. Use the Super settings screen for that, and keep `ROSTER_AUTO_SYNC=0` to block background sync during configuration. Legacy roster imports are unchanged and need the deliberate migration in [ContestDojo setup](setup-contestdojo.md).

Git content mode is a **separate migration**: prepare the canonical manifest/operations/page/media bundle, dedicated Git cache, identity, credentials, host verification and approved branch policy using [Git publishing](git-publishing.md). This workflow does not clone a repository or provision Git credentials; existing owner-managed credential mounts are preserved. Do not point it at the app source checkout or weaken branch protections.

## 3. First rollout

1. Apply the incremental patch on top of the latest Markdown redesign delivery; review/commit/push and merge through the usual branch policy. A main push builds only.
2. Have the owner complete section 1 and configure GitHub values. Never use demo login to recover production access. Leave real email/import disabled while checking.
3. Open **Actions → Build and Push → Run workflow**, select **main**, check **Deploy current main…**, and run. Complete any configured Environment review separately.
4. The script rejects missing/unsafe values, wrong replica strategy/container, unsuitable PVCs, autoscaling, unavailable permissions and a main branch that advanced after the run began. It server-dry-runs all writes first. A failed preflight does not patch the Deployment.
5. It creates immutable, run-versioned ConfigMap/Secret objects, then updates **one Deployment template** to reference them and the built image digest, guarded by its original resourceVersion. It never edits an existing Secret/ConfigMap or rewrites volumes. An intervening owner edit causes a conflict instead of being overwritten.
6. Wait for rollout (up to 300 seconds), then verify public pages/assets/API responses, correct event content, Google bootstrap login, Admin restrictions, controlled publication and persistence after a coordinated restart. Confirm demo sign-in is absent. No public fake-report/mail/load tests without approval.

Until this first controlled rollout has been verified, local tests are not production sign-off. The workflow cannot confirm Google/ContestDojo/Postmark authorization, correct private-data mappings, physical routes, directory ownership or real device behavior.

## Failures, retained settings and rollback

- kubectl receives Secret bodies through stdin, never command arguments. Raw API/admission stdout/stderr is suppressed because it can echo secrets, including unmasked base64 values. No secret manifests are uploaded as artifacts. Temporary kubeconfig is mode `0600` in a private directory and removed in `finally` on normal completion/failure. Cancellation relies on disposal of the hosted runner.
- Failures after configuration creation can leave unused versioned objects; failures after the Deployment patch may leave a partial/unhealthy rollout. The job does not automatically retry writes or undo a deployment. Ask the owner to inspect metadata/status without dumping Secret values or full environment output.
- Old versions are retained for owner-reviewed rollback. Restore a known previous **image digest and its configuration references together** only if compatible with the current database/content state. A `latest` tag or another ordinary main deployment is not an automatic rollback.
- The owner should periodically remove only unused `live-runtime-*` objects after the rollback window. Preserve those referenced by current pods/templates and any retained rollback revisions. Old Secret versions retain old credentials until deleted/revoked. No automatic garbage collection is included.

## References and verification

- [Workflow](../.github/workflows/build-and-push.yaml), [deployment script](../scripts/deploy-production.mjs), [offline tests](../tests/deployment.test.mjs).
- [GitHub deployment protection and private-plan limits](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- [Kubernetes ConfigMaps](https://kubernetes.io/docs/tasks/configure-pod-container/configure-pod-configmap/), [Secrets](https://kubernetes.io/docs/tasks/inject-data-application/distribute-credentials-secure/), [guarded patch operations](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_patch/).

The tests use synthetic configuration, mocked Kubernetes/GitHub responses and a local fake kubectl. No real cluster/provider credentials or production calls are used. See the [deployment work log](status/log/2026-10-21-github-deployment.md) for executed checks and unverified boundaries.
