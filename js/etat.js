// État partagé de l'interface : secteur affiché, filtres, zone « autour de », tournée
import { store } from './store.js';
import {
  catDe, surfaceDe, anneeDe, decennale, score, priorite, rappelEnRetard, sansAccent, distanceKm, aujourdhui, etatEtab, nomGenerique,
} from './metier.js';
import { DALLAGE } from './pole.js';

export const FILTRES_VIDES = () => ({
  texte: '', cp: '', ville: '', categories: new Set(), surfMin: null, surfMax: null,
  decennale: new Set(), anneeMin: null, anneeMax: null, statuts: new Set(), priorites: new Set(),
  retard: false, semaine: false, reference: false, assigne: '', groupe: '', categoriesMasquees: new Set(),
  etats: new Set(['actif', 'inconnu']),   // établissements fermés masqués par défaut
  nomIdentifie: false,
  strategie: '', strategieAFaire: false,  // '' | '_mes' (mes stratégies en cours) | id d'une stratégie
  // pôle Dallage : permis de construire
  permis: '', permisDu: '', permisAu: '', etapes: new Set(), nouveaux: false, masquerNonPertinents: DALLAGE,
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

const memos = new Map();
let version = 0;
export const invalider = () => { version++; };
store.on('change', d => {
  if (!d || ['sites', 'secteur_departements', 'groupes', 'strategies', 'strategie_sites'].includes(d.table)) invalider();
  else if (etat.filtres.strategie && ['activites', 'contacts', 'actualites'].includes(d.table)) invalider();   // avancement des stratégies
});

// Période du filtre « Permis de construire » → bornes de dates (AAAA-MM-JJ)
const jourLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function bornesPermis(f) {
  const a = new Date();
  if (f.permis === 'semaine') { const l = new Date(a); l.setDate(a.getDate() - ((a.getDay() + 6) % 7)); return [jourLocal(l), null]; }
  if (f.permis === 'mois') return [jourLocal(new Date(a.getFullYear(), a.getMonth(), 1)), null];
  if (f.permis === 'annee') return [jourLocal(new Date(a.getFullYear(), 0, 1)), null];
  if (f.permis === 'anterieur') return [null, jourLocal(new Date(a.getFullYear() - 1, 11, 31))];
  if (f.permis === '30j') return [jourLocal(new Date(Date.now() - 30 * 864e5)), null];
  return [f.permisDu || null, f.permisAu || null];
}

// Test d'un site selon un jeu de filtres (panneau de filtres, ou critères d'une stratégie)
export function construireTest(f, autour = null) {
  const txt = sansAccent(f.texte || '').trim().split(/\s+/).filter(Boolean);
  const ville = sansAccent(f.ville || '').trim();
  const cp = (f.cp || '').trim();
  const cps = cp.split(/[ ,;]+/).filter(Boolean);
  const auj = aujourdhui();
  const dans7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const vide = x => !x || !x.size;
  const [pDu, pAu] = bornesPermis(f);
  const recents = new Date(Date.now() - 7 * 864e5).toISOString();
  const masquerNP = f.masquerNonPertinents && !(f.statuts && f.statuts.has('non_pertinent'));
  return (s, ignorerMasquees = false) => {
    if (pDu || pAu) { const d = s.infos_od?.permis?.date; if (!d || (pDu && d < pDu) || (pAu && d > pAu)) return false; }
    if (!vide(f.etapes) && !f.etapes.has(s.infos_od?.permis?.etape)) return false;
    if (f.nouveaux && !((s.created_at || '') >= recents)) return false;
    if (masquerNP && s.statut === 'non_pertinent') return false;
    const i = infos(s);
    if (txt.length && !txt.every(t => i.recherche.includes(t))) return false;
    if (cps.length && !cps.some(c => (s.code_postal || '').startsWith(c) || s.departement === c.toUpperCase())) return false;
    if (ville && !i.ville.includes(ville)) return false;
    if (!vide(f.categories) && !f.categories.has(i.cat)) return false;
    if (!ignorerMasquees && !vide(f.categoriesMasquees) && f.categoriesMasquees.has(i.cat)) return false;
    if (f.surfMin && !(i.surface >= f.surfMin)) return false;
    if (f.surfMax && !(i.surface <= f.surfMax)) return false;
    if (!vide(f.decennale) && !f.decennale.has(i.dec)) return false;
    if (f.anneeMin && !(i.annee >= f.anneeMin)) return false;
    if (f.anneeMax && !(i.annee <= f.anneeMax)) return false;
    if (!vide(f.statuts) && !f.statuts.has(s.statut || 'a_qualifier')) return false;
    if (!vide(f.priorites) && !f.priorites.has(i.prio)) return false;
    if (f.retard && !rappelEnRetard(s)) return false;
    if (f.reference && !(s.groupe_id && store.get('groupes', s.groupe_id)?.reference)) return false;
    if (f.semaine && !(s.date_prochain_rappel && s.date_prochain_rappel >= auj && s.date_prochain_rappel <= dans7)) return false;
    if (f.assigne && (f.assigne === '_aucun' ? s.assigne_a : s.assigne_a !== f.assigne)) return false;
    if (f.groupe && s.groupe_id !== f.groupe) return false;
    if (!vide(f.etats) && !f.etats.has(etatEtab(s))) return false;
    if (f.nomIdentifie && nomGenerique(s.nom)) return false;
    if (autour && !(s.lat && distanceKm(autour, s) <= autour.rayon)) return false;
    return true;
  };
}

let filtreStrategie = null;   // fourni par strategies-core.js (évite une dépendance circulaire au chargement)
export const brancherFiltreStrategie = fn => { filtreStrategie = fn; };

export function sitesFiltres({ ignorerMasquees = false, secteur = etat.secteur } = {}) {
  const f = etat.filtres;
  const cle = version + '|' + secteur + '|' + JSON.stringify(f, (k, v) => v instanceof Set ? [...v] : v) + '|' + JSON.stringify(etat.autour) + '|' + ignorerMasquees;
  if (memos.has(cle)) return memos.get(cle);
  const test = construireTest(f, etat.autour);
  // filtre « stratégie » : on part de toute la France (une mission peut déborder du secteur affiché)
  const strat = f.strategie && filtreStrategie ? filtreStrategie(f.strategie, f.strategieAFaire) : null;
  const base = strat ? sitesDuSecteur('national') : sitesDuSecteur(secteur);
  const res = base.filter(s => (!strat || strat.has(s.id)) && test(s, ignorerMasquees));
  memos.set(cle, res); if (memos.size > 6) memos.delete(memos.keys().next().value);
  return res;
}

export function nomCA(email) {
  const p = store.get('profils', email);
  return p ? `${p.prenom} ${p.nom}` : (email || '—');
}
