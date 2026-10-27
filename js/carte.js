// Carte France + Belgique : regroupement des sites (clusters), taille selon surface, couleur selon activité
import { store } from './store.js';
import { etat, sitesFiltres, sitesDuSecteur, infos, emettre, ecouter } from './etat.js';
import { CATEGORIES, STATUTS, EMPRISES_SECTEURS, rayon, rappelEnRetard, fmtM2, fmtN, fmtM2court, esc } from './metier.js';
import { $, debounce } from './ui.js';

let carte, groupeSites, coucheAutour, coucheTournee, coucheSelection, fonds = {}, fondActif;
let surClic = null;

const FONDS = {
  plan: { nom: 'Plan', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', o: { subdomains: 'abcd', maxZoom: 20, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>' } },
  osm: { nom: 'Détaillé', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', o: { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
  sat: { nom: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', o: { maxZoom: 19, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' } },
  ign: { nom: 'Photo IGN', url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', o: { maxZoom: 19, attribution: '© IGN – Géoplateforme (France uniquement)' } },
};

export function initCarte() {
  carte = L.map('carte', { preferCanvas: true, zoomControl: false, minZoom: 5, maxBounds: [[38, -12], [56, 16]] }).setView([47.2, 2.8], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(carte);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(carte);
  for (const [k, f] of Object.entries(FONDS)) fonds[k] = L.tileLayer(f.url, { ...f.o, crossOrigin: true });
  const choix = localStorage.getItem('big_fond') || 'plan';
  $('#fonds-carte').innerHTML = Object.entries(FONDS).map(([k, f]) => `<button data-f="${k}">${f.nom}</button>`).join('');
  $('#fonds-carte').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) choisirFond(b.dataset.f); });
  choisirFond(fonds[choix] ? choix : 'plan');

  const rendu = L.canvas({ padding: 0.5 });
  groupeSites = L.markerClusterGroup({
    chunkedLoading: true, chunkInterval: 120, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16, maxClusterRadius: z => (z <= 7 ? 70 : z <= 11 ? 55 : 40),
    iconCreateFunction: c => {
      const n = c.getChildCount(), t = n < 10 ? 32 : n < 100 ? 40 : n < 1000 ? 48 : 56;
      return L.divIcon({ html: `<div class="cluster ${n >= 1000 ? 'c3' : n >= 100 ? 'c2' : ''}" style="width:${t}px;height:${t}px">${n >= 10000 ? Math.round(n / 1000) + 'k' : n}</div>`, className: '', iconSize: [t, t] });
    },
  });
  groupeSites.on('clustermouseover', e => {
    const m = e.layer.getAllChildMarkers();
    let surf = 0; for (const x of m) surf += x._surf || 0;
    e.layer.bindTooltip(`<b>${fmtN(m.length)} sites</b><br>${fmtM2court(surf)} cumulés`, { className: 'info-site', direction: 'top' }).openTooltip();
  });
  carte.addLayer(groupeSites);
  coucheAutour = L.layerGroup().addTo(carte);
  coucheTournee = L.layerGroup().addTo(carte);
  coucheSelection = L.layerGroup().addTo(carte);
  carte._renduSites = rendu;

  carte.on('click', e => { if (surClic) { const f = surClic; surClic = null; carte.getContainer().style.cursor = ''; f(e.latlng); } });

  dessinerLegende();
  const redessiner = debounce(dessinerSites, 60);
  ecouter('filtres', redessiner);
  ecouter('autour', () => { dessinerAutour(); redessiner(); });
  ecouter('secteur', () => { redessiner(); cadrerSecteur(); });
  ecouter('tournee', dessinerTournee);
  ecouter('vue', v => { if (v === 'carte') setTimeout(() => carte.invalidateSize(), 50); });
  store.on('change', d => { if (!d || d.table === 'sites') redessiner(); });
  dessinerSites();
  dessinerTournee();
}

function choisirFond(k) {
  if (fondActif) carte.removeLayer(fondActif);
  fondActif = fonds[k].addTo(carte); fondActif.bringToBack();
  document.querySelectorAll('#fonds-carte button').forEach(b => b.classList.toggle('actif', b.dataset.f === k));
  localStorage.setItem('big_fond', k);
}

function styleSite(s) {
  const i = infos(s);
  let color = '#ffffff', weight = 1;
  if (s.statut === 'client') { color = STATUTS.client.couleur; weight = 3; }
  else if (rappelEnRetard(s)) { color = '#B23A48'; weight = 3; }
  else if (['prospect', 'en_contact', 'rdv', 'devis'].includes(s.statut)) { color = '#2A336E'; weight = 2; }
  return { radius: rayon(s), fillColor: CATEGORIES[i.cat]?.couleur || '#8F9092', fillOpacity: 0.86, color, weight, opacity: 1 };
}

function dessinerSites() {
  const liste = sitesFiltres().filter(s => s.lat != null && s.lng != null);
  const marqueurs = new Array(liste.length);
  for (let k = 0; k < liste.length; k++) {
    const s = liste[k], i = infos(s);
    const m = L.circleMarker([s.lat, s.lng], { ...styleSite(s), renderer: carte._renduSites });
    m._siteId = s.id; m._surf = i.surface;
    m.bindTooltip(() => `<b>${esc(s.nom)}</b><br>${esc(CATEGORIES[i.cat]?.libelle || '')} · ${fmtM2(i.surface)}${i.annee ? ' · ' + i.annee : ''}<br><small>${esc(s.ville || '')} — ${esc(STATUTS[s.statut]?.libelle || '')}</small>`, { className: 'info-site', direction: 'top', offset: [0, -4] });
    m.on('click', () => emettre('ouvrir-site', s.id));
    marqueurs[k] = m;
  }
  groupeSites.clearLayers();
  groupeSites.addLayers(marqueurs);
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
  const pts = sitesDuSecteur().filter(s => s.lat).map(s => [s.lat, s.lng]);
  if (pts.length > 3) {
    const b = L.latLngBounds(pts);
    carte.fitBounds(b.pad(0.05), { maxZoom: 9 });
  } else carte.fitBounds(EMPRISES_SECTEURS[etat.secteur] || EMPRISES_SECTEURS.national);
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
  if (etat.depart) {
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
  const tmpl = fondActif._url, sub = fondActif.options.subdomains || 'abc';
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
