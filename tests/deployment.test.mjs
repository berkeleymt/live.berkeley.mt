import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configuration, inspectDeployment, resources, deploymentPatch, deploy } from '../scripts/deploy-production.mjs';

const variables = {
  LIVE_STORAGE_READY: 'true', LIVE_CONTAINER_NAME: 'app',
  GOOGLE_CLIENT_ID: '123-fixture.apps.googleusercontent.com', SUPER_ADMIN_EMAILS: 'operator@example.test', STAFF_PUBLIC_ORIGIN: 'https://live.example.test',
  DATABASE_PATH: '/data/private/data.db', PRIVATE_DB_PATH: '/data/private/reports.db', STAFF_STATE_PATH: '/data/private/staff.sqlite3',
  SITE_MEDIA_DIR: '/data/media', EVENT_CONTENT_PATH: '/data/content/event.json', SITE_CONTENT_PATH: '/data/content/site.json', WAYFINDING_CONTENT_PATH: '/data/content/wayfinding.json', PAGES_CONTENT_DIR: '/data/content/pages',
};
const environment = {
  GITHUB_REPOSITORY: 'berkeleymt/live.berkeley.mt', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', DEPLOY_PRODUCTION: 'true',
  GITHUB_SHA: 'a'.repeat(40), IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1', LIVE_VARIABLES_JSON: JSON.stringify(variables),
};
function fixture() {
  return {
    metadata: { name: 'live', namespace: 'bmt', resourceVersion: '42' },
    spec: { replicas: 1, strategy: { type: 'Recreate' }, template: { metadata: { labels: { app: 'live' } }, spec: {
      volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'existing-data' } }],
      containers: [
        { name: 'metrics', image: 'existing-sidecar' },
        { name: 'app', image: 'existing-app', volumeMounts: [{ name: 'data', mountPath: '/data' }], envFrom: [{ configMapRef: { name: 'owner-config' } }], env: [{ name: 'KEEP', value: 'owner-setting' }, { name: 'DEMO_MODE', value: 'true' }, { name: 'POSTMARK_SERVER_TOKEN', value: 'old-token' }] },
      ],
    } } },
  };
}
function harness({ env = {}, change, hpas = [], bound = true, deny = '', head = environment.GITHUB_SHA, race = false, drift = false } = {}) {
  let deployment = fixture();
  change?.(deployment);
  const calls = [];
  const kube = (args, input) => {
    calls.push({ args, input });
    if (deny && args.join(' ').includes(deny)) throw new Error('Synthetic RBAC denial');
    if (args[0] === 'get') {
      if (args[1] === 'deployment') return JSON.stringify(deployment);
      if (args[1] === 'hpa') return JSON.stringify({ items: hpas });
      if (args[1] === 'pvc') return JSON.stringify({ metadata: {}, status: { phase: bound ? 'Bound' : 'Pending' } });
    }
    if (args[0] === 'patch' && !args.includes('--dry-run=server')) {
      if (race) deployment.metadata.resourceVersion = '43';
      assert.equal(input[0].value, deployment.metadata.resourceVersion, 'resourceVersion conflict');
      deployment.spec.template.spec.containers[1].env = input[1].value;
      deployment.spec.template.spec.containers[1].image = input[2].value;
    }
    if (args[0] === 'rollout' && drift) deployment.spec.template.spec.containers[1].image = 'changed-by-another-operator';
    return '';
  };
  return { calls, kube, result: () => deployment, run: () => deploy({ ...environment, ...env }, kube, async () => head) };
}
const writes = calls => calls.filter(({ args }) => ['create', 'patch'].includes(args[0]) && !args.includes('--dry-run=server'));

