#!/usr/bin/env node
/**
 * BIG Prospection — pôle DALLAGE : base des acteurs et projets de construction en Nouvelle-Aquitaine
 *   1. Projets : permis de construire de locaux d'activité (entrepôt, industrie, artisanat, agricole, commerce) ≥ SURFACE_MIN m²,
 *      autorisés depuis 36 mois — base officielle Sitadel (SDES, data.gouv.fr, mise à jour mensuelle).
 *   2. Acteurs (base SIRENE via l'API Recherche d'entreprises) : architectes, AMO / bureaux d'études, promoteurs et investisseurs,
 *      contractants généraux, agences régionales des majors du BTP, sièges sociaux industriels et logistiques (≥ 50 salariés).
 * Résultat : table dal_sites (fonction dal_import ; le suivi commercial n'est jamais écrasé).
 *
 * Usage : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-dallage.mjs [--min 500] [--mois 36] [--sans-projets] [--sans-acteurs] [--out dossier]
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SURFACE_MIN = Number(opt('min', process.env.SURFACE_MIN || 500));
const MOIS = Number(opt('mois', process.env.MOIS || 36));
const OUT = opt('out', '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!OUT && !(SUPABASE_URL && KEY)) { console.error('Définissez SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, ou --out <dossier>'); process.exit(1); }
const hSupa = { apikey: KEY, 'content-type': 'application/json', 'user-agent': 'BIG-Prospection/1.0 (dallage)', ...(KEY.startsWith('eyJ') ? { authorization: 'Bearer ' + KEY } : {}) };

const DEPTS = ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'];   // Nouvelle-Aquitaine
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const titre = s => String(s || '').toLowerCase().replace(/(^|[\s\-'’(&/])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Sas|Sarl|Sa|Sci|Snc|Eurl|Sasu|Btp|Be|Amo)\b/g, m => m.toUpperCase());

async function obtenir(url, { essais = 5, json = true, ...opts } = {}) {
  for (let i = 1; i <= essais; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'user-agent': 'BIG-Prospection/1.0 (dallage)', accept: json ? 'application/json' : '*/*', ...(opts.headers || {}) } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`), { fatal: true });
      if (!json) return r;
      const t = await r.text(); return t ? JSON.parse(t) : null;
    } catch (e) { if (e.fatal || i === essais) throw e; await sleep(1500 * i * i); }
  }
}

// ======================================================================= 1. PROJETS (Sitadel)
const DATASET_SITADEL = '689c42fa521ccf80ce954f83';   // « Liste des permis de construire et autres autorisations d'urbanisme »
const DEST = { ENT: 'entrepot', IND: 'industrie', ART: 'artisanat', AGR: 'agricole', COM: 'commerce', BUR: 'bureaux', PUB: 'service_public', SP: 'service_public', SER: 'service_public', HEB: 'hebergement' };
const DEST_UTILES = new Set(['entrepot', 'industrie', 'artisanat', 'agricole', 'commerce']);
const LIB_DEST = { entrepot: 'Entrepôt', industrie: 'Industrie', artisanat: 'Artisanat', agricole: 'Bâtiment agricole', commerce: 'Commerce' };

