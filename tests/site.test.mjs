import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { MAX_COPY_KEYS, formatSiteText, isImageUrl, isLinkUrl, parseSiteConfig, parseSiteDocument, searchGuide } from '../src/features/site/config.ts';

// No browser automation and no production server. Compile site.rs in a minimal isolated host
// so this builder can verify its real routes without modifying shared main.rs/AppState.
const root = resolve(import.meta.dirname, '..');
const initial = await readFile(join(root, 'content/site.json'), 'utf8');
const fixture = JSON.parse(initial);
const deps = join(root, 'server/target/debug/deps');
const binary = join(root, 'server/target/debug/site-test-harness');
const unitBinary = join(root, 'server/target/debug/site-unit-tests');
const harness = join(root, 'src/features/site/server-test-harness.rs');
const libraryFiles = await readdir(deps);
const externs = [];
for (const name of ['axum', 'tokio', 'serde', 'serde_json', 'sha2', 'uuid', 'reqwest', 'base64', 'tower_http', 'argon2', 'jsonwebtoken', 'rusqlite']) {
  const candidates = await Promise.all(libraryFiles.filter(file => file.startsWith(`lib${name}-`) && file.endsWith('.rlib')).map(async file => ({ file, time: (await stat(join(deps, file))).mtimeMs })));
  candidates.sort((a, b) => b.time - a.time);
  assert.ok(candidates.length, `Run cargo build --locked --manifest-path server/Cargo.toml first; missing ${name}`);
  externs.push('--extern', `${name}=${join(deps, candidates[0].file)}`);
}
async function command(program, args) {
  const child = spawn(program, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `${program} failed:\n${output}`);
  return output;
}
await command('rustc', ['--edition=2021', harness, '-L', `dependency=${deps}`, ...externs, '-o', binary]);
await command('rustc', ['--edition=2021', '--test', harness, '-L', `dependency=${deps}`, ...externs, '-o', unitBinary]);

test('Rust site store regression tests pass against the real site.rs', async () => {
  const output = await command(unitBinary, []);
  assert.equal(output.match(/^test site::tests::.* \.\.\. ok$/gm)?.length, 8);
  assert.match(output, /0 failed/);
});

test('public fixture is valid, clearly labeled, and schema/URL checks match the API', () => {
  assert.deepEqual(parseSiteConfig(fixture), fixture);
  assert.equal(fixture.guide.notice, '', 'the shared event banner provides demo provenance without repeated warnings');
  assert.match(fixture.guide.intro, /Prepare for your visit/);
  assert.equal(parseSiteDocument({ revision: 'a'.repeat(64), content: fixture }).content.schemaVersion, 1);
  assert.throws(() => parseSiteDocument({ revision: 'unknown', content: fixture }), /revision/i);
  assert.throws(() => parseSiteConfig({ ...fixture, privateRoster: [] }), /Unknown field/);
  assert.throws(() => parseSiteConfig({ ...fixture, schemaVersion: 2 }), /schemaVersion/);
  const duplicate = structuredClone(fixture); duplicate.guide.sections.push(duplicate.guide.sections[0]);
  assert.throws(() => parseSiteConfig(duplicate), /unique/);
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,a', '//evil.test/p.png', '/media/../site.json', '/media/a.svg', '/media/a.html', 'https://staff:secret@example.invalid/a.png', 'https://example.invalid/\\a', '/demo-guide/a%2epng']) assert.equal(isImageUrl(url), false, url);
  for (const url of ['/bmt-logo.svg', '/media/test.png', '/demo-guide/demo.webp', 'https://example.invalid/image.png']) assert.equal(isImageUrl(url), true, url);
  for (const url of ['//evil.test', '/api/site', '/../../etc/passwd', 'mailto:someone@example.invalid']) assert.equal(isLinkUrl(url), false, url);
  for (const url of ['/#schedule', '#guide-arrival', '/guide', '/lost-and-found', 'https://taketransit.berkeley.mt/']) assert.equal(isLinkUrl(url), true, url);
});

