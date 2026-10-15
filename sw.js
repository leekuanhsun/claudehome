/* 離線快取：讓存錢計畫在沒有網路時也能開啟 */
const CACHE = 'saving-plan-v26';
const SHELL = [
  './',
  'login.html',
  'index.html',
  'expense.html',
  'diary.html',
  'history.html',
  'plan.html',
  'settings.html',
  'profiles.html',
  'styles.css',
  'calc.js',
  'sync.js',
  'supabase-config.js',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 網路優先：每次先抓最新版，離線時才用快取，避免更新後還停在舊畫面
  ev.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
