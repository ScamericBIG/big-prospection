// Service worker : application disponible hors connexion + mémorisation des tuiles de carte
const VERSION = 'big-prospection-v1.0.3';
const COQUILLE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/config.js', 'js/store.js', 'js/etat.js', 'js/metier.js', 'js/categories.js', 'js/ui.js',
  'js/filtres.js', 'js/carte.js', 'js/fiche.js', 'js/liste.js', 'js/groupes.js', 'js/perfs.js', 'js/tournee.js', 'js/importer.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.markercluster.js', 'vendor/leaflet/MarkerCluster.css',
  'vendor/supabase.js', 'vendor/xlsx.full.min.js',
  'img/logo-big.png', 'img/logo-mark.png', 'img/favicon.png', 'img/icon-192.png', 'img/icon-512.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png',
];
const TUILES = 'big-tuiles-v1';
const MAX_TUILES = 6000;
const HOTES_TUILES = /basemaps\.cartocdn\.com|tile\.openstreetmap\.org|arcgisonline\.com|data\.geopf\.fr/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== TUILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let compteur = 0;
async function rogner() {
  const c = await caches.open(TUILES); const ks = await c.keys();
  if (ks.length > MAX_TUILES) for (const k of ks.slice(0, ks.length - MAX_TUILES)) await c.delete(k);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Tuiles de carte : cache d'abord, réseau ensuite (et mémorisation)
  if (HOTES_TUILES.test(url.hostname)) {
    e.respondWith(caches.open(TUILES).then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok) { c.put(req.url, r.clone()); if (++compteur % 200 === 0) rogner(); }
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  // Fichiers de l'application : réseau d'abord (mises à jour immédiates), cache si hors connexion
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
  // Supabase et API : gérés par l'application (cache IndexedDB)
});
