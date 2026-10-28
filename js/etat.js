// État partagé de l'interface : secteur affiché, filtres, zone « autour de », tournée
import { store } from './store.js';
import {
  catDe, surfaceDe, anneeDe, decennale, score, priorite, rappelEnRetard, sansAccent, distanceKm, aujourdhui,
} from './metier.js';

export const FILTRES_VIDES = () => ({
  texte: '', cp: '', ville: '', categories: new Set(), surfMin: null, surfMax: null,
  decennale: new Set(), anneeMin: null, anneeMax: null, statuts: new Set(), priorites: new Set(),
  retard: false, semaine: false, reference: false, assigne: '', groupe: '', categoriesMasquees: new Set(),
});

export const etat = {
  secteur: 'national',
  filtres: FILTRES_VIDES(),
  autour: null,            // { lat, lng, rayon (km), libelle }
  tournee: [],             // ids de sites
  depart: null,            // { lat, lng, libelle }
  siteOuvert: null,
};

try {
  const t = JSON.parse(localStorage.getItem('big_tournee') || 'null');
  if (t) { etat.tournee = t.sites || []; etat.depart = t.depart || null; }
} catch { }
export const sauverTournee = () => { try { localStorage.setItem('big_tournee', JSON.stringify({ sites: etat.tournee, depart: etat.depart })); } catch { } };

const bus = new EventTarget();
export const emettre = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const ecouter = (type, fn) => bus.addEventListener(type, e => fn(e.detail));

// ---- cache des valeurs calculées par site (score, catégorie…), invalidé à chaque modification
const calc = new WeakMap();
export function infos(s) {
  let c = calc.get(s);
  if (!c) {
    const sc = score(s);
    c = {
      cat: catDe(s), surface: surfaceDe(s), annee: anneeDe(s), dec: decennale(s).code, score: sc, prio: priorite(sc),
      recherche: sansAccent([s.nom, s.enseigne, s.proprietaire, s.ville, s.code_postal, s.siren, s.siret, s.adresse].filter(Boolean).join(' ')),
      ville: sansAccent(s.ville),
    };
    calc.set(s, c);
  }
  return c;
}

const memoSecteur = new Map();
export function sitesDuSecteur(code = etat.secteur) {
  const m = memoSecteur.get(code);
  if (m && m.v === version) return m.res;
  const tous = store.liste('sites');
  const res = code === 'national' ? tous : tous.filter(s => (s.secteur || store.secteurDe(s)) === code);
  memoSecteur.set(code, { v: version, res });
  return res;
}

// Pré-calcul des scores / catégories / textes de recherche pendant les temps morts du navigateur :
// les premiers filtres et changements de secteur sont ensuite instantanés.
export function prechauffer() {
  const sites = store.liste('sites'); let k = 0;
  const tranche = dl => {
    const fin = Math.min(sites.length, k + 2000);
    for (; k < fin; k++) infos(sites[k]);
    if (k < sites.length) planifier(tranche);
  };
  const planifier = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 16));
  planifier(tranche);
}

let memo = { cle: null, res: [] };
let version = 0;
export const invalider = () => { version++; };
store.on('change', d => { if (!d || ['sites', 'secteur_departements', 'groupes'].includes(d.table)) invalider(); });

export function sitesFiltres({ ignorerMasquees = false } = {}) {
  const f = etat.filtres;
  const cle = version + '|' + etat.secteur + '|' + JSON.stringify(f, (k, v) => v instanceof Set ? [...v] : v) + '|' + JSON.stringify(etat.autour) + '|' + ignorerMasquees;
  if (memo.cle === cle) return memo.res;
  const txt = sansAccent(f.texte).trim().split(/\s+/).filter(Boolean);
  const ville = sansAccent(f.ville).trim();
  const cp = f.cp.trim();
  const auj = aujourdhui();
  const dans7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const res = sitesDuSecteur().filter(s => {
    const i = infos(s);
    if (txt.length && !txt.every(t => i.recherche.includes(t))) return false;
    if (cp && !(s.code_postal || '').startsWith(cp) && s.departement !== cp.toUpperCase()) return false;
    if (ville && !i.ville.includes(ville)) return false;
    if (f.categories.size && !f.categories.has(i.cat)) return false;
    if (!ignorerMasquees && f.categoriesMasquees.size && f.categoriesMasquees.has(i.cat)) return false;
    if (f.surfMin && !(i.surface >= f.surfMin)) return false;
    if (f.surfMax && !(i.surface <= f.surfMax)) return false;
    if (f.decennale.size && !f.decennale.has(i.dec)) return false;
    if (f.anneeMin && !(i.annee >= f.anneeMin)) return false;
    if (f.anneeMax && !(i.annee <= f.anneeMax)) return false;
    if (f.statuts.size && !f.statuts.has(s.statut || 'a_qualifier')) return false;
    if (f.priorites.size && !f.priorites.has(i.prio)) return false;
    if (f.retard && !rappelEnRetard(s)) return false;
    if (f.reference && !(s.groupe_id && store.get('groupes', s.groupe_id)?.reference)) return false;
    if (f.semaine && !(s.date_prochain_rappel && s.date_prochain_rappel >= auj && s.date_prochain_rappel <= dans7)) return false;
    if (f.assigne && (f.assigne === '_aucun' ? s.assigne_a : s.assigne_a !== f.assigne)) return false;
    if (f.groupe && s.groupe_id !== f.groupe) return false;
    if (etat.autour && !(s.lat && distanceKm(etat.autour, s) <= etat.autour.rayon)) return false;
    return true;
  });
  memo = { cle, res };
  return res;
}

export function nomCA(email) {
  const p = store.get('profils', email);
  return p ? `${p.prenom} ${p.nom}` : (email || '—');
}
