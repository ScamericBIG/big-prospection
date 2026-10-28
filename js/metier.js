// Règles métier : secteurs, statuts, score de priorité, garantie décennale, formats
import { CATEGORIES } from './categories.js';
export { CATEGORIES };

// Valeurs par défaut (écrasées par les tables Supabase `secteurs` / `secteur_departements`)
export const SECTEURS_DEFAUT = [
  { code: 'nord', libelle: 'Nord', zones: 'Hauts-de-France, Grand Est, Belgique', couleur: '#505EB6', ordre: 1 },
  { code: 'idf', libelle: 'IDF', zones: 'Île-de-France', couleur: '#D4549B', ordre: 2 },
  { code: 'est', libelle: 'Est', zones: 'Auvergne-Rhône-Alpes, PACA', couleur: '#C9772B', ordre: 3 },
  { code: 'ouest', libelle: 'Ouest', zones: 'Reste de la France côté Ouest', couleur: '#2E8B6A', ordre: 4 },
  { code: 'national', libelle: 'National', zones: 'Tous secteurs', couleur: '#3B4796', ordre: 5 },
];
const D = (s, list) => Object.fromEntries(list.split(' ').map(d => [d, s]));
export const DEPARTEMENTS_DEFAUT = {
  ...D('nord', '02 59 60 62 80 08 10 51 52 54 55 57 67 68 88 BE'),
  ...D('idf', '75 77 78 91 92 93 94 95'),
  ...D('est', '01 03 07 15 26 38 42 43 63 69 73 74 04 05 06 13 83 84 2A 2B 21 25 39 58 70 71 89 90 30 34 48'),
  ...D('ouest', '14 27 50 61 76 22 29 35 56 44 49 53 72 85 18 28 36 37 41 45 16 17 19 23 24 33 40 47 64 79 86 87 09 11 12 31 32 46 65 66 81 82'),
};
export const EMPRISES_SECTEURS = {             // cadrage carte si le secteur n'a pas encore de sites
  nord: [[48.0, 1.4], [51.6, 8.3]], idf: [[48.1, 1.4], [49.25, 3.6]], est: [[42.9, 2.9], [48.4, 7.8]],
  ouest: [[42.3, -5.2], [50.1, 3.2]], national: [[41.3, -5.3], [51.6, 9.6]],
};

export const STATUTS = {
  a_qualifier:   { libelle: 'À qualifier',     couleur: '#8F9092', ordre: 0 },
  prospect:      { libelle: 'Prospect',        couleur: '#505EB6', ordre: 1 },
  en_contact:    { libelle: 'En contact',      couleur: '#1C9AC1', ordre: 2 },
  rdv:           { libelle: 'RDV',             couleur: '#7A4FB6', ordre: 3 },
  devis:         { libelle: 'Devis envoyé',    couleur: '#C8741F', ordre: 4 },
  client:        { libelle: 'Client',          couleur: '#1E8A4C', ordre: 5 },
  perdu:         { libelle: 'Perdu',           couleur: '#B23A48', ordre: 6 },
  non_pertinent: { libelle: 'Non pertinent',   couleur: '#5D5E61', ordre: 7 },
};
export const ENTONNOIR = ['prospect', 'en_contact', 'rdv', 'devis', 'client'];

export const TYPES_ACTIVITE = {
  appel: '📞 Appel', email: '✉️ Email', rdv: '📅 Rendez-vous', visite: '🏭 Visite terrain',
  devis: '💶 Devis', chantier: '🏗 Chantier réalisé', note: '📝 Note', statut: '🔄 Statut',
};
export const ROLES_CONTACT = { decideur: 'Décideur', contact: 'Contact', standard: 'Standard / accueil', prescripteur: 'Prescripteur' };

export const ANNEE = new Date().getFullYear();

// ---- valeurs effectives (saisie de l'équipe > open data)
export const catDe = s => s.categorie || s.categorie_auto || 'AUTRE';
export const surfaceDe = s => s.surface_m2 ?? s.surface_auto ?? null;
export const anneeDe = s => s.annee_construction ?? s.annee_auto ?? null;
export const ageDe = s => { const a = anneeDe(s); return a ? ANNEE - a : null; };

// Valeurs estimées (reprise de l'ancienne base) : affichées avec « ≈ » tant qu'elles ne sont ni saisies ni confirmées par l'open data
export const surfaceEstimee = s => s.surface_m2 == null && !!s.infos_od?.estimation?.surface;
export const anneeEstimee = s => s.annee_construction == null && !!s.infos_od?.estimation?.annee;

