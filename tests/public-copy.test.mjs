import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

// Pure component/helper tests: no browser, DOM interactions, effects or provider requests.
const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'node_modules/.cache/public-copy-test');
await build({ root, configFile: false, publicDir: false, logLevel: 'error', build: {
  outDir, emptyOutDir: true, lib: { entry: Object.fromEntries(Object.entries({
    text: 'src/features/site/text.ts', defaults: 'src/features/site/defaults.ts',
    editor: 'src/features/site/PublicCopyEditor.tsx', lookup: 'src/features/wayfinding/IdLookup.tsx',
    rooms: 'src/features/wayfinding/RoomFinder.tsx', route: 'src/features/wayfinding/RoutePlanner.tsx',
    legacy: 'src/features/wayfinding/StudentLookup.tsx', reports: 'src/features/lost-found/LostFoundPage.tsx',
    subscription: 'src/components/InfoCard.tsx', errors: 'src/features/wayfinding/publicErrors.ts',
    rosterApi: 'src/features/wayfinding/rosterApi.ts', wayfindingApi: 'src/features/wayfinding/api.ts',
    reportApi: 'src/features/lost-found/api.ts', subscriptionResult: 'src/features/site/subscription.ts',
    guide: 'src/features/site/GuidePage.tsx',
  }).map(([key, path]) => [key, join(root, path)])), formats: ['es'], fileName: (_, name) => `${name}.mjs` },
  rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom', 'react-markdown', 'remark-gfm', '@phosphor-icons/react'] },
} });
const load = name => import(pathToFileURL(join(outDir, `${name}.mjs`)));
const { SiteTextContext } = await load('text');
const { siteDefaults, siteText, mergeDefaultCopy } = await load('defaults');
const { PublicCopyEditor } = await load('editor');
const { IdLookup } = await load('lookup');
const { RoomFinder } = await load('rooms');
const { RoutePlanner } = await load('route');
const { StudentLookup } = await load('legacy');
const { LostFoundPage } = await load('reports');
const { EmailSubscribe } = await load('subscription');
const { publicWayfindingError } = await load('errors');
const { RosterApiError, rosterRequest } = await load('rosterApi');
const { WayfindingApiError, wayfindingRequest } = await load('wayfindingApi');
const { publicReportError, LostFoundRequestError } = await load('reportApi');
const { subscriptionResult } = await load('subscriptionResult');
const { GuideContent } = await load('guide');
const render = (element, copy = {}) => renderToStaticMarkup(h(SiteTextContext.Provider, { value: { ...siteDefaults, copy } }, element));

test('missing-default merge preserves intentional blanks, overrides and unknown valid keys without mutating input', () => {
  const original = { 'rooms.title': '', 'lookup.title': 'Authored rooms', 'custom.future': 'Keep me' };
  const merged = mergeDefaultCopy(original);
  assert.equal(merged['rooms.title'], ''); assert.equal(merged['lookup.title'], 'Authored rooms');
  assert.equal(merged['custom.future'], 'Keep me'); assert.equal(merged['route.title'], 'Plan a route');
  assert.deepEqual(original, { 'rooms.title': '', 'lookup.title': 'Authored rooms', 'custom.future': 'Keep me' });
  assert.deepEqual(mergeDefaultCopy(merged), merged);
  assert.equal(siteText({ ...siteDefaults, copy: original }, 'rooms.title'), '');
  assert.equal(siteText({ ...siteDefaults, copy: original }, 'route.title'), 'Plan a route');
});

test('copy editor explicitly merges missing defaults into draft, preserving values and showing all added fields', () => {
  const copy = { 'lookup.title': 'Local title', 'rooms.title': '', 'custom.future': 'keep' };
  let draft = copy;
  // Call the pure component's merge action directly; no UI-driven/browser workflow.
  const tree = PublicCopyEditor({ copy, onChange: value => { draft = value; } });
  const children = tree.props.children.flat();
  const action = children.find(child => child?.type === 'button');
  assert.equal(action.props.disabled, false); action.props.onClick();
  assert.equal(draft['lookup.title'], 'Local title'); assert.equal(draft['rooms.title'], '');
  assert.equal(draft['custom.future'], 'keep'); assert.equal(draft['route.title'], siteDefaults.copy['route.title']);
  const html = renderToStaticMarkup(h(PublicCopyEditor, { copy: draft, onChange() {} }));
  assert.match(html, /route.title/); assert.match(html, /Local title/); assert.match(html, /custom.future/);
  const full = PublicCopyEditor({ copy: draft, onChange() {} });
  assert.equal(full.props.children.find(child => child?.type === 'button').props.disabled, true);
  const large = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`custom.key${i}`, 'Keep']));
  const bounded = PublicCopyEditor({ copy: large, onChange() { assert.fail('Must not silently discard custom keys'); } });
  assert.equal(bounded.props.children.find(child => child?.type === 'button').props.disabled, true);
  assert.match(renderToStaticMarkup(bounded), /would exceed 500 keys/);
});

