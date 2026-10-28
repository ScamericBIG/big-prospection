// « Segmentation secteurs » : zones de chaque chargé d'affaires (pointillés + remplissage) et répartition des sites filtrés
import { store } from './store.js';
import { etat, ecouter, sitesFiltres, nomCA } from './etat.js';
import { fmtN, esc } from './metier.js';
import { debounce, toast } from './ui.js';
import { getCarte } from './carte.js';

let actif = false, topo = null, couche = null, bouton = null, legende = null;

const secteurDe = code => store.data.secteur_departements.get(code)?.secteur || null;
const couleurDe = code => store.get('secteurs', code)?.couleur || '#8F9092';

export function initSegmentation() {
  const carte = getCarte();
  carte.createPane('segments').style.zIndex = 350;                // au-dessus du fond de carte, sous les sites
  carte.getPane('segments').style.pointerEvents = 'none';
  const Ctrl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'ctrl-segmentation');
      div.innerHTML = `<button type="button" class="btn-loueur" title="Afficher les secteurs de chaque chargé d'affaires">🗺 Segmentation secteurs</button><div class="legende-secteurs" hidden></div>`;
      L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
      bouton = div.querySelector('button'); legende = div.querySelector('.legende-secteurs');
      bouton.onclick = () => basculer(!actif);
      return div;
    },
  });
  carte.addControl(new Ctrl());
  const maj = debounce(() => actif && rendreLegende(), 250);
  ecouter('filtres', maj); ecouter('secteur', maj); ecouter('autour', maj);
  store.on('change', d => {
    if (!actif) return;
    if (d?.table === 'secteur_departements' || d?.table === 'secteurs') dessiner();
    if (!d || d.table === 'sites') maj();
  });
  try { if (localStorage.getItem('big_segmentation') === '1') basculer(true); } catch { }
}

async function basculer(on) {
  actif = on;
  try { localStorage.setItem('big_segmentation', on ? '1' : '0'); } catch { }
  bouton.classList.toggle('actif', on);
  legende.hidden = !on;
  if (!on) { couche && getCarte().removeLayer(couche); return; }
  if (!topo) {
    try { topo = await (await fetch('data/zones-secteurs.topojson')).json(); }
    catch { toast('Contours des secteurs indisponibles (hors connexion ?)', 'erreur'); actif = false; bouton.classList.remove('actif'); legende.hidden = true; return; }
  }
  dessiner();
  rendreLegende();
}

function dessiner() {
  const carte = getCarte();
  if (couche) carte.removeLayer(couche);
  couche = L.layerGroup();
  const obj = topo.objects.zones;
  const sect = g => secteurDe(g.properties.code);
  // remplissage : chaque département prend la couleur de son secteur (sans bordure interne)
  L.geoJSON(topojson.feature(topo, obj), {
    pane: 'segments', interactive: false,
    style: f => { const s = secteurDe(f.properties.code); return { stroke: false, fillColor: s ? couleurDe(s) : '#8F9092', fillOpacity: s ? 0.17 : 0.04 }; },
  }).addTo(couche);
  // limites entre secteurs (et contour extérieur) en pointillés
  const limites = topojson.mesh(topo, obj, (a, b) => a === b || sect(a) !== sect(b));
  L.geoJSON(limites, { pane: 'segments', interactive: false, style: { color: '#2A336E', weight: 2.2, opacity: 0.75, dashArray: '7 6', fill: false } }).addTo(couche);
  // nom du secteur au centre de sa zone (repère en plus de la couleur)
  const centres = new Map();
  for (const f of topojson.feature(topo, obj).features) {
    const s = secteurDe(f.properties.code); if (!s) continue;
    const c = L.geoJSON(f).getBounds().getCenter(), e = centres.get(s) || { lat: 0, lng: 0, n: 0 };
    e.lat += c.lat; e.lng += c.lng; e.n++; centres.set(s, e);
  }
  for (const [s, e] of centres) {
    const lib = store.get('secteurs', s)?.libelle || s;
    L.marker([e.lat / e.n, e.lng / e.n], { pane: 'segments', interactive: false, keyboard: false,
      icon: L.divIcon({ className: '', html: `<div class="etiquette-secteur" style="--c:${couleurDe(s)}">${esc(lib)}</div>`, iconSize: [0, 0] }) }).addTo(couche);
  }
  couche.addTo(carte);
}

// Légende : nombre de sites (selon les filtres actuels) par secteur, sur toute la France
function rendreLegende() {
  const sites = sitesFiltres({ secteur: 'national', ignorerMasquees: false });
  const compte = new Map(); let total = 0;
  for (const s of sites) { const k = s.secteur || store.secteurDe(s) || '—'; compte.set(k, (compte.get(k) || 0) + 1); total++; }
  const secteurs = store.liste('secteurs').filter(s => s.code !== 'national').sort((a, b) => a.ordre - b.ordre);
  const filtresActifs = Object.entries(etat.filtres).some(([k, v]) => k !== 'categoriesMasquees' && (v instanceof Set ? v.size : !!v));
  legende.innerHTML = `<div class="ls-titre">${filtresActifs ? 'Sites filtrés' : 'Sites'} par secteur <small>(toute la France)</small></div>
    ${secteurs.map(s => {
      const n = compte.get(s.code) || 0, resp = store.liste('profils').filter(p => p.secteur === s.code && p.actif !== false).map(p => p.prenom).join(', ');
      return `<div class="ls-ligne"><span class="ls-carre" style="background:${s.couleur}"></span><span><b>${esc(s.libelle)}</b>${resp ? ` <small>${esc(resp)}</small>` : ''}</span>
        <span class="ls-n">${fmtN(n)}</span><span class="ls-pct">${total ? Math.round(n / total * 100) : 0} %</span>
        <span class="ls-barre"><i style="width:${total ? n / total * 100 : 0}%;background:${s.couleur}"></i></span></div>`;
    }).join('')}
    ${compte.get('—') ? `<div class="ls-ligne"><span class="ls-carre" style="background:#8F9092"></span><span>Hors secteur</span><span class="ls-n">${fmtN(compte.get('—'))}</span><span></span></div>` : ''}
    <div class="ls-total">Total : <b>${fmtN(total)}</b>${etat.secteur !== 'national' ? ' · la carte n’affiche que le secteur sélectionné' : ''}</div>`;
}
