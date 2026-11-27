// AS Games PWA Service Worker v2.4.2
const CACHE_NAME = 'asgames-cache-v2.4.2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './audio.js',
  './game-wingo.js',
  './game-aviator.js',
  './game-mines.js',
  './game-k3.js',
  './game-ludo.js',
  './game-king.js',
  './game-wheel.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable.png',
  './assets/avatar-vip.jpg',
  './assets/card-wingo.jpg',
  './assets/card-aviator.jpg',
  './assets/card-mines.jpg',
  './assets/card-k3.jpg',
  './assets/card-ludo.jpg',
  './assets/card-king.jpg',
  './assets/card-wheel.jpg',
  './assets/hero-banner-1.jpg',
  './assets/hero-banner-2.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching static assets for AS Games app');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET or API / dynamic requests
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/downloads/')) {
    return;
  }

  // Network-First for HTML, JS, CSS, and Manifest so updates appear immediately
  const isCoreAsset = req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('manifest.json') ||
    url.pathname.includes('icon-');

  if (isCoreAsset) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then((networkResp) => {
        if (networkResp && networkResp.status === 200) {
          const respClone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
        }
        return networkResp;
      }).catch(() => {
        return caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
      })
    );
    return;
  }

  // Cache-First with background refresh for game art images
  event.respondWith(
    caches.match(req).then((cachedResp) => {
      if (cachedResp) {
        fetch(req).then((networkResp) => {
          if (networkResp && networkResp.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, networkResp));
          }
        }).catch(() => {});
        return cachedResp;
      }
      return fetch(req).then((networkResp) => {
        if (networkResp && networkResp.status === 200) {
          const respClone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
        }
        return networkResp;
      });
    })
  );
});
