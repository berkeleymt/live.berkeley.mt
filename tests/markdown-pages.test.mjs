import assert from 'node:assert/strict';
import { test, after, afterEach } from 'node:test';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createElement as h, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
const directory = resolve(import.meta.dirname, '..');
const outDir = join(directory, 'node_modules/.cache/markdown-pages-test');
await build({ root: directory, configFile: false, publicDir: false, logLevel: 'error', build: { outDir, emptyOutDir: true, lib: { entry: { editor: join(directory, 'src/features/pages/PageEditor.tsx'), renderer: join(directory, 'src/features/pages/PageRenderer.tsx'), model: join(directory, 'src/features/pages/model.ts'), staff: join(directory, 'src/features/staff/context.ts'), frame: join(directory, 'src/components/PublicFrame.tsx') }, formats: ['es'], fileName: (_, name) => `${name}.mjs` }, rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom', '@phosphor-icons/react', 'react-markdown', 'remark-gfm'] } } });
process.env.NODE_ENV = 'test';
const { PageEditor } = await import(pathToFileURL(join(outDir, 'editor.mjs')));
const { PageRenderer, AuthoredRoute } = await import(pathToFileURL(join(outDir, 'renderer.mjs')));
const { StaffContext } = await import(pathToFileURL(join(outDir, 'staff.mjs')));
const model = await import(pathToFileURL(join(outDir, 'model.mjs')));
const frame = await import(pathToFileURL(join(outDir, 'frame.mjs')));
const siteContent = JSON.parse(await readFile(join(directory, 'content/site.json'), 'utf8'));
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://live.example.test/admin/content', pretendToBeVisual: true });
const { window } = dom; const { document } = window;
Object.assign(globalThis, { window, document, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: callback => callback() });
const { createRoot } = await import('react-dom/client');
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; sessionStorage.clear(); });
after(() => dom.window.close());
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const page = (route = '/pages/example') => ({ meta: { title: 'Authored title', route, nav_label: 'Example', nav_order: 5, nav_visible: true, layout: 'prose' }, body: '\n## First\n\nText\n\n### Second\n', parts: [{ kind: 'markdown', source: '\n## First\n\nText\n\n### Second\n' }], headings: [{ id: 'section-0-2', title: 'First', part: 0 }, { id: 'section-0-6', title: 'Second', part: 0 }] });
const publication = { revision: 'a'.repeat(64), files: { 'one.md': model.newSource('one'), 'two.md': model.newSource('two') }, pages: { 'one.md': page('/pages/one'), 'two.md': page('/pages/two') }, reloadError: null };
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
const click = async node => { assert.ok(node); await act(async () => node.click()); };
async function input(node, value) { assert.ok(node); await act(async () => { Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true })); }); }
async function mount(request) { root = createRoot(document.getElementById('root')); await act(async () => root.render(h(StaffContext.Provider, { value: { request, can: () => true } }, h(PageEditor)))); }

test('maintained TOML editing preserves body, supports literal/multiline strings and validates draft/path boundaries', () => {
  const source = "+++\ntitle = '''A\nlong title'''\nroute = '/pages/test'\nnav_label = 'Test'\n+++\n\nBody **stays**.\n";
  assert.equal(model.splitSource(source).meta.title, 'A\nlong title');
  const updated = model.updateMeta(source, 'nav_visible', true);
  assert.equal(model.splitSource(updated).body, model.splitSource(source).body);
  assert.equal(model.splitSource(updated).meta.nav_visible, true);
  assert.deepEqual(model.parsePagesDocument(publication), publication);
  assert.throws(() => model.parsePagesDocument({ ...publication, pages: { 'one.md': {} } }), /Invalid page publication/);
  assert.throws(() => model.parsePagesDocument({ ...publication, pages: [] }), /Invalid page publication/);
  for (const path of ['/admin', '/api/pages', '/classic', '/directions', '/pages/a/b', '/pages/%2e%2e']) assert.equal(model.isPageRoute(path), false);
  for (const url of ['javascript:alert(1)', '//example.com', '/pages/../admin']) assert.equal(model.isPageLink(url), false);
  sessionStorage.setItem(model.draftKey, JSON.stringify({ ...publication, selected: 'one.md' })); assert.ok(model.readDraft(sessionStorage));
  sessionStorage.setItem(model.draftKey, JSON.stringify({ ...publication, files: { '../a.md': 'unsafe' }, selected: '../a.md' })); assert.equal(model.readDraft(sessionStorage), null);
  const p = page('/guide'); p.meta.nav_visible = false;
  assert.deepEqual(model.pageNavigation({ pages: { 'guide.md': p } }, [{ id: 'guide', href: '/guide', label: 'Old' }]), []);
});

