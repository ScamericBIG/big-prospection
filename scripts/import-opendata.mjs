#!/usr/bin/env node
/**
 * BIG Prospection — import des sites depuis l'open data
 *
 * France  : BDNB (bâtiments ≥ SURFACE_MIN m² d'emprise : surface, année de construction, propriétaire, adresse)
 *           + Géorisques ICPE (exploitant, rubriques 1510 entrepôts / 1511 frigorifiques…)
 *           + API Recherche d'entreprises (établissement présent sur place → raison sociale + code NAF)
 * Belgique: OpenStreetMap (bâtiments warehouse / industrial ≥ SURFACE_MIN m²)
 *
 * Usage :
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node import-opendata.mjs --dep 59,62 [--be] [--min 5000]
 *   node import-opendata.mjs --dep 59 --out ./sortie        (sans Supabase : écrit un JSON importable dans l'appli)
 *   --dep all  → tous les départements métropolitains
 */
import proj4 from 'proj4';
import fs from 'node:fs';
import path from 'node:path';
import { categorieDepuisNaf, categorieDepuisRubriques, nafExclu, LIBELLES_NAF_DIVISION } from '../js/categories.js';

// ---------------------------------------------------------------- paramètres
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const DEPS_METRO = [...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter(d => d !== '20'), '2A', '2B'];
const depArg = String(opt('dep', process.env.DEPARTEMENTS || '') || '');
const DEPARTEMENTS = depArg === 'all' ? DEPS_METRO : depArg.split(/[ ,;]+/).filter(Boolean);
const AVEC_BE = !!opt('be', process.env.BELGIQUE === 'true');
const SURFACE_MIN = Number(opt('min', process.env.SURFACE_MIN || 5000));
const ENRICHIR = String(opt('enrichir', process.env.ENRICHIR ?? 'true')) !== 'false';
const OUT = opt('out', process.env.OUT_DIR || '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!DEPARTEMENTS.length && !AVEC_BE) {
  console.error('Indiquez --dep 59,62 (ou --dep all) et/ou --be');
  process.exit(1);
}
if (!OUT && !(SUPABASE_URL && SUPABASE_KEY)) {
  console.error('Définissez SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, ou --out <dossier>');
  process.exit(1);
}

proj4.defs('EPSG:2154', '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const toWgs = proj4('EPSG:2154', 'EPSG:4326');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJson(url, { tries = 5, headers = {}, method = 'GET', body } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { method, body, headers: { accept: 'application/json', 'user-agent': 'BIG-Prospection/1.0 (import open data)', ...headers } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) { const t = await r.text(); throw Object.assign(new Error(`HTTP ${r.status} ${t.slice(0, 200)}`), { fatal: r.status < 500 && r.status !== 429 }); }
      return await r.json();
    } catch (e) {
      if (e.fatal || i === tries) throw e;
      await sleep(1500 * i * i);
    }
  }
}

// ---------------------------------------------------------------- géométrie
function centroidePolygone(ring) {            // ring: [[x,y],…] en mètres
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return { x: ring[0][0], y: ring[0][1], a: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a), a: Math.abs(a / 2) };
}
function centroideGeom(geom) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  let best = null;
  for (const p of polys) { const c = centroidePolygone(p[0]); if (!best || c.a > best.a) best = c; }
  return best;
}
function distM(a, b) {                        // lat/lng → mètres (approx. équirectangulaire)
  const k = Math.PI / 180, x = (b.lng - a.lng) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}
class Grille {                                // index spatial simple (cellules ~1 km)
  constructor() { this.m = new Map(); }
  key(lat, lng) { return Math.floor(lat * 100) + ':' + Math.floor(lng * 70); }
  add(o) { const k = this.key(o.lat, o.lng); (this.m.get(k) || this.m.set(k, []).get(k)).push(o); }
  near(lat, lng, rayon) {
    const r = [], la = Math.floor(lat * 100), ln = Math.floor(lng * 70);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of this.m.get((la + i) + ':' + (ln + j)) || []) {
      const d = distM({ lat, lng }, o); if (d <= rayon) r.push([d, o]);
    }
    return r.sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }
}

