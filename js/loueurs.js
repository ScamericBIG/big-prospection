// Agences de location de matériel (Kiloutou) : bouton sur la carte, agences du secteur, agences les plus proches d'un site
import { store } from './store.js';
import { etat, ecouter, emettre } from './etat.js';
import { distanceKm, esc } from './metier.js';
import { $, toast } from './ui.js';
import { getCarte } from './carte.js';

let actif = false, couche = null, panneau = null, bouton = null, premierCadrage = true;

const agences = () => store.liste('agences').filter(a => a.enseigne === 'kiloutou' && a.lat != null);
const secteurAgence = a => a.pays === 'BE' ? store.data.secteur_departements.get('BE')?.secteur : store.data.secteur_departements.get(a.departement)?.secteur;
export const agencesDuSecteur = () => etat.secteur === 'national' ? agences() : agences().filter(a => secteurAgence(a) === etat.secteur);

export function agencesProches(pt, n = 3) {
  if (!pt?.lat) return [];
  return agences().map(a => ({ a, d: distanceKm(pt, a) })).sort((x, y) => x.d - y.d).slice(0, n);
}
export const lienItineraire = (a, depuis) => `https://www.google.com/maps/dir/?api=1${depuis?.lat ? `&origin=${depuis.lat},${depuis.lng}` : ''}&destination=${a.lat},${a.lng}`;
export const lienInfos = a => `https://www.google.com/search?q=${encodeURIComponent(`Kiloutou ${a.ville || ''} ${a.adresse || ''}`)}`;
export const fmtKm = d => d < 10 ? d.toFixed(1).replace('.', ',') + ' km' : Math.round(d) + ' km';

export function initLoueurs() {
  const carte = getCarte();
  const Ctrl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'ctrl-loueur');
      div.innerHTML = `<button type="button" class="btn-loueur" title="Afficher les agences Kiloutou du secteur">
          <img src="img/kiloutou.png" alt="" onload="this.parentNode.classList.add('avec-logo')" onerror="this.remove()">
          <span class="ic" aria-hidden="true">🔧</span><span class="txt">Kiloutou</span><small class="nb"></small></button>
        <div class="panneau-agences" hidden></div>`;
      L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div);
      bouton = div.querySelector('.btn-loueur'); panneau = div.querySelector('.panneau-agences');
      bouton.onclick = () => basculer(!actif);
      return div;
    },
  });
  carte.addControl(new Ctrl());
  couche = L.layerGroup();
  ecouter('secteur', () => { premierCadrage = true; if (actif) { dessiner(); cadrer(); } majCompteur(); });
  ecouter('ouvrir-site', () => actif && rendrePanneau());
  store.on('change', d => { if (d?.table === 'agences' || d?.table === 'secteur_departements') { majCompteur(); if (actif) dessiner(); } });
  carte.on('moveend', () => { if (actif && !etat.siteOuvert) rendrePanneau(); });
  majCompteur();
  try { if (localStorage.getItem('big_kiloutou') === '1') basculer(true, false); } catch { }
}

function majCompteur() {
  if (!bouton) return;
  const n = agencesDuSecteur().length;
  bouton.querySelector('.nb').textContent = n ? `(${n})` : '';
}

function basculer(on, cadrage = true) {
  const carte = getCarte();
  if (on && !agences().length) {
    toast(store.enLigne ? 'Liste des agences Kiloutou pas encore disponible : lancez « Import agences Kiloutou » dans GitHub › Actions' : 'Agences Kiloutou indisponibles hors connexion sur cet appareil (jamais synchronisées)', 'erreur');
    return;
  }
  actif = on;
  try { localStorage.setItem('big_kiloutou', on ? '1' : '0'); } catch { }
  bouton.classList.toggle('actif', on);
  panneau.hidden = !on;
  if (on) { couche.addTo(carte); dessiner(); if (cadrage) cadrer(); rendrePanneau(); }
  else { carte.removeLayer(couche); }
}

function cadrer() {
  if (!premierCadrage || etat.siteOuvert) return;
  const l = agencesDuSecteur(); if (!l.length) return;
  premierCadrage = false;
  getCarte().fitBounds(L.latLngBounds(l.map(a => [a.lat, a.lng])).pad(0.08), { maxZoom: 11 });
}

function popupAgence(a) {
  const s = etat.siteOuvert && store.get('sites', etat.siteOuvert);
  const d = s?.lat ? distanceKm(s, a) : null;
  return `<div class="popup-agence"><b>${esc(a.nom)}</b><br>${esc(a.adresse || '')}<br>${esc([a.code_postal, a.ville].filter(Boolean).join(' '))}
    ${d != null ? `<br><small>À ${fmtKm(d)} de « ${esc(s.nom)} » (à vol d'oiseau)</small>` : ''}
    <div class="liens">${a.telephone ? `<a class="btn btn-petit" href="tel:${esc(a.telephone.replace(/\s/g, ''))}">📞 ${esc(a.telephone)}</a>` : ''}
    <a class="btn btn-petit" target="_blank" rel="noopener" href="${lienItineraire(a, s)}">🧭 Itinéraire</a>
    <a class="btn btn-petit" target="_blank" rel="noopener" href="${lienInfos(a)}">🔎 Horaires & tél.</a></div></div>`;
}

function dessiner() {
  couche.clearLayers();
  const icone = L.divIcon({ className: '', html: '<div class="marqueur-loueur" aria-hidden="true">🔧</div>', iconSize: [24, 24], iconAnchor: [12, 12] });
  for (const a of agencesDuSecteur()) {
    L.marker([a.lat, a.lng], { icon: icone, zIndexOffset: 500, keyboard: false, title: a.nom })
      .bindPopup(() => popupAgence(a), { maxWidth: 300 }).addTo(couche);
  }
}

// Panneau latéral : agences triées par distance au site ouvert (sinon au centre de la carte)
function rendrePanneau() {
  if (!panneau || !actif) return;
  const carte = getCarte();
  const s = etat.siteOuvert && store.get('sites', etat.siteOuvert);
  const ref = s?.lat ? s : (() => { const c = carte.getCenter(); return { lat: c.lat, lng: c.lng }; })();
  const l = agencesDuSecteur().map(a => ({ a, d: distanceKm(ref, a) })).sort((x, y) => x.d - y.d);
  panneau.innerHTML = `<div class="pa-entete"><b>${l.length} agence${l.length > 1 ? 's' : ''} Kiloutou</b> — secteur ${esc(store.get('secteurs', etat.secteur)?.libelle || '')}
      <small>${s?.lat ? `Triées par distance à « ${esc(s.nom)} »` : 'Triées par distance au centre de la carte'}</small></div>
    <ul>${l.slice(0, 80).map(({ a, d }) => `<li data-id="${esc(a.id)}"><span class="pa-nom">${esc(a.ville || a.nom)}</span><span class="pa-d">${fmtKm(d)}</span><small>${esc(a.adresse || '')}</small></li>`).join('')}</ul>
    ${l.length > 80 ? `<small class="vide">… ${l.length - 80} autres plus loin</small>` : ''}`;
  panneau.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => {
    const a = store.get('agences', li.dataset.id); if (!a) return;
    carte.setView([a.lat, a.lng], Math.max(carte.getZoom(), 13));
    L.popup({ maxWidth: 300 }).setLatLng([a.lat, a.lng]).setContent(popupAgence(a)).openOn(carte);
  });
}
