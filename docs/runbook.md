# Deployment and event-day operations

Status: current repository configuration plus minimal readiness checklist. This is deliberately not a disaster-recovery/HA program. Ian deprioritized recovery; deployment correctness and honest state still matter.

## Current deployment facts

- [Workflow](../.github/workflows/build-and-push.yaml) builds/pushes images on main, but no longer deploys on a push. A manually confirmed main-branch run validates GitHub configuration/storage, creates versioned ConfigMap/Secret objects, and patches Kubernetes `bmt/live` to the exact built image digest. It waits up to 300 seconds for rollout. Follow the [GitHub setup and owner checklist](github-deployment.md); this code has not been exercised against the real cluster.
- `KUBECONFIG_B64` is an Actions secret. Never paste its value into docs/logs. A successful build alone is not a confirmed rollout; a rollout alone is not correct tournament content.
- [Dockerfile](../Dockerfile) sets absolute `/app/content/{site,event,wayfinding}.json` paths so a changed container working directory does not redirect content loading. Database and upload paths still depend on actual deployment configuration.
- Deployment manifests/persistent volumes, replica count, backups and hosting ownership are not fully described in this repository. Do not invent their configuration from the workflow. Confirm actual mounts before replacing containers or moving files; never delete a data volume as a deployment shortcut.
- Last earlier production observation in this session: updated APIs/assets served with demo mode off, but event content still said BmMT April 12, 2026. This documentation pass did not repeat that check.

## Before November publication

- [ ] Event/date/timezone, full schedule, notices and guide approved by a content owner.
- [ ] Room labels, floor plans, entrances, closures and accessible routes verified on site; asset publication rights/attribution confirmed.
- [ ] ContestDojo event ID/token configured privately, import/mappings validated, no real roster in Git/test fixtures.
- [ ] Student lookup returns only correct assigned rooms; incorrect/missing IDs and unmapped rooms handled clearly.
- [ ] Two-role access migration and agreed login tested; demo login disabled.
- [ ] GitHub publication/load state, concurrent edits and invalid-content rejection exercised.
- [ ] Confirmation mail sent through the verified Berkeley sender to a controlled address; retries do not duplicate reports.
- [ ] Phone/desktop/accessibility and scale checks recorded with actual environments/results; no synthetic pass marks.
- [ ] Translation fallback/disclaimer and source-English access work; help/contact details are current.

## Read-only production smoke after a deploy

An authorized operator checks `/`, `/guide`, `/rooms`, `/lost-found` and their referenced assets; `/api/live`, `/api/site`, `/api/wayfinding`, `/api/staff/session` return expected types, not an SPA fallback HTML response. Check event date/content, current loaded revision where supported, demo mode off and unauthenticated staff writes rejected. Do not submit fake public reports or send mail in production merely to probe health; use a controlled approved test.

## If something goes wrong

1. Separate a bad content revision, an API/network failure and an old code rollout. Look at the actual version and safe diagnostic error, not just “CI green.”
2. Keep last validated content where the app supports it, with a stale timestamp. Do not describe stale event instructions as current.
3. If the app is unavailable, direct visitors through existing in-person staff/help channels. No promised recovery time or failover is established here.
4. An authorized deployment owner can inspect rollout/logs and decide a restart/revert. Never reset public history, bypass branch protection, expose secrets or destroy private data to make a health check green.

GitHub-first runtime content loading and content-only build filtering are implemented but explicitly opt-in. Follow the separate [content migration](git-publishing.md); deployment configuration does not migrate content or provision Git credentials.
