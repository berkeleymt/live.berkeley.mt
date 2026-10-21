import assert from 'node:assert/strict';
import { test, after, afterEach } from 'node:test';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement as h, act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
const directory = resolve(import.meta.dirname, '..');
const outDir = join(directory, 'node_modules/.cache/visitor-flows-test');
await build({ root: directory, configFile: false, publicDir: false, logLevel: 'error', build: { outDir, emptyOutDir: true, lib: { entry: join(directory, 'src/features/wayfinding/RoomFinder.tsx'), formats: ['es'], fileName: () => 'rooms.mjs' }, rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom', '@phosphor-icons/react'] } } });
process.env.NODE_ENV = 'test';
const dom = new JSDOM('<div id="root"></div>', { url: 'https://live.example.test/rooms', pretendToBeVisual: true });
const { window } = dom; const { document } = window;
const frames = [];
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: callback => { frames.push(callback); return frames.length; } });
const { createRoot } = await import('react-dom/client');
const { RoomLookup, RoomFinder } = await import(pathToFileURL(join(outDir, 'rooms.mjs')));
let root;
const realFetch = globalThis.fetch;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; frames.length = 0; globalThis.fetch = realFetch; window.history.replaceState(null, '', '/rooms'); });
after(() => dom.window.close());
const fixture = { revision: 'synthetic', lookup: { mode: 'unavailable', sourceLabel: 'Synthetic' }, contentWarning: null, content: { title: 'Synthetic rooms', intro: 'Synthetic intro', notice: '', helpText: 'Legacy help', travelUrl: 'https://example.test/', buildings: [{ id: 'building', name: 'Synthetic building', aliases: [], coordinates: [0, 0], status: 'unverified', verificationNote: 'Not verified', entrances: [{ id: 'entry', name: 'Synthetic entrance', coordinates: [0, 0], accessible: false, notes: '', steps: ['Find the synthetic entrance'] }], floors: [{ id: 'floor', name: 'Synthetic floor', image: null, rooms: [{ id: 'room', code: '101', name: 'Room 101', hotspot: null, route: { entranceId: 'entry', steps: ['Synthetic text direction'] }, accessibleRoute: null }] }] }] } };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
async function mount(Component, props = {}) { root = createRoot(document.getElementById('root')); await act(async () => root.render(h(Component, props))); }
async function flushFocus() { await act(async () => { frames.splice(0).forEach(callback => callback()); }); }
async function input(node, value) { assert.ok(node, document.body.textContent); await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new window.Event('input', { bubbles: true })); }); }

test('ID-only lookup promotes assignments, keeps private input out of navigation/storage and offers Change ID', async () => {
  const calls = [];
  globalThis.fetch = async (path, options = {}) => {
    calls.push([path, options]);
    if (path === '/api/wayfinding') return json(fixture);
    if (path === '/api/rooms/status') return json({ available: true, mode: 'demo', stale: false });
    assert.equal(path, '/api/rooms/lookup'); assert.equal(options.method, 'POST');
    return json({ demo: true, stale: true, checkedAt: 1, assignments: [{ scheduleId: 'round', round: 'Synthetic round', startTime: '09:00', endTime: '10:00', roomId: 'room', status: 'matched' }] });
  };
  await mount(RoomLookup);
  assert.equal(document.querySelector('.wf-search-section'), null, 'personal lookup must not mount public browsing');
  assert.equal(document.querySelector('.wf-route-planner'), null);
  await input(document.querySelector('input'), 'PRIVATE-SYNTHETIC-ID');
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await flushFocus();
  assert.equal(document.querySelector('form'), null);
  assert.match(document.querySelector('.wf-assignments').textContent, /Synthetic round/);
  assert.equal(document.querySelector('a.wf-button').getAttribute('href'), '/map?room=room');
  assert.equal(document.activeElement.tagName, 'H3');
  assert.doesNotMatch(document.body.textContent, /PRIVATE-SYNTHETIC-ID/);
  assert.equal(window.localStorage.length + window.sessionStorage.length, 0);
  assert.equal(calls.filter(([path]) => path.includes('PRIVATE')).length, 0);
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { studentId: 'PRIVATE-SYNTHETIC-ID' });
  await act(async () => button('Change ID').click()); await flushFocus();
  assert.equal(document.querySelector('input').value, '');
  assert.equal(document.activeElement, document.querySelector('input'));
  assert.equal(document.querySelector('.wf-assignments'), null);
});