// ---------------------------------------------------------------- sources France
const BDNB = 'https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet';
const BDNB_CHAMPS = 'batiment_groupe_id,annee_construction,surface_emprise_sol,usage_principal_bdnb_open,usage_niveau_1_txt,l_denomination_proprietaire,l_siren,libelle_adr_principale_ban,libelle_commune_insee,code_commune_insee,hauteur_mean,nb_niveau,geom_groupe';

async function batimentsBdnb(dep) {
  const out = []; const page = 500;
  for (let offset = 0; ; offset += page) {
    const url = `${BDNB}?code_departement_insee=eq.${dep}&surface_emprise_sol=gte.${SURFACE_MIN}&select=${BDNB_CHAMPS}&order=batiment_groupe_id&limit=${page}&offset=${offset}`;
    const rows = await getJson(url);
    out.push(...rows);
    if (rows.length < page) break;
    await sleep(600);
  }
  return out;
}

async function icpeDepartement(dep) {
  const out = [];
  for (let p = 1; p < 400; p++) {
    const j = await getJson(`https://georisques.gouv.fr/api/v1/installations_classees?departement=${dep}&page_size=100&page=${p}`);
    for (const x of j.data || []) if (x.latitude && x.longitude) out.push({ ...x, lat: x.latitude, lng: x.longitude });
    if (!j.total_pages || p >= j.total_pages) break;
    await sleep(250);
  }
  return out;
}

