// Service Worker for Dr. Claw PWA
const CACHE_NAME = 'dr-claw-ui-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Fetch event — only HTML is handled here: network-first so builds are picked
// up immediately, with the last good copy as an offline fallback.
//
// Every other request (API calls, icons, hashed assets) goes straight to the
// network without a respondWith(). Routing them through the worker added a
// cache lookup per request, could serve a stale precached file after an
// upgrade, and turned any worker-side failure into "TypeError: Failed to fetch"
// for the page while the server was still busy starting up.
self.addEventListener('fetch', event => {
  if (event.request.method && event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate';
  const isHTML = url.pathname === '/' || url.pathname.endsWith('.html');

  if (!isNavigation && !isHTML) return;

  const networkResponse = fetch(event.request);

  // Keep the last good HTML on HTTP errors. Cache writes must outlive the
  // response, but a quota/storage failure must not break a successful load.
  event.waitUntil(
    networkResponse
      .then(response => {
        if (!response.ok) return;
        const clone = response.clone();
        return caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      })
      .catch(() => {})
  );

  event.respondWith(
    networkResponse.catch(() => caches.match(event.request))
  );
});

// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
