#!/usr/bin/env node
/**
 * BIG Prospection — vérification des établissements (France)
 *   - établissement actif ou définitivement fermé (base SIRENE, via l'API Recherche d'entreprises) ;
 *   - nom concret pour les sites « Bâtiment industriel… », « Site industriel… » ou nommés d'après leur propriétaire (SCI) :
 *     entreprise active installée sur place ;
 *   - site fermé : nouvel occupant probable à la même adresse.
 * Les sites sont vérifiés par lots (les jamais vérifiés d'abord, puis ceux vérifiés il y a plus de 30 jours).
 *
 * Usage : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/verifier-etablissements.mjs [--nb 12000] [--jours 30]
 */
import { categorieDepuisNaf, nafExclu, LIBELLES_NAF_DIVISION } from '../js/categories.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const NB = Number(opt('nb', process.env.NB || 12000));
const JOURS = Number(opt('jours', process.env.JOURS || 30));
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SUPABASE_URL || !KEY) { console.error('Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const hSupa = { apikey: KEY, 'content-type': 'application/json', 'user-agent': 'BIG-Prospection/1.0 (verification)', ...(KEY.startsWith('eyJ') ? { authorization: 'Bearer ' + KEY } : {}) };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const titre = s => (s || '').toLowerCase().replace(/(^|[\s\-'’(])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
const nomGenerique = n => !n || !n.trim() || /^(bâtiment|batiment|site) (industriel|logistique)/i.test(n);
const MOTS_VIDES = new Set(['sas', 'sarl', 'societe', 'groupe', 'france', 'transports', 'transport', 'logistique', 'logistics', 'entrepot', 'entrepots', 'site', 'des', 'les', 'and', 'industrie', 'industries', 'services']);
const mots = n => new Set(String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(m => m.length >= 3 && !MOTS_VIDES.has(m)));
const memeNom = (a, b) => { const A = mots(a), B = mots(b); for (const m of A) if (B.has(m)) return true; return false; };
const chiffres = s => String(s || '').replace(/\D/g, '');

async function obtenir(url, { essais = 5, ...opts } = {}) {
  for (let i = 1; i <= essais; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { accept: 'application/json', 'user-agent': 'BIG-Prospection/1.0 (verification)', ...(opts.headers || {}) } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`), { fatal: true });
      const t = await r.text(); return t ? JSON.parse(t) : null;
    } catch (e) { if (e.fatal || i === essais) throw e; await sleep(1500 * i * i); }
  }
}

// API Recherche d'entreprises : 7 requêtes / seconde maximum
let prochain = 0;
async function re(chemin) {
  const t = Math.max(Date.now(), prochain); prochain = t + 160;
  if (t > Date.now()) await sleep(t - Date.now());
  return obtenir('https://recherche-entreprises.api.gouv.fr' + chemin);
}
const distM = (a, b) => { const k = Math.PI / 180, x = (b.lng - a.lng) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k; return Math.sqrt(x * x + y * y) * 6371000; };
const POIDS_EFFECTIF = { NN: 0, '00': 0, '01': 1, '02': 1, '03': 2, '11': 3, '12': 4, '21': 5, '22': 6, '31': 7, '32': 8, '41': 9, '42': 10, '51': 11, '52': 12, '53': 13 };

// entreprises actives installées autour du point (rayon en km)
async function occupants(lat, lng, rayon = 0.15) {
  const j = await re(`/near_point?lat=${lat.toFixed(6)}&long=${lng.toFixed(6)}&radius=${rayon}&per_page=25&page=1`);
  const l = [];
  for (const r of j?.results || []) for (const e of r.matching_etablissements || []) {
    if (e.etat_administratif && e.etat_administratif !== 'A') continue;
    const naf = e.activite_principale || r.activite_principale;
    if (!naf || nafExclu(naf)) continue;
    const elat = Number(e.latitude), elng = Number(e.longitude);
    const d = isFinite(elat) && isFinite(elng) ? distM({ lat, lng }, { lat: elat, lng: elng }) : rayon * 1000;
    let score = -d / 25 + (POIDS_EFFECTIF[e.tranche_effectif_salarie || r.tranche_effectif_salarie] || 0) * 2;
    if (categorieDepuisNaf(naf) !== 'AUTRE') score += 15;
    if (/^68/.test(naf)) score -= 30;            // sociétés immobilières : propriétaires, pas occupants
    l.push({ nom: titre((e.liste_enseignes && e.liste_enseignes[0]) || r.nom_complet), siren: r.siren, siret: e.siret, naf, d: Math.round(d), score });
  }
  return l.sort((a, b) => b.score - a.score);
}

// recherche d'une entreprise par SIREN / SIRET : état de l'unité légale et de l'établissement
async function fiche(numero) {
  const j = await re(`/search?q=${numero}&page=1&per_page=5`);
  return (j?.results || []).find(r => r.siren === numero.slice(0, 9)) || null;
}

async function verifier(s) {
  const siret = /^\d{14}$/.test(chiffres(s.siret)) ? chiffres(s.siret) : null;
  const siren = siret ? siret.slice(0, 9) : (/^\d{9}$/.test(chiffres(s.siren)) ? chiffres(s.siren) : null);
  const out = { id: s.id, etat: null, resultat: {} };
  // 1. état officiel
  if (siret || siren) {
    const ul = await fiche(siret || siren);
    if (ul) {
      const etabs = [...(ul.matching_etablissements || []), ul.siege].filter(Boolean);
      let e = siret ? etabs.find(x => x.siret === siret) : null;
      if (!e && !siret && s.lat) {                 // seulement un SIREN : établissement le plus proche du site
        e = etabs.filter(x => isFinite(Number(x.latitude))).map(x => ({ x, d: distM(s, { lat: Number(x.latitude), lng: Number(x.longitude) }) }))
          .filter(o => o.d < 400).sort((a, b) => a.d - b.d)[0]?.x || null;
        if (e) out.siret = e.siret;
      }
      if (e) { out.etat = e.etat_administratif === 'F' ? 'ferme' : 'actif'; out.date_fermeture = e.date_fermeture || null; }
      else if (ul.etat_administratif === 'C') { out.etat = 'ferme'; out.date_fermeture = ul.date_fermeture || null; }
      out.resultat.sirene = { siren: ul.siren, ul: ul.etat_administratif, etab: e?.etat_administratif || null };
    } else out.resultat.sirene = 'introuvable';
  }
  // 2. occupant actuel : nom générique / propriétaire, pas d'identifiant, ou établissement fermé
  const generique = nomGenerique(s.nom) || (s.proprietaire && s.nom?.toLowerCase() === s.proprietaire.toLowerCase());
  if (s.lat && s.lng && (generique || ((!siret || out.etat === 'ferme') && out.etat !== 'actif'))) {
    const l = await occupants(s.lat, s.lng);
    const best = l[0];
    if (best) {
      out.resultat.occupant = { nom: best.nom, siret: best.siret, d: best.d };
      if (out.etat === 'actif' && best.siren === siren) { /* l'occupant est l'entreprise déjà connue */ }
      else if (out.etat === 'ferme') {
        if (best.siren === siren) { out.etat = 'actif'; out.resultat.transfert = best.siret; }   // même entreprise, nouveau SIRET
        else out.nouvel_occupant = { nom: best.nom, siret: best.siret, naf: best.naf, distance_m: best.d, le: new Date().toISOString().slice(0, 10) };
      } else if (!generique && !memeNom(s.nom, best.nom)) {
        // site déjà nommé (ancienne base, saisie) mais l'entreprise trouvée sur place porte un autre nom : simple indication
        out.nouvel_occupant = { nom: best.nom, siret: best.siret, naf: best.naf, distance_m: best.d, possible: true, le: new Date().toISOString().slice(0, 10) };
      } else {
        out.etat = 'actif';
        out.siret = generique ? best.siret : (out.siret || best.siret); out.siren = best.siren; out.naf = best.naf;
        out.naf_libelle = LIBELLES_NAF_DIVISION[best.naf.replace(/\D/g, '').slice(0, 2)] || null;
        if (generique) out.nom = best.nom;
      }
    }
  }
  if (!out.etat) out.etat = s.etat_etablissement === 'ferme' ? 'ferme' : 'inconnu';
  return out;
}

// ------------------------------------------------------------------ exécution
const rpc = (f, corps) => obtenir(`${SUPABASE_URL}/rest/v1/rpc/${f}`, { method: 'POST', body: JSON.stringify(corps), headers: hSupa });
const sites = await rpc('sites_a_verifier', { nb: NB, jours: JOURS });
log(`${sites.length} sites à vérifier (jamais vérifiés ou vérifiés il y a plus de ${JOURS} jours)`);
const stats = { actif: 0, ferme: 0, inconnu: 0, renommes: 0, occupants: 0, erreurs: 0, modifies: 0 };
let lot = [];
const envoyer = async () => { if (!lot.length) return; stats.modifies += await rpc('maj_etablissements', { rows: lot }); lot = []; };
let k = 0;
const file = [...sites];
async function ouvrier() {
  for (; ;) {
    const s = file.shift(); if (!s) return;
    try {
      const r = await verifier(s);
      stats[r.etat]++; if (r.nom) stats.renommes++; if (r.nouvel_occupant) stats.occupants++;
      lot.push(r);
    } catch (e) { stats.erreurs++; if (stats.erreurs < 20) log('  !', s.id, e.message); }
    if (++k % 500 === 0) { log(`  … ${k}/${sites.length}`, JSON.stringify(stats)); }
    if (lot.length >= 200) { const l = lot; lot = []; stats.modifies += await rpc('maj_etablissements', { rows: l }); }
  }
}
await Promise.all([ouvrier(), ouvrier(), ouvrier(), ouvrier()]);
await envoyer();
log(`Terminé : ${stats.actif} actifs, ${stats.ferme} fermés, ${stats.inconnu} non déterminés ; ${stats.renommes} noms trouvés, ${stats.occupants} nouveaux occupants ; ${stats.modifies} sites modifiés ; ${stats.erreurs} erreurs`);
if (stats.erreurs > sites.length / 2) process.exit(1);
