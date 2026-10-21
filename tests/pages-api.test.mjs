import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
const home = await readFile(resolve('content/pages/home.md'), 'utf8');
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'live-pages-api-'));
  for (const name of ['event', 'site', 'wayfinding']) await writeFile(join(root, `${name}.json`), await readFile(resolve(`content/${name}.json`)));
  const processes = [];
  t.after(async () => { for (const child of processes) if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } await rm(root, { recursive: true, force: true }); });
  async function start() {
    const child = spawn(resolve('server/target/debug/server'), [], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, HOST: '127.0.0.1', PORT: '0', DEMO_MODE: 'true', EVENT_CONTENT_PATH: join(root, 'event.json'), SITE_CONTENT_PATH: join(root, 'site.json'), WAYFINDING_CONTENT_PATH: join(root, 'wayfinding.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
    processes.push(child); let errors = '';
    child.stderr.on('data', b => { errors += b; });
    const port = await new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error(errors)), 15000); child.once('exit', code => { clearTimeout(timer); rej(new Error(`${code}: ${errors}`)); }); child.stdout.on('data', b => { const match = String(b).match(/Server listening on 127.0.0.1:(\d+)/); if (match) { clearTimeout(timer); res(match[1]); } }); });
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/api/staff/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Request': '1' }, body: JSON.stringify({ accountId: 'demo-operator' }) });
    assert.equal(login.status, 200); const session = await login.json();
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-Staff-CSRF': session.csrfToken, 'X-Staff-Request': '1' };
    const api = (path, { method = 'GET', body, auth = true, csrf = true } = {}) => fetch(`${base}${path}`, { method, headers: { ...(auth ? { ...headers, ...(!csrf ? { 'X-Staff-CSRF': '' } : {}) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    return { api, stop: async () => { child.kill(); await once(child, 'exit'); } };
  }
  return { root, start };
}
async function json(res) { assert.equal(res.status, 200, await res.clone().text()); return res.json(); }
async function eventually(load, predicate) { for (let i = 0; i < 65; i++) { const value = await load(); if (predicate(value)) return value; await wait(100); } assert.fail('Publication did not converge'); }

test('file pages: explicit adoption, permissions, actual files, CAS, compatibility and invalid last-good restart', async t => {
  const fixture = await setup(t); const s = await fixture.start();
  let current = await json(await s.api('/api/pages', { auth: false }));
  assert.deepEqual(current.files, {}); await assert.rejects(access(join(fixture.root, 'pages')));
  assert.match((await s.api('/api/pages', { auth: false })).headers.get('cache-control'), /no-store/);
  for (const [path, method, body] of [['/api/pages/editor', 'GET'], ['/api/pages/editor', 'PUT', { revision: current.revision, files: {} }], ['/api/pages/preview', 'POST', { source: home }], ['/api/pages/adopt', 'POST']]) assert.equal((await s.api(path, { method, body, auth: false })).status, 401);
  assert.equal((await s.api('/api/pages/preview', { method: 'POST', body: { source: home }, csrf: false })).status, 403);
  const converted = await json(await s.api('/api/pages/adopt', { method: 'POST' }));
  assert.equal(Object.keys(converted.files).length, 9);
  assert.match(converted.files['faq.md'], /Where can I find my testing room/);
  assert.match(converted.files['updates.md'], /subscribe\(\)/);
  assert.match(converted.files['map.md'], /map\(\)/);
  assert.match(converted.files['guide.md'], /guide-before-you-arrive/); assert.match(converted.files['help.md'], /anchor\(id="wifi"\)/);
  assert.deepEqual((await json(await s.api('/api/pages'))).files, {}); await assert.rejects(access(join(fixture.root, 'pages')));
  const stale = { revision: current.revision, files: converted.files };
  current = await json(await s.api('/api/pages/editor', { method: 'PUT', body: stale }));
  assert.equal(await readFile(join(fixture.root, 'pages/guide.md'), 'utf8'), current.files['guide.md']);
  assert.equal((await s.api('/api/pages/adopt', { method: 'POST' })).status, 422);
  assert.equal((await s.api('/api/pages/editor', { method: 'PUT', body: stale })).status, 409);
  const site = await json(await s.api('/api/site/editor')); site.content.guide.title = 'Not the editable source anymore';
  assert.equal((await s.api('/api/site/editor', { method: 'PUT', body: { revision: site.revision, content: site.content } })).status, 422);
  const event = await json(await s.api('/api/content'));
  const changedFaq = structuredClone(event); changedFaq.content.faqs[0].answer = 'Wrong editable source';
  assert.equal((await s.api('/api/content', { method: 'PUT', body: changedFaq })).status, 422);
  event.content.notice = 'Shared event notices remain editable';
  assert.equal((await s.api('/api/content', { method: 'PUT', body: event })).status, 200);
  for (const source of ['bad', home + '\n{{ unknown() }}\n', home + '\n![missing](/media/missing.png)\n', home.replace('route = "/"', 'route = "/admin"')]) {
    assert.equal((await s.api('/api/pages/preview', { method: 'POST', body: { source } })).status, 422);
    assert.equal((await s.api('/api/pages/editor', { method: 'PUT', body: { revision: current.revision, files: { 'home.md': source } } })).status, 422);
  }
  assert.equal((await json(await s.api('/api/pages'))).revision, current.revision);
  const concurrent = await Promise.all(['A', 'B'].map(text => s.api('/api/pages/editor', { method: 'PUT', body: { revision: current.revision, files: { ...current.files, 'home.md': home + `\n${text}\n` } } })));
  assert.deepEqual(concurrent.map(res => res.status).sort(), [200, 409]);
  await writeFile(join(fixture.root, 'pages/home.md'), home + '\nDirect file change\n');
  current = await eventually(async () => json(await s.api('/api/pages')), next => next.files['home.md'].includes('Direct file change'));
  await writeFile(join(fixture.root, 'pages/home.md'), 'invalid direct edit');
  const lastGood = await eventually(async () => json(await s.api('/api/pages')), next => !!next.reloadError);
  assert.deepEqual(lastGood.files, current.files);
  await s.stop(); const restarted = await fixture.start();
  const retained = await json(await restarted.api('/api/pages'));
  assert.deepEqual(retained.files, current.files); assert.ok(retained.reloadError);
});
