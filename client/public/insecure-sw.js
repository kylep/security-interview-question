const CACHE_NAME = 'notes-cache-v1';
const TARGET_URL = '/api/notes';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method === 'GET' && request.url.includes(TARGET_URL)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return fetch(request).then(response => {
          cache.put(TARGET_URL, response.clone());
          return response;
        }).catch(() => cache.match(TARGET_URL));
      })
    );
  }
});