test('dynamic routes distinguish loading, error, last-good, missing and absent-page fallback without example flash', () => {
  const render = (state, path = '/pages/example') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(Routes, null, h(Route, { element: h(Outlet, { context: { pages: { ...state, refresh() {} } } }) }, h(Route, { path: '*', element: h(AuthoredRoute, { fallback: path === '/' ? h('p', null, 'Legacy home') : undefined }) })))));
  assert.match(render({ document: null, loading: true }), /Loading published pages/);
  assert.doesNotMatch(render({ document: null, loading: true }, '/'), /Legacy home/);
  assert.match(render({ document: null, error: 'offline' }), /No example page/);
  assert.match(render({ document: { pages: {} } }), /Page not found/);
  assert.match(render({ document: { pages: {} } }, '/'), /Legacy home/);
  const html = render({ document: { pages: { 'example.md': page() } }, error: 'offline' });
  assert.match(html, /Showing last good pages/); assert.match(html, /Authored title/);
  const parsed = new JSDOM(html).window.document;
  for (const link of parsed.querySelectorAll('nav a')) assert.ok(parsed.querySelector(link.getAttribute('href')), 'contents links point to real headings');
});

test('preview renders safe prose and anchors but never mounts any operational shortcode', () => {
  const preview = page(); preview.parts.push({ kind: 'anchor', id: 'legacy-anchor' }, ...model.blockNames.map(name => ({ kind: 'block', name })));
  const html = renderToStaticMarkup(h(PageRenderer, { page: preview, preview: true }));
  assert.equal((html.match(/disabled in preview/g) ?? []).length, model.blockNames.length);
  assert.equal(model.blockNames.length, 8);
  assert.match(html, /id="preview-legacy-anchor"/); assert.match(html, /id="preview-section-0-2"/);
  assert.doesNotMatch(html, /<form|name="email"|Student ID|Check for rooms/);
});

test('button links are safe composed actions; short pages keep utilities after their content', () => {
  const short = page(); short.parts.unshift({ kind: 'button', label: 'Find my rooms', href: '/rooms' });
  const html = renderToStaticMarkup(h(PageRenderer, { page: short, preview: true }));
  assert.match(html, /class="public-action"/); assert.match(html, /href="\/rooms"/);
  assert.ok(html.indexOf('Text') < html.indexOf('Search &amp; print'));
  assert.doesNotMatch(html, /class="authored-contents"/);
  const long = page(); long.body = 'Long guide '.repeat(200); long.headings = [...long.headings, { id: 'section-0-8', title: 'Third', part: 0 }, { id: 'section-0-10', title: 'Fourth', part: 0 }];
  assert.match(renderToStaticMarkup(h(PageRenderer, { page: long, preview: true })), /href="#preview-section-0-2"/);
  const doc = structuredClone(publication); doc.pages['one.md'].parts.push({ kind: 'button', label: 'Bad', href: 'javascript:alert(1)' });
  assert.throws(() => model.parsePagesDocument(doc), /Invalid page publication/);
});

for (const status of [422, 503, 409, 401, 403]) test(`page editor retains source and revision after ${status}; switching and deletion are guarded`, async () => {
  const writes = [];
  await mount(async (path, options = {}) => { assert.equal(path, '/api/pages/editor'); if (options.method === 'PUT') { writes.push(JSON.parse(options.body)); return new Response('Synthetic rejection', { status }); } return json(publication); });
  const source = document.getElementById('page-source'); const changed = source.value + '\nRetain this unpublished change\n';
  await input(source, changed);
  assert.equal(JSON.parse(sessionStorage.getItem(model.draftKey)).files['one.md'], changed);
  window.confirm = () => false; await click(button('two.md')); assert.equal(document.getElementById('page-source').value, changed);
  await click(button('Delete page')); assert.ok(button('one.md'));
  await click(button('Publish all changes'));
  assert.equal(writes.length, 1); assert.equal(writes[0].revision, publication.revision);
  assert.equal(document.getElementById('page-source').value, changed);
  assert.equal(JSON.parse(sessionStorage.getItem(model.draftKey)).files['one.md'], changed);
  assert.match(document.body.textContent, /Your draft is retained/);
  if (status === 409) { assert.equal(button('Publish all changes').disabled, true); assert.match(document.body.textContent, /Publication changed/); }
});

test('page editor explicitly restores stale drafts and requires reconciliation before adopting a new CAS revision', async () => {
  const saved = { revision: 'old-base', files: { ...publication.files, 'one.md': publication.files['one.md'] + '\nSaved work\n' }, selected: 'one.md' };
  sessionStorage.setItem(model.draftKey, JSON.stringify(saved));
  const writes = [];
  await mount(async (_, options = {}) => { if (options.method === 'PUT') { const body = JSON.parse(options.body); writes.push(body); return json({ ...publication, ...body, revision: 'new-publication' }); } return json(publication); });
  await click(button('Restore draft')); assert.match(document.getElementById('page-source').value, /Saved work/);
  assert.equal(button('Publish all changes').disabled, true);
  await click(button('Load current publication')); window.confirm = () => true;
  await click(button('I reconciled my draft — use current revision'));
  await click(button('Publish all changes'));
  assert.equal(writes[0].revision, publication.revision); assert.equal(writes[0].files['one.md'], saved.files['one.md']);
  assert.equal(sessionStorage.getItem(model.draftKey), null); assert.match(document.body.textContent, /Pages published/);
});