test('copy count/string/document bounds stay finite, while old sparse documents and blank overrides remain valid', () => {
  const copy = Object.fromEntries(Array.from({ length: MAX_COPY_KEYS }, (_, index) => [`custom.key${index}`, 'value']));
  assert.equal(Object.keys(parseSiteConfig({ ...fixture, copy }).copy).length, 500);
  assert.throws(() => parseSiteConfig({ ...fixture, copy: { ...copy, overflow: '' } }), /500/);
  assert.throws(() => parseSiteConfig({ ...fixture, copy: { 'rooms.title': 'x'.repeat(4001) } }), /4000/);
  assert.throws(() => parseSiteConfig({ ...fixture, copy: Object.fromEntries(Object.keys(copy).map(key => [key, 'x'.repeat(2000)])) }), /512/);
  assert.deepEqual(parseSiteConfig({ ...fixture, copy: { 'rooms.title': '', 'custom.future': 'Preserve' } }).copy, { 'rooms.title': '', 'custom.future': 'Preserve' });
});

test('guide search matches multiple terms across title and content; templates are plain text', () => {
  const sections = fixture.guide.sections;
  assert.equal(searchGuide(sections, '').length, sections.length);
  assert.equal(searchGuide(sections, '   WI-FI   accessibility  ').length, 1);
  assert.equal(searchGuide(sections, 'never-a-match-123').length, 0);
  assert.equal(formatSiteText('Show {count} older updates for {eventTitle}. {unknown}', { count: 3, eventTitle: '<b>Demo</b>' }), 'Show 3 older updates for <b>Demo</b>. {unknown}');
});

test('standalone feature bundles and Markdown/guide render safely without a browser', async () => {
  const outDir = join(root, 'server/target/site-feature-test-build');
  await build({
    root, configFile: false, publicDir: false, logLevel: 'error',
    build: { outDir, emptyOutDir: true, lib: { entry: join(root, 'src/features/site/index.ts'), formats: ['es'], fileName: () => 'site.mjs' }, rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'react-markdown', 'remark-gfm', '@phosphor-icons/react'] } },
  });
  const { SafeSiteMarkdown, GuideContent, siteDefaults } = await import(pathToFileURL(join(outDir, 'site.mjs')));
  assert.deepEqual(siteDefaults, fixture);
  const html = renderToStaticMarkup(createElement(SafeSiteMarkdown, { children: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1)) ![bad](data:image/svg+xml,bad)\n\n[Guide](/guide) **Safe text**' }));
  assert.doesNotMatch(html, /<script|onerror=|javascript:|data:image/);
  assert.match(html, /href="\/guide"/);
  assert.match(html, /<strong>Safe text<\/strong>/);
  const guide = renderToStaticMarkup(createElement(GuideContent, { content: fixture }));
  assert.match(guide, /Prepare for your visit/);
  assert.match(guide, /aria-label="In this guide"/);
  assert.match(guide, /type="search"/);
  assert.match(guide, /Print guide/);
  assert.match(guide, /guide-before-you-arrive/);
});

