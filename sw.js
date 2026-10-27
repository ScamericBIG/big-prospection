// Service worker : application disponible hors connexion + mémorisation des tuiles de carte
const VERSION = 'big-prospection-v1.1.0';
const COQUILLE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/config.js', 'js/store.js', 'js/etat.js', 'js/metier.js', 'js/categories.js', 'js/ui.js',
  'js/filtres.js', 'js/carte.js', 'js/fiche.js', 'js/liste.js', 'js/groupes.js', 'js/perfs.js', 'js/tournee.js', 'js/importer.js', 'js/cluster-worker.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/supercluster.min.js',
  'vendor/supabase.js', 'vendor/xlsx.full.min.js',
  'img/logo-big.png', 'img/logo-mark.png', 'img/favicon.png', 'img/icon-192.png', 'img/icon-512.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png',
];
const TUILES = 'big-tuiles-v1';
const MAX_TUILES = 6000;
const HOTES_TUILES = /basemaps\.cartocdn\.com|tile\.openstreetmap\.org|arcgisonline\.com|data\.geopf\.fr/;

self.addEventListener('install', e => {
  // cache: 'reload' : on contourne le cache HTTP pour embarquer la toute dernière version des fichiers
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(COQUILLE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
  // Fichiers de l'application : réponse immédiate depuis le cache (démarrage instantané, même en 4G faible),
  // mise à jour en arrière-plan. Une nouvelle version (sw.js modifié) est installée puis proposée à l'utilisateur.
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const reseau = fetch(req).then(r => { if (r.ok && !url.pathname.endsWith('/data/demo-sites.json')) c.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(reseau); return hit; }
      return (await reseau) || (await c.match('index.html')) || new Response('Hors connexion', { status: 503 });
    }));
    return;
  }
  // Supabase et API : gérés par l'application (cache IndexedDB)
});
