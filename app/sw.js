// Апп-ыг интернэтгүй үед ч нээгдэхээр кэшлэнэ (Google API-г кэшлэхгүй)
const V = 'universe-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon-192.png', 'icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('universe-shell') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('google.com')) return;
  // өөрийн файлууд: эхлээд сүлжээ (шинэ хувилбар), үгүй бол кэш. CDN: эхлээд кэш.
  const own = u.origin === location.origin;
  e.respondWith((async () => {
    const c = await caches.open(V);
    if (!own) {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }
    try {
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await c.match(e.request, { ignoreSearch: true })) || (await c.match('index.html'));
    }
  })());
});