test('visitor components consume optional copy context; standalone rendering needs no poller', () => {
  const info = { mode: 'unavailable', sourceLabel: 'Legacy source' };
  const content = { buildings: [] };
  assert.match(render(h(IdLookup, { info, content, onSelectRoom() {} }), { 'lookup.title': 'My edited rooms', 'lookup.checking': 'Checking edited availability' }), /My edited rooms/);
  assert.match(render(h(RoomFinder), { 'rooms.title': 'Edited finder', 'rooms.loading': 'Edited loading' }), /Edited loading/);
  assert.match(render(h(RoutePlanner, { content }), { 'route.title': 'Edited planner', 'route.noGraph': '<b>Plain text only</b>' }), /&lt;b&gt;Plain text only&lt;\/b&gt;/);
  assert.match(render(h(StudentLookup, { info, content, onSelectRoom() {} }), { 'lookup.legacyUnavailable': 'Edited legacy availability' }), /Edited legacy availability/);
  assert.match(render(h(LostFoundPage), { 'lostFound.title': 'Edited reports' }), /Edited reports/);
  assert.match(render(h(EmailSubscribe), { 'subscription.label': 'Edited subscription' }), /Edited subscription/);
  assert.match(renderToStaticMarkup(h(RoutePlanner, { content })), /Step-by-step routes are unavailable/);
});

test('route selectors/notices, legacy privacy labels and guide preview use edited copy with plain substitutions', () => {
  const graph = { demonstration: true, nodes: [{ id: 'a', label: 'Authored A', roomId: 'room-a', mapId: 'm', x: 0, y: 0 }], maps: [{ id: 'm', label: 'Authored map', image: null }], edges: [] };
  const content = { buildings: [], graph };
  const html = render(h(RoutePlanner, { content, selectedRoom: 'room-a' }), {
    'route.selected': 'Visit {label}', 'route.from': 'Edited starting point', 'route.chooseBoth': 'Edited select both', 'route.demoNotice': 'Edited demo warning',
  });
  assert.match(html, /value="a" selected="">Authored A/); assert.match(html, /Edited starting point/); assert.match(html, /Edited select both/);
  assert.doesNotMatch(html, /Edited demo warning/, 'a fictional-route warning only applies after choosing an actual demo route');
  assert.match(render(h(RoutePlanner, { content, selectedRoom: 'missing' }), { 'route.unmapped': 'Edited missing node' }), /Edited missing node/);
  const legacy = render(h(StudentLookup, { info: { mode: 'demo', sourceLabel: 'PRIVATE_PROVIDER_PAYLOAD', demoCredentials: [] }, content, onSelectRoom() {} }), { 'lookup.studentId': 'Edited ID', 'lookup.legacyPrivacy': 'Edited private code guidance', 'lookup.privateCode': 'Edited code' });
  assert.match(legacy, /Edited private code guidance/); assert.match(legacy, /Edited ID/); assert.match(legacy, /Edited code/); assert.doesNotMatch(legacy, /PRIVATE_PROVIDER_PAYLOAD/);
  const guide = renderToStaticMarkup(h(GuideContent, { content: { ...siteDefaults, copy: { 'guide.search': 'Edited guide search', 'guide.contents': 'Edited contents' } }, preview: true }));
  assert.match(guide, /Edited guide search/); assert.match(guide, /aria-label="Edited contents"/);
  assert.doesNotMatch(render(h(RoomFinder), { 'rooms.title': '' }), /Find your room/);
  assert.match(render(h(LostFoundPage, { copy: { title: 'Explicit report override' } }), { 'lostFound.title': 'Context title' }), /Explicit report override/);
});

test('substitutions are one-pass plain text; unknown placeholders and blank values survive', () => {
  const content = { ...siteDefaults, copy: { 'route.overlay': 'Map {label}; {unknown}', 'lookup.directions': 'Go to {round}' } };
  assert.equal(siteText(content, 'route.overlay', { label: '{unknown} <img onerror=x>' }), 'Map {unknown} <img onerror=x>; {unknown}');
  assert.equal(siteText(content, 'lookup.directions', { round: '' }), 'Go to ');
});

