/* 서비스 워커 — 앱 껍데기를 캐시해 오프라인에서도 메모를 볼 수 있게 한다.
   메모 본문은 localStorage 에 있고, 온라인이 되면 드라이브와 다시 맞춘다. */
'use strict';

const CACHE = 'memo-shell-v1';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  '../memo-core.js',
  '../drive-api.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* 구글 인증·드라이브 API는 절대 캐시하지 않는다 */
  if (/(googleapis\.com|google\.com|gstatic\.com)$/.test(url.hostname)) return;
  if (url.origin !== self.location.origin) return;

  /* HTML·설정은 네트워크 우선 — 배포 직후 바로 최신이 뜨도록 */
  const fresh = req.mode === 'navigate' || /\/(index\.html|config\.js)$/.test(url.pathname);
  if (fresh) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
