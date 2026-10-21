import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'node_modules/.cache/floor-map-test');
await build({ root, configFile: false, publicDir: false, logLevel: 'error', plugins: [{
  name: 'map-double',
  enforce: 'pre',
  resolveId(id) { if (id === 'react-leaflet') return '\0map-double'; },
  load(id) { if (id !== '\0map-double') return; return `
    import { createElement as h } from 'react';
    export const useMap = () => globalThis.floorTestMap;
    export const useMapEvents = useMap;
    export const MapContainer = ({ children }) => h('div', {}, children);
    export const Marker = MapContainer;
    export const Tooltip = MapContainer;
    export const Polyline = () => null;
    export const ImageOverlay = () => null;
  `; },
}], build: { outDir, emptyOutDir: true, lib: { entry: join(root, 'src/features/wayfinding/FloorMap.tsx'), formats: ['es'], fileName: () => 'map.mjs' },
  rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom'] },
} });

test('equivalent polling renders preserve pan and fit; only a changed selection recenters the map', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.Image = class {
    naturalWidth = 1000;
    naturalHeight = 800;
    set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
  };
  const container = document.createElement('div');
  const pans = [];
  globalThis.floorTestMap = {
    getZoom: () => 0, getMinZoom: () => -2, getMaxZoom: () => 2,
    getContainer: () => container, invalidateSize() {}, setMinZoom() {},
    panTo(position) { pans.push(position); },
    project: ([y, x]) => ({ x, y }),
  };
  const { FloorMap } = await import(pathToFileURL(join(outDir, 'map.mjs')));
  const app = createRoot(document.getElementById('app'));
  const draw = (x = 20, selectedId = 'a') => app.render(h(FloorMap, {
    image: { url: '/media/test.webp', alt: 'Test plan', caption: 'Test source', demonstration: false },
    points: [{ id: 'a', label: 'A', x, y: 30 }, { id: 'b', label: 'B', x: 75, y: 70 }], selectedId,
  }));
  try {
    await act(async () => draw());
    assert.deepEqual(pans, [[560, 200]]);
    await act(async () => draw());
    await act(async () => draw());
    assert.equal(pans.length, 1, 'fresh objects from an unrelated refresh must not undo a user pan or fit');
    await act(async () => draw(25));
    assert.deepEqual(pans.at(-1), [560, 250], 'staff marker movement should recenter');
    await act(async () => draw(25, 'b'));
    assert.deepEqual(pans.at(-1), [240.00000000000003, 750]);
    assert.equal(pans.length, 3);
  } finally {
    await act(async () => app.unmount());
    dom.window.close();
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'Image', 'floorTestMap']) delete globalThis[key];
  }
});
