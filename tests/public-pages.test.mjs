import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { scheduleState } from '../src/data/schedule.ts';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { build } from 'vite';
import { publicPaths } from '../src/data/publicNavigation.ts';

// Static React rendering, not browser or interaction verification. No effects/network requests run.
const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'node_modules/.cache/public-pages-test');
await build({
  root, configFile: false, publicDir: false, logLevel: 'error',
  build: { outDir, emptyOutDir: true, lib: {
    entry: { classic: join(root, 'src/ClassicApp.tsx'), pages: join(root, 'src/App.tsx'), frame: join(root, 'src/components/PublicFrame.tsx'), routes: join(root, 'src/SiteRoutes.tsx'), rooms: join(root, 'src/features/wayfinding/RoomFinder.tsx'), reports: join(root, 'src/features/lost-found/LostFoundPage.tsx'), delivery: join(root, 'src/features/lost-found/LostFoundDelivery.tsx'), staffContext: join(root, 'src/features/staff/context.ts') },
    formats: ['es'], fileName: (_, name) => `${name}.mjs`,
  }, rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom', 'react-markdown', 'remark-gfm', '@phosphor-icons/react'] } },
});
const pages = await import(pathToFileURL(join(outDir, 'pages.mjs')));
const { PublicLayout } = await import(pathToFileURL(join(outDir, 'frame.mjs')));
const { SiteRoutes } = await import(pathToFileURL(join(outDir, 'routes.mjs')));
const { RoomFinder } = await import(pathToFileURL(join(outDir, 'rooms.mjs')));
const { LostFoundPage } = await import(pathToFileURL(join(outDir, 'reports.mjs')));
const { LostFoundDelivery, LostFoundMailSettings } = await import(pathToFileURL(join(outDir, 'delivery.mjs')));
const { StaffContext } = await import(pathToFileURL(join(outDir, 'staffContext.mjs')));

test('Classic uses published event identity and calendar-aware state, not the old April event', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  try {
    const { HeaderWidget, NowHero } = await import(pathToFileURL(join(outDir, 'classic.mjs')));
    const event = { title: 'Published tournament', date: '2026-11-14', timeZone: 'America/Los_Angeles', subtitle: '', notice: '', eventUrl: '', travelUrl: '', faqs: [] };
    const events = [{ id: 'round', title: 'Individual round', startTime: '09:00', endTime: '10:00', category: 'individual', location: 'Room A' }];
    const header = renderToStaticMarkup(h(HeaderWidget, { event, stale: false }));
    assert.match(header, /Published tournament/);
    assert.match(header, /Saturday, November 14, 2026/);
    assert.doesNotMatch(header, /April|BmMT/);
    for (const [now, expected] of [
      ['2026-10-21T17:30:00Z', /See you at Berkeley/],
      ['2026-11-14T17:30:00Z', /Happening Now/],
      ['2026-11-15T17:30:00Z', /Thanks for being part of Published tournament/],
    ]) {
      const clock = scheduleState(events, [], event, Date.parse(now));
      const html = renderToStaticMarkup(h(NowHero, { events, delays: [], event, phase: clock.phase, nowMins: clock.minutes }));
      assert.match(html, expected);
      assert.doesNotMatch(html, /April|BmMT|All done for today/);
    }
    const empty = renderToStaticMarkup(h(NowHero, { events: [], delays: [], event, phase: 'unpublished' }));
    assert.match(empty, /Schedule coming soon/);
  } finally {
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
  }
});
const content = JSON.parse(await readFile(join(root, 'content/site.json'), 'utf8'));
const event = JSON.parse(await readFile(join(root, 'content/event.json'), 'utf8'));
const data = {
  event, schedule: [{ id: 'synthetic-event', title: 'Synthetic schedule item', startTime: '09:00', endTime: '10:00', location: 'Test room', category: 'general', description: 'Test details' }],
  delays: [{ id: 'd', eventId: 'synthetic-event', newTime: '09:15', newEndTime: '10:15', reason: 'Synthetic delay reason', timestamp: '2026-11-14T16:00:00Z' }],
  announcements: [{ id: 'a', title: 'Synthetic urgent update', body: 'Published **urgent** text.', priority: 'urgent', timestamp: '2026-11-14T16:00:00Z' }],
  venues: [], info: [], lastUpdated: '2026-11-14T16:00:00Z',
};
const context = {
  site: { content, document: { content, revision: 'a'.repeat(64) }, error: null, loading: false, stale: false, refresh() {} },
  live: { data, error: null, stale: false, lastReceived: Date.parse(data.lastUpdated), refresh() {} },
};
const elements = {
  '/': h(pages.default), '/schedule': h(pages.SchedulePage), '/updates': h(pages.UpdatesPage), '/map': h(pages.MapPage),
  '/guide': h(pages.PublicGuidePage), '/faq': h(pages.FaqPage), '/help': h(pages.HelpPage),
  '/rooms': h(RoomFinder, { embedded: true }), '/lost-found': h(LostFoundPage, { helpHref: '/help' }),
};
function render(path, value = context) {
  return renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(Routes, null,
    h(Route, { element: h(PublicLayout, { context: value }, h(Outlet, { context: value })) },
      ...Object.entries(elements).map(([path, element]) => h(Route, { key: path, path, element }))))));
}