async function launch(t, password = 'synthetic-site-tests-only') {
  const directory = await mkdtemp(join(tmpdir(), 'bmt-site-api-'));
  const path = join(directory, 'site.json'); const media = join(directory, 'media');
  await writeFile(path, initial);
  const child = spawn(binary, [], {
    cwd: directory,
    env: { PATH: process.env.PATH, SITE_CONTENT_PATH: path, SITE_MEDIA_DIR: media, ...(password ? { ADMIN_PASSWORD: password } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    // Only this test's ephemeral child is stopped; never an existing application process.
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  });
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Site test host startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Site test host exited ${code}`)); });
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/Site test listening on (127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://${match[1]}`); }
    });
  });
  const api = (path, { method = 'GET', body, bytes, type, auth = true, headers = {}, editorHeader = true } = {}) => fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(auth && password ? { Authorization: `Basic ${Buffer.from(`staff:${password}`).toString('base64')}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(type ? { 'Content-Type': type } : {}),
      ...(method !== 'GET' && editorHeader ? { 'X-Site-Editor': '1' } : {}), ...headers,
    },
    body: bytes ?? (body ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(15000),
  });
  return { api, path, media, origin };
}

async function waitFor(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail('Expected the test reload loop to observe a valid file edit.');
}

test('site HTTP contract: authentication, revision-safe publishing, direct edits and last-good fallback', async t => {
  const { api, path, origin } = await launch(t);
  let document;
  await t.test('public GET contains only public content and no caching', async () => {
    const response = await api('/api/site', { auth: false });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    document = await response.json();
    assert.deepEqual(Object.keys(document).sort(), ['content', 'revision']);
    assert.equal(document.revision.length, 64);
    assert.deepEqual(document.content, fixture);
  });
  await t.test('all editor and asset operations require server authentication', async () => {
    for (const endpoint of ['/api/site/editor', '/api/site/media']) assert.equal((await api(endpoint, { auth: false })).status, 401);
    assert.equal((await api('/api/site/editor', { method: 'PUT', body: document, auth: false })).status, 401);
    assert.equal((await api('/api/site/media', { method: 'POST', bytes: Buffer.from('bad'), type: 'image/png', auth: false })).status, 401);
    assert.equal((await api('/api/site/editor', { headers: { Authorization: `Basic ${Buffer.from('staff:incorrect').toString('base64')}` } })).status, 401);
  });
  await t.test('cross-origin and simple forged mutations fail closed', async () => {
    assert.equal((await api('/api/site/editor', { method: 'PUT', body: document, editorHeader: false })).status, 403);
    assert.equal((await api('/api/site/editor', { method: 'PUT', body: document, headers: { Origin: 'https://evil.example.invalid' } })).status, 403);
    assert.equal((await api('/api/site/editor', { method: 'PUT', body: document, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  });
  await t.test('save updates the editable file and public snapshot; stale save returns 409', async () => {
    const stale = structuredClone(document);
    document.content.branding.title = 'Synthetic API test title';
    document.content.navigation = [
      { id: 'schedule', label: 'Synthetic timetable', href: '/schedule' },
      { id: 'updates', label: 'Synthetic updates', href: '/updates' },
      { id: 'old-help', label: 'Saved help link', href: '/#help' },
    ];
    document.content.copy['hub.title'] = 'Synthetic visitor hub';
    document.content.copy['route.selected'] = 'Go to {label}';
    document.content.copy['lookup.privacy'] = 'Authored privacy notice';
    document.content.copy['rooms.title'] = '';
    document.content.copy['custom.future'] = 'Keep this valid unknown key';
    const response = await api('/api/site/editor', { method: 'PUT', body: document, headers: { Origin: origin } });
    assert.equal(response.status, 200, await response.clone().text());
    document = await response.json();
    assert.notEqual(document.revision, stale.revision);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).branding.title, 'Synthetic API test title');
    assert.equal((await (await api('/api/site', { auth: false })).json()).content.branding.title, 'Synthetic API test title');
    const published = (await (await api('/api/site', { auth: false })).json()).content;
    assert.deepEqual(published.navigation, document.content.navigation);
    assert.equal(published.copy['hub.title'], 'Synthetic visitor hub');
    assert.equal(published.copy['route.selected'], 'Go to {label}');
    assert.equal(published.copy['lookup.privacy'], 'Authored privacy notice');
    assert.equal(published.copy['rooms.title'], '');
    assert.equal(published.copy['custom.future'], 'Keep this valid unknown key');
    assert.equal((await api('/api/site/editor', { method: 'PUT', body: stale })).status, 409);
  });
  await t.test('invalid schema, unsafe image URLs and duplicate IDs do not modify disk', async () => {
    const before = await readFile(path, 'utf8');
    for (const mutate of [content => { content.schemaVersion = 2; }, content => { content.hero.imageUrl = 'javascript:alert(1)'; }, content => { content.guide.sections.push(content.guide.sections[0]); }, content => { content.privateRoster = []; }, content => { content.navigation[0].href = '/not-a-page'; }, content => { content.navigation[0].href = '/schedule?redirect=evil'; }, content => { content.copy = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`custom.key${index}`, 'value'])); }]) {
      const next = structuredClone(document); mutate(next.content);
      assert.equal((await api('/api/site/editor', { method: 'PUT', body: next })).status, 422);
    }
    assert.equal(await readFile(path, 'utf8'), before);
  });
  await t.test('older sparse copy documents remain sparse on save; server does not silently merge defaults', async () => {
    const next = structuredClone(document);
    next.content.copy = { 'rooms.title': '', 'custom.future': 'Keep me' };
    const response = await api('/api/site/editor', { method: 'PUT', body: next });
    assert.equal(response.status, 200);
    document = await response.json();
    assert.deepEqual(document.content.copy, next.content.copy);
    assert.deepEqual((await (await api('/api/site', { auth: false })).json()).content.copy, next.content.copy);
  });
  await t.test('valid direct file edits reload; invalid files preserve the last good snapshot', async () => {
    const next = structuredClone(document.content); next.guide.title = 'Direct file edit';
    await writeFile(path, JSON.stringify(next));
    assert.equal((await api('/api/site/editor', { method: 'PUT', body: document })).status, 409);
    await waitFor(async () => (await (await api('/api/site')).json()).content.guide.title === 'Direct file edit');
    const editor = await (await api('/api/site/editor')).json();
    assert.equal(editor.reloadError, null); document = { revision: editor.revision, content: editor.content };
    await writeFile(path, '{broken');
    const broken = await (await api('/api/site/editor')).json();
    assert.match(broken.reloadError, /Invalid site JSON/);
    assert.equal(broken.content.guide.title, 'Direct file edit');
    assert.equal((await (await api('/api/site', { auth: false })).json()).revision, document.revision);
    assert.equal((await api('/api/site/editor', { method: 'PUT', body: document })).status, 409);
    await writeFile(path, JSON.stringify(document.content));
    assert.equal((await (await api('/api/site/editor')).json()).reloadError, null);
  });
});

test('raster asset uploads are bounded, randomized, public, and non-sniffable', async t => {
  const { api, media } = await launch(t);
  // Real 1x1 PNG test image; no EXIF/personal data.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX2sAAAAASUVORK5CYII=', 'base64');
  assert.equal((await api('/api/site/media', { method: 'POST', bytes: Buffer.from('<svg></svg>'), type: 'image/svg+xml' })).status, 415);
  assert.equal((await api('/api/site/media', { method: 'POST', bytes: Buffer.from('<html>bad</html>'), type: 'image/png' })).status, 415);
  assert.equal((await api('/api/site/media', { method: 'POST', bytes: png, type: 'image/jpeg' })).status, 415);
  assert.equal((await api('/api/site/media', { method: 'POST', bytes: Buffer.alloc(5 * 1024 * 1024 + 1), type: 'image/png' })).status, 413);
  const firstResponse = await api('/api/site/media', { method: 'POST', bytes: png, type: 'image/png' });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  const second = await (await api('/api/site/media', { method: 'POST', bytes: png, type: 'image/png' })).json();
  assert.match(first.url, /^\/media\/[a-f0-9-]{36}\.png$/);
  assert.notEqual(first.url, second.url);
  assert.equal(first.bytes, png.length);
  const publicResponse = await api(first.url, { auth: false });
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get('content-type'), 'image/png');
  assert.equal(publicResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.match(publicResponse.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await publicResponse.arrayBuffer()), png);
  const library = await (await api('/api/site/media')).json();
  assert.equal(library.assets.length, 2); assert.equal(library.truncated, false);
  assert.equal((await readdir(media)).length, 2);
  assert.equal((await api('/media/', { auth: false })).status, 404);
});

test('editor reads/writes and media fail closed without configured authentication', async t => {
  const { api } = await launch(t, null);
  assert.equal((await api('/api/site', { auth: false })).status, 200);
  const document = await (await api('/api/site')).json();
  for (const endpoint of ['/api/site/editor', '/api/site/media']) assert.equal((await api(endpoint)).status, 401);
  assert.equal((await api('/api/site/editor', { method: 'PUT', body: document })).status, 401);
  assert.equal((await api('/api/site/media', { method: 'POST', bytes: Buffer.from('bad'), type: 'image/png' })).status, 401);
});
