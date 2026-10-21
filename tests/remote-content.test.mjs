import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, chmod, symlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
const exec = promisify(execFile);
const env = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_TERMINAL_PROMPT: '0' };
const git = async (cwd, ...args) => (await exec('git', args, { cwd, env, timeout: 15000 })).stdout.trim();
const fixtures = Object.fromEntries(await Promise.all(['event', 'site', 'wayfinding'].map(async key => [key, JSON.parse(await readFile(resolve(`content/${key}.json`)))])));
const operations = () => ({ schedule: [{ id: 'synthetic-round', title: 'Synthetic round', startTime: '10:00', endTime: '11:00', location: 'Synthetic room', category: 'team' }], delays: [], announcements: [] });
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'live-remote-content-'));
  const author = join(root, 'author'); const origin = join(root, 'origin.git'); const runtime = join(root, 'runtime.git');
  await mkdir(author); await mkdir(join(author, 'content'));
  await git(author, 'init', '--initial-branch=main');
  await writeFile(join(author, 'application.txt'), 'Executable application files are never checked out by the runtime.');
  await writeFile(join(author, 'content/manifest.json'), '{"schemaVersion":1}');
  await writeFile(join(author, 'content/operations.json'), JSON.stringify(operations()));
  for (const [key, value] of Object.entries(fixtures)) await writeFile(join(author, `content/${key}.json`), JSON.stringify(value));
  await cp(resolve('content/media'), join(author, 'content/media'), { recursive: true });
  await git(author, 'add', '.'); await git(author, 'commit', '-m', 'Synthetic initial public bundle');
  await git(root, 'init', '--bare', origin); await git(author, 'remote', 'add', 'origin', origin); await git(author, 'push', 'origin', 'main');
  await git(root, 'init', '--bare', runtime); await git(runtime, 'remote', 'add', 'origin', origin);
  const initial = await git(author, 'rev-parse', 'HEAD'); const processes = [];
  t.after(async () => {
    for (const child of processes) if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
    // An in-flight Git child can finish just after its server exits; bound cleanup retries.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  async function start(overrides = {}, fail = false) {
    const child = spawn(resolve('server/target/debug/server'), [], { cwd: root, env: { ...env, HOST: '127.0.0.1', PORT: '0', DEMO_MODE: 'true', EVENT_CONTENT_PATH: resolve('content/event.json'), SITE_CONTENT_PATH: resolve('content/site.json'), WAYFINDING_CONTENT_PATH: resolve('content/wayfinding.json'), LIVE_CONTENT_REMOTE_REPO: runtime, LIVE_CONTENT_ALLOW_LOCAL_REMOTE: 'true', ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.push(child); let output = '';
    child.stderr.on('data', b => { output += b; });
    const port = await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`Startup timed out: ${output}`)), 30000);
      child.once('exit', code => { clearTimeout(timer); fail ? res(null) : rej(new Error(`Exited ${code}: ${output}`)); });
      child.stdout.on('data', b => { const match = String(b).match(/Server listening on 127.0.0.1:(\d+)/); if (match) { clearTimeout(timer); res(match[1]); } });
    });
    if (fail) { assert.equal(port, null); return {}; }
    const base = `http://127.0.0.1:${port}`;
    const identities = {};
    async function identity(role) {
      if (!identities[role]) {
        const res = await fetch(`${base}/api/staff/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Request': '1' }, body: JSON.stringify({ accountId: role === 'super' ? 'demo-super' : 'demo-operator' }) });
        assert.equal(res.status, 200); const session = await res.json();
        identities[role] = { Cookie: res.headers.get('set-cookie').split(';')[0], 'X-Staff-CSRF': session.csrfToken, 'X-Staff-Request': '1' };
      }
      return identities[role];
    }
    async function api(path, { method = 'GET', body, revision, auth = 'admin', headers = {}, raw } = {}) {
      return fetch(`${base}${path}`, { method, headers: { ...(auth ? await identity(auth) : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(revision ? { 'If-Match': `"${revision}"` } : {}), ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(60000) });
    }
    const live = async () => (await api('/api/live', { auth: false })).json();
    const status = async () => (await api('/api/publishing')).json();
    const sync = async () => { const res = await api('/api/publishing/sync', { method: 'POST' }); return res; };
    const stop = async () => { child.kill(); await once(child, 'exit'); };
    return { api, live, status, sync, stop, output: () => output };
  }
  async function commit(file, value) {
    if (value !== undefined) await writeFile(join(author, file), typeof value === 'string' ? value : JSON.stringify(value));
    await git(author, 'add', '--all'); await git(author, 'commit', '-m', 'Synthetic direct file change'); await git(author, 'push', 'origin', 'main');
    return git(author, 'rev-parse', 'HEAD');
  }
  return { root, author, origin, runtime, initial, start, commit };
}
async function ok(response) { assert.ok(response.ok, `${response.status}: ${await response.clone().text()}`); return response; }

test('remote-first editor and direct files converge; code-only commits preserve drafts, all document reads share revision', async t => {
  const f = await setup(t); const s = await f.start();
  assert.equal((await s.live()).operationRevision, f.initial);
  assert.equal((await s.status()).mode, 'remote');
  assert.equal((await s.api('/api/settings/publication')).status, 403, 'Admin cannot inspect configuration');
  const settings = await (await ok(await s.api('/api/settings/publication', { auth: 'super' }))).json();
  assert.equal(settings.branch, 'main'); assert.ok(!JSON.stringify(settings).includes(f.origin));
  assert.equal((await s.api('/api/publishing', { auth: false })).status, 401);
  assert.equal((await s.api('/api/publishing/pending', { auth: false })).status, 401);
  const before = await (await s.api('/api/content')).json();
  const code = await f.commit('application.txt', 'Unrelated code-only change must be preserved.');
  const response = await ok(await s.api('/api/content', { method: 'PUT', body: { ...before, content: { ...before.content, title: 'Synthetic editor title' } } }));
  const saved = await response.json(); assert.notEqual(saved.revision, code);
  assert.equal(await git(f.origin, 'rev-parse', 'refs/heads/main'), saved.revision);
  assert.equal(await git(f.runtime, 'show', `${saved.revision}:application.txt`), 'Unrelated code-only change must be preserved.');
  assert.equal((await s.live()).event.title, 'Synthetic editor title');
  for (const path of ['/api/site', '/api/site/editor', '/api/wayfinding', '/api/wayfinding/editor', '/api/content']) assert.equal((await (await s.api(path)).json()).revision, saved.revision, path);
  const noop = await ok(await s.api('/api/content', { method: 'PUT', body: saved }));
  assert.equal((await noop.json()).revision, saved.revision, 'identical save does not create formatting-only commit');
  await git(f.author, 'pull', '--ff-only', 'origin', 'main');
  const site = { ...fixtures.site, hero: { ...fixtures.site.hero, location: 'Synthetic direct location' } };
  const direct = await f.commit('content/site.json', site);
  const deadline = Date.now() + 25000;
  while ((await s.live()).operationRevision !== direct && Date.now() < deadline) await wait(100);
  assert.equal((await s.live()).operationRevision, direct, 'background poll activates without sync, restart or rebuild');
  assert.equal((await s.status()).remoteRevision, direct);
  assert.equal((await (await s.api('/api/site')).json()).content.hero.location, 'Synthetic direct location');
  assert.equal((await s.api('/api/content', { method: 'PUT', body: saved })).status, 409);
  const created = await ok(await s.api('/api/schedule', { method: 'POST', revision: direct, body: { title: 'Synthetic next round', startTime: '12:00', endTime: '13:00', category: 'team', location: 'Synthetic' } }));
  assert.equal(created.status, 201); assert.equal((await s.live()).schedule.length, 2);
  assert.equal((await s.api('/api/schedule', { method: 'POST', body: {} })).status, 428);
  const exported = await (await s.api('/api/publishing/export')).json();
  assert.ok(exported.editorial); assert.ok(!JSON.stringify(exported).includes('csrfToken'));
  assert.equal(await git(f.runtime, 'rev-parse', '--is-bare-repository'), 'true');
});

test('rejected push retains draft, never activates; restart, retry and explicit archive are honest', async t => {
  const f = await setup(t); let s = await f.start();
  const hook = join(f.origin, 'hooks/pre-receive'); await writeFile(hook, '#!/bin/sh\nexit 1\n'); await chmod(hook, 0o755);
  const before = await (await s.api('/api/content')).json();
  assert.equal((await s.api('/api/content', { method: 'PUT', body: { ...before, content: { ...before.content, title: 'Synthetic retained draft' } } })).status, 503);
  const state = await s.status(); assert.match(state.pendingRevision, /^[a-f0-9]{40}$/); assert.equal(state.revision, f.initial);
  assert.equal((await s.live()).event.title, before.content.title);
  assert.equal(await git(f.origin, 'rev-parse', 'refs/heads/main'), f.initial);
  await s.stop(); s = await f.start(); assert.equal((await s.status()).pendingRevision, state.pendingRevision);
  assert.equal((await (await s.api('/api/publishing/pending')).json()).content.editorial.event.title, 'Synthetic retained draft');
  assert.equal((await s.api('/api/content', { method: 'PUT', body: before })).status, 409, 'new saves cannot silently overwrite retained publication');
  await writeFile(hook, '#!/bin/sh\nexit 0\n');
  await ok(await s.api('/api/publishing/push', { method: 'POST', revision: state.pendingRevision }));
  assert.equal((await s.live()).event.title, 'Synthetic retained draft');
  assert.equal((await s.status()).pendingRevision, null);
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  const next = await (await s.api('/api/content')).json();
  assert.equal((await s.api('/api/content', { method: 'PUT', body: { ...next, content: { ...next.content, title: 'Synthetic archive' } } })).status, 503);
  const pending = (await s.status()).pendingRevision;
  assert.equal((await s.api('/api/publishing/archive', { method: 'POST', revision: f.initial })).status, 409);
  await ok(await s.api('/api/publishing/archive', { method: 'POST', revision: pending }));
  assert.equal(await git(f.runtime, 'rev-parse', `refs/live/drafts/${pending}`), pending, 'archive preserves every draft object');
  assert.equal((await s.status()).pendingRevision, null);
});

test('invalid commits and symlinks never partly activate; restart keeps last-good and restore is a forward remote commit', async t => {
  const f = await setup(t); let s = await f.start();
  const changed = { ...fixtures.event, title: 'Must not partly activate' };
  await writeFile(join(f.author, 'content/event.json'), JSON.stringify(changed));
  const bad = await f.commit('content/site.json', { ...fixtures.site, privateRoster: ['not-public'] });
  assert.equal((await s.sync()).status, 422);
  const status = await s.status(); assert.equal(status.remoteRevision, bad); assert.equal(status.revision, f.initial); assert.equal(status.healthy, false);
  assert.equal((await s.live()).event.title, fixtures.event.title);
  await s.stop(); s = await f.start(); assert.equal((await s.live()).operationRevision, f.initial);
  await ok(await s.api('/api/publishing/restore', { method: 'POST', revision: bad, body: { revision: f.initial } }));
  const restored = (await s.live()).operationRevision;
  assert.notEqual(restored, f.initial); assert.equal(await git(f.origin, 'rev-parse', `${restored}^`), bad);
  await git(f.author, 'pull', '--ff-only', 'origin', 'main');
  await rm(join(f.author, 'content/site.json')); await symlink('../../private.db', join(f.author, 'content/site.json'));
  await f.commit(); assert.equal((await s.sync()).status, 422); assert.equal((await s.live()).operationRevision, restored);
  const serialized = JSON.stringify(await s.status()); assert.ok(!serialized.includes('privateRoster')); assert.ok(!serialized.includes(f.root));
});

test('media uploads and direct hash-named files use the complete bundle; missing/unsafe references are rejected', async t => {
  const f = await setup(t); const s = await f.start();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
  const beforeUpload = await (await s.api('/api/site/editor')).json();
  const asset = await (await ok(await s.api('/api/site/media', { method: 'POST', raw: png, headers: { 'Content-Type': 'image/png', 'X-Site-Editor': '1' } }))).json();
  const name = `${createHash('sha256').update(png).digest('hex')}.png`; assert.equal(asset.url, `/media/${name}`);
  assert.equal(asset.previousRevision, beforeUpload.revision); assert.equal(asset.revision, (await s.live()).operationRevision);
  assert.equal(await git(f.runtime, 'show', `${asset.revision}:content/site.json`), await git(f.runtime, 'show', `${asset.previousRevision}:content/site.json`), 'append-only upload may safely advance matching editor CAS base');
  const publicAsset = await ok(await s.api(asset.url, { auth: false })); assert.deepEqual(Buffer.from(await publicAsset.arrayBuffer()), png);
  assert.equal(publicAsset.headers.get('content-type'), 'image/png');
  const current = await (await s.api('/api/site/editor')).json();
  await ok(await s.api('/api/site/editor', { method: 'PUT', body: { revision: current.revision, content: { ...current.content, hero: { ...current.content.hero, imageUrl: asset.url, imageAlt: 'Synthetic pixel' } } } }));
  const latest = await (await s.api('/api/site/editor')).json();
  assert.equal((await s.api('/api/site/editor', { method: 'PUT', body: { revision: latest.revision, content: { ...latest.content, hero: { ...latest.content.hero, imageUrl: `/media/${'a'.repeat(64)}.png` } } } })).status, 422);
  const external = structuredClone(latest.content);
  external.hero = { ...external.hero, imageUrl: 'https://example.org/media/photo.png', imageAlt: 'Synthetic external image' };
  external.copy.example = 'The /media/ directory is public, not a private inbox.';
  external.guide.sections[0].markdown = '![External](https://example.org/media/photo.png)\n\n`/media/not-an-image.png`';
  const externalSaved = await (await ok(await s.api('/api/site/editor', { method: 'PUT', body: { revision: latest.revision, content: external } }))).json();
  assert.equal((await (await s.api('/api/site')).json()).content.hero.imageUrl, external.hero.imageUrl);
  const invalidMarkdown = structuredClone(external);
  invalidMarkdown.guide.sections[0].markdown = '![Missing](&#47;media/missing.png)';
  assert.equal((await s.api('/api/site/editor', { method: 'PUT', body: { revision: externalSaved.revision, content: invalidMarkdown } })).status, 422);
  assert.equal((await s.live()).operationRevision, externalSaved.revision);
  assert.equal(await git(f.origin, 'rev-parse', 'refs/heads/main'), externalSaved.revision, 'invalid Markdown cannot publish a missing local image');
  await git(f.author, 'pull', '--ff-only', 'origin', 'main');
  await f.commit('content/media/private.txt', 'not a supported public asset');
  assert.equal((await s.sync()).status, 422);
  assert.equal((await s.api('/media/private.txt', { auth: false })).status, 404);
  assert.equal((await s.api('/media/not-committed.png', { auth: false })).status, 404);
});

test('concurrent editor CAS, non-fast-forward retry, outage and unexpected index do not lose work', async t => {
  const f = await setup(t); let s = await f.start();
  const before = await (await s.api('/api/content')).json();
  const attempts = await Promise.all(['A', 'B'].map(title => s.api('/api/content', { method: 'PUT', body: { ...before, content: { ...before.content, title: `Synthetic ${title}` } } })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
  await git(f.author, 'pull', '--ff-only', 'origin', 'main');
  const hook = join(f.origin, 'hooks/pre-receive'); await writeFile(hook, '#!/bin/sh\nexit 1\n'); await chmod(hook, 0o755);
  const current = await (await s.api('/api/content')).json();
  assert.equal((await s.api('/api/content', { method: 'PUT', body: { ...current, content: { ...current.content, title: 'Synthetic losing draft' } } })).status, 503);
  const pending = (await s.status()).pendingRevision;
  await writeFile(hook, '#!/bin/sh\nexit 0\n');
  const remote = await f.commit('content/event.json', { ...current.content, title: 'Synthetic direct winner' }); await ok(await s.sync());
  assert.equal((await s.api('/api/publishing/push', { method: 'POST', revision: pending })).status, 503);
  assert.equal(await git(f.origin, 'rev-parse', 'refs/heads/main'), remote);
  assert.equal((await s.live()).event.title, 'Synthetic direct winner');
  await s.stop(); await rename(f.origin, `${f.origin}.unavailable`); s = await f.start();
  assert.equal((await s.live()).operationRevision, remote); assert.equal((await s.sync()).status, 503);
  assert.ok((await s.status()).lastFailure);
  await writeFile(join(f.runtime, 'index'), 'Synthetic dirty index that must not be removed.');
  assert.equal((await s.sync()).status, 409);
  assert.equal(await readFile(join(f.runtime, 'index'), 'utf8'), 'Synthetic dirty index that must not be removed.');
  assert.equal((await s.live()).operationRevision, remote);
});

test('configuration rejects a worktree, alternate push destination, private/unsupported content and missing last-good', async t => {
  const f = await setup(t);
  await f.start({ LIVE_CONTENT_REMOTE_REPO: f.author }, true);
  await git(f.runtime, 'remote', 'set-url', '--push', 'origin', join(f.root, 'other.git'));
  await f.start({}, true);
  await git(f.runtime, 'config', '--unset', 'remote.origin.pushurl');
  await f.commit('content/operations.json', { ...operations(), editorial: fixtures });
  await f.start({}, true);
  await f.start({ LIVE_CONTENT_REPO: f.author }, true);
});

test('Markdown remote bundle pages persist as blobs, retain pending proposals, restore and reject unsafe direct files', async t => {
  const f = await setup(t); const s = await f.start();
  const source = await readFile(resolve('content/pages/home.md'), 'utf8');
  const initial = await (await s.api('/api/pages')).json(); assert.deepEqual(initial.files, {});
  const saved = await (await ok(await s.api('/api/pages/editor', { method: 'PUT', body: { revision: initial.revision, files: { 'home.md': source } } }))).json();
  assert.equal(await git(f.origin, 'show', `${saved.revision}:content/pages/home.md`), source.trim());
  assert.ok(!JSON.parse(await git(f.origin, 'show', `${saved.revision}:content/operations.json`)).pages);
  assert.equal((await s.api('/api/pages/editor', { method: 'PUT', body: { revision: initial.revision, files: {} } })).status, 409);
  assert.equal((await s.api('/api/pages/editor', { method: 'PUT', body: { revision: saved.revision, files: { 'home.md': source + '\n![Missing](/media/missing.png)\n' } } })).status, 422);
  const hook = join(f.origin, 'hooks/pre-receive'); await writeFile(hook, '#!/bin/sh\nexit 1\n'); await chmod(hook, 0o755);
  assert.equal((await s.api('/api/pages/editor', { method: 'PUT', body: { revision: saved.revision, files: { 'home.md': source + '\nRetained proposal\n' } } })).status, 503);
  const health = await s.status(); assert.ok(health.pendingRevision);
  assert.match(await git(f.runtime, 'show', `${health.pendingRevision}:content/pages/home.md`), /Retained proposal/);
  assert.equal((await (await s.api('/api/pages')).json()).files['home.md'], source);
  await rm(hook);
  await ok(await s.api('/api/publishing/push', { method: 'POST', revision: health.pendingRevision }));
  const published = await (await s.api('/api/pages')).json(); assert.match(published.files['home.md'], /Retained proposal/);
  await ok(await s.api('/api/publishing/restore', { method: 'POST', revision: published.revision, body: { revision: saved.revision } }));
  const restored = await (await s.api('/api/pages')).json(); assert.equal(restored.files['home.md'], source);
  await git(f.author, 'pull', '--ff-only', 'origin', 'main');
  await f.commit('content/pages/home.md', 'invalid frontmatter');
  assert.equal((await s.sync()).status, 422);
  assert.equal((await (await s.api('/api/pages')).json()).revision, restored.revision);
  await rm(join(f.author, 'content/pages/home.md')); await symlink('../site.json', join(f.author, 'content/pages/home.md'));
  await f.commit('content/pages/home.md'); assert.equal((await s.sync()).status, 422);
  await s.stop(); const restarted = await f.start(); assert.equal((await (await restarted.api('/api/pages')).json()).files['home.md'], source);
});
