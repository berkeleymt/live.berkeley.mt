import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const namespace = 'bmt';
const deploymentName = 'live';
const repository = 'berkeleymt/live.berkeley.mt';
const imageRepository = `ghcr.io/${repository}`;
export const requiredPaths = ['DATABASE_PATH', 'PRIVATE_DB_PATH', 'STAFF_STATE_PATH', 'SITE_MEDIA_DIR', 'EVENT_CONTENT_PATH', 'SITE_CONTENT_PATH', 'WAYFINDING_CONTENT_PATH', 'PAGES_CONTENT_DIR'];
const optionalPaths = ['LIVE_CONTESTDOJO_DB', 'LIVE_CONTENT_REPO', 'LIVE_CONTENT_REMOTE_REPO'];
const secretKeys = ['POSTMARK_SERVER_TOKEN', 'CONTESTDOJO_API_TOKEN'];
class DeploymentError extends Error {}
const requireThat = (condition, message) => { if (!condition) throw new DeploymentError(message); };
const inside = (file, directory) => file === directory || file.startsWith(`${directory}/`);
const email = value => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

export function configuration(variables, secrets = {}) {
  const v = key => variables[key] ?? '';
  const required = key => {
    requireThat(typeof v(key) === 'string' && v(key).trim() !== '', `Missing Variable: ${key}`);
    return v(key);
  };
  requireThat(v('LIVE_STORAGE_READY') === 'true', 'Set LIVE_STORAGE_READY=true only after the owner verifies storage, permissions and content migration.');
  const container = required('LIVE_CONTAINER_NAME');
  requireThat(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(container), 'Invalid LIVE_CONTAINER_NAME.');
  const data = {
    DEMO_MODE: 'false', HOST: '0.0.0.0', PORT: '3001', STATIC_DIR: '/app/dist',
    STAFF_AUTH_MODE: 'google', STAFF_COOKIE_SECURE: 'true', ADMIN_PASSWORD: '',
    GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'), SUPER_ADMIN_EMAILS: required('SUPER_ADMIN_EMAILS'),
    STAFF_PUBLIC_ORIGIN: required('STAFF_PUBLIC_ORIGIN'), LIVE_CONTENT_ALLOW_LOCAL_REMOTE: 'false',
  };
  requireThat(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(data.GOOGLE_CLIENT_ID), 'Invalid GOOGLE_CLIENT_ID.');
  requireThat(data.SUPER_ADMIN_EMAILS.split(',').every(value => email(value.trim())), 'Invalid SUPER_ADMIN_EMAILS.');
  let origin;
  try { origin = new URL(data.STAFF_PUBLIC_ORIGIN); } catch { /* Checked below without echoing input. */ }
  requireThat(origin?.protocol === 'https:' && origin.origin === data.STAFF_PUBLIC_ORIGIN, 'STAFF_PUBLIC_ORIGIN must be an exact HTTPS origin, without a trailing slash.');
  for (const key of requiredPaths) data[key] = required(key);
  for (const key of optionalPaths) data[key] = v(key);
  for (const key of [...requiredPaths, ...optionalPaths]) {
    const value = data[key];
    requireThat(typeof value === 'string' && (!value || (path.posix.isAbsolute(value) && path.posix.normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value) && value !== '/' && !value.endsWith('/'))), `Invalid absolute path: ${key}`);
  }
  requireThat(!data.LIVE_CONTENT_REPO || !data.LIVE_CONTENT_REMOTE_REPO, 'Choose only one Git content mode.');
  requireThat(v('LIVE_CONTENT_RUNTIME_RELOAD') !== 'true' || data.LIVE_CONTENT_REMOTE_REPO, 'Runtime build skipping requires verified remote-first content mode.');
  data.LIVE_CONTENT_BRANCH = v('LIVE_CONTENT_BRANCH') || 'main';
  requireThat(/^[a-zA-Z0-9_/-]+$/.test(data.LIVE_CONTENT_BRANCH) && !data.LIVE_CONTENT_BRANCH.startsWith('-') && !data.LIVE_CONTENT_BRANCH.startsWith('/') && !data.LIVE_CONTENT_BRANCH.endsWith('/') && !data.LIVE_CONTENT_BRANCH.includes('//'), 'Invalid LIVE_CONTENT_BRANCH.');

  const publicRoots = ['/app', data.SITE_MEDIA_DIR, data.PAGES_CONTENT_DIR, ...['EVENT_CONTENT_PATH', 'SITE_CONTENT_PATH', 'WAYFINDING_CONTENT_PATH'].map(key => path.posix.dirname(data[key]))];
  const privateKeys = ['DATABASE_PATH', 'PRIVATE_DB_PATH', 'STAFF_STATE_PATH', 'LIVE_CONTESTDOJO_DB'];
  const gitRoots = [data.LIVE_CONTENT_REPO, data.LIVE_CONTENT_REMOTE_REPO].filter(Boolean);
  for (const key of privateKeys) if (data[key]) {
    requireThat(![...publicRoots, ...gitRoots].some(root => inside(data[key], root)), `${key} must be outside application, public content, media and Git directories.`);
  }
  for (const root of gitRoots) requireThat(!publicRoots.some(publicRoot => inside(root, publicRoot) || inside(publicRoot, root)), 'Git runtime repositories must be separate from application and public directories.');
  const privatePaths = privateKeys.map(key => data[key]).filter(Boolean);
  requireThat(new Set(privatePaths).size === privatePaths.length, 'Private databases must have distinct paths.');
  for (const key of ['CONTESTDOJO_EVENT_ID', 'POSTMARK_FROM_ADDRESS', 'LIVE_LOST_FOUND_MAIL_FROM', 'LIVE_LOST_FOUND_MAIL_REPLY_TO']) data[key] = v(key);
  data.ROSTER_AUTO_SYNC = v('ROSTER_AUTO_SYNC') || '0';
  data.LIVE_LOST_FOUND_MAIL_ENABLED = v('LIVE_LOST_FOUND_MAIL_ENABLED') || 'false';
  data.SITE_BASE_URL = data.STAFF_PUBLIC_ORIGIN;
  requireThat(['0', '1'].includes(data.ROSTER_AUTO_SYNC), 'ROSTER_AUTO_SYNC must be 0 or 1.');
  requireThat(['true', 'false'].includes(data.LIVE_LOST_FOUND_MAIL_ENABLED), 'LIVE_LOST_FOUND_MAIL_ENABLED must be true or false.');
  const sensitive = Object.fromEntries(secretKeys.map(key => [key, secrets[key] || '']));
  for (const key of secretKeys) requireThat(typeof sensitive[key] === 'string' && sensitive[key].length <= 16384 && !/[\x00-\x20\x7f]/.test(sensitive[key]), `Invalid Secret: ${key}`);
  requireThat(!sensitive.CONTESTDOJO_API_TOKEN || (data.LIVE_CONTESTDOJO_DB && /^[a-zA-Z0-9_-]+$/.test(data.CONTESTDOJO_EVENT_ID)), 'ContestDojo token requires private storage and a valid event ID.');
  requireThat(data.ROSTER_AUTO_SYNC !== '1' || data.LIVE_CONTESTDOJO_DB, 'Auto-sync requires LIVE_CONTESTDOJO_DB.');
  requireThat(!sensitive.POSTMARK_SERVER_TOKEN || email(data.POSTMARK_FROM_ADDRESS), 'Postmark token requires POSTMARK_FROM_ADDRESS; it enables announcement delivery.');
  if (data.LIVE_LOST_FOUND_MAIL_ENABLED === 'true') {
    requireThat(sensitive.POSTMARK_SERVER_TOKEN && ['LIVE_LOST_FOUND_MAIL_FROM', 'LIVE_LOST_FOUND_MAIL_REPLY_TO'].every(key => email(data[key]) && data[key].toLowerCase().endsWith('@berkeley.mt')), 'Receipt email requires a Postmark token and approved Berkeley from/reply-to addresses.');
  }
  requireThat(Object.values(data).every(value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value)), 'Configuration contains an oversized or invalid value.');
  return { container, data, sensitive };
}