test('initial load retry still offers the previously saved draft instead of deleting it', async () => {
  const saved = { revision: 'old-base', files: { ...publication.files, 'one.md': publication.files['one.md'] + '\nSaved before outage\n' }, selected: 'one.md' };
  sessionStorage.setItem(model.draftKey, JSON.stringify(saved));
  let attempt = 0;
  await mount(async () => ++attempt === 1 ? new Response('Offline', { status: 503 }) : json(publication));
  await click(button('Load current publication'));
  assert.ok(button('Restore draft'), 'retry must recover the tab backup');
  assert.deepEqual(JSON.parse(sessionStorage.getItem(model.draftKey)), saved);
  await click(button('Restore draft'));
  assert.match(document.getElementById('page-source').value, /Saved before outage/);
  assert.equal(button('Publish all changes').disabled, true, 'old revision requires reconciliation');
});

test('shell links entering a custom report route use document navigation, including query/fragment links', async () => {
  window.scrollTo = () => {};
  const report = page('/help/private-report'); report.parts = [{ kind: 'block', name: 'report_form' }];
  const context = { site: { content: siteContent, document: {} }, live: {}, pages: { document: { ...publication, pages: { 'report.md': report } } } };
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/'] }, h(frame.PublicLayout, { context }, h(frame.PublicLink, { href: '/help/private-report?from=home#form' }, 'Custom report')))));
  const links = [...document.querySelectorAll('a')].filter(a => a.getAttribute('href')?.startsWith('/help/private-report'));
  assert.equal(links.length, 2);
  for (const link of links) {
    let routerIntercepted;
    const observe = event => { routerIntercepted = event.defaultPrevented; event.preventDefault(); };
    document.addEventListener('click', observe, { once: true });
    await click(link);
    assert.equal(routerIntercepted, false, 'router must not create same-document Back entries into reports');
  }
});

test('a publication poll cannot remove an active report or discard its memory-only draft', async () => {
  window.scrollTo = () => {};
  const report = page('/help/private-report'); report.parts = [{ kind: 'block', name: 'report_form' }]; report.headings = [];
  const context = { site: { content: siteContent, document: {} }, live: {}, pages: { document: { ...publication, pages: { 'report.md': report } } } };
  const Frame = frame.PublicFrameContent;
  const tree = value => h(MemoryRouter, { initialEntries: ['/help/private-report'] }, h(Routes, null, h(Route, { element: h(Frame, { context: value }) }, h(Route, { path: '*', element: h(AuthoredRoute) }))));
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(tree(context)));
  await input(document.getElementById('lf-description'), 'PRIVATE-SYNTHETIC-REPORT');
  const before = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(before); assert.equal(before.defaultPrevented, true);
  const next = { ...context, pages: { document: { ...publication, revision: 'b'.repeat(64), pages: {} } } };
  await act(async () => root.render(tree(next)));
  assert.equal(document.getElementById('lf-description')?.value, 'PRIVATE-SYNTHETIC-REPORT');
  assert.equal(sessionStorage.length + window.localStorage.length, 0, 'private reports must remain memory-only');
  assert.match(document.body.textContent, /page changed/i);
  const after = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(after); assert.equal(after.defaultPrevented, true);
});

test('inserting prose before an operational block does not remount its form state', async () => {
  const report = page('/help/private-report'); report.parts = [{ kind: 'block', name: 'report_form' }]; report.headings = [];
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(PageRenderer, { page: report })));
  await input(document.getElementById('lf-description'), 'Retained form state');
  const field = document.getElementById('lf-description');
  await act(async () => root.render(h(PageRenderer, { page: { ...report, parts: [{ kind: 'markdown', source: 'New public introduction' }, ...report.parts] } })));
  assert.ok(document.getElementById('lf-description') === field, 'live blocks need semantic, not positional keys');
  assert.equal(document.getElementById('lf-description').value, 'Retained form state');
});

