// Offline support.
// - On install, every file the app needs is saved in one go.
// - The app always opens from those saved files, instantly, with or without signal.
//   (Before, it tried the network first, which can hang for a long time with no signal.)
// - A new version is downloaded in the background and switched to when you tap
//   "Update now" (or the next time the app is fully closed and reopened).
const VERSION = '20261111.1848';
const CACHE = 'gamecoach-' + VERSION;
const FILES = [
  './', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/engine.js', 'js/cards.js', 'js/ai.js', 'js/coach.js', 'js/ui.js', 'js/chips.js', 'js/glossary.js', 'js/trainer.js', 'js/showdown.js', 'js/version.js',
  'css/chess.css', 'js/chess/app.js', 'js/chess/engine.js', 'js/chess/coach.js', 'js/chess/glossary.js', 'js/vendor/chess.js',
  'icons/chess.svg', 'fonts/cormorant-600.woff2', 'fonts/cormorant-700.woff2',
  ...['w', 'b'].flatMap(c => ['K', 'Q', 'R', 'B', 'N', 'P'].map(p => `pieces/${c}${p}.svg`)), 'js/handranks.js',
  'fonts/limelight.woff2', 'fonts/source-sans-400.woff2', 'fonts/source-sans-600.woff2', 'fonts/source-sans-700.woff2',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // always live: the version check and Claude
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/version.json')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  })());
});