export function inspectDeployment(deployment, config) {
  requireThat(deployment.metadata?.name === deploymentName && deployment.metadata?.namespace === namespace && deployment.metadata?.resourceVersion, 'Unexpected deployment identity or missing resourceVersion.');
  requireThat(deployment.spec?.replicas === 1 && deployment.spec?.strategy?.type === 'Recreate' && !deployment.spec?.paused, 'Owner must configure one replica, Recreate strategy and an unpaused deployment.');
  const spec = deployment.spec.template.spec;
  const index = spec.containers.findIndex(container => container.name === config.container);
  requireThat(index >= 0, 'LIVE_CONTAINER_NAME does not match an existing container.');
  const container = spec.containers[index];
  requireThat(container.imagePullPolicy !== 'Never', 'Container imagePullPolicy must allow pulling the new digest.');
  const claims = new Set();
  for (const key of [...requiredPaths, ...optionalPaths]) {
    if (!config.data[key]) continue;
    // Pages stage/rename sibling directories; the parent must also be durable.
    const target = key === 'PAGES_CONTENT_DIR' ? path.posix.dirname(config.data[key]) : config.data[key];
    const mount = [...(container.volumeMounts || [])].filter(m => inside(target, m.mountPath)).sort((a, b) => b.mountPath.length - a.mountPath.length)[0];
    const volume = spec.volumes?.find(volume => volume.name === mount?.name);
    requireThat(mount && !mount.readOnly && !mount.subPathExpr && volume?.persistentVolumeClaim && !volume.persistentVolumeClaim.readOnly, `${key} must be covered by a writable persistentVolumeClaim mount.`);
    claims.add(volume.persistentVolumeClaim.claimName);
  }
  return { index, claims: [...claims] };
}

