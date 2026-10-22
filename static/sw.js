// Offline: pages and assets are fetched from the network first and saved; when the network is
// unavailable (Dwinelle's basement), the last saved copy is served. /admin and /api are never cached.
const CACHE = "live-v1";
const PRECACHE = ["/", "/map/", "/schedule/", "/rooms/", "/updates/", "/faq/", "/guide/", "/help/", "/style.css", "/live.js"];
const key = (req) => { const u = new URL(req.url); return u.origin + u.pathname; };

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRECACHE.map((p) => fetch(p).then((r) => r.ok && c.put(key(r), r)).catch(() => null)))));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key(e.request), copy)); }
      return res;
    }).catch(() => caches.match(key(e.request)).then((hit) => hit || (e.request.mode === "navigate" ? caches.match(location.origin + "/") : Response.error())))
  );
});
