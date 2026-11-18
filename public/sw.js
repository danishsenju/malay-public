/**
 * TransitMY service worker - the "MRT tunnel" survival layer.
 *
 * Strategy, in the app's own honesty language:
 *   - App shell + static assets: cache-first (hashed /_next/static is immutable)
 *   - Pages + API responses:     network-first, fall back to the last good copy
 * A stale answer beats a broken empty screen - same rule as the server cache.
 */

const CACHE = 'sampai-bila-v1';
const SHELL = ['/', '/plan', '/weather', '/report', '/status'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Immutable build assets: cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(hit =>
        hit ??
        fetch(request).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return res;
        }),
      ),
    );
    return;
  }

  // Everything else (pages, /api/*): network-first with last-good fallback.
  event.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});

/**
 * Flood alerts (Web Push). Payload shape from lib/floodAlerts.ts:
 *   { title, body, url, tag }
 * `tag` is per state-set, so a newer alert for the same area replaces the
 * older one in the tray instead of stacking up - `renotify` still buzzes.
 */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'TransitMY', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'transitmy',
      renotify: Boolean(data.tag),
      data: { url: data.url || '/weather' },
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/weather', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      // Reuse an open TransitMY window if there is one - jumping to the page
      // beats spawning a second copy of the app.
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          // navigate() rejects on windows this worker doesn't control yet.
          return w.navigate(target).then(c => (c || w).focus()).catch(() => self.clients.openWindow(target));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