// découpe d'une ligne CSV « ; » ou « , » avec guillemets
function decouper(ligne, sep) {
  const res = []; let cur = '', q = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (q) { if (c === '"') { if (ligne[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { res.push(cur); cur = ''; } else cur += c;
  }
  res.push(cur); return res;
}
// lecture en flux d'un gros fichier CSV (plusieurs centaines de Mo) ligne par ligne
async function* lignesCsv(url) {
  const r = await obtenir(url, { json: false, essais: 3 });
  const dec = new TextDecoder(/latin|1252/i.test(r.headers.get('content-type') || '') ? 'latin1' : 'utf-8');
  let reste = '';
  for await (const morceau of r.body) {
    reste += dec.decode(morceau, { stream: true });
    let k; while ((k = reste.indexOf('\n')) >= 0) { yield reste.slice(0, k).replace(/\r$/, ''); reste = reste.slice(k + 1); }
  }
  if (reste) yield reste;
}
async function fichierLocaux() {
  if (process.env.SITADEL_URL) return process.env.SITADEL_URL;
  const ds = await obtenir(`https://www.data.gouv.fr/api/1/datasets/${DATASET_SITADEL}/`);
  const csv = (ds?.resources || []).filter(r => /csv/i.test(r.format || '') || /\.csv/i.test(r.url || ''));
  log(`  Sitadel : ${csv.length} fichiers CSV — ${csv.map(r => r.title).join(' | ')}`);
  const locaux = csv.find(r => /locaux/i.test(r.title || '') && !/logement/i.test(r.title || '')) || csv.find(r => /non.?r[ée]sidentiel/i.test(r.title || ''));
  if (!locaux) throw new Error('fichier « locaux » introuvable dans le jeu de données Sitadel');
  return locaux.latest || locaux.url;
}
function colonnes(entete) {
  const H = entete.map(h => h.trim().replace(/^﻿/, '').toUpperCase());
  const trouve = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
  const surf = [];
  H.forEach((h, i) => { const m = h.match(/^SURF_([A-Z]+?)_(CREE|CRE)/); if (m && DEST[m[1]]) surf.push([i, DEST[m[1]]]); });
  return {
    H, surf,
    dep: trouve(/^DEP(_CODE)?$/, /^CODE_DEP/, /^DEPARTEMENT/), comm: trouve(/^COMM$/, /^CODE_COMMUNE/, /^COM$/, /^DEPCOM/),
    num: trouve(/^NUM_DAU$/, /^NUM_PC/, /^NUM_/), etat: trouve(/^ETAT_DAU$/, /^ETAT/), type: trouve(/^TYPE_DAU$/, /^TYPE_/),
    dateAut: trouve(/^DATE_REELLE_AUTORISATION$/, /^DATE_AUT/, /^DPC_AUT$/), dateDoc: trouve(/^DATE_REELLE_DOC$/, /^DATE_DOC/), dateFin: trouve(/^DATE_REELLE_DAACT$/, /DAACT/),
    denom: trouve(/^DENOM_DEM$/, /^DENOMINATION/, /DENOM/), siren: trouve(/^SIREN_DEM$/, /^SIREN/), siret: trouve(/^SIRET_DEM$/, /^SIRET/),
    num_voie: trouve(/^ADR_NUM_TER$/), type_voie: trouve(/^ADR_TYPEVOIE_TER$/), voie: trouve(/^ADR_LIBVOIE_TER$/), lieudit: trouve(/^ADR_LIEUDIT_TER$/),
    cp: trouve(/^ADR_CODPOST_TER$/, /^CODE_POSTAL/), localite: trouve(/^ADR_LOCALITE_TER$/, /^LIBELLE_COMMUNE/, /^NOM_COMMUNE/),
    nature: trouve(/^NATURE_PROJET_COMPLETEE$/, /^NATURE_PROJET/), terrain: trouve(/^SUPERFICIE_TERRAIN$/, /^SUPERFICIE_T/),
    x: trouve(/^X$/, /^COORD_X/), y: trouve(/^Y$/, /^COORD_Y/), lat: trouve(/^LAT/), lng: trouve(/^LON/),
  };
}
const dateIso = v => { v = String(v || '').trim(); if (!v) return null; const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/) || v.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`; };
const nombre = v => { const n = Number(String(v || '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };

async function projets() {
  const url = await fichierLocaux();
  log(`  Sitadel : lecture de ${url}`);
  const lim = new Date(Date.now() - MOIS * 30.5 * 864e5).toISOString().slice(0, 10);
  let C = null, sep = ';', n = 0, gardes = [];
  for await (const ligne of lignesCsv(url)) {
    if (!C) { sep = (ligne.match(/;/g) || []).length >= (ligne.match(/,/g) || []).length ? ';' : ','; C = colonnes(decouper(ligne, sep)); log(`  colonnes : ${C.H.length} (surfaces : ${C.surf.map(([i, d]) => C.H[i] + '→' + d).join(', ') || 'aucune !'})`); if (C.dep < 0 || !C.surf.length) throw new Error('format Sitadel inattendu : ' + C.H.slice(0, 40).join(',')); continue; }
    n++;
    const v = decouper(ligne, sep);
    const dep = String(v[C.dep] || '').trim().padStart(2, '0');
    if (!DEPTS.includes(dep)) continue;
    const surfaces = {}; let total = 0;
    for (const [i, d] of C.surf) { const x = nombre(v[i]); if (x > 0 && DEST_UTILES.has(d)) { surfaces[d] = (surfaces[d] || 0) + x; total += x; } }
    if (total < SURFACE_MIN) continue;
    const date = dateIso(v[C.dateAut]);
    if (!date || date < lim) continue;
    const etat = String(v[C.etat] ?? '').trim();
    if (etat === '4') continue;                                   // annulé
    const doc = dateIso(v[C.dateDoc]), fin = dateIso(v[C.dateFin]);
    const etape = fin || etat === '6' ? 'livre' : doc || etat === '5' ? 'travaux' : 'permis_accorde';
    const principal = Object.entries(surfaces).sort((a, b) => b[1] - a[1])[0][0];
    const ville = titre(v[C.localite] || '');
    const denom = String(v[C.denom] || '').trim(), siren = String(v[C.siren] || '').replace(/\D/g, '').slice(0, 9) || null;
    const num = String(v[C.num] || '').trim() || `${dep}-${date}-${n}`;
    const adresse = [v[C.num_voie], v[C.type_voie], v[C.voie]].map(x => String(x || '').trim()).filter(Boolean).join(' ') || String(v[C.lieudit] || '').trim() || null;
    gardes.push({
      nom: `${LIB_DEST[principal]} ${Math.round(total).toLocaleString('fr-FR')} m² — ${ville || dep}${denom ? ' (' + titre(denom) + ')' : ''}`.slice(0, 200),
      proprietaire: denom ? titre(denom) : null, siren, siret: String(v[C.siret] || '').replace(/\D/g, '') || null,
      adresse: adresse ? titre(adresse) : null, code_postal: String(v[C.cp] || '').trim() || null, ville: ville || null, departement: dep, pays: 'FR',
      lat: C.lat >= 0 ? nombre(v[C.lat]) || null : null, lng: C.lng >= 0 ? nombre(v[C.lng]) || null : null,
      categorie_auto: 'PROJET', surface_auto: Math.round(total), source: 'sitadel', source_id: num,
      _comm: String(v[C.comm] || '').trim(),
      infos_od: { permis: { num, date, etape, date_chantier: doc, date_achevement: fin, nature: { 1: 'Construction neuve', 2: 'Travaux sur construction existante' }[String(v[C.nature] || '').trim()] || null,
        surfaces: Object.fromEntries(Object.entries(surfaces).map(([k, x]) => [k, Math.round(x)])), demandeur: denom ? titre(denom) : null, siren_demandeur: siren, terrain_m2: nombre(v[C.terrain]) || null, type: String(v[C.type] || '').trim() || null } },
    });
  }
  log(`  Sitadel : ${n} autorisations lues, ${gardes.length} projets retenus en Nouvelle-Aquitaine (≥ ${SURFACE_MIN} m², depuis ${MOIS} mois)`);
  await geocoderProjets(gardes.filter(p => p.lat == null));
  return gardes;
}
// géocodage par lot (Base Adresse Nationale), à défaut centre de la commune
async function geocoderProjets(liste) {
  for (let i = 0; i < liste.length; i += 1000) {
    const lot = liste.slice(i, i + 1000);
    const csv = 'id;adresse;postcode;citycode\n' + lot.map((p, k) => [k, (p.adresse || '').replace(/[;"\n]/g, ' '), p.code_postal || '', p._comm || ''].join(';')).join('\n');
    const fd = new FormData();
    fd.append('data', new Blob([csv], { type: 'text/csv' }), 'projets.csv');
    fd.append('columns', 'adresse'); fd.append('postcode', 'postcode'); if (lot.some(p => p._comm)) fd.append('citycode', 'citycode');
    try {
      const r = await obtenir('https://api-adresse.data.gouv.fr/search/csv/', { method: 'POST', body: fd, json: false, essais: 3 });
      const lignes = (await r.text()).split(/\r?\n/).filter(Boolean);
      const H = decouper(lignes[0], ';');
      const iId = H.indexOf('id'), iLat = H.indexOf('latitude'), iLng = H.indexOf('longitude'), iScore = H.indexOf('result_score'), iCity = H.indexOf('result_city'), iCp = H.indexOf('result_postcode');
      for (const l of lignes.slice(1)) {
        const v = decouper(l, ';'), p = lot[+v[iId]]; if (!p) continue;
        if (v[iLat] && Number(v[iScore]) >= 0.3) { p.lat = +Number(v[iLat]).toFixed(6); p.lng = +Number(v[iLng]).toFixed(6); p.ville = p.ville || v[iCity] || null; p.code_postal = p.code_postal || v[iCp] || null; if (Number(v[iScore]) < 0.6) p.infos_od.position_approx = true; }
      }
    } catch (e) { log('  ! géocodage BAN', e.message); }
    await sleep(500);
  }
  log(`  géocodage : ${liste.filter(p => p.lat != null).length}/${liste.length} projets localisés`);
}

// ======================================================================= 2. ACTEURS (SIRENE)
let prochain = 0;
async function re(chemin) {                        // API Recherche d'entreprises : 7 requêtes / seconde
  const t = Math.max(Date.now(), prochain); prochain = t + 160;
  if (t > Date.now()) await sleep(t - Date.now());
  return obtenir('https://recherche-entreprises.api.gouv.fr' + chemin);
}
const EFF = n => ({ 3: '02,03,11,12,21,22,31,32,41,42,51,52,53', 10: '11,12,21,22,31,32,41,42,51,52,53', 20: '12,21,22,31,32,41,42,51,52,53', 50: '21,22,31,32,41,42,51,52,53' }[n]);
const PROFILS = [
  { cat: 'ARCHI', q: 'activite_principale=71.11Z', eff: 3 },
  { cat: 'BET', q: 'activite_principale=71.12B', eff: 10 },
  { cat: 'PROMOTEUR', q: 'activite_principale=41.10B,41.10C,41.10D', eff: 0 },
  { cat: 'PROMOTEUR', q: 'activite_principale=68.20B', eff: 10 },
  { cat: 'CONTRACTANT', q: 'activite_principale=41.20B', eff: 20 },
  { cat: 'SIEGE', q: 'section_activite_principale=C', eff: 50, siege: true },
  { cat: 'SIEGE', q: 'activite_principale=52.10A,52.10B,52.29A,52.29B,49.41A,49.41B,46.90Z', eff: 50, siege: true },
];
// majors du BTP et contractants généraux / promoteurs logistiques nationaux : agences et établissements en Nouvelle-Aquitaine
const NOMS = [
  ['MAJOR', ['Vinci Construction', 'Sogea', 'GTM Bâtiment', 'Eiffage Construction', 'Eiffage Génie Civil', 'Bouygues Bâtiment', 'Spie batignolles', 'Fayat Bâtiment', 'Cari', 'NGE', 'Léon Grosse', 'Demathieu Bard', 'Rabot Dutilleul', 'Legendre', 'GCC', 'Pigeon', 'Colas']],
  ['CONTRACTANT', ['GSE', 'GA Smart Building', 'Idec', 'Quille Construction', 'Cogesud', 'Alsei', 'Barjane', 'Ceetrus', 'Concept Building', 'Bati Normand', 'Cimea']],
  ['PROMOTEUR', ['Argan', 'Goodman', 'Prologis', 'Panattoni', 'Segro', 'GLP', 'Virtuo', 'Baytree', 'Logistics Capital Partners', 'Faubourg Promotion', 'Sogaris', 'Telamon', 'Montea', 'WDP', 'Vailog', 'P3 Logistic Parks']],
];
const nomEtab = (r, e) => titre((e?.liste_enseignes && e.liste_enseignes[0]) || r.nom_complet || r.nom_raison_sociale || '');
function ligneActeur(cat, r, e, nat = false) {
  const lat = Number(e?.latitude), lng = Number(e?.longitude);
  let c = cat;
  if (cat === 'BET' && /\bamo\b|assistan|programm|ma[iî]tr\w* d.?(oe|œ)uvre|pilotage|\bopc\b|conduite d.op/i.test(r.nom_complet || '')) c = 'AMO';
  return {
    nom: nomEtab(r, e) + (nat && e?.libelle_commune ? ' — ' + titre(e.libelle_commune) : ''), enseigne: r.nom_complet && nomEtab(r, e) !== titre(r.nom_complet) ? titre(r.nom_complet) : null,
    siren: r.siren, siret: e?.siret || null, naf: e?.activite_principale || r.activite_principale || null, naf_libelle: null,
    adresse: e?.adresse ? titre(String(e.adresse).replace(/\s\d{5}\s.*$/, '')) : null, code_postal: e?.code_postal || null, ville: e?.libelle_commune ? titre(e.libelle_commune) : null,
    departement: e?.departement || (e?.code_postal || '').slice(0, 2) || null, pays: 'FR', lat: isFinite(lat) && lat ? +lat.toFixed(6) : null, lng: isFinite(lng) && lng ? +lng.toFixed(6) : null,
    categorie_auto: c, source: 'sirene', source_id: e?.siret || r.siren,
    infos_od: { effectif: e?.tranche_effectif_salarie || r.tranche_effectif_salarie || null, raison_sociale: titre(r.nom_complet), siege: !!e?.est_siege, categorie_entreprise: r.categorie_entreprise || null,
      dirigeants: (r.dirigeants || []).filter(d => d.nom || d.denomination).slice(0, 4).map(d => d.denomination ? titre(d.denomination) + (d.qualite ? ' (' + d.qualite + ')' : '') : `${titre(d.prenoms || '')} ${titre(d.nom || '')}`.trim() + (d.qualite ? ' — ' + d.qualite : '')) },
  };
}
async function acteurs() {
  const res = new Map();
  const ajouter = l => { if (l.source_id && !res.has(l.source_id)) res.set(l.source_id, l); };
  for (const p of PROFILS) {
    let k = 0;
    for (const dep of DEPTS) {
      for (let page = 1; page <= 40; page++) {
        let j;
        try { j = await re(`/search?${p.q}&departement=${dep}${p.eff ? '&tranche_effectif_salarie=' + EFF(p.eff) : ''}&etat_administratif=A&per_page=25&page=${page}`); }
        catch (e) { log(`  ! ${p.cat} ${dep}`, e.message); break; }
        for (const r of j?.results || []) {
          if (p.siege) { const s = r.siege; if (s && DEPTS.includes(String(s.departement || (s.code_postal || '').slice(0, 2)))) { ajouter(ligneActeur(p.cat, r, { ...s, est_siege: true })); k++; } continue; }
          const etabs = (r.matching_etablissements || []).filter(e => (!e.etat_administratif || e.etat_administratif === 'A') && String(e.departement || (e.code_postal || '').slice(0, 2)) === dep);
          for (const e of etabs.length ? etabs : [r.siege].filter(Boolean)) { ajouter(ligneActeur(p.cat, r, e)); k++; }
        }
        if (!j?.results?.length || page >= (j.total_pages || 1)) break;
      }
    }
    log(`  ${p.cat} (${p.q}) : ${k} établissements`);
  }
  for (const [cat, noms] of NOMS) {
    let k = 0;
    for (const n of noms) {
      for (const dep of DEPTS) {
        let j;
        try { j = await re(`/search?q=${encodeURIComponent(n)}&departement=${dep}&etat_administratif=A&per_page=10&page=1`); }
        catch (e) { log(`  ! ${n} ${dep}`, e.message); continue; }
        for (const r of j?.results || []) {
          if (!new RegExp(n.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(r.nom_complet || '')) continue;
          for (const e of (r.matching_etablissements || []).filter(e => (!e.etat_administratif || e.etat_administratif === 'A') && String(e.departement || (e.code_postal || '').slice(0, 2)) === dep)) { ajouter(ligneActeur(cat, r, e, true)); k++; }
        }
      }
    }
    log(`  ${cat} (liste nationale) : ${k} agences / établissements en Nouvelle-Aquitaine`);
  }
  return [...res.values()];
}

// ======================================================================= écriture
async function envoyer(lignes, etiquette) {
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/dallage-${etiquette}.json`, JSON.stringify(lignes, null, 1)); log(`  → ${OUT}/dallage-${etiquette}.json`); }
  if (!(SUPABASE_URL && KEY)) return;
  for (let i = 0; i < lignes.length; i += 400) {
    const n = await obtenir(`${SUPABASE_URL}/rest/v1/rpc/dal_import`, { method: 'POST', body: JSON.stringify({ rows: lignes.slice(i, i + 400).map(({ _comm, ...l }) => l) }), headers: hSupa });
    log(`  → Supabase ${etiquette} : ${Math.min(i + 400, lignes.length)}/${lignes.length} (${n})`);
  }
}

let erreurs = 0, proj = [], act = [];
if (!args.includes('--sans-projets')) {
  log('1. Projets (permis de construire, Sitadel)…');
  try { proj = await projets(); } catch (e) { erreurs++; log('!! projets :', e.message); }
}
if (!args.includes('--sans-acteurs')) {
  log('2. Acteurs (SIRENE)…');
  try { act = await acteurs(); } catch (e) { erreurs++; log('!! acteurs :', e.message); }
}
// promoteurs / sièges qui ont déposé des permis récents : nombre de projets
const parSiren = new Map(); for (const p of proj) if (p.siren) parSiren.set(p.siren, (parSiren.get(p.siren) || 0) + 1);
for (const a of act) if (parSiren.get(a.siren)) a.infos_od.nb_projets = parSiren.get(a.siren);
try { await envoyer(proj, 'projets'); await envoyer(act, 'acteurs'); } catch (e) { erreurs++; log('!! écriture :', e.message); }
log(`Terminé : ${proj.length} projets, ${act.length} acteurs${erreurs ? ` — ${erreurs} erreur(s)` : ''}`);
if (erreurs && !proj.length && !act.length) process.exit(1);
