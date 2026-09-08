// Service Worker for Dr. Claw PWA
const CACHE_NAME = 'dr-claw-ui-v3';
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

// Fetch event — network-first for HTML so builds are picked up immediately
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate';
  const isHTML = url.pathname === '/' || url.pathname.endsWith('.html');

  if (isNavigation || isHTML) {
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
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
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
