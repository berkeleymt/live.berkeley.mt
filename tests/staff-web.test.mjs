import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement as h, act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { build } from 'vite';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { rosterRequest } from '../src/features/wayfinding/rosterApi.ts';

// Browserless DOM tests with mocked transport/GIS. Not real Google or device verification.
const rootDir = resolve(import.meta.dirname, '..');
const outDir = join(rootDir, 'node_modules/.cache/staff-web-test');
await build({ root: rootDir, configFile: false, publicDir: false, logLevel: 'error', build: {
  outDir, emptyOutDir: true, lib: { entry: { ...Object.fromEntries(['StaffLogin', 'StaffProvider', 'StaffPeople', 'StaffShell', 'context'].map(name => [name, join(rootDir, `src/features/staff/${name}.${name === 'context' ? 'ts' : 'tsx'}`)])), PublishingPanel: join(rootDir, 'src/components/PublishingPanel.tsx'), EventEditor: join(rootDir, 'src/components/EventEditor.tsx'), SiteEditor: join(rootDir, 'src/features/site/SiteEditor.tsx') }, formats: ['es'], fileName: (_, name) => `${name}.mjs` },
  rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom', '@phosphor-icons/react'] },
} });
// Vite's library build sets NODE_ENV; keep the DOM renderer aligned with React's test runtime.
process.env.NODE_ENV = 'test';
const { StaffLogin } = await import(pathToFileURL(join(outDir, 'StaffLogin.mjs')));
const { StaffProvider } = await import(pathToFileURL(join(outDir, 'StaffProvider.mjs')));
const { StaffPeople } = await import(pathToFileURL(join(outDir, 'StaffPeople.mjs')));
const { StaffShell } = await import(pathToFileURL(join(outDir, 'StaffShell.mjs')));
const { PublishingPanel } = await import(pathToFileURL(join(outDir, 'PublishingPanel.mjs')));
const { StaffContext, useStaff } = await import(pathToFileURL(join(outDir, 'context.mjs')));
const dom = new JSDOM('<!doctype html><div id="test-root"></div>', { url: 'https://live.example.test/admin', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
Object.assign(globalThis, { window, document, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { EventEditor } = await import(pathToFileURL(join(outDir, 'EventEditor.mjs')));
const { SiteEditor } = await import(pathToFileURL(join(outDir, 'SiteEditor.mjs')));
const { createRoot } = await import('react-dom/client');
let root;
let current;
const originalFetch = globalThis.fetch;
const admin = { id: 'admin@example.test', email: 'admin@example.test', name: 'admin@example.test', role: 'admin', demo: false, authSource: 'google', picture: null, capabilities: ['access:read', 'updates:read', 'content:write', 'schedule:write', 'rooms:write', 'found:read'] };
const boss = { ...admin, id: 'super@example.test', email: 'super@example.test', role: 'super', capabilities: [...admin.capabilities, 'people:write', 'settings:write'] };
const session = user => ({ user, csrfToken: user ? 'synthetic-csrf' : null, expiresAt: user ? Date.now() / 1000 + 86400 : null, demoMode: false, demoAccounts: [], passwordLoginEnabled: false, ownerLoginEnabled: false, authMode: 'google', googleClientId: 'synthetic-client' });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('restore acknowledgement stays beside its label inside the event editor', async () => {
  const style = document.createElement('style');
  style.textContent = await readFile(join(rootDir, 'src/today.css'), 'utf8') + await readFile(join(rootDir, 'src/features/staff/staff-editors.css'), 'utf8');
  document.head.append(style);
  try {
    await mount(h('div', { className: 'staff-ui' }, h('main', { className: 'staff-main' }, h('section', { className: 'event-editor' },
      h('label', { className: 'planner-confirmation' }, h('input', { type: 'checkbox' }), h('span', {}, 'Reviewed restore'))))));
    const label = document.querySelector('.planner-confirmation');
    assert.equal(window.getComputedStyle(label).display, 'flex');
    assert.equal(window.getComputedStyle(label).flexDirection, 'row');
  } finally { style.remove(); }
});
function Probe() { current = useStaff(); return null; }
async function mount(element, path = '/admin') {
  root = createRoot(document.getElementById('test-root'));
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [path] }, element)); });
}
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
const click = async node => { assert.ok(node, 'button exists'); await act(async () => node.click()); };
async function input(node, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
function mockContext(user, extra = {}) {
  return { session: session(user), status: 'ready', busy: false, connected: true, error: null, refresh: async () => {}, login: async () => false, googleLogin: async () => false, demoLogin: async () => false, logout: async () => true, can: capability => user?.capabilities.includes(capability) ?? false, request: async () => { throw new Error('Unexpected transport'); }, ...extra };
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; current = null; delete window.google;
  document.querySelector('#live-google-identity')?.remove();
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
});
after(() => dom.window.close());