test('explicit production defaults ignore unrelated Variables and keep secrets separate', () => {
  const config = configuration({ ...variables, DEMO_MODE: 'true', STAFF_COOKIE_SECURE: 'false', ADMIN_PASSWORD: 'ignored', UNRELATED: 'ignored' });
  assert.equal(config.data.DEMO_MODE, 'false');
  assert.equal(config.data.STAFF_COOKIE_SECURE, 'true');
  assert.equal(config.data.STAFF_AUTH_MODE, 'google');
  assert.equal(config.data.ADMIN_PASSWORD, '');
  assert.equal(config.data.ROSTER_AUTO_SYNC, '0');
  assert.equal(config.data.LIVE_LOST_FOUND_MAIL_ENABLED, 'false');
  assert.equal(config.data.UNRELATED, undefined);
  assert.deepEqual(config.sensitive, { POSTMARK_SERVER_TOKEN: '', CONTESTDOJO_API_TOKEN: '' });
});

for (const [key, value] of [
  ['LIVE_STORAGE_READY', 'false'], ['LIVE_CONTAINER_NAME', ''], ['GOOGLE_CLIENT_ID', ''], ['SUPER_ADMIN_EMAILS', 'not-an-email'], ['STAFF_PUBLIC_ORIGIN', 'http://live.example.test'], ['STAFF_PUBLIC_ORIGIN', 'https://live.example.test/'],
  ['DATABASE_PATH', 'data.db'], ['DATABASE_PATH', '/data/private/../public.db'], ['PRIVATE_DB_PATH', '/data/content/reports.db'], ['STAFF_STATE_PATH', variables.DATABASE_PATH],
  ['LIVE_CONTENT_BRANCH', '-main'], ['LIVE_CONTENT_BRANCH', '../main'], ['ROSTER_AUTO_SYNC', 'true'], ['LIVE_LOST_FOUND_MAIL_ENABLED', '1'], ['LIVE_CONTENT_RUNTIME_RELOAD', 'true'],
]) test(`configuration rejects invalid ${key} (${value})`, () => assert.throws(() => configuration({ ...variables, [key]: value })));

test('Git paths and private stores cannot overlap public paths or each other', () => {
  assert.throws(() => configuration({ ...variables, LIVE_CONTENT_REPO: '/data/git', LIVE_CONTENT_REMOTE_REPO: '/data/bare' }), /one Git/);
  assert.throws(() => configuration({ ...variables, LIVE_CONTENT_REMOTE_REPO: '/data' }), /outside|separate/);
  assert.throws(() => configuration({ ...variables, LIVE_CONTENT_REMOTE_REPO: '/data/content/git' }), /separate/);
  assert.equal(configuration({ ...variables, LIVE_CONTENT_REMOTE_REPO: '/data/public.git', LIVE_CONTENT_RUNTIME_RELOAD: 'true' }).data.LIVE_CONTENT_REMOTE_REPO, '/data/public.git');
});

test('optional provider activation requires matching configuration and secrets never enter ConfigMap', () => {
  assert.throws(() => configuration(variables, { POSTMARK_SERVER_TOKEN: 'synthetic-token' }), /POSTMARK_FROM_ADDRESS/);
  assert.throws(() => configuration(variables, { CONTESTDOJO_API_TOKEN: 'synthetic-token' }), /storage/);
  assert.throws(() => configuration({ ...variables, ROSTER_AUTO_SYNC: '1' }), /LIVE_CONTESTDOJO_DB/);
  assert.throws(() => configuration({ ...variables, LIVE_LOST_FOUND_MAIL_ENABLED: 'true' }), /Receipt/);
  assert.throws(() => configuration({ ...variables, POSTMARK_FROM_ADDRESS: 'a@berkeley.mt' }, { POSTMARK_SERVER_TOKEN: 'bad\ntoken' }), /Secret/);
  const config = configuration({ ...variables, POSTMARK_FROM_ADDRESS: 'notice@berkeley.mt', LIVE_LOST_FOUND_MAIL_ENABLED: 'true', LIVE_LOST_FOUND_MAIL_FROM: 'found@berkeley.mt', LIVE_LOST_FOUND_MAIL_REPLY_TO: 'desk@berkeley.mt', LIVE_CONTESTDOJO_DB: '/data/private/roster.db', CONTESTDOJO_EVENT_ID: 'fixture' }, { POSTMARK_SERVER_TOKEN: 'synthetic-mail-token', CONTESTDOJO_API_TOKEN: 'synthetic-roster-token' });
  const [map, secret] = resources(config, '123-1');
  assert.equal(map.immutable, true); assert.equal(secret.immutable, true);
  assert.equal(map.data.POSTMARK_SERVER_TOKEN, undefined);
  assert.equal(Buffer.from(secret.data.POSTMARK_SERVER_TOKEN, 'base64').toString(), 'synthetic-mail-token');
});