// Garantie décennale : couverte pendant 10 ans après la réception (≈ année de construction)
export function decennale(s) {
  const a = anneeDe(s);
  if (!a) return { code: 'inconnue', libelle: 'Année inconnue', classe: 'neutre' };
  const fin = a + 10, est = anneeEstimee(s) ? ' (année estimée)' : '';
  return fin > ANNEE
    ? { code: 'sous', libelle: `Sous décennale (jusqu'en ${fin})${est}`, court: 'Sous décennale' + (est ? ' ≈' : ''), classe: 'info' }
    : { code: 'hors', libelle: `Hors décennale depuis ${fin}${est}`, court: 'Hors décennale' + (est ? ' ≈' : ''), classe: 'ok' };
}

// Score de potentiel (0-100) : surface (50 pts) + ancienneté (40 pts) + activité (10 pts)
const BONUS_CAT = { LOG: 10, FRIGO: 10, AGRO: 8, TRANSPORT: 7, IND: 6, PHARMA: 6, CHIMIE: 6, COMMERCE: 6, AUTRE: 3 };
export function score(s) {
  const surf = surfaceDe(s), age = ageDe(s);
  const ps = surf ? Math.max(0, Math.min(50, 10 + 12 * Math.log2(surf / 5000))) : 10;
  const pa = age == null ? 20 : age < 10 ? age : Math.min(40, 10 + (age - 10) * 1.5);
  return Math.round(ps + pa + (BONUS_CAT[catDe(s)] ?? 3));
}
export const priorite = sc => sc >= 65 ? 'A' : sc >= 45 ? 'B' : 'C';

// Rayon du point sur la carte selon la surface
export function rayon(s) {
  const surf = surfaceDe(s);
  if (!surf) return 5;
  return Math.max(5, Math.min(24, 5 + 3.2 * Math.log2(Math.max(surf, 2500) / 5000 + 0.5)));
}

// ---- formats
const nf = new Intl.NumberFormat('fr-FR');
export const fmtN = n => n == null || isNaN(n) ? '—' : nf.format(Math.round(n));
export const fmtM2 = n => n == null ? '—' : nf.format(Math.round(n)) + ' m²';
export const fmtM2court = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M m²' : n >= 1e4 ? Math.round(n / 1000) + ' k m²' : nf.format(n) + ' m²';
export const fmtDate = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('fr-FR'); };
export const fmtDateHeure = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); };
export const fmtEuro = n => n == null ? '—' : n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const aujourdhui = () => new Date().toISOString().slice(0, 10);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sansAccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function rappelEnRetard(s) {
  return s.date_prochain_rappel && s.date_prochain_rappel < aujourdhui() && !['client', 'perdu', 'non_pertinent'].includes(s.statut);
}
export function distanceKm(a, b) {
  const k = Math.PI / 180, dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * k) * Math.cos(b.lat * k) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
export const deptDeCp = cp => {
  if (!/^\d{5}$/.test(cp || '')) return null;
  if (cp.startsWith('20')) return cp < '20200' ? '2A' : '2B';
  if (cp.startsWith('97') || cp.startsWith('98')) return cp.slice(0, 3);
  return cp.slice(0, 2);
};

// ---------------------------------------------------------------- formats d'email
// Jetons : {prenom} {nom} {p} (initiale du prénom) {n} (initiale du nom). Ex. {p}{nom}@log.com → cbrunel@log.com
const partieEmail = s => sansAccent(s).replace(/[’'`\s]+/g, '').replace(/[^a-z0-9.\-_]/g, '');
export function emailDepuisFormat(format, prenom, nom) {
  if (!format || !format.includes('@') || !nom) return null;
  const P = partieEmail(prenom), N = partieEmail(nom);
  if (/\{(prenom|p)\}/.test(format) && !P) return null;
  return format.replace(/\{prenom\}/g, P).replace(/\{nom\}/g, N).replace(/\{p\}/g, P[0] || '').replace(/\{n\}/g, N[0] || '').toLowerCase();
}
const MODELES = ['{prenom}.{nom}', '{p}{nom}', '{p}.{nom}', '{prenom}{nom}', '{prenom}_{nom}', '{prenom}-{nom}', '{nom}.{prenom}', '{nom}{p}', '{nom}', '{prenom}', '{p}{n}'];
// Retrouve le format à partir d'un contact dont l'email est connu (cbrunel@log.com + Cédric BRUNEL → {p}{nom}@log.com)
export function deduireFormat(c) {
  if (!c?.email || !c.nom || !c.email.includes('@')) return null;
  const [local, dom] = c.email.toLowerCase().split('@');
  for (const m of MODELES) {
    const e = emailDepuisFormat(`${m}@${dom}`, c.prenom || '', c.nom);
    if (e && e.split('@')[0] === local) return `${m}@${dom}`;
  }
  return null;
}
export const exempleFormat = f => emailDepuisFormat(f, 'Cédric', 'Brunel');