test('FAQ then Guide publishing uses the latest bundle revision without losing either change', async () => {
  const event = JSON.parse(await readFile(join(rootDir, 'content/event.json'), 'utf8'));
  const site = JSON.parse(await readFile(join(rootDir, 'content/site.json'), 'utf8'));
  let revision = 'a'.repeat(64);
  const values = { '/api/content': event, '/api/site/editor': site };
  const writes = [];
  const request = async (path, options = {}) => {
    if (options.method === 'PUT') {
      const input = JSON.parse(options.body);
      if (input.revision !== revision) return new Response('Publication changed', { status: 409 });
      writes.push(path); values[path] = input.content;
      revision = String.fromCharCode(97 + writes.length).repeat(64);
    }
    return json({ revision, content: values[path], reloadError: null });
  };
  window.confirm = () => true;
  await mount(h(StaffContext.Provider, { value: mockContext(admin, { request }) }, h('div', null, h(EventEditor, { onPublish() {} }), h(SiteEditor))));
  const labelControl = text => [...document.querySelectorAll('label')].find(node => node.textContent === text)?.control;
  await input(labelControl('Event name'), 'Updated event');
  await act(async () => document.querySelector('.event-editor form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await click(button('Guide'));
  const intro = labelControl('Guide introduction');
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(intro, 'Updated guide'); intro.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await click(button('Save public content'));
  assert.deepEqual(writes, ['/api/content', '/api/site/editor']);
  assert.equal(values['/api/content'].title, 'Updated event');
  assert.equal(values['/api/site/editor'].guide.intro, 'Updated guide');
  await input(labelControl('Event name'), 'Updated again');
  await act(async () => document.querySelector('.event-editor form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(writes.length, 3, 'the reverse order also advances an unchanged document safely');
  assert.equal(values['/api/content'].title, 'Updated again');
});

test('Guide retains the draft, focuses recovery and refuses to overwrite concurrent content', async () => {
  const site = JSON.parse(await readFile(join(rootDir, 'content/site.json'), 'utf8'));
  let current = structuredClone(site), revision = 'a'.repeat(64), writes = 0;
  const request = async (_path, options = {}) => {
    if (options.method === 'PUT') { writes++; return new Response('Publication changed', { status: 409 }); }
    return json({ revision, content: current, reloadError: null });
  };
  await mount(h(StaffContext.Provider, { value: mockContext(admin, { request }) }, h(SiteEditor, { section: 'Guide' })));
  const intro = [...document.querySelectorAll('label')].find(node => node.textContent === 'Guide introduction').control;
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(intro, 'My local draft'); intro.dispatchEvent(new window.Event('input', { bubbles: true })); });
  current.guide.intro = 'A colleague’s published version'; revision = 'b'.repeat(64);
  await click(button('Save public content'));
  assert.equal(writes, 0);
  assert.equal(intro.value, 'My local draft');
  assert.equal(document.activeElement.classList.contains('editor-savebar'), true);
  assert.match(document.querySelector('.bmt-site-conflict').textContent, /A colleague’s published version/);
  assert.equal(button('Save public content').disabled, true);
  await click(button('Use published version'));
  assert.equal(intro.value, current.guide.intro);
  assert.equal(document.querySelector('[role=alert]'), null);
});

test('publication preflight never removes the final CAS guard', async () => {
  const site = JSON.parse(await readFile(join(rootDir, 'content/site.json'), 'utf8'));
  let writes = 0;
  const request = async (_path, options = {}) => {
    if (options.method === 'PUT') { writes++; return new Response('Another editor published during your save.', { status: 409 }); }
    return json({ revision: 'a'.repeat(64), content: site, reloadError: null });
  };
  await mount(h(StaffContext.Provider, { value: mockContext(admin, { request }) }, h(SiteEditor, { section: 'Guide' })));
  const intro = [...document.querySelectorAll('label')].find(node => node.textContent === 'Guide introduction').control;
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(intro, 'Retain me'); intro.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await click(button('Save public content'));
  assert.equal(writes, 1);
  assert.equal(intro.value, 'Retain me');
  assert.equal(button('Save public content').disabled, true);
  assert.match(document.querySelector('.editor-savebar').textContent, /Another editor published/);
});

test('remote publishing distinguishes loaded, remote and retained draft; failure keeps actions and CAS revision', async () => {
  const state = { mode: 'remote', revision: 'a'.repeat(40), remoteRevision: 'b'.repeat(40), head: 'b'.repeat(40), pendingRevision: 'c'.repeat(40), branch: 'main', healthy: false, dirty: false, locked: false, issues: [{ kind: 'pending', message: 'Draft retained; remote confirmation required.' }], history: [] };
  const writes = [];
  await mount(h(StaffContext.Provider, { value: mockContext(admin, { request: async () => json(state) }) }, h(PublishingPanel, { disabled: false, request: async (...args) => { writes.push(args); return false; } })));
  assert.match(document.body.textContent, /Loaded publicly/); assert.match(document.body.textContent, /Last observed remote/); assert.match(document.body.textContent, /Retained draft/);
  assert.ok(!button('View Super publication configuration'));
  assert.ok(button('Restore and publish selected bundle').disabled);
  await click(button('Retry retained publication'));
  assert.deepEqual(writes[0], ['POST', '/publishing/push', undefined, state.pendingRevision]);
  assert.match(document.querySelector('[role=alert]').textContent, /not confirmed/);
  assert.ok(button('Download retained draft JSON')); assert.ok(button('Archive draft without publishing'));
  assert.ok(!document.body.textContent.includes('Restore completed locally'));
});

test('Super configuration is explicit, remote sync uses loaded revision and archive requires confirmation', async () => {
  let state = { mode: 'remote', revision: 'a'.repeat(40), remoteRevision: 'b'.repeat(40), head: 'b'.repeat(40), pendingRevision: 'c'.repeat(40), branch: 'main', healthy: false, dirty: false, locked: false, issues: [], history: [] };
  const reads = []; const writes = [];
  const originalConfirm = window.confirm;
  try {
    await mount(h(StaffContext.Provider, { value: mockContext(boss, { request: async path => { reads.push(path); return json(path.endsWith('/publication') ? { configuration: 'Deployment-owned configuration.', protection: 'No force push.' } : state); } }) }, h(PublishingPanel, { disabled: false, request: async (...args) => { writes.push(args); if (args[1].endsWith('/archive')) state = { ...state, pendingRevision: null }; return true; } })));
    assert.deepEqual(reads, ['/api/publishing']);
    await click(button('View Super publication configuration')); assert.match(document.body.textContent, /Deployment-owned/);
    await click(button('Fetch and validate remote')); assert.deepEqual(writes.at(-1), ['POST', '/publishing/sync', undefined, state.revision]);
    window.confirm = () => false; await click(button('Archive draft without publishing')); assert.equal(writes.length, 1);
    window.confirm = () => true; await click(button('Archive draft without publishing')); assert.deepEqual(writes.at(-1), ['POST', '/publishing/archive', undefined, 'c'.repeat(40)]);
    assert.match(document.body.textContent, /not published/); assert.ok(!button('Retry retained publication'));
  } finally { window.confirm = originalConfirm; }
});

test('legacy local Git publication remains local-only and does not offer remote-first actions', async () => {
  const state = { mode: 'git', revision: 'a'.repeat(40), head: 'a'.repeat(40), branch: 'main', healthy: true, dirty: false, locked: false, issues: [], history: [] };
  await mount(h(StaffContext.Provider, { value: mockContext(admin, { request: async () => json(state) }) }, h(PublishingPanel, { disabled: false, request: async () => true })));
  assert.ok(button('Push current publication to origin & verify')); assert.ok(button('Restore selected revision locally'));
  assert.ok(!button('Fetch and validate remote')); assert.match(document.body.textContent, /Published locally/);
});

test('Google-only sign-in initializes FedCM and verifies credentials through Live with actionable denied state', async () => {
  let options;
  const requests = [];
  window.google = { accounts: { id: {
    initialize(value) { options = value; },
    renderButton(container) { const b = document.createElement('button'); b.textContent = 'Synthetic Google button'; container.append(b); },
  } } };
  globalThis.fetch = async (path, init) => { requests.push([path, init]); return path === '/api/staff/session' ? json(session(null)) : json({ error: 'That Google account is not on the staff list. Ask a Super admin to add you.' }, 403); };
  await mount(h(StaffProvider, null, h(Probe), h(StaffLogin)), '/staff/sign-in');
  assert.equal(options.client_id, 'synthetic-client');
  assert.equal(options.use_fedcm_for_prompt, true);
  assert.equal(options.use_fedcm_for_button, true);
  assert.equal(options.auto_select, false);
  assert.equal(document.querySelector('input[type=password]'), null);
  await act(async () => options.callback({ credential: 'synthetic-credential' }));
  const [path, init] = requests.at(-1);
  assert.equal(path, '/api/staff/google-login');
  assert.deepEqual(JSON.parse(init.body), { credential: 'synthetic-credential' });
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.headers.get('X-Staff-Request'), '1');
  assert.match(document.querySelector('[role=alert]').textContent, /not on the staff list/);
  assert.equal(window.localStorage.length, 0);
});

test('Google loading failure offers retry and missing configuration never offers a Google password fallback', async () => {
  await mount(h(StaffContext.Provider, { value: mockContext(null) }, h(StaffLogin)), '/staff/sign-in');
  const script = document.querySelector('#live-google-identity');
  assert.equal(script.src, 'https://accounts.google.com/gsi/client');
  await act(async () => script.dispatchEvent(new window.Event('error')));
  assert.match(document.querySelector('[role=alert]').textContent, /could not load/);
  await click(button('Retry Google sign-in'));
  assert.match(document.body.textContent, /Loading Google sign-in/);
  await act(async () => root.render(h(MemoryRouter, null, h(StaffContext.Provider, { value: mockContext(null, { session: { ...session(null), googleClientId: null } }) }, h(StaffLogin)))));
  assert.match(document.body.textContent, /not configured/);
  assert.equal(document.querySelector('input[type=password]'), null);
});

test('identity footer and flat role-filtered sidebar hide People from Admin and retain separate Lemon', async () => {
  await mount(h(StaffContext.Provider, { value: mockContext(admin) }, h(StaffShell, null, 'Workspace')));
  assert.equal(document.querySelector('a[href="/admin/people"]'), null);
  assert.match(document.querySelector('.staff-account').textContent, /admin@example.test/);
  assert.match(document.querySelector('.staff-account').textContent, /Connected to Live/);
  assert.equal(document.querySelector('.staff-avatar').textContent, 'A');
  assert.equal(document.querySelector('a[href="https://lemon.berkeley.mt"]').target, '_blank');
  assert.equal(document.querySelector('.staff-nav-disabled'), null);
  const account = document.querySelector('button[aria-controls="staff-account-details"]');
  assert.equal(account.getAttribute('aria-expanded'), 'false');
  await act(async () => account.click());
  assert.equal(account.getAttribute('aria-expanded'), 'true');
  assert.ok(document.querySelector('#staff-account-details.staff-account-open'));
  await act(async () => account.click());
  assert.equal(account.getAttribute('aria-expanded'), 'false');
});

test('open Super People page navigates away on live demotion; removal/expiry sends it to sign-in', async () => {
  let data = session(boss);
  globalThis.fetch = async path => { assert.equal(path, '/api/staff/session'); return json(data); };
  await mount(h(StaffProvider, null, h(Probe), h(Routes, null,
    h(Route, { path: '/admin', element: h(StaffShell) }, h(Route, { index: true, element: h('p', null, 'Today content') }), h(Route, { path: 'people', element: h('p', null, 'People content') })),
    h(Route, { path: '/staff/sign-in', element: h(StaffLogin) }))), '/admin/people');
  assert.match(document.body.textContent, /People content/);
  assert.ok(document.querySelector('a[href="/admin/people"]'));
  data = session(admin);
  await act(async () => current.refresh());
  assert.match(document.body.textContent, /Today content/);
  assert.match(document.body.textContent, /current role cannot open/);
  assert.equal(document.querySelector('a[href="/admin/people"]'), null);
  data = session(null);
  await act(async () => current.refresh());
  assert.match(document.body.textContent, /Sign in to help run the day/);
  assert.match(document.body.textContent, /session ended or your access was removed/);
});

test('transport outage retains valid identity, marks disconnected and recovers without credential retries', async () => {
  const requests = [];
  let offline = false;
  globalThis.fetch = async (path, init) => { requests.push([path, init]); if (offline) throw new TypeError('offline'); return json(session(boss)); };
  await mount(h(StaffProvider, null, h(Probe), h(StaffShell, null, 'Workspace')));
  assert.equal(requests[0][1].headers.get('X-Staff-Presence'), '1');
  offline = true;
  await act(async () => current.refresh());
  assert.equal(current.session.user.role, 'super');
  assert.match(document.body.textContent, /Connection interrupted/);
  offline = false;
  await act(async () => current.refresh());
  assert.match(document.body.textContent, /Connected to Live/);
  assert.ok(requests.every(([path]) => path === '/api/staff/session'));
});

test('roster sync keeps its provider timeout through staff transport without weakening cancellation or retrying', async () => {
  globalThis.fetch = async () => json(session(admin));
  await mount(h(StaffProvider, null, h(Probe)));
  const originalTimeout = AbortSignal.timeout;
  const deadlines = [];
  let calls = 0;
  AbortSignal.timeout = ms => {
    const controller = new AbortController();
    deadlines.push({ ms, controller });
    return controller.signal;
  };
  try {
    globalThis.fetch = async (path, init) => {
      calls++;
      assert.equal(path, '/api/roster/sync');
      assert.equal(init.headers.get('X-Staff-CSRF'), 'synthetic-csrf');
      // Model a provider response after the ordinary 12-second request budget.
      for (const { ms, controller } of deadlines) if (ms <= 12_000) controller.abort();
      init.signal.throwIfAborted();
      return json({ synced: true });
    };
    assert.deepEqual(await rosterRequest('/roster/sync', { method: 'POST', body: '{}' }, current.request), { synced: true });
    assert.equal(calls, 1);
    assert.ok(deadlines.every(({ ms }) => ms >= 70_000 && ms <= 90_000));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(rosterRequest('/roster/sync', { method: 'POST', body: '{}', signal: abort.signal }, current.request), { name: 'AbortError' });
    assert.equal(calls, 2, 'no automatic retry of an uncertain sync');
    globalThis.fetch = async () => json({});
    deadlines.length = 0;
    await current.request('/api/roster');
    assert.equal(deadlines.at(-1).ms, 12_000, 'ordinary reads stay bounded');
    await current.request('/api/content', { method: 'PUT', body: '{}' });
    assert.equal(deadlines.at(-1).ms, 90_000, 'publication keeps its existing budget');
    await current.request('/api/pages/editor', { method: 'PUT', body: '{}' });
    assert.equal(deadlines.at(-1).ms, 90_000, 'Markdown publication needs the same remote-confirmation budget');
    await current.request('/api/pages/preview', { method: 'POST', body: '{}' });
    assert.equal(deadlines.at(-1).ms, 12_000, 'inert previews do not push a Git bundle');
  } finally { AbortSignal.timeout = originalTimeout; }
});

test('People protects own/bootstrap rows, adds accounts, confirms removal and shows server errors', async () => {
  const people = [
    { email: boss.email, role: 'super', picture: null, fixed: false, online: true, addedBy: 'environment' },
    { email: 'bootstrap@example.test', role: 'super', picture: null, fixed: true, online: false, addedBy: 'environment' },
    { email: admin.email, role: 'admin', picture: null, fixed: false, online: false, addedBy: boss.email },
  ];
  const writes = [];
  const request = async (path, init = {}) => {
    if (!init.method) return json({ accounts: people });
    writes.push([path, init]);
    if (init.method === 'POST') return new Response(null, { status: 204 });
    return json({ error: 'Your own account and environment-configured Super accounts are protected.' }, 409);
  };
  await mount(h(StaffContext.Provider, { value: mockContext(boss, { request }) }, h(StaffPeople)), '/admin/people');
  assert.equal([...document.querySelectorAll('button')].filter(b => b.textContent === 'Remove account').length, 1);
  assert.match(document.body.textContent, /Environment-protected Super/);
  await input(document.querySelector('#people-email'), 'new@example.test');
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(JSON.parse(writes[0][1].body), { email: 'new@example.test', role: 'admin' });
  assert.match(document.body.textContent, /saved. Access updates/);
  await click(button('Remove account'));
  assert.equal(writes.length, 1, 'first press does not mutate');
  await click(button('Cancel'));
  assert.equal(writes.length, 1);
  await click(button('Remove account'));
  await click(button('Confirm removal'));
  assert.equal(writes[1][1].method, 'DELETE');
  assert.equal(writes[1][0], '/api/staff/people/admin%40example.test');
  assert.match(document.querySelector('[role=alert]').textContent, /protected/);
});
