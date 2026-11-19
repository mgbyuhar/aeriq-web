/* AERIQ service worker: makes the shop installable and speeds up repeat
   visits. API calls (checkout) are never cached and always go to network. */
const CACHE = 'aeriq-v1';
const SHELL = ['/', '/index.html', '/catalog.json', '/meta.json', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Checkout and any API call: network only, never cached.
  if (url.pathname.startsWith('/api/')) return;
  // Product images: cache first, then network.
  if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      }))
    );
    return;
  }
  // Pages and data: network first, fall back to cache when offline.
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request))
  );
});
