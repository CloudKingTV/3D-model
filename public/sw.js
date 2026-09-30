/*
 * Marble Mayhem's offline cache. Pages are fetched from the network first
 * (so an update shows up straight away) and fall back to the cache; the
 * hashed assets never change, so they come from the cache first.
 */
const CACHE = 'marble-mayhem-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const page = request.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (!page) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const hit = await cache.match(request);
      if (hit) return hit;
      throw error;
    }
  })());
});