test('receipt form retains email and phone, explains provider privacy and honest confirmation', () => {
  const html = render('/lost-found');
  assert.match(html, /type="email" required/);
  assert.match(html, /type="tel"/);
  assert.match(html, /email service receives your email address and receipt number/);
  assert.match(html, /status separately from the saved report/);
  assert.doesNotMatch(html, /Private staff notes|fixture@example.invalid/);
});

test('static delivery states preserve uncertainty, read-only access and manual follow-up without claiming delivery', () => {
  const report = { id: 'synthetic', synthetic: false, delivery: { state: 'uncertain', revision: 2, attempts: 1, nextAttempt: null, updatedAt: '2026-11-14T18:00:00Z', diagnostic: 'transport_unknown', providerId: null, history: [] } };
  const renderDelivery = (canWrite, changes = {}) => renderToStaticMarkup(h(StaffContext.Provider, { value: { can: () => canWrite, request: async () => { throw new Error('Static tests must not request'); } } }, h(LostFoundDelivery, { report: { ...report, ...changes }, canWrite, configured: false, disabled: false, onSaved() {}, onEditing() {} })));
  const readonly = renderDelivery(false);
  assert.match(readonly, /Acceptance uncertain/); assert.match(readonly, /Check Postmark activity/);
  assert.doesNotMatch(readonly, /<form/);
  const writable = renderDelivery(true);
  assert.match(writable, /Record manual follow-up/); assert.match(writable, /value="retry" disabled/);
  const accepted = renderDelivery(true, { delivery: { ...report.delivery, state: 'accepted', diagnostic: 'provider_accepted' } });
  assert.match(accepted, /Provider accepted — inbox delivery unverified/); assert.doesNotMatch(accepted, /<form/);
  assert.match(renderDelivery(true, { delivery: null }), /Not requested by this legacy report/);
  assert.equal(renderToStaticMarkup(h(StaffContext.Provider, { value: { can: () => false } }, h(LostFoundMailSettings))), '');
});

test('every dedicated destination has one main, one page heading, a skip target and active shared navigation', () => {
  for (const path of publicPaths) {
    const html = render(path);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, path);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, path);
    assert.match(html, /href="#main"/);
    assert.match(html, /<main[^>]*id="main"/);
    assert.match(html, new RegExp(`<a[^>]*aria-current="page"[^>]*href="${path}"|<a[^>]*href="${path}"[^>]*aria-current="page"`), path);
    for (const target of publicPaths) assert.ok(html.includes(`href="${target}"`), `${path} links to ${target}`);
    if (path !== '/' && path !== '/schedule') assert.doesNotMatch(html, /Synthetic schedule item/);
  }
});

test('actual route registry mounts all public destinations rather than the old long page or a missing route', () => {
  for (const path of publicPaths) {
    const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(SiteRoutes)));
    assert.doesNotMatch(html, /Page not found/);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, path);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, path);
  }
});

