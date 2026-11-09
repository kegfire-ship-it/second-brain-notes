// Kept as a standalone function so the build can embed it in /sw.js.
export function setupOfflineWorker(scope, { cacheName, entries }) {
  const prefix = 'second-brain-shell-';
  const origin = scope.location.origin;
  const assets = new Map(entries.map((entry) => [new URL(entry.url, origin).href, entry]));
  const shell = new URL('/index.html', origin).href;

  scope.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      try {
        const cache = await scope.caches.open(cacheName);
        // addAll commits atomically; integrity also rejects HTML substituted
        // by nginx or assets from another deployment during installation.
        await cache.addAll(entries.map(({ url, integrity }) => new Request(
          new URL(url, origin),
          { integrity, cache: 'reload', credentials: 'omit', redirect: 'error' },
        )));
      } catch (error) {
        await scope.caches.delete(cacheName);
        throw error;
      }
      // No skipWaiting: a new version waits until every old client closes.
    })());
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const keys = await scope.caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName)
        .map((key) => scope.caches.delete(key)));
      // No clients.claim: never change the worker under an already-open editor.
    })());
  });

  scope.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== origin
      || /^\/api(?:\/|$)/.test(url.pathname)
      || /^\/ai-agent-stack(?:\/|$)/.test(url.pathname)
      || request.headers.has('authorization')) return;

    // Same-origin document routes use this worker's shell even while online,
    // keeping HTML and lazy chunks on the same version until safe activation.
    const navigation = request.mode === 'navigate'
      && !/\.[^/]+$/.test(url.pathname);
    const key = navigation ? shell : url.href;
    if (!navigation && !assets.has(key)) return;
    event.respondWith((async () => {
      const cache = await scope.caches.open(cacheName);
      const cached = await cache.match(key);
      if (cached) return cached;
      // Recover eviction only with these exact build bytes. Fetch rejects an
      // integrity mismatch, including a newer index.html after deployment.
      const entry = assets.get(key);
      if (entry) {
        try {
          const response = await scope.fetch(new Request(key, {
            integrity: entry.integrity,
            cache: 'reload', credentials: 'omit', redirect: 'error',
          }));
          if (response.ok) {
            await cache.put(key, response.clone());
            return response;
          }
        } catch {
          // Offline, integrity mismatch or unavailable storage: fail closed.
        }
      }
      return new Response('Offline app files are unavailable. Reconnect and reopen the app.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    })());
  });
}
