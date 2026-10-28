// Itinéraire : sites autour d'une adresse + tournée optimisée (ouverture dans Google Maps / Waze)
import { store } from './store.js';
import { etat, emettre, ecouter, sauverTournee, infos } from './etat.js';
import { distanceKm, esc, fmtM2 } from './metier.js';
import { $, $$, toast, debounce } from './ui.js';
import { cadrerTournee } from './carte.js';

export async function geocoder(q) {
  q = q.trim(); if (q.length < 3) return [];
  const res = [];
  try {
    const r = await (await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`)).json();
    for (const f of r.features || []) res.push({ libelle: f.properties.label, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
  } catch { }
  // Belgique (et repli) : Nominatim / OpenStreetMap
  if (res.length < 2 || /belgi|bruxelles|brussel|anvers|antwerpen|li[eè]ge|gand|gent|charleroi|namur|mons\b/i.test(q)) {
    try {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=4&countrycodes=be,fr&accept-language=fr&q=${encodeURIComponent(q)}`)).json();
      for (const x of r) res.push({ libelle: x.display_name.split(',').slice(0, 4).join(','), lat: +x.lat, lng: +x.lon });
    } catch { }
  }
  return res;
}

export function initTournee() {
  const champ = $('#it-adresse'), sug = $('#it-suggestions');
  const chercher = debounce(async () => {
    if (!navigator.onLine) { sug.innerHTML = '<button disabled>Recherche d’adresse indisponible hors connexion</button>'; sug.hidden = false; return; }
    const r = await geocoder(champ.value);
    sug.innerHTML = r.map((x, k) => `<button data-k="${k}">${esc(x.libelle)}</button>`).join('');
    sug.hidden = !r.length;
    $$('button[data-k]', sug).forEach(b => b.onclick = () => { definirCentre(r[b.dataset.k]); sug.hidden = true; champ.value = r[b.dataset.k].libelle; });
  }, 300);
  champ.addEventListener('input', chercher);
  champ.addEventListener('blur', () => setTimeout(() => sug.hidden = true, 200));
  $('#it-position').onclick = () => {
    if (!navigator.geolocation) return toast('Géolocalisation indisponible', 'erreur');
    navigator.geolocation.getCurrentPosition(p => definirCentre({ libelle: 'Ma position', lat: p.coords.latitude, lng: p.coords.longitude }),
      () => toast('Position refusée ou indisponible', 'erreur'), { enableHighAccuracy: true, timeout: 10000 });
  };
  $('#it-effacer').onclick = () => effacerItineraire();
  $('#it-rayon').addEventListener('input', e => {
    $('#it-rayon-val').textContent = e.target.value + ' km';
    if (etat.autour) { etat.autour.rayon = +e.target.value; emettreAutour(); }
  });
  ecouter('tournee', rendre);
  store.on('change', d => { if (d?.table === 'sites') rendre(); });
  rendre();
}
const emettreAutour = debounce(() => emettre('autour'), 150);

function definirCentre(p) {
  etat.autour = { ...p, rayon: +$('#it-rayon').value };
  if (!etat.depart || etat.depart.auto) etat.depart = { ...p, auto: true };
  sauverTournee(); emettre('autour'); emettre('tournee');
}