export function resources(config, version) {
  const name = `live-runtime-${version}`;
  const metadata = { name, namespace, labels: { 'app.kubernetes.io/managed-by': 'live-github-actions' } };
  return [
    { apiVersion: 'v1', kind: 'ConfigMap', metadata, immutable: true, data: config.data },
    { apiVersion: 'v1', kind: 'Secret', metadata, immutable: true, type: 'Opaque', data: Object.fromEntries(Object.entries(config.sensitive).map(([key, value]) => [key, Buffer.from(value).toString('base64')])) },
  ];
}

export function deploymentPatch(deployment, config, index, name, digest) {
  const managed = new Set([...Object.keys(config.data), ...Object.keys(config.sensitive)]);
  const env = (deployment.spec.template.spec.containers[index].env || []).filter(entry => !managed.has(entry.name));
  for (const [values, source] of [[config.data, 'configMapKeyRef'], [config.sensitive, 'secretKeyRef']]) {
    for (const key of Object.keys(values)) env.push({ name: key, valueFrom: { [source]: { name, key } } });
  }
  return [
    { op: 'test', path: '/metadata/resourceVersion', value: deployment.metadata.resourceVersion },
    { op: 'add', path: `/spec/template/spec/containers/${index}/env`, value: env },
    { op: 'replace', path: `/spec/template/spec/containers/${index}/image`, value: `${imageRepository}@${digest}` },
  ];
}