test('navigation discovers arbitrary authored pages, orders them and removes deleted/hidden custom entries', () => {
  const first = page('/pages/new-destination'); first.meta.nav_order = -10; first.meta.nav_label = 'New destination';
  const second = page('/help/another'); second.meta.nav_order = 20;
  const docs = { pages: { 'new.md': first, 'another.md': second } };
  assert.deepEqual(model.pageNavigation(docs, []).map(link => link.href), ['/pages/new-destination', '/help/another']);
  second.meta.nav_order = -20;
  assert.equal(model.pageNavigation(docs, [])[0].href, '/help/another');
  delete docs.pages['another.md']; first.meta.nav_visible = false;
  assert.deepEqual(model.pageNavigation(docs, []), []);
});

test('renderer drops raw HTML, scripts and unsafe destinations even on an untrusted client payload', () => {
  const unsafe = page(); unsafe.parts = [{ kind: 'markdown', source: '<script>alert(1)</script>\n\n[Bad](javascript:alert%281%29)\n\n![Bad](data:text/html,unsafe)\n\n**Safe**' }];
  const html = renderToStaticMarkup(h(PageRenderer, { page: unsafe, preview: true }));
  assert.doesNotMatch(html, /<script|javascript:|data:text/); assert.match(html, /<strong>Safe<\/strong>/);
});

test('source toolbar and debounced validated live preview keep unsaved source and operational blocks inert', async () => {
  const calls = [];
  await mount(async (path, options = {}) => {
    calls.push(path);
    if (path === '/api/pages/preview') { const preview = page(); preview.parts = [{ kind: 'markdown', source: 'Validated preview text' }, { kind: 'block', name: 'room_lookup' }]; assert.match(JSON.parse(options.body).source, /New draft text/); return json(preview); }
    return json(publication);
  });
  const source = document.getElementById('page-source');
  await input(source, source.value + '\nNew draft text\n');
  await click(button('Bold'));
  assert.match(document.getElementById('page-source').value, /\*\*/);
  await act(async () => new Promise(resolve => setTimeout(resolve, 900)));
  const frame = document.querySelector('iframe[title="Page preview"]');
  assert.ok(frame);
  await act(async () => frame.dispatchEvent(new window.Event('load')));
  assert.match(frame.contentDocument.body.textContent, /Validated preview text/);
  assert.equal(frame.contentDocument.querySelector('form'), null);
  assert.equal(frame.contentDocument.querySelector('.staff-ui'), null);
  assert.equal(frame.sandbox?.contains('allow-scripts') ?? false, false);
  assert.ok(sessionStorage.getItem(model.draftKey));
  assert.deepEqual(calls, ['/api/pages/editor', '/api/pages/preview']);
  window.confirm = () => true; await click(button('two.md'));
  assert.match(JSON.parse(sessionStorage.getItem(model.draftKey)).files['one.md'], /New draft text/);
});

test('publishing the previewed source preserves the preview document and clears dirty state', async () => {
  const rendered = page('/pages/one'); rendered.parts = [{ kind: 'markdown', source: 'Published preview stays visible' }];
  await mount(async (path, options = {}) => {
    if (path === '/api/pages/preview') return json(rendered);
    if (options.method === 'PUT') return json({ ...publication, revision: 'b'.repeat(64), files: JSON.parse(options.body).files, pages: { ...publication.pages, 'one.md': rendered } });
    return json(publication);
  });
  await input(document.getElementById('page-source'), publication.files['one.md'] + '\nPublished preview stays visible\n');
  await act(async () => new Promise(resolve => setTimeout(resolve, 900)));
  const frame = document.querySelector('iframe[title="Page preview"]');
  assert.ok(frame);
  await act(async () => frame.dispatchEvent(new window.Event('load')));
  assert.match(frame.contentDocument.body.textContent, /Published preview stays visible/);
  await click(button('Publish all changes'));
  assert.ok(document.querySelector('iframe[title="Page preview"]') === frame, 'publishing must retain the current preview and its scroll state');
  assert.match(frame.contentDocument.body.textContent, /Published preview stays visible/);
  assert.match(document.body.textContent, /Pages published/);
  assert.equal(button('Publish all changes').disabled, true);
  assert.equal(sessionStorage.getItem(model.draftKey), null);
});

test('secondary page creation and deletion edit only the draft until publication', async () => {
  const writes = [];
  await mount(async (path, options = {}) => { if (options.method === 'PUT') writes.push(path); return json(publication); });
  assert.ok(document.getElementById('new-page-name').closest('.page-recovery'));
  await input(document.getElementById('new-page-name'), 'visitor-info');
  await click(button('Create page'));
  assert.match(document.getElementById('page-source').value, /\/pages\/visitor-info/);
  assert.ok(JSON.parse(sessionStorage.getItem(model.draftKey)).files['visitor-info.md']);
  assert.ok(button('Delete page').closest('.page-recovery'));
  window.confirm = () => true;
  await click(button('Delete page'));
  assert.equal(sessionStorage.getItem(model.draftKey), null);
  assert.equal(button('Publish all changes').disabled, true);
  assert.deepEqual(writes, []);
});