function rendre() {
  const el = $('#tournee');
  const sites = etat.tournee.map(id => store.get('sites', id)).filter(Boolean);
  if (!sites.length) {
    el.innerHTML = `<p class="vide">Ajoutez des sites à votre tournée depuis leur fiche (« + Tournée »).${etat.depart ? `<br>Départ : ${esc(etat.depart.libelle)} <button class="lien" id="to-sans-depart">retirer</button>` : ''}</p>`;
    $('#to-sans-depart')?.addEventListener('click', () => { etat.depart = null; maj(); });
    return;
  }
  let km = 0, prec = etat.depart;
  for (const s of sites) { if (prec && s.lat) km += distanceKm(prec, s); if (s.lat) prec = s; }
  el.innerHTML = `
    <div><b>Tournée : ${sites.length} site${sites.length > 1 ? 's' : ''}</b> · ≈ ${Math.round(km * 1.3)} km par la route</div>
    ${etat.depart ? `<div class="vide">Départ : ${esc(etat.depart.libelle)} <button class="lien" id="to-sans-depart">retirer</button></div>` : ''}
    <ol>${sites.map((s, k) => `<li><a href="#" data-o="${s.id}">${esc(s.nom)}</a> <small class="vide">${esc(s.ville || '')} · ${fmtM2(infos(s).surface)}</small>
      <button class="btn-icone" data-x="${s.id}" title="Retirer">✕</button>${k ? `<button class="btn-icone" data-up="${k}" title="Monter">↑</button>` : ''}</li>`).join('')}</ol>
    <div class="actions">
      <button class="btn btn-petit" id="to-opt">⚡ Optimiser l'ordre</button>
      <button class="btn btn-petit" id="to-voir">🗺 Voir</button>
      <a class="btn btn-petit btn-primaire" id="to-gmaps" target="_blank" rel="noopener">Google Maps</a>
      <button class="btn btn-petit" id="to-vider">Vider</button>
    </div>`;
  $('#to-sans-depart')?.addEventListener('click', () => { etat.depart = null; maj(); });
  $$('[data-o]', el).forEach(a => a.onclick = e => { e.preventDefault(); emettre('ouvrir-site', a.dataset.o); });
  $$('[data-x]', el).forEach(b => b.onclick = () => { etat.tournee = etat.tournee.filter(i => i !== b.dataset.x); maj(); });
  $$('[data-up]', el).forEach(b => b.onclick = () => { const k = +b.dataset.up; [etat.tournee[k - 1], etat.tournee[k]] = [etat.tournee[k], etat.tournee[k - 1]]; maj(); });
  $('#to-opt').onclick = () => { optimiser(); maj(); toast('Ordre optimisé (plus proche voisin + 2-opt)'); };
  $('#to-voir').onclick = () => { emettre('aller-vue', 'carte'); cadrerTournee(); };
  $('#to-vider').onclick = () => { etat.tournee = []; maj(); };
  // Google Maps : 9 étapes intermédiaires maximum
  const pts = sites.filter(s => s.lat).map(s => `${s.lat},${s.lng}`);
  if (pts.length) {
    const origine = etat.depart ? `${etat.depart.lat},${etat.depart.lng}` : pts[0];
    const etapes = (etat.depart ? pts : pts.slice(1)).slice(0, 10);
    const dest = etapes.pop() || pts[0];
    $('#to-gmaps').href = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${origine}&destination=${dest}${etapes.length ? '&waypoints=' + etapes.join('|') : ''}`;
    if (pts.length > 10) $('#to-gmaps').title = 'Google Maps limite l’itinéraire aux 10 premiers sites';
  }
}
function maj() { sauverTournee(); emettre('tournee'); }

// « Effacer » et « Réinitialiser » : retire la zone de recherche ET le point de départ qu'elle avait posé
export function effacerItineraire() {
  etat.autour = null;
  const champ = $('#it-adresse'); if (champ) champ.value = '';
  if (etat.depart?.auto) etat.depart = null;
  sauverTournee();
  emettre('autour'); emettre('tournee');
}

function optimiser() {
  const sites = etat.tournee.map(id => store.get('sites', id)).filter(s => s?.lat);
  const sansPos = etat.tournee.filter(id => !store.get('sites', id)?.lat);
  if (sites.length < 2) return;
  // plus proche voisin
  const reste = [...sites], ordre = [];
  let cur = etat.depart || reste.shift();
  if (!etat.depart) ordre.push(cur);
  while (reste.length) {
    let k = 0, best = Infinity;
    reste.forEach((s, i) => { const d = distanceKm(cur, s); if (d < best) { best = d; k = i; } });
    cur = reste.splice(k, 1)[0]; ordre.push(cur);
  }
  // 2-opt
  const pts = etat.depart ? [etat.depart, ...ordre] : ordre;
  const d = (a, b) => distanceKm(a, b);
  let amelio = true, tours = 0;
  while (amelio && tours++ < 50) {
    amelio = false;
    for (let i = 1; i < pts.length - 2; i++) for (let j = i + 1; j < pts.length - 1; j++) {
      if (d(pts[i - 1], pts[i]) + d(pts[j], pts[j + 1]) > d(pts[i - 1], pts[j]) + d(pts[i], pts[j + 1]) + 1e-9) {
        pts.splice(i, j - i + 1, ...pts.slice(i, j + 1).reverse()); amelio = true;
      }
    }
  }
  etat.tournee = [...(etat.depart ? pts.slice(1) : pts).map(s => s.id), ...sansPos];
}