export async function deploy(env, kube, fetchHead) {
  requireThat(env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main' && env.DEPLOY_PRODUCTION === 'true' && env.GITHUB_REPOSITORY === repository, 'Production requires explicit manual dispatch on this repository’s main branch.');
  requireThat(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') && /^sha256:[a-f0-9]{64}$/.test(env.IMAGE_DIGEST || ''), 'Missing or invalid source revision/image digest.');
  requireThat(/^\d{1,20}$/.test(env.GITHUB_RUN_ID || '') && /^\d{1,5}$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'Missing deployment run identity.');
  let variables;
  try { variables = JSON.parse(env.LIVE_VARIABLES_JSON); } catch { throw new DeploymentError('Cannot read GitHub Variables.'); }
  requireThat(variables && typeof variables === 'object' && !Array.isArray(variables), 'Cannot read GitHub Variables.');
  const config = configuration(variables, env);
  const deployment = JSON.parse(kube(['get', 'deployment', deploymentName, '-o', 'json']));
  const { index, claims } = inspectDeployment(deployment, config);
  const autoscalers = JSON.parse(kube(['get', 'hpa', '-o', 'json']));
  requireThat(!autoscalers.items.some(item => item.spec?.scaleTargetRef?.kind === 'Deployment' && item.spec.scaleTargetRef.name === deploymentName), 'Owner must remove autoscaling for this single-writer deployment.');
  for (const claim of claims) {
    const pvc = JSON.parse(kube(['get', 'pvc', claim, '-o', 'json']));
    requireThat(pvc.status?.phase === 'Bound' && !pvc.metadata?.deletionTimestamp, 'A required PVC is not Bound or is being deleted.');
  }
  requireThat(await fetchHead() === env.GITHUB_SHA, 'main advanced since this run started; start a new deployment from current main.');
  const objects = resources(config, `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`);
  const patch = deploymentPatch(deployment, config, index, objects[0].metadata.name, env.IMAGE_DIGEST);
  for (const object of objects) kube(['create', '--dry-run=server', '-f', '-', '-o', 'name'], object);
  kube(['patch', 'deployment', deploymentName, '--type=json', '--dry-run=server', '--patch-file=/dev/stdin', '-o', 'name'], patch);
  for (const object of objects) kube(['create', '-f', '-', '-o', 'name'], object);
  requireThat(await fetchHead() === env.GITHUB_SHA, 'main advanced during preflight; deployment unchanged, unused configuration objects may remain.');
  kube(['patch', 'deployment', deploymentName, '--type=json', '--patch-file=/dev/stdin', '-o', 'name'], patch);
  kube(['rollout', 'status', `deployment/${deploymentName}`, '--timeout=300s']);
  const final = JSON.parse(kube(['get', 'deployment', deploymentName, '-o', 'json']));
  const active = final.spec.template.spec.containers.find(container => container.name === config.container);
  requireThat(active?.image === `${imageRepository}@${env.IMAGE_DIGEST}` && [...Object.keys(config.data), ...Object.keys(config.sensitive)].every(key => {
    const ref = active.env?.find(entry => entry.name === key)?.valueFrom;
    return (ref?.configMapKeyRef || ref?.secretKeyRef)?.name === objects[0].metadata.name;
  }), 'Deployment changed during rollout; inspect it before retrying.');
}

export async function run(env = process.env) {
  let directory;
  const kube = (args, input) => {
    if (!directory) {
      requireThat(/^[a-zA-Z0-9+/=\s]+$/.test(env.KUBECONFIG_B64 || '') && env.KUBECONFIG_B64.length <= 1024 * 1024, 'Missing/invalid Secret: KUBECONFIG_B64.');
      directory = mkdtempSync(path.join(tmpdir(), 'live-deploy-'));
      writeFileSync(path.join(directory, 'kubeconfig'), Buffer.from(env.KUBECONFIG_B64, 'base64'), { mode: 0o600 });
    }
    try {
      const rollout = args[0] === 'rollout';
      return execFileSync('kubectl', ['--kubeconfig', path.join(directory, 'kubeconfig'), `--request-timeout=${rollout ? '330s' : '20s'}`, '-n', namespace, ...args], {
        input: input ? JSON.stringify(input) : undefined, encoding: 'utf8', timeout: rollout ? 350000 : 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // API/admission errors can echo Secret payloads. Never print their stdout/stderr.
      throw new DeploymentError(`Kubernetes ${args[0]} ${args[1]} failed. Check RBAC/admission/storage with the owner. Deployment may have changed if patching began; no automatic rollback or retry.`);
    }
  };
  const fetchHead = async () => {
    try {
      requireThat(env.GH_TOKEN, 'Missing GitHub token.');
      const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000),
      });
      requireThat(response.ok, 'Cannot read main.');
      return (await response.json()).object.sha;
    } catch { throw new DeploymentError('Cannot verify current main through GitHub; deployment stopped.'); }
  };
  try { await deploy(env, kube, fetchHead); }
  finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await run(); console.log('Production rollout completed. Verify sign-in, public content and persistence before opening access.'); }
  catch (error) { console.error(error instanceof DeploymentError ? error.message : 'Deployment failed. Raw configuration/API output is withheld; ask the owner to inspect the deployment.'); process.exitCode = 1; }
}