test('real page renderers retain schedule delays, urgent updates, subscriptions, guide search and print', () => {
  const schedule = render('/schedule');
  assert.match(schedule, /Synthetic schedule item/);
  assert.match(schedule, /Synthetic delay reason/);
  assert.match(schedule, /9:15/);
  assert.match(schedule, /<s>9:00/);
  assert.match(schedule, /Event details/);
  const updates = render('/updates');
  assert.match(updates, /Synthetic urgent update/);
  assert.match(updates, /type="email"/);
  assert.match(updates, /Published <strong>urgent<\/strong> text/);
  const guide = render('/guide');
  assert.match(guide, /type="search"/);
  assert.match(guide, /Print guide/);
  assert.match(guide, /guide-before-you-arrive/);
  assert.match(render('/faq'), /type="search"/);
});

test('Home now/next is derived from the event timezone and delayed live schedule', () => {
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-11-14T17:30:00Z');
  try {
    const live = { ...context.live, data: { ...data, event: { ...event, date: '2026-11-14' }, schedule: [...data.schedule, { ...data.schedule[0], id: 'next', title: 'Synthetic next item', startTime: '10:30', endTime: '11:30' }] } };
    const html = render('/', { ...context, live });
    assert.match(html, /Scheduled now/);
    assert.match(html, /Synthetic schedule item/);
    assert.match(html, /Synthetic next item/);
    assert.match(html, /Synthetic delay reason/);
    assert.match(html, /Synthetic urgent update/);
  } finally { Date.now = realNow; }
});

test('first-load failure does not masquerade as an empty schedule or publish bundled guide facts; stale keeps last good', () => {
  const unavailable = { site: { ...context.site, document: null, error: 'offline' }, live: { ...context.live, data: null, error: 'offline' } };
  const schedule = render('/schedule', unavailable);
  assert.match(schedule, /could not load/);
  assert.doesNotMatch(schedule, /Synthetic schedule item|schedule will appear here/);
  assert.doesNotMatch(render('/guide', unavailable), /Demo guide|guide-before-you-arrive/);
  const stale = render('/schedule', { ...context, live: { ...context.live, stale: true, error: 'offline' } });
  assert.match(stale, /last received information/);
  assert.match(stale, /Last received:/);
  assert.match(stale, /Synthetic schedule item/);
  assert.match(stale, /Try again/);
});

test('shared public frame supplies edited copy to nested room/report renderers and existing shell, schedule, updates and guide', () => {
  const edited = structuredClone(content);
  edited.copy = { 'a11y.navigation': 'Edited navigation', 'rooms.loading': 'Edited room status', 'lostFound.title': 'Edited report page', 'subscription.label': 'Edited mailing list', 'guide.search': 'Edited search label', 'schedule.details': 'Edited event details', 'hub.title': '' };
  const value = { ...context, site: { ...context.site, content: edited } };
  assert.match(render('/rooms', value), /Edited room status/);
  assert.match(render('/rooms', value), /aria-label="Edited navigation"/);
  assert.match(render('/lost-found', value), /<h1 id="lf-heading">Edited report page<\/h1>/);
  assert.match(render('/updates', value), /Edited mailing list/);
  assert.match(render('/guide', value), /Edited search label/);
  assert.match(render('/schedule', value), /Edited event details/);
  assert.equal(edited.copy['hub.title'], '');
  assert.equal(Object.hasOwn(edited.copy, 'route.title'), false); // render-time defaults do not migrate installed content.
});

test('authored labels and older hash links are normalized in the shared shell without changing saved content', () => {
  const edited = structuredClone(content);
  edited.navigation = [{ id: 'schedule', label: 'Edited timetable', href: '/#schedule' }];
  const html = render('/schedule', { ...context, site: { ...context.site, content: edited } });
  assert.match(html, /<h1>Edited timetable<\/h1>/);
  assert.match(html, /href="\/schedule"[^>]*>Edited timetable/);
  assert.doesNotMatch(html, /href="\/#schedule"/);
  assert.equal(edited.navigation[0].href, '/#schedule');
});
