// Service worker ÉroticaX — mise en cache pour un rechargement quasi instantané à la réouverture.
// Incrémente CACHE_NAME (v1 -> v2 -> ...) après un déploiement si tu veux forcer
// tous les navigateurs à repartir sur un cache propre.
const CACHE_NAME = 'eroticax-cache-v1';

// IMPORTANT : "/" et "/index.html" sont volontairement exclus.
// Ces routes passent par une fonction Netlify (/.netlify/functions/home) qui génère
// la page à la volée (aperçus Open Graph dynamiques) et _headers force déjà
// "no-cache, must-revalidate" dessus. Le SW ne doit jamais court-circuiter ça.
const PRECACHE_URLS = [
  './videos.html'
];

const NEVER_CACHE_PATHS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}) // ne bloque pas l'installation si une URL échoue (ex: offline au 1er install)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Jamais de cache sur les échanges dynamiques Firebase (données Firestore/Auth toujours fraîches)
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')
  ) {
    return;
  }

  // "/" et "/index.html" : on laisse passer directement au réseau, sans jamais
  // toucher au cache (route dynamique côté fonction Netlify, doit rester toujours fraîche).
  if (url.origin === location.origin && NEVER_CACHE_PATHS.includes(url.pathname)) {
    return;
  }

  const isNavigation = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    // Pages HTML statiques (ex: videos.html) : stale-while-revalidate -> affichage
    // instantané depuis le cache, puis mise à jour en arrière-plan pour la prochaine ouverture.
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Ressources statiques (polices, SDK Firebase, images, icônes) : cache-first
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return cached;
      }
    })
  );
});
