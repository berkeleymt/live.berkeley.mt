import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicDestination, publicNavigation, publicPaths } from '../src/data/publicNavigation.ts';
import { isLinkUrl, parseSiteConfig } from '../src/features/site/config.ts';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('../content/site.json', import.meta.url), 'utf8'));

test('public content accepts dedicated routes and legacy anchors, rejecting unsafe or unimplemented destinations', () => {
  for (const href of ['/', '/schedule', '/updates', '/map', '/rooms', '/guide', '/faq', '/help', '/lost-found', '/classic', '/#schedule', '/guide#guide-before-you-arrive']) {
    assert.equal(isLinkUrl(href), true, href);
    const content = structuredClone(fixture);
    content.navigation = [{ id: 'test', label: 'Edited destination', href }];
    assert.equal(parseSiteConfig(content).navigation[0].href, href);
  }
  for (const href of ['/not-a-page', '//evil.invalid', '/schedule/../admin', '/schedule#one#two', '/schedule?redirect=evil', 'javascript:alert(1)']) {
    assert.equal(isLinkUrl(href), false, href);
  }
});

test('seed navigation covers each public destination once and older labels survive migration', () => {
  assert.deepEqual(new Set(fixture.navigation.map(link => link.href)), new Set(publicPaths));
  const old = [{ id: 'schedule', label: 'Our timetable', href: '/#schedule' }, { id: 'map', label: 'Room lookup', href: '/rooms' }];
  const migrated = publicNavigation(old, fixture.navigation);
  assert.equal(migrated[0].label, 'Our timetable');
  assert.equal(migrated[0].href, '/schedule');
  assert.deepEqual(new Set(migrated.map(link => link.href)), new Set(publicPaths));
  assert.equal(new Set(migrated.map(link => link.id)).size, migrated.length);
  assert.equal(parseSiteConfig({ ...fixture, navigation: migrated }).schemaVersion, 1);
  assert.deepEqual(old[0], { id: 'schedule', label: 'Our timetable', href: '/#schedule' });
});

test('old homepage destinations resolve to the new dedicated pages', () => {
  for (const [anchor, path] of Object.entries({ today: '/', schedule: '/schedule', updates: '/updates', map: '/map', help: '/help', faq: '/faq' })) {
    assert.equal(publicDestination(`/#${anchor}`), path);
    assert.equal(publicDestination(`#${anchor}`), path);
  }
});

test('custom anchors, existing routes and external destinations are preserved', () => {
  for (const href of ['/classic', '/rooms', '/guide#guide-access', '/#custom-section', '#custom-section', 'https://berkeley.mt/#schedule', '/?preview=1#schedule', '/#toString']) {
    assert.equal(publicDestination(href), href);
  }
});