let dernierAppelRE = 0;
async function etablissementsProches(lat, lng) {
  const attente = 150 - (Date.now() - dernierAppelRE); if (attente > 0) await sleep(attente);   // ≤ 7 req/s
  dernierAppelRE = Date.now();
  try {
    const j = await getJson(`https://recherche-entreprises.api.gouv.fr/near_point?lat=${lat.toFixed(6)}&long=${lng.toFixed(6)}&radius=0.25&per_page=25&page=1`, { tries: 4 });
    const etabs = [];
    for (const r of j.results || []) for (const e of r.matching_etablissements || []) {
      if (e.etat_administratif && e.etat_administratif !== 'A') continue;
      const elat = Number(e.latitude), elng = Number(e.longitude);
      etabs.push({
        nom: (e.liste_enseignes && e.liste_enseignes[0]) || r.nom_complet, raison_sociale: r.nom_complet,
        siren: r.siren, siret: e.siret, naf: e.activite_principale || r.activite_principale,
        effectif: e.tranche_effectif_salarie || r.tranche_effectif_salarie || null,
        d: isFinite(elat) && isFinite(elng) ? distM({ lat, lng }, { lat: elat, lng: elng }) : 200,
      });
    }
    return etabs;
  } catch (e) { log('  ! recherche-entreprises', e.message); return []; }
}
const POIDS_EFFECTIF = { NN: 0, '00': 0, '01': 1, '02': 1, '03': 2, '11': 3, '12': 4, '21': 5, '22': 6, '31': 7, '32': 8, '41': 9, '42': 10, '51': 11, '52': 12, '53': 13 };
function meilleurEtablissement(etabs) {
  let best = null, bs = -1e9;
  for (const e of etabs) {
    if (!e.naf || nafExclu(e.naf)) continue;
    const cat = categorieDepuisNaf(e.naf);
    let s = -e.d / 25 + (POIDS_EFFECTIF[e.effectif] || 0) * 2;
    if (cat && cat !== 'AUTRE') s += 15;
    if (/^68/.test(e.naf)) s -= 30;            // sociétés immobilières (SCI) : propriétaires, pas occupants
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}

function decouperAdresse(lib) {
  if (!lib) return {};
  const m = lib.match(/^(.*?)\s*(\d{5})\s+(.+)$/);
  return m ? { adresse: m[1].trim(), code_postal: m[2], ville: m[3].trim() } : { adresse: lib };
}
const titre = s => (s || '').toLowerCase().replace(/(^|[\s\-'’(])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

async function traiterDepartement(dep) {
  log(`Département ${dep} : BDNB…`);
  const bats = await batimentsBdnb(dep);
  log(`  ${bats.length} bâtiments ≥ ${SURFACE_MIN} m²`);
  // 1) centroïdes + filtres de base
  let cand = [];
  for (const b of bats) {
    if (!b.geom_groupe) continue;
    const usage = b.usage_principal_bdnb_open || b.usage_niveau_1_txt || '';
    if (/sidentiel/i.test(usage)) continue;
    const c = centroideGeom(b.geom_groupe); if (!c) continue;
    const [lng, lat] = toWgs.forward([c.x, c.y]);
    cand.push({ b, lat, lng, usage, surface: Math.round(b.surface_emprise_sol || c.a) });
  }
  // 2) fusion des bâtiments d'un même site (même propriétaire, < 200 m)
  cand.sort((a, b) => b.surface - a.surface);
  const g = new Grille(), sites = [];
  for (const c of cand) {
    const prop = (c.b.l_denomination_proprietaire || [])[0] || '';
    const voisin = g.near(c.lat, c.lng, 200).find(s => s.prop === prop && prop);
    if (voisin) {
      voisin.surface += c.surface; voisin.ids.push(c.b.batiment_groupe_id);
      if (c.b.annee_construction && (!voisin.annee || c.b.annee_construction < voisin.annee)) voisin.annee = c.b.annee_construction;
      continue;
    }
    const s = { ...c, prop, ids: [c.b.batiment_groupe_id], annee: c.b.annee_construction || null };
    sites.push(s); g.add(s);
  }
  log(`  ${sites.length} sites après regroupement`);
  // 3) ICPE
  let icpe = [];
  try { icpe = await icpeDepartement(dep); log(`  ${icpe.length} installations ICPE`); } catch (e) { log('  ! Géorisques', e.message); }
  const gi = new Grille(); icpe.forEach(x => gi.add(x));
  // 4) enrichissement + catégorie
  const lignes = [];
  let n = 0;
  for (const s of sites) {
    n++; if (n % 200 === 0) log(`  … ${n}/${sites.length}`);
    const ic = gi.near(s.lat, s.lng, 300)[0];
    const rubriques = ic ? (ic.rubriques || []).map(r => String(r.numeroRubrique || r.numero || '')).filter(Boolean) : [];
    let etab = null;
    if (ENRICHIR) etab = meilleurEtablissement(await etablissementsProches(s.lat, s.lng));
    const naf = etab?.naf || (ic?.codeNaf ? String(ic.codeNaf) : null);
    if (naf && nafExclu(naf) && !rubriques.length) continue;
    let cat = categorieDepuisRubriques(rubriques) || (naf ? categorieDepuisNaf(naf) : null);
    if (!cat) cat = /secondaire/i.test(s.usage) ? 'IND' : null;
    // Bâtiment tertiaire non identifié : on ne garde que les volumes « type entrepôt » (1-2 niveaux, ≥ 6 m)
    if (!cat) {
      const plat = (s.b.nb_niveau || 1) <= 2 && (s.b.hauteur_mean || 0) >= 6;
      if (!plat) continue;
      cat = 'AUTRE';
    }
    const adr = decouperAdresse(s.b.libelle_adr_principale_ban);
    const nomOccupant = etab?.nom || ic?.raisonSociale || null;
    lignes.push({
      nom: titre(nomOccupant || s.prop || `Site industriel ${s.b.libelle_commune_insee || ''}`).trim(),
      enseigne: etab?.raison_sociale && etab.raison_sociale !== etab.nom ? titre(etab.raison_sociale) : null,
      proprietaire: s.prop ? titre(s.prop) : null,
      siren: etab?.siren || (s.b.l_siren || [])[0] || null,
      siret: etab?.siret || ic?.siret || null,
      naf, naf_libelle: naf ? (LIBELLES_NAF_DIVISION[naf.slice(0, 2)] || null) : null,
      adresse: adr.adresse || null, code_postal: adr.code_postal || null,
      ville: adr.ville || s.b.libelle_commune_insee || null, departement: dep, pays: 'FR',
      lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6),
      categorie_auto: cat, surface_auto: s.surface, annee_auto: s.annee,
      source: 'bdnb', source_id: s.ids[0],
      infos_od: {
        bdnb_ids: s.ids, usage: s.usage, hauteur: s.b.hauteur_mean, niveaux: s.b.nb_niveau,
        icpe: ic ? { nom: ic.raisonSociale, regime: ic.regime, seveso: ic.statutSeveso, rubriques, aiot: ic.codeAIOT } : null,
      },
    });
  }
  log(`  ${lignes.length} sites retenus`);
  return lignes;
}

// ---------------------------------------------------------------- Belgique (OpenStreetMap)
const PROVINCES_BE = ['BE-VAN', 'BE-VBR', 'BE-VLI', 'BE-VOV', 'BE-VWV', 'BE-WBR', 'BE-WHT', 'BE-WLG', 'BE-WLX', 'BE-WNA', 'BE-BRU'];
function aireLatLng(pts) {
  const k = Math.PI / 180, lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const xy = pts.map(p => [p.lon * k * Math.cos(lat0 * k) * 6371000, p.lat * k * 6371000]);
  return centroidePolygone(xy).a;
}
async function traiterBelgique() {
  const lignes = [];
  for (const prov of PROVINCES_BE) {
    log(`Belgique ${prov} : OpenStreetMap…`);
    const q = `[out:json][timeout:300];area["ISO3166-2"="${prov}"]->.a;(way["building"~"^(warehouse|industrial|manufacture|cold_storage|hangar)$"](area.a););out tags geom;`;
    let j;
    try { j = await getJson('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } }); }
    catch (e) { log('  ! Overpass', e.message); continue; }
    let k = 0;
    for (const w of j.elements || []) {
      if (!w.geometry || w.geometry.length < 4) continue;
      const surface = Math.round(aireLatLng(w.geometry));
      if (surface < SURFACE_MIN) continue;
      const t = w.tags || {};
      const lat = w.geometry.reduce((s, p) => s + p.lat, 0) / w.geometry.length;
      const lng = w.geometry.reduce((s, p) => s + p.lon, 0) / w.geometry.length;
      const annee = parseInt((t.start_date || t['building:year'] || '').slice(0, 4)) || null;
      const cat = t.building === 'cold_storage' ? 'FRIGO' : t.building === 'warehouse' ? 'LOG' : t.building === 'hangar' ? 'TRANSPORT' : 'IND';
      lignes.push({
        nom: t.name || t.operator || t.brand || `Bâtiment ${t.building === 'warehouse' ? 'logistique' : 'industriel'} ${t['addr:city'] || ''}`.trim(),
        enseigne: t.operator || t.brand || null, proprietaire: t.owner || null,
        adresse: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
        code_postal: t['addr:postcode'] || null, ville: t['addr:city'] || null, departement: 'BE', pays: 'BE',
        lat: +lat.toFixed(6), lng: +lng.toFixed(6),
        categorie_auto: cat, surface_auto: surface, annee_auto: annee,
        source: 'osm', source_id: 'way/' + w.id,
        infos_od: { osm_building: t.building, province: prov },
      });
      k++;
    }
    log(`  ${k} bâtiments ≥ ${SURFACE_MIN} m²`);
    await sleep(5000);                         // politesse envers le serveur Overpass
  }
  return lignes;
}

// ---------------------------------------------------------------- écriture
async function envoyer(lignes, etiquette) {
  if (!lignes.length) return;
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    const f = path.join(OUT, `sites-${etiquette}.json`);
    fs.writeFileSync(f, JSON.stringify(lignes));
    log(`  → ${f}`);
  }
  if (SUPABASE_URL && SUPABASE_KEY) {
    for (let i = 0; i < lignes.length; i += 500) {
      const n = await getJson(`${SUPABASE_URL}/rest/v1/rpc/import_sites`, {
        method: 'POST', body: JSON.stringify({ rows: lignes.slice(i, i + 500) }),
        headers: { apikey: SUPABASE_KEY, authorization: 'Bearer ' + SUPABASE_KEY, 'content-type': 'application/json' },
      });
      log(`  → Supabase : ${n} lignes (${i + Math.min(500, lignes.length - i)}/${lignes.length})`);
    }
  }
}

let total = 0;
for (const dep of DEPARTEMENTS) {
  try { const l = await traiterDepartement(dep); await envoyer(l, dep); total += l.length; }
  catch (e) { log(`!! Département ${dep} en échec :`, e.message); }
}
if (AVEC_BE) { const l = await traiterBelgique(); await envoyer(l, 'BE'); total += l.length; }
log(`Terminé : ${total} sites importés.`);