for (const [name, change] of [
  ['replicas', d => { d.spec.replicas = 2; }], ['strategy', d => { d.spec.strategy.type = 'RollingUpdate'; }], ['paused', d => { d.spec.paused = true; }],
  ['container', d => { d.spec.template.spec.containers[1].name = 'another'; }], ['read-only mount', d => { d.spec.template.spec.containers[1].volumeMounts[0].readOnly = true; }],
  ['ephemeral storage', d => { d.spec.template.spec.volumes = [{ name: 'data', emptyDir: {} }]; }], ['shadow mount', d => { d.spec.template.spec.containers[1].volumeMounts.push({ name: 'temporary', mountPath: '/data/private' }); }],
  ['pages parent', d => { d.spec.template.spec.containers[1].volumeMounts.push({ name: 'temporary', mountPath: '/data/content' }); }],
]) test(`deployment preflight rejects ${name} without writes`, async () => {
  const h = harness({ change }); await assert.rejects(h.run()); assert.deepEqual(writes(h.calls), []);
});

test('successful deployment preflights every write, pins digest and preserves owner configuration', async () => {
  const h = harness(); await h.run();
  assert.equal(h.calls.filter(c => c.args.includes('--dry-run=server')).length, 3);
  assert.ok(h.calls.findIndex(c => writes([c]).length) > h.calls.findLastIndex(c => c.args.includes('--dry-run=server')));
  const before = fixture().spec.template.spec;
  const after = h.result().spec.template.spec;
  assert.deepEqual(after.volumes, before.volumes); assert.deepEqual(after.containers[0], before.containers[0]);
  assert.deepEqual(after.containers[1].volumeMounts, before.containers[1].volumeMounts);
  assert.deepEqual(after.containers[1].envFrom, before.containers[1].envFrom);
  assert.deepEqual(after.containers[1].env.find(e => e.name === 'KEEP'), before.containers[1].env[0]);
  assert.match(after.containers[1].image, /@sha256:/);
  assert.equal(after.containers[1].env.find(e => e.name === 'POSTMARK_SERVER_TOKEN').value, undefined);
  assert.deepEqual(h.calls.at(-2).args, ['rollout', 'status', 'deployment/live', '--timeout=300s']);
});

for (const [name, options] of [
  ['push is build-only', { env: { GITHUB_EVENT_NAME: 'push' } }], ['manual confirmation', { env: { DEPLOY_PRODUCTION: 'false' } }], ['branch', { env: { GITHUB_REF: 'refs/heads/feature' } }], ['fork', { env: { GITHUB_REPOSITORY: 'someone/fork' } }],
  ['digest', { env: { IMAGE_DIGEST: 'latest' } }], ['run identity', { env: { GITHUB_RUN_ID: '../unsafe' } }], ['JSON', { env: { LIVE_VARIABLES_JSON: 'invalid' } }], ['settings', { env: { LIVE_VARIABLES_JSON: '{}' } }],
]) test(`approval/config gate: ${name}`, async () => {
  const h = harness(options); await assert.rejects(h.run()); assert.deepEqual(h.calls, []);
});

