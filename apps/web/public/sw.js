// ---------------------------------------------------------------------------
// Service worker — app-shell + static-asset caching ONLY.
//
// Deliberately does NOT cache:
//   - Any request to the Socket.IO origin (game state travels exclusively
//     over the websocket, never through this worker's fetch handler at
//     all — nothing to exclude there).
//   - Any `/api/*` request (session bootstrap, game summary/events,
//     anything under lib/api.ts). Stale game data is worse than a visible
//     network error: a cached "you're alive" response outliving an actual
//     death, or a cached lobby roster missing a kick, would actively
//     mislead a player mid-game. API requests are passed straight to the
//     network, uncached, every time.
//   - Next.js RSC/data requests (`?_rsc=`) or POST/non-GET requests in
//     general — same reasoning, and the Cache API can't store non-GET
//     requests regardless.
//
// What IS cached, cache-first: the Next.js build's static assets
// (`/_next/static/...`, immutable + content-hashed, safe to cache
// forever) and a small explicit app-shell list (icons, manifest, the
// offline fallback page itself). Navigations use network-first with a
// fall-through to the cached shell page, then to /offline, so a returning
// visitor with no connectivity still gets *something* rather than a
// browser error page — but never a cached game screen.
// ---------------------------------------------------------------------------

const CACHE_VERSION = 'mafia-shell-v1';

const APP_SHELL_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch the socket/API origin
  if (isApiRequest(url)) return; // game state and REST responses: always network, never cached

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('/offline')) ?? Response.error();
      }),
    );
  }
});