test('selected map destination precedes collapsed browsing; Change room restores search without moving focus on rerender', async () => {
  window.history.replaceState(null, '', '/map?room=room');
  let calls = 0;
  globalThis.fetch = async path => { calls++; assert.equal(path, '/api/wayfinding'); return json(fixture); };
  await mount(RoomFinder, { embedded: true, mapOnly: true, composed: true });
  const detail = document.querySelector('.wf-detail'); const browse = document.querySelector('.wf-search-section');
  assert.ok(detail.compareDocumentPosition(browse) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(browse.open, false);
  assert.match(detail.textContent, /Synthetic text direction/);
  assert.doesNotMatch(document.body.textContent, /Legacy help/);
  await act(async () => button('Change room').click()); await flushFocus();
  assert.equal(browse.open, true);
  const search = document.querySelector('input[type="search"]'); assert.equal(document.activeElement, search);
  await act(async () => root.render(h(RoomFinder, { embedded: true, mapOnly: true, composed: true })));
  assert.equal(document.activeElement, search); assert.equal(calls, 1);
  await act(async () => document.querySelector('.wf-result').click()); await flushFocus();
  assert.equal(new URLSearchParams(window.location.search).get('room'), 'building');
  assert.equal(browse.open, false); assert.equal(document.activeElement.tagName, 'H2');
});

test('lookup network failure is actionable and retry does not mount unrelated tools', async () => {
  let attempts = 0;
  globalThis.fetch = async path => { attempts++; assert.equal(path, '/api/wayfinding'); return new Response('', { status: 503 }); };
  await mount(RoomLookup); assert.ok(document.querySelector('[role="alert"]'));
  await act(async () => document.querySelector('button').click()); assert.equal(attempts, 2);
  assert.equal(document.querySelector('form'), null);
});

test('a selected room has one map workflow; route mode retains origin and accessible-route controls', async () => {
  const routed = structuredClone(fixture);
  routed.content.graph = { demonstration: true, maps: [{ id: 'plan', label: 'Synthetic plan', floorId: 'floor', image: null }], nodes: [{ id: 'start', mapId: 'plan', roomId: null, label: 'Entrance', x: 0, y: 0 }, { id: 'finish', mapId: 'plan', roomId: 'room', label: 'Room 101', x: 50, y: 50 }], edges: [{ id: 'path', from: 'start', to: 'finish', kind: 'stairs', cost: 1, stepFree: false, closed: false, status: 'demo', verificationNote: '', instruction: 'Synthetic route step' }] };
  window.history.replaceState(null, '', '/map?room=room');
  globalThis.fetch = async () => json(routed);
  await mount(RoomFinder, { embedded: true, mapOnly: true, composed: true });
  assert.equal(document.querySelectorAll('.wf-route-planner').length, 0);
  assert.match(document.querySelector('.wf-detail').textContent, /Synthetic text direction/);
  await act(async () => button('Plan a route').click());
  assert.equal(document.querySelectorAll('.wf-route-planner').length, 1);
  assert.equal(document.querySelectorAll('.wf-floor-plan').length, 0);
  assert.match(document.querySelector('.wf-detail').textContent, /Synthetic route step/);
  assert.equal(document.querySelectorAll('.wf-route-planner select').length, 2);
  await act(async () => document.querySelector('.wf-route-planner input[type="checkbox"]').click());
  assert.match(document.querySelector('.wf-route-planner').textContent, /cannot show a step-free route/);
  await act(async () => button('Floor plan').click());
  assert.equal(document.querySelectorAll('.wf-route-planner').length, 0);
  assert.match(document.querySelector('.wf-detail').textContent, /Synthetic text direction/);
});