test('public error classification ignores provider text and only selects bounded canonical keys', () => {
  for (const mode of ['rooms', 'lookup', 'legacy']) {
    assert.equal(publicWayfindingError(new Error('PRIVATE_PROVIDER_PAYLOAD'), mode), `${mode}.error`);
  }
  for (const [status, key] of [[404, 'lookup.notFound'], [422, 'lookup.notFound'], [429, 'lookup.rateLimited'], [503, 'lookup.unavailable'], [500, 'lookup.error']]) {
    assert.equal(publicWayfindingError(new RosterApiError(status, 'PRIVATE_PROVIDER_PAYLOAD'), 'lookup'), key);
    assert.ok(Object.hasOwn(siteDefaults.copy, key));
  }
  assert.equal(publicWayfindingError(new WayfindingApiError(403, 'PRIVATE_PROVIDER_PAYLOAD'), 'legacy'), 'legacy.notFound');
  for (const [status, key] of [[413, 'errorTooLarge'], [422, 'errorInvalid'], [429, 'errorRateLimited'], [500, 'submitUncertain']]) {
    assert.equal(publicReportError(new LostFoundRequestError('PRIVATE_PROVIDER_PAYLOAD', status)), key);
    assert.ok(Object.hasOwn(siteDefaults.copy, `lostFound.${key}`));
  }
  assert.equal(publicReportError(new Error('PRIVATE_PROVIDER_PAYLOAD')), 'submitUncertain');
});

test('public lookup transport refuses upstream bodies; subscription results use only recognized safe states', async () => {
  const upstream = async () => new Response(JSON.stringify({ message: 'PRIVATE_PROVIDER_PAYLOAD', error: 'SECRET' }), { status: 422 });
  await assert.rejects(rosterRequest('/rooms/lookup', { method: 'POST' }, upstream), error => {
    assert.equal(error.status, 422); assert.doesNotMatch(error.message, /PRIVATE_PROVIDER|SECRET/);
    return publicWayfindingError(error, 'lookup') === 'lookup.notFound';
  });
  await assert.rejects(wayfindingRequest('/lookup', { method: 'POST' }, upstream), error => {
    assert.equal(publicWayfindingError(error, 'legacy'), 'legacy.invalid'); return true;
  });
  for (const value of [null, '<html>PRIVATE_PROVIDER_PAYLOAD</html>', { ok: false, message: 'PRIVATE_PROVIDER_PAYLOAD' }, { ok: 'true', message: 'secret' }]) assert.deepEqual(subscriptionResult(200, value), { ok: false, key: 'subscription.failure' });
  assert.deepEqual(subscriptionResult(200, { ok: true, message: "You're already subscribed." }), { ok: true, key: 'subscription.alreadySubscribed' });
  assert.deepEqual(subscriptionResult(200, { ok: true, message: 'PRIVATE_PROVIDER_PAYLOAD' }), { ok: true, key: 'subscription.saved' });
  assert.deepEqual(subscriptionResult(200, { ok: true, emailDeliveryEnabled: false, message: "You're already subscribed." }), { ok: true, key: 'subscription.unavailable' });
  assert.deepEqual(subscriptionResult(200, { ok: true, emailDeliveryEnabled: false }), { ok: true, key: 'subscription.unavailable' });
  assert.deepEqual(subscriptionResult(200, { ok: true, emailDeliveryEnabled: true }), { ok: true, key: 'subscription.success' });
  assert.deepEqual(subscriptionResult(200, { ok: false, message: 'Invalid email address.' }), { ok: false, key: 'subscription.invalid' });
  assert.deepEqual(subscriptionResult(503, { ok: true, message: 'secret' }), { ok: false, key: 'subscription.failure' });
  assert.deepEqual(subscriptionResult(429, {}), { ok: false, key: 'subscription.rateLimited' });
});

test('migrated literal keys exist in canonical copy; optional helper cannot start a polling hook', async () => {
  for (const path of ['wayfinding/IdLookup.tsx', 'wayfinding/StudentLookup.tsx', 'wayfinding/RoutePlanner.tsx', 'wayfinding/RoomFinder.tsx', 'wayfinding/CampusMap.tsx']) {
    const source = await readFile(join(root, 'src/features', path), 'utf8');
    for (const [, key] of source.matchAll(/\bt\('([A-Za-z.]+)'/g)) assert.ok(Object.hasOwn(siteDefaults.copy, key), `${path}: ${key}`);
  }
  const helper = await readFile(join(root, 'src/features/site/text.ts'), 'utf8');
  assert.doesNotMatch(helper, /useSite\(|fetch\(|setInterval|setTimeout|useEffect/);
});
