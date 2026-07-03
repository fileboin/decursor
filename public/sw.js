const CACHE_NAME = 'decursor-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// These paths serve UI code that must stay fresh.
// Network-first: try the server, fall back to cache only when offline.
const NETWORK_FIRST_PATHS = new Set(['/', '/index.html', '/app.js']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete every cache whose name is not the current CACHE_NAME.
  // When CACHE_NAME changes (e.g. v1 → v2), the old cache is automatically
  // removed here the moment the new Service Worker activates.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls always go straight to the network — never cached.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first for HTML and JS: always fetch the latest from the server.
  // If the network is unavailable, fall back to the cached version.
  if (NETWORK_FIRST_PATHS.has(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for other static assets (icons, manifest).
  // These change rarely and can tolerate serving a cached copy.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (
          response.ok &&
          response.type === 'basic' &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