for (const [name, options] of [
  ['stale main', { head: 'c'.repeat(40) }], ['unbound PVC', { bound: false }], ['autoscaling', { hpas: [{ spec: { scaleTargetRef: { kind: 'Deployment', name: 'live' } } }] }],
  ['create permission', { deny: 'create --dry-run=server' }], ['patch permission', { deny: 'patch deployment live --type=json --dry-run=server' }],
]) test(`preflight rejects ${name} without writes`, async () => {
  const h = harness(options); await assert.rejects(h.run()); assert.deepEqual(writes(h.calls), []);
});

test('deployment CAS rejects concurrent changes without a rollout or overwrite', async () => {
  const h = harness({ race: true }); await assert.rejects(h.run(), /resourceVersion conflict/);
  assert.equal(h.result().spec.template.spec.containers[1].image, 'existing-app');
  assert.equal(h.calls.some(c => c.args[0] === 'rollout'), false);
});

test('rollout failure and later operator drift are not retried or claimed successful', async () => {
  for (const options of [{ deny: 'rollout status' }, { drift: true }]) {
    const h = harness(options); await assert.rejects(h.run());
    assert.equal(writes(h.calls).filter(c => c.args[0] === 'patch').length, 1);
  }
});

test('new run versions do not modify old ConfigMaps/Secrets and explicit refs override envFrom', () => {
  const config = configuration(variables);
  const deployment = fixture();
  const { index, claims } = inspectDeployment(deployment, config);
  assert.equal(index, 1); assert.deepEqual(claims, ['existing-data']);
  assert.notEqual(resources(config, '1-1')[0].metadata.name, resources(config, '1-2')[0].metadata.name);
  const patch = deploymentPatch(deployment, config, index, 'live-runtime-1-2', environment.IMAGE_DIGEST);
  assert.deepEqual(patch[0], { op: 'test', path: '/metadata/resourceVersion', value: '42' });
  assert.equal(patch[1].value.filter(e => e.name === 'DEMO_MODE').length, 1);
  assert.equal(patch[1].value.find(e => e.name === 'DEMO_MODE').valueFrom.configMapKeyRef.name, 'live-runtime-1-2');
});

test('CLI suppresses sensitive kubectl errors/malformed responses and removes temporary kubeconfig', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'live-deploy-test-'));
  try {
    const bin = path.join(directory, 'bin'); const scratch = path.join(directory, 'scratch'); mkdirSync(bin); mkdirSync(scratch);
    const marker = 'synthetic-private-error-marker';
    for (const body of [`process.stderr.write('${marker}'); process.exit(1);`, `process.stdout.write('${marker}');`]) {
      writeFileSync(path.join(bin, 'kubectl'), `#!${process.execPath}\n${body}`, { mode: 0o755 });
      const result = spawnSync(process.execPath, ['scripts/deploy-production.mjs'], { encoding: 'utf8', env: { ...environment, PATH: bin, TMPDIR: scratch, KUBECONFIG_B64: Buffer.from('synthetic-config').toString('base64') } });
      assert.equal(result.status, 1);
      assert.ok(!(result.stdout + result.stderr).includes(marker));
      assert.deepEqual(readdirSync(scratch), []);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('workflow has a main-only manual confirmation gate and digest handoff', () => {
  const workflow = readFileSync('.github/workflows/build-and-push.yaml', 'utf8');
  assert.match(workflow, /deploy_production:[\s\S]*?default: false/);
  assert.match(workflow, /if: github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main' && inputs.deploy_production/);
  assert.match(workflow, /digest: \$\{\{ steps.image.outputs.digest \}\}/);
  assert.match(workflow, /IMAGE_DIGEST: \$\{\{ needs.build.outputs.digest \}\}/);
  assert.match(workflow, /group: live-production\s+cancel-in-progress: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.ok(!workflow.includes('rollout restart'));
  assert.ok(!workflow.includes('toJSON(secrets)'));
});
