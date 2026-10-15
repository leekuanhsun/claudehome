/* 離線快取：讓存錢計畫在沒有網路時也能開啟 */
const CACHE = 'saving-plan-v20';
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
  ev.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }))
  );
});
