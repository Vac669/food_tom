/*
 * Service worker: trzyma pliki aplikacji w pamięci telefonu, żeby otwierała się od razu i bez sieci.
 * Zapytania do OpenAI i Gemini idą zawsze prosto do sieci.
 * Po zmianie plików podbij numer wersji, wtedy telefony pobiorą nową wersję.
 */
const CACHE = 'tomfood-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/calc.js',
  'js/ai.js',
  'js/db.js',
  'js/app.js',
  'fonts/bricolage-grotesque-latin-wght-normal.woff2',
  'fonts/bricolage-grotesque-latin-ext-wght-normal.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Najpierw sieć (świeża wersja po każdej aktualizacji), a bez sieci kopia z pamięci.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
