const CACHE_NAME = 'accountech-shell-v19';
const APP_BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const APP_SHELL = [
  `${APP_BASE}/`,
  `${APP_BASE}/manifest.webmanifest`,
  `${APP_BASE}/icone.png`,
  `${APP_BASE}/logo.png`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const relativePath = APP_BASE && url.pathname.startsWith(`${APP_BASE}/`)
    ? url.pathname.slice(APP_BASE.length)
    : url.pathname;
  const isNavigation = request.mode === 'navigate';
  const isStaticAsset = relativePath.startsWith('/assets/') || APP_SHELL.includes(url.pathname);

  // Never intercept API, authentication or attachment requests. Those responses
  // may contain user-specific data and must not survive in the browser cache.
  if (!isNavigation && !isStaticAsset) return;

  event.respondWith(
    fetch(request, isNavigation ? { cache: 'no-store' } : undefined)
      .then((response) => {
        const responseCopy = response.clone();
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        if (isNavigation) return caches.match(`${APP_BASE}/`);
        return Response.error();
      }))
  );
});
