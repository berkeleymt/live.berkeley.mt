import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function command(program, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${program} exited ${code}:\n${output}`)));
  });
}

test('isolated Rust wayfinding module and HTTP security contract', { timeout: 240_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'live-wayfinding-'));
  const privateDirectory = await mkdtemp(join(tmpdir(), 'live-wayfinding-private-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'Cargo.toml'), (await readFile(join(root, 'server/Cargo.toml'), 'utf8')).replace('name = "server"', 'name = "wayfinding_test_harness"'));
  await writeFile(join(directory, 'Cargo.lock'), (await readFile(join(root, 'server/Cargo.lock'), 'utf8')).replace('name = "server"', 'name = "wayfinding_test_harness"'));
  await writeFile(join(directory, 'src/main.rs'), `
#[path = ${JSON.stringify(join(root, 'server/src/wayfinding.rs'))}]
mod wayfinding;
// File-mode-only harness: remote source is uninhabited, never a remote mock.
// Production remote behavior is covered by remote-content.test.mjs.
mod remote_content {
    pub enum RemoteStore {}
    pub struct Snapshot { pub revision: String, pub content: Content }
    pub struct Content { pub editorial: Option<Editorial> }
    pub struct Editorial { pub wayfinding: crate::wayfinding::WayfindingContent }
    impl RemoteStore { pub fn snapshot(&self) -> Snapshot { match *self {} } }
}
use axum::{extract::Request, middleware::{self, Next}, response::Response, Router};
use std::{sync::Arc, net::SocketAddr};
// Only this disposable test harness accepts x-test-role. Production never does.
async fn test_access(mut request: Request, next: Next) -> Response {
    let role = request.headers().get("x-test-role").and_then(|v| v.to_str().ok()).unwrap_or("").to_owned();
    if role == "reader" || role == "writer" || role == "denied" {
        request.extensions_mut().insert(wayfinding::WayfindingAccess { can_read: role != "denied", can_write: role == "writer" });
    }
    next.run(request).await
}
#[tokio::main]
async fn main() {
    let store = Arc::new(wayfinding::WayfindingStore::from_env(std::env::var("WAYFINDING_CONTENT_PATH").unwrap().into()).unwrap());
    let app = Router::new().merge(wayfinding::public_router(store.clone()))
        .merge(wayfinding::admin_router(store).layer(middleware::from_fn(test_access)));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!("TEST_PORT={}", listener.local_addr().unwrap().port());
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}
`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CARGO_TARGET_DIR: join(root, 'server/target') };
  await t.test('Rust validation, conflicts, privacy, lookup and authorization tests pass', async () => {
    const output = await command('cargo', ['test', '--locked', '--manifest-path', join(directory, 'Cargo.toml')], { env });
    assert.match(output, /test result: ok/);
  });
  await command('cargo', ['build', '--locked', '--manifest-path', join(directory, 'Cargo.toml')], { env });
  const processes = [];
  t.after(async () => {
    for (const child of processes) {
      if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); }
    }
  });
  let count = 0;
  const source = await readFile(join(root, 'content/wayfinding.json'), 'utf8');
  async function launch(extra = {}) {
    const contentPath = join(directory, `directions-${count++}.json`);
    await writeFile(contentPath, source);
    const child = spawn(join(root, 'server/target/debug/wayfinding_test_harness'), [], {
      cwd: directory, env: { PATH: process.env.PATH, WAYFINDING_CONTENT_PATH: contentPath, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    processes.push(child);
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test server startup timed out')), 10_000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Test server exited before readiness')); });
      child.stdout.on('data', data => { const match = String(data).match(/TEST_PORT=(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    return { contentPath, api: (path, { method = 'GET', body, role, headers = {} } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(role ? { 'x-test-role': role } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000),
    }) };
  }
  const { api, contentPath } = await launch({ DEMO_MODE: 'true' });
  const sample = { studentId: 'DEMO-1001', checkInCode: 'DEMO-CHECKIN-2026' };
  await t.test('demo lookup needs both fields and returns minimal assigned rooms', async () => {
    const publicResponse = await api('/api/wayfinding');
    assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
    const publicDoc = await publicResponse.json();
    assert.equal(publicDoc.lookup.mode, 'demo');
    assert.deepEqual(publicDoc.lookup.demoCredentials, [sample]);
    assert.ok(!JSON.stringify(publicDoc).includes('codeHash'));
    const response = await api('/api/wayfinding/lookup', { method: 'POST', body: sample });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(result.assignments, [{ round: 'Demo individual round', roomId: 'demo-a101' }, { round: 'Demo team round', roomId: 'demo-a102' }]);
    assert.ok(!JSON.stringify(result).match(/"(?:name|team|email|contact|students)"/));
    const incorrect = await api('/api/wayfinding/lookup', { method: 'POST', body: { ...sample, checkInCode: 'wrong' } });
    const unknown = await api('/api/wayfinding/lookup', { method: 'POST', body: { ...sample, studentId: 'UNKNOWN' } });
    assert.equal(incorrect.status, 403); assert.equal(unknown.status, 403);
    assert.equal(await incorrect.text(), await unknown.text());
    assert.equal((await api('/api/wayfinding/lookup', { method: 'POST', body: { studentId: sample.studentId } })).status, 422);
    assert.equal((await api('/api/wayfinding/lookup?studentId=DEMO-1001')).status, 405);
    for (const path of ['/api/wayfinding/roster', '/api/wayfinding/students']) assert.equal((await api(path)).status, 404);
  });
  await t.test('staff editor fails closed, validates content and rejects stale/direct-file edits', async () => {
    assert.equal((await api('/api/wayfinding/editor')).status, 401);
    assert.equal((await api('/api/wayfinding/editor', { role: 'denied' })).status, 403);
    const document = await (await api('/api/wayfinding/editor', { role: 'reader' })).json();
    assert.equal((await api('/api/wayfinding/editor', { method: 'PUT', body: document, role: 'reader' })).status, 403);
    const edited = structuredClone(document); edited.content.title = 'Synthetic edited title';
    const saved = await api('/api/wayfinding/editor', { method: 'PUT', body: edited, role: 'writer' });
    assert.equal(saved.status, 200); const latest = await saved.json(); assert.notEqual(latest.revision, document.revision);
    assert.equal((await api('/api/wayfinding/editor', { method: 'PUT', body: document, role: 'writer' })).status, 409);
    for (const mutate of [
      doc => { doc.content.students = [{ studentId: 'PRIVATE' }]; },
      doc => { doc.content.buildings[0].floors[0].image.url = 'javascript:alert(1)'; },
      doc => { doc.content.buildings[0].floors[0].image.demonstration = false; },
      doc => { doc.content.buildings[0].floors[0].rooms[0].route.entranceId = 'missing'; },
      doc => { doc.content.buildings[0].floors[0].rooms[0].hotspot.x = -5; },
    ]) {
      const invalid = structuredClone(latest); mutate(invalid);
      assert.equal((await api('/api/wayfinding/editor', { method: 'PUT', body: invalid, role: 'writer' })).status, 422);
    }
    assert.equal((await api('/api/wayfinding/editor', { method: 'PUT', body: latest, role: 'writer', headers: { origin: 'https://evil.invalid' } })).status, 403);
    const external = structuredClone(latest.content); external.title = 'Direct file edit';
    await writeFile(contentPath, JSON.stringify(external));
    assert.equal((await api('/api/wayfinding/editor', { method: 'PUT', body: latest, role: 'writer' })).status, 409);
    const reloaded = await (await api('/api/wayfinding')).json(); assert.equal(reloaded.content.title, 'Direct file edit');
    await writeFile(contentPath, '{invalid');
    const lastGood = await (await api('/api/wayfinding')).json(); assert.equal(lastGood.content.title, 'Direct file edit'); assert.ok(lastGood.contentWarning);
    assert.equal((await api('/api/wayfinding/editor', { role: 'writer' })).status, 503);
    await writeFile(contentPath, source);
  });
  await t.test('demo is off by default and for non-literal flag values', async () => {
    for (const extra of [{}, { DEMO_MODE: '1' }]) {
      const normal = await launch(extra);
      const publicDoc = await (await normal.api('/api/wayfinding')).json();
      assert.equal(publicDoc.lookup.mode, 'unavailable'); assert.equal(publicDoc.lookup.demoCredentials, undefined);
      assert.equal((await normal.api('/api/wayfinding/lookup', { method: 'POST', body: sample })).status, 403);
    }
  });
  await t.test('private import verifies hashed codes without exposing roster or accepting demo credentials', async () => {
    const studentId = 'SYNTHETIC-PRIVATE-9001'; const code = 'SYNTHETIC-RANDOM-CODE-ONLY'; const salt = randomBytes(16).toString('hex');
    const privatePath = join(privateDirectory, 'roster.json');
    const record = { studentId, codeSalt: salt, codeHash: createHash('sha256').update(`${salt}:${studentId}:${code}`).digest('hex'), assignments: [{ round: 'Synthetic imported test', roomId: 'demo-a101' }] };
    await writeFile(privatePath, JSON.stringify({ version: 1, source: 'contestdojo_export', generatedAt: '2026-10-14T00:00:00Z', students: [record] }), { mode: 0o600 });
    const normal = await launch({ PRIVATE_ROSTER_PATH: privatePath });
    const publicDoc = await (await normal.api('/api/wayfinding')).json();
    assert.equal(publicDoc.lookup.mode, 'private_import'); assert.match(publicDoc.lookup.sourceLabel, /not a live connection/);
    for (const value of [studentId, code, salt, record.codeHash]) assert.ok(!JSON.stringify(publicDoc).includes(value));
    const response = await normal.api('/api/wayfinding/lookup', { method: 'POST', body: { studentId, checkInCode: code } });
    assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(result.assignments, record.assignments); assert.ok(!JSON.stringify(result).includes(studentId));
    assert.equal((await normal.api('/api/wayfinding/lookup', { method: 'POST', body: sample })).status, 403);
  });
  await t.test('private configuration rejects repository files, directories and demo mixing', async () => {
    await assert.rejects(launch({ PRIVATE_ROSTER_PATH: join(root, 'content/wayfinding.json') }), /exited before readiness/);
    await assert.rejects(launch({ PRIVATE_ROSTER_PATH: privateDirectory }), /exited before readiness/);
    await assert.rejects(launch({ DEMO_MODE: 'true', PRIVATE_ROSTER_PATH: join(privateDirectory, 'unused.json') }), /exited before readiness/);
  });
  await t.test('lookup failures rate-limit with retry guidance, reject cross-origin and large bodies', async () => {
    const fresh = await launch({ DEMO_MODE: 'true' });
    assert.equal((await fresh.api('/api/wayfinding/lookup', { method: 'POST', body: sample, headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await fresh.api('/api/wayfinding/lookup', { method: 'POST', body: { ...sample, checkInCode: 'x'.repeat(5000) } })).status, 413);
    for (let i = 0; i < 5; i++) assert.equal((await fresh.api('/api/wayfinding/lookup', { method: 'POST', body: { ...sample, checkInCode: 'wrong' } })).status, 403);
    const limited = await fresh.api('/api/wayfinding/lookup', { method: 'POST', body: sample });
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '600');
  });
});

test('frontend search and request helpers preserve privacy and find buildings/floors/rooms', async () => {
  const source = await readFile(join(root, 'src/features/wayfinding/api.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  const helpers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const content = JSON.parse(await readFile(join(root, 'content/wayfinding.json'), 'utf8'));
  assert.equal(helpers.searchRooms(content, 'a101')[0].room.id, 'demo-a101');
  assert.equal(helpers.searchRooms(content, 'dwINelle')[0].building.id, 'dwinelle');
  assert.equal(helpers.searchRooms(content, 'ground')[0].floor.id, 'demo-ground');
  assert.equal(helpers.searchRooms(content, 'nothing matches').length, 0);
  assert.ok(helpers.searchRooms(content, '').length >= 3);
  const original = globalThis.fetch;
  try {
    let capture;
    globalThis.fetch = async (url, init) => { capture = { url, init }; return Response.json({ assignments: [] }); };
    await helpers.wayfindingRequest('/lookup', { method: 'POST', body: JSON.stringify({ studentId: 'SYNTHETIC', checkInCode: 'private' }) });
    assert.equal(capture.url, '/api/wayfinding/lookup'); assert.equal(capture.init.cache, 'no-store'); assert.equal(capture.init.credentials, 'same-origin');
    assert.ok(capture.init.signal instanceof AbortSignal);
    assert.equal(capture.init.headers.get('Content-Type'), 'application/json');
    let authenticated = false;
    await helpers.wayfindingRequest('/editor', { method: 'PUT', body: '{}' }, async (url, init) => {
      authenticated = true;
      assert.equal(url, '/api/wayfinding/editor');
      assert.equal(init.credentials, 'same-origin');
      return Response.json({ revision: 'synthetic' });
    });
    assert.equal(authenticated, true);
    globalThis.fetch = async () => new Response('private upstream response', { status: 500 });
    await assert.rejects(helpers.wayfindingRequest(''), error => !error.message.includes('private upstream'));
  } finally { globalThis.fetch = original; }
  for (const unsafe of ['javascript:alert(1)', 'data:image/svg+xml,bad', '//evil.test/map.svg', '/demo-maps/../private', 'https://user:pass@host.test/map.svg']) assert.equal(helpers.safeImageUrl(unsafe), false);

  const apiUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
  const validation = ts.transpileModule(await readFile(join(root, 'src/features/wayfinding/validation.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText.replace("'./api'", JSON.stringify(apiUrl));
  const { parseWayfinding } = await import(`data:text/javascript;base64,${Buffer.from(validation).toString('base64')}`);
  assert.deepEqual(parseWayfinding(content), content);
  assert.throws(() => parseWayfinding({ ...content, students: [] }), /unknown field/);
  const invalidAccess = structuredClone(content);
  invalidAccess.buildings[0].floors[0].rooms[0].accessibleRoute.entranceId = 'demo-main';
  assert.throws(() => parseWayfinding(invalidAccess), /accessible|step-free/i);
  const invalidImage = structuredClone(content);
  invalidImage.buildings[0].floors[0].image.demonstration = false;
  assert.throws(() => parseWayfinding(invalidImage), /demonstration/i);
});
