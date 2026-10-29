// Carte France + Belgique : regroupement des sites (clusters), taille selon surface, couleur selon activité
import { store } from './store.js';
import { etat, sitesFiltres, sitesDuSecteur, infos, emettre, ecouter } from './etat.js';
import { CATEGORIES, STATUTS, EMPRISES_SECTEURS, rayon, rappelEnRetard, fmtM2, fmtN, fmtM2court, esc, surfaceEstimee, anneeEstimee } from './metier.js';
import { $, debounce } from './ui.js';
import { faitDansFiltre } from './strategies-core.js';

let carte, coucheAutour, coucheTournee, coucheSelection, fonds = {}, fondActif;
let surClic = null;

// Fonds de carte gratuits sans clé (CARTO exige désormais une clé API : abandonné)
const FONDS = {
  plan: { nom: 'Plan', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', o: { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
  ignplan: { nom: 'Plan IGN', url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', o: { maxZoom: 19, attribution: '© IGN – Géoplateforme (France)' } },
  sat: { nom: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' } },
  ign: { nom: 'Photo IGN', url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', o: { maxZoom: 19, attribution: '© IGN – Géoplateforme (France uniquement)' } },
};

// ----------------------------------------------------------------------------------------------
// Couche des sites : regroupement Supercluster + dessin sur un seul canvas.
// Seuls les points / groupes visibles à l'écran sont dessinés (quelques centaines), ce qui reste
// fluide même avec 50 000 sites ou plus, y compris sur smartphone.
// ----------------------------------------------------------------------------------------------
const ANNEAU = { client: STATUTS.client.couleur, retard: '#B23A48', cours: '#2A336E' };
const EN_COURS = new Set(['prospect', 'en_contact', 'rdv', 'devis']);
const rayonGroupe = n => (n < 10 ? 15 : n < 100 ? 19 : n < 1000 ? 23 : 27);

const CoucheSites = L.Layer.extend({
  options: { padding: 0.35 },
  initialize() {
    this._visibles = []; this._tip = null; this._survolId = null;
    this._ids = []; this._gen = 0; this._req = 0; this._reqDep = 0; this._vues = new Map(); this._attentes = new Map(); this._pret = false;
    this._worker = new Worker('js/cluster-worker.js');
    this._worker.onmessage = ({ data: m }) => {
      if (m.type === 'charge' && m.gen === this._gen) { this._pret = true; this.redessiner(); }
      else if (m.type === 'vue') this._recevoir(m);
      else if (m.type === 'deplier') { const f = this._attentes.get(m.req); this._attentes.delete(m.req); f?.(m); }
    };
  },
  onAdd(map) {
    this._map = map;
    const pane = map.getPane('sites') || map.createPane('sites');
    pane.style.zIndex = 450; pane.style.pointerEvents = 'none';
    this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', pane);
    this._ctx = this._canvas.getContext('2d');
    this._tip = L.tooltip({ className: 'info-site', direction: 'top', offset: [0, -8], opacity: 1 });
    map.on('moveend resize viewreset', this.redessiner, this);
    map.on('zoomanim', this._animerZoom, this);
    map.on('mousemove', this._survol, this);
    map.on('mouseout zoomstart movestart', this._finSurvol, this);
    map.on('click', this._clic, this);
    this.redessiner();
  },
  onRemove(map) {
    L.DomUtil.remove(this._canvas);
    map.off('moveend resize viewreset', this.redessiner, this).off('zoomanim', this._animerZoom, this)
       .off('mousemove', this._survol, this).off('mouseout zoomstart movestart', this._finSurvol, this).off('click', this._clic, this);
  },
  // Envoie les positions au calcul de regroupement (fil séparé)
  charger(sites) {
    const n = sites.length, lat = new Float64Array(n), lng = new Float64Array(n), surf = new Float64Array(n);
    this._ids = new Array(n);
    for (let k = 0; k < n; k++) { const s = sites[k]; lat[k] = s.lat; lng[k] = s.lng; surf[k] = infos(s).surface || 0; this._ids[k] = s.id; }
    this._gen++; this._pret = false;
    this._worker.postMessage({ type: 'charger', gen: this._gen, lat, lng, surf }, [lat.buffer, lng.buffer, surf.buffer]);
  },
  // Demande les groupes / points visibles pour la vue actuelle
  redessiner() {
    if (!this._map || this._map._animatingZoom || !this._pret) return;
    const map = this._map, taille = map.getSize(), pad = taille.multiplyBy(this.options.padding).round();
    const hg = map.containerPointToLayerPoint([0, 0]).subtract(pad);
    const w = taille.x + 2 * pad.x, h = taille.y + 2 * pad.y;
    const no = map.layerPointToLatLng(hg), se = map.layerPointToLatLng(hg.add([w, h]));
    const z = Math.round(map.getZoom()), req = ++this._req;
    this._vues.set(req, { hg, w, h, no, z, pixelOrigin: map.getPixelOrigin() });
    this._worker.postMessage({ type: 'vue', req, gen: this._gen, zoom: z,
      bbox: [Math.max(-180, no.lng), Math.max(-85, se.lat), Math.min(180, se.lng), Math.min(85, no.lat)] });
  },
  _recevoir(m) {
    const vue = this._vues.get(m.req); this._vues.delete(m.req);
    if (!vue || m.req !== this._req || m.gen !== this._gen || !this._map || this._map._animatingZoom) return;
    const map = this._map;
    if (Math.round(map.getZoom()) !== vue.z || !map.getPixelOrigin().equals(vue.pixelOrigin)) return this.redessiner();
    const { hg, w, h } = vue, dpr = window.devicePixelRatio || 1, c = this._canvas, ctx = this._ctx;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px';
    }
    L.DomUtil.setPosition(c, hg);
    this._hg = hg; this._no = vue.no;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const d = m.data, pts = [], grps = [];
    for (let o = 0; o < d.length; o += 6) {
      const lng = d[o], lat = d[o + 1];
      const p = map.latLngToLayerPoint([lat, lng]).subtract(hg);
      if (d[o + 2] < 0) grps.push({ g: true, x: p.x, y: p.y, r: rayonGroupe(d[o + 4]), n: d[o + 4], surf: d[o + 5], cid: d[o + 3], lat, lng });
      else {
        const s = store.get('sites', this._ids[d[o + 2]]); if (!s || s.supprime) continue;
        pts.push({ g: false, x: p.x, y: p.y, r: rayon(s), s, lat, lng });
      }
    }
    pts.sort((a, b) => b.r - a.r);                       // les gros dessous, les petits dessus
    for (const v of pts) {
      const s = v.s, i = infos(s);
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 6.2832);
      const fait = faitDansFiltre(s);            // site déjà traité dans la stratégie filtrée : grisé
      ctx.globalAlpha = fait ? 0.3 : 0.88; ctx.fillStyle = fait ? '#8F9092' : (CATEGORIES[i.cat]?.couleur || '#8F9092'); ctx.fill();
      if (fait && v.r >= 5) { ctx.globalAlpha = 1; ctx.strokeStyle = '#1E8A4C'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(v.x - v.r * 0.45, v.y); ctx.lineTo(v.x - v.r * 0.1, v.y + v.r * 0.35); ctx.lineTo(v.x + v.r * 0.5, v.y - v.r * 0.35); ctx.stroke(); ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 6.2832); }
      let col = '#ffffff', lw = 1;
      if (s.statut === 'client') { col = ANNEAU.client; lw = 3; }
      else if (rappelEnRetard(s)) { col = ANNEAU.retard; lw = 3; }
      else if (EN_COURS.has(s.statut)) { col = ANNEAU.cours; lw = 2; }
      ctx.globalAlpha = 1; ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const v of grps) {
      const fonce = v.n >= 1000 ? '42,51,110' : v.n >= 100 ? '59,71,150' : '80,94,182';
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r + 5, 0, 6.2832); ctx.fillStyle = `rgba(${fonce},0.25)`; ctx.fill();
      ctx.beginPath(); ctx.arc(v.x, v.y, v.r, 0, 6.2832); ctx.fillStyle = `rgba(${fonce},0.93)`; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${v.n >= 1000 ? 13 : 12}px Arial, Helvetica, sans-serif`;
      ctx.fillText(v.n >= 10000 ? Math.round(v.n / 1000) + 'k' : String(v.n), v.x, v.y + 0.5);
    }
    this._visibles = pts.concat(grps);
  },
  _deplier(cid) {
    return new Promise(res => { const req = ++this._reqDep; this._attentes.set(req, res); this._worker.postMessage({ type: 'deplier', req, cid }); });
  },
  _animerZoom(e) {
    if (!this._no) return;
    const ech = this._map.getZoomScale(e.zoom), dec = this._map._latLngToNewLayerPoint(this._no, e.zoom, e.center);
    L.DomUtil.setTransform(this._canvas, dec, ech);
  },
  _touches(cp) {                                         // éléments sous le pointeur, du plus haut au plus bas
    if (!this._hg) return [];
    const p = this._map.containerPointToLayerPoint(cp).subtract(this._hg), res = [];
    for (let k = this._visibles.length - 1; k >= 0; k--) {
      const v = this._visibles[k], dx = v.x - p.x, dy = v.y - p.y, r = v.r + (L.Browser.mobile ? 6 : 2);
      if (dx * dx + dy * dy <= r * r) res.push(v);
    }
    return res;
  },
  _survol(e) {
    if (this._attente) return;
    this._attente = requestAnimationFrame(() => {
      this._attente = null;
      const t = this._touches(e.containerPoint)[0];
      this._map.getContainer().style.cursor = surClic ? 'crosshair' : t ? 'pointer' : '';
      const cle = t ? (t.g ? 'g' + t.cid : t.s.id) : null;
      if (cle === this._survolId) return;
      this._survolId = cle;
      if (!t) { this._map.closeTooltip(this._tip); return; }
      let html;
      if (t.g) html = `<b>${fmtN(t.n)} sites</b><br>${fmtM2court(t.surf)} cumulés<br><small>Cliquer pour zoomer</small>`;
      else {
        const s = t.s, i = infos(s);
        html = `<b>${esc(s.nom)}</b><br>${esc(CATEGORIES[i.cat]?.libelle || '')} · ${surfaceEstimee(s) ? '≈ ' : ''}${fmtM2(i.surface)}${i.annee ? ' · ' + (anneeEstimee(s) ? '≈ ' : '') + i.annee : ''}<br><small>${esc(s.ville || '')} — ${esc(STATUTS[s.statut]?.libelle || '')}</small>`;
      }
      this._tip.setLatLng([t.lat, t.lng]).setContent(html);
      if (!this._map.hasLayer(this._tip)) this._map.openTooltip(this._tip);
    });
  },
  _finSurvol() { this._survolId = null; if (this._map) this._map.closeTooltip(this._tip); },
  _clic(e) {
    if (surClic) return;
    const touches = this._touches(e.containerPoint);
    const t = touches[0]; if (!t) return;
    this._finSurvol();
    if (t.g) {
      this._deplier(t.cid).then(r => {
        if (r.zoom <= 17) this._map.flyTo([t.lat, t.lng], Math.max(r.zoom, this._map.getZoom() + 1), { duration: 0.45 });
        else listeSites((r.feuilles || []).map(i => store.get('sites', this._ids[i])).filter(Boolean), [t.lat, t.lng]);
      });
      return;
    }
    // plusieurs sites exactement au même endroit : on propose la liste
    const memes = touches.filter(v => !v.g && Math.abs(v.x - t.x) < 3 && Math.abs(v.y - t.y) < 3);
    if (memes.length > 1) return listeSites(memes.map(v => v.s), [t.lat, t.lng]);
    emettre('ouvrir-site', t.s.id);
  },
});

function listeSites(sites, ll) {
  sites.sort((a, b) => (infos(b).surface || 0) - (infos(a).surface || 0));
  const html = `<div class="popup-liste"><b>${sites.length} sites à cet endroit</b><ul>${sites.slice(0, 60).map(s =>
    `<li><a href="#" data-site="${s.id}"><span class="rond" style="background:${CATEGORIES[infos(s).cat]?.couleur}"></span>${esc(s.nom)}</a> <small>${fmtM2court(infos(s).surface)}</small></li>`).join('')}</ul>${sites.length > 60 ? `<small>… et ${sites.length - 60} autres (voir l'onglet Liste)</small>` : ''}</div>`;
  const pop = L.popup({ maxWidth: 320, autoPanPadding: [20, 20] }).setLatLng(ll).setContent(html).openOn(carte);
  pop.getElement()?.querySelectorAll('[data-site]').forEach(a => a.onclick = ev => { ev.preventDefault(); carte.closePopup(); emettre('ouvrir-site', a.dataset.site); });
}

let couche, positionsIndexees = new Map();

export function initCarte() {
  carte = L.map('carte', { zoomControl: false, minZoom: 5, maxBounds: [[38, -12], [56, 16]], zoomSnap: 1, wheelPxPerZoomLevel: 90 }).setView([47.2, 2.8], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(carte);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(carte);
  for (const [k, f] of Object.entries(FONDS)) fonds[k] = L.tileLayer(f.url, { ...f.o, crossOrigin: true, updateWhenZooming: false, keepBuffer: 3 });
  const choix = localStorage.getItem('big_fond') || 'plan';
  $('#fonds-carte').innerHTML = Object.entries(FONDS).map(([k, f]) => `<button data-f="${k}">${f.nom}</button>`).join('');
  $('#fonds-carte').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) choisirFond(b.dataset.f); });
  choisirFond(fonds[choix] ? choix : 'plan');

  couche = new CoucheSites().addTo(carte);
  coucheAutour = L.layerGroup().addTo(carte);
  coucheTournee = L.layerGroup().addTo(carte);
  coucheSelection = L.layerGroup().addTo(carte);

  carte.on('click', e => { if (surClic) { const f = surClic; surClic = null; carte.getContainer().style.cursor = ''; f(e.latlng); } });

  dessinerLegende();
  const maj = debounce(dessinerSites, 80);
  ecouter('filtres', maj);
  ecouter('autour', () => { dessinerAutour(); maj(); });
  ecouter('secteur', () => { maj(); cadrerSecteur(); });
  ecouter('tournee', dessinerTournee);
  ecouter('vue', v => { if (v === 'carte') setTimeout(() => { carte.invalidateSize(); couche.redessiner(); }, 50); });
  store.on('change', d => { if (!d || ['sites', 'strategies', 'strategie_sites'].includes(d.table) || (etat.filtres.strategie && ['activites', 'contacts'].includes(d.table))) maj(); });
  ecouter('cadrer-filtres', () => {
    const l = sitesFiltres().filter(s => s.lat != null);
    if (l.length) carte.fitBounds(L.latLngBounds(l.map(s => [s.lat, s.lng])).pad(0.1), { maxZoom: 13 });
  });
  dessinerSites();
  dessinerTournee();
}

function choisirFond(k) {
  if (fondActif) carte.removeLayer(fondActif);
  fondActif = fonds[k].addTo(carte); fondActif.bringToBack();
  document.querySelectorAll('#fonds-carte button').forEach(b => b.classList.toggle('actif', b.dataset.f === k));
  localStorage.setItem('big_fond', k);
}

// Ne reconstruit l'index de regroupement que si la liste des sites affichés (ou leurs positions/surfaces) a changé ;
// sinon (statut, commentaire, rappel…) un simple redessin suffit.
function dessinerSites() {
  const liste = sitesFiltres().filter(s => s.lat != null && s.lng != null);
  let reindexer = liste.length !== positionsIndexees.size;
  if (!reindexer) for (const s of liste) {
    const p = positionsIndexees.get(s.id);
    if (!p || p[0] !== s.lat || p[1] !== s.lng || p[2] !== (infos(s).surface || 0)) { reindexer = true; break; }
  }
  if (reindexer) {
    positionsIndexees = new Map(liste.map(s => [s.id, [s.lat, s.lng, infos(s).surface || 0]]));
    couche.charger(liste);
  } else couche.redessiner();
  marquerSelection(etat.siteOuvert);
}

export function marquerSelection(id) {
  coucheSelection.clearLayers();
  const s = id && store.get('sites', id);
  if (s?.lat) L.circleMarker([s.lat, s.lng], { radius: rayon(s) + 7, color: '#2A336E', weight: 3, fill: false, dashArray: '4 3', interactive: false }).addTo(coucheSelection);
}

export function centrerSur(s, zoom = 16) {
  if (!s?.lat) return;
  carte.setView([s.lat, s.lng], Math.max(carte.getZoom(), zoom));
}

export function cadrerSecteur() {
  let n = 0, s0 = 90, n0 = -90, w0 = 180, e0 = -180;
  for (const s of sitesDuSecteur()) {
    if (s.lat == null || s.lng == null) continue;
    n++; if (s.lat < s0) s0 = s.lat; if (s.lat > n0) n0 = s.lat; if (s.lng < w0) w0 = s.lng; if (s.lng > e0) e0 = s.lng;
  }
  if (n > 3) carte.fitBounds(L.latLngBounds([s0, w0], [n0, e0]).pad(0.05), { maxZoom: 9 });
  else carte.fitBounds(EMPRISES_SECTEURS[etat.secteur] || EMPRISES_SECTEURS.national);
}

function dessinerLegende() {
  const l = $('#legende');
  const pref = localStorage.getItem('big_legende');
  const replie = pref ? pref === '0' : window.innerWidth < 860;
  const cats = Object.entries(CATEGORIES).map(([k, c]) =>
    `<div class="lg ${etat.filtres.categoriesMasquees.has(k) ? 'off' : ''}" data-c="${k}" title="Cliquer pour masquer / afficher"><span class="rond" style="background:${c.couleur}"></span>${esc(c.libelle)}</div>`).join('');
  const tailles = [5000, 20000, 50000, 100000].map(v => { const r = rayon({ surface_auto: v }); return `<span><i style="width:${r * 2}px;height:${r * 2}px"></i>${v >= 1000 ? v / 1000 + 'k' : v}</span>`; }).join('');
  l.innerHTML = `<button class="btn-icone legende-replier" title="Replier">${replie ? '▸' : '▾'}</button><b>Légende</b>` + (replie ? '' :
    `<div class="cats">${cats}</div><div class="tailles">${tailles}<span>m² (taille = surface)</span></div>
     <div class="anneaux"><span><i style="border-color:${STATUTS.client.couleur}"></i>client</span><span><i style="border-color:#B23A48"></i>rappel en retard</span><span><i style="border-color:#2A336E"></i>en cours</span></div>`);
  l.querySelector('.legende-replier').onclick = () => { localStorage.setItem('big_legende', replie ? '1' : '0'); dessinerLegende(); };
  l.querySelectorAll('[data-c]').forEach(d => d.onclick = () => {
    const m = etat.filtres.categoriesMasquees, c = d.dataset.c;
    m.has(c) ? m.delete(c) : m.add(c);
    dessinerLegende(); emettre('filtres');
  });
}

function dessinerAutour() {
  coucheAutour.clearLayers();
  const a = etat.autour; if (!a) return;
  L.circle([a.lat, a.lng], { radius: a.rayon * 1000, color: '#505EB6', weight: 2, fillOpacity: 0.05, dashArray: '6 4', interactive: false }).addTo(coucheAutour);
  L.marker([a.lat, a.lng], { icon: L.divIcon({ className: '', html: '<div class="marqueur-tournee marqueur-depart">◎</div>', iconSize: [22, 22] }) }).bindTooltip(esc(a.libelle)).addTo(coucheAutour);
  carte.fitBounds(L.latLng(a.lat, a.lng).toBounds(a.rayon * 2000));
}

export function dessinerTournee() {
  coucheTournee.clearLayers();
  const pts = [];
  if (etat.depart && etat.tournee.length) {
    pts.push([etat.depart.lat, etat.depart.lng]);
    L.marker([etat.depart.lat, etat.depart.lng], { icon: L.divIcon({ className: '', html: '<div class="marqueur-tournee marqueur-depart">D</div>', iconSize: [22, 22] }) }).bindTooltip('Départ : ' + esc(etat.depart.libelle)).addTo(coucheTournee);
  }
  etat.tournee.forEach((id, k) => {
    const s = store.get('sites', id); if (!s?.lat) return;
    pts.push([s.lat, s.lng]);
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<div class="marqueur-tournee">${k + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 30] }), zIndexOffset: 1000 })
      .bindTooltip(esc(s.nom)).on('click', () => emettre('ouvrir-site', id)).addTo(coucheTournee);
  });
  if (pts.length > 1) L.polyline(pts, { color: '#B23A48', weight: 3, opacity: .75, dashArray: '8 6', interactive: false }).addTo(coucheTournee);
}

export function cadrerTournee() {
  const pts = coucheTournee.getLayers().filter(l => l.getLatLng).map(l => l.getLatLng());
  if (pts.length) carte.fitBounds(L.latLngBounds(pts).pad(0.15));
}

// Mode « cliquer sur la carte pour placer un site »
export function choisirPosition(fn) { surClic = fn; carte.getContainer().style.cursor = 'crosshair'; }
export const getCarte = () => carte;

// Pré-chargement des tuiles (hors connexion) sur l'emprise du secteur courant
export async function prechargerTuiles(progression) {
  const b = L.latLngBounds(EMPRISES_SECTEURS[etat.secteur] || EMPRISES_SECTEURS.national);
  const pts = sitesDuSecteur().filter(s => s.lat);
  const bb = pts.length > 3 ? L.latLngBounds(pts.map(s => [s.lat, s.lng])) : b;
  // Téléchargement en masse : uniquement le Plan IGN (données ouvertes) — les serveurs OpenStreetMap l'interdisent
  const tmpl = FONDS.ignplan.url, sub = 'abc';
  const urls = [];
  const zMax = etat.secteur === 'national' ? 9 : 10;
  for (let z = 5; z <= zMax; z++) {
    const p1 = carte.project(bb.getNorthWest(), z).divideBy(256).floor(), p2 = carte.project(bb.getSouthEast(), z).divideBy(256).floor();
    for (let x = p1.x; x <= p2.x; x++) for (let y = p1.y; y <= p2.y; y++)
      urls.push(L.Util.template(tmpl, { s: sub[(x + y) % sub.length], z, x, y, r: '' }));
  }
  let n = 0;
  const travail = async () => { while (urls.length) { const u = urls.pop(); try { await fetch(u, { mode: 'cors' }); } catch { } n++; progression?.(n); } };
  const total = urls.length;
  progression?.(0, total);
  await Promise.all(Array.from({ length: 6 }, travail));
  return total;
}
