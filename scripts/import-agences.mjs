#!/usr/bin/env node
/**
 * BIG Prospection — import des agences de location de matériel (Kiloutou) dans la table `agences`.
 *
 * Sources (combinées, dédoublonnées à 200 m) :
 *   1. Base SIRENE via l'API Recherche d'entreprises : établissements ouverts de KILOUTOU, département par département
 *   2. OpenStreetMap (Overpass) : agences étiquetées Kiloutou (apporte souvent le téléphone et le site web)
 *
 * Usage : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-agences.mjs   [--out agences.json]
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '';
// accepte aussi une adresse copiée avec « /rest/v1/ » à la fin
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ENSEIGNE = 'kiloutou';
const SIRENS = new Set(['317686061']);                   // KILOUTOU SAS
const DEPS = [...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter(d => d !== '20'), '2A', '2B'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
async function getJson(url, opts = {}, essais = 5) {
  for (let i = 1; i <= essais; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { accept: 'application/json', 'user-agent': 'BIG-Prospection/1.0 (agences)', ...(opts.headers || {}) } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`), { fatal: true });
      const t = await r.text(); return t ? JSON.parse(t) : null;
    } catch (e) { if (e.fatal || i === essais) throw e; await sleep(1500 * i * i); }
  }
}
const distM = (a, b) => { const k = Math.PI / 180, x = (b.lng - a.lng) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k; return Math.hypot(x, y) * 6371000; };
const titre = s => (s || '').toLowerCase().replace(/(^|[\s\-'’(])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
const deptDeCp = cp => !/^\d{5}$/.test(cp || '') ? null : cp.startsWith('20') ? (cp < '20200' ? '2A' : '2B') : cp.slice(0, 2);

// ------------------------------------------------------------------ 1. SIRENE
async function sirene() {
  const res = new Map();
  for (const dep of DEPS) {
    let page = 1, n = 0;
    for (; page <= 5; page++) {
      let j;
      try { j = await getJson(`https://recherche-entreprises.api.gouv.fr/search?q=kiloutou&departement=${dep}&limite_matching_etablissements=100&per_page=25&page=${page}`); }
      catch (e) { log(`  ! SIRENE ${dep}`, e.message); break; }
      for (const r of j?.results || []) {
        if (!SIRENS.has(r.siren) && !/^kiloutou/i.test(r.nom_complet || '')) continue;
        for (const e of r.matching_etablissements || []) {
          if (e.etat_administratif && e.etat_administratif !== 'A') continue;
          const lat = Number(e.latitude), lng = Number(e.longitude);
          if (!isFinite(lat) || !isFinite(lng) || !lat) continue;
          const cp = e.code_postal || null;
          res.set(e.siret, {
            id: e.siret, enseigne: ENSEIGNE,
            nom: 'Kiloutou ' + titre((e.liste_enseignes || [])[0]?.replace(/^kiloutou\s*/i, '') || e.libelle_commune || ''),
            adresse: (e.adresse || '').replace(/\s*\d{5}\s+.*$/, '') || null, code_postal: cp, ville: titre(e.libelle_commune || ''),
            departement: deptDeCp(cp) || dep, pays: 'FR', lat, lng, telephone: null, site_web: null, source: 'sirene',
          });
          n++;
        }
      }
      if (!j || (j.total_pages || 1) <= page) break;
      await sleep(200);
    }
    if (n) log(`  ${dep} : ${n} établissements`);
    await sleep(200);                                     // ≤ 7 requêtes / seconde
  }
  return [...res.values()];
}

// ------------------------------------------------------------------ 2. OpenStreetMap
async function osm() {
  const q = `[out:json][timeout:180];(area["ISO3166-1"="FR"][admin_level=2];area["ISO3166-1"="BE"][admin_level=2];)->.a;
    (nwr["brand"~"kiloutou",i](area.a);nwr["name"~"kiloutou",i](area.a);nwr["operator"~"kiloutou",i](area.a););out center tags;`;
  const j = await getJson('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return (j?.elements || []).map(e => {
    const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!lat || !lng) return null;
    const cp = t['addr:postcode'] || null, be = /^\d{4}$/.test(cp || '');
    return {
      id: `osm-${e.type}-${e.id}`, enseigne: ENSEIGNE, nom: t.name && /kiloutou/i.test(t.name) ? t.name : 'Kiloutou ' + (t['addr:city'] || ''),
      adresse: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null, code_postal: cp, ville: t['addr:city'] || null,
      departement: be ? 'BE' : deptDeCp(cp), pays: be ? 'BE' : 'FR', lat, lng,
      telephone: t.phone || t['contact:phone'] || null, site_web: t.website || t['contact:website'] || null, source: 'osm',
    };
  }).filter(Boolean);
}

// ------------------------------------------------------------------ fusion + envoi
const debut = new Date().toISOString();
log('SIRENE…'); let a = []; try { a = await sirene(); } catch (e) { log('! SIRENE', e.message); }
log(`SIRENE : ${a.length} établissements`);
log('OpenStreetMap…'); let b = []; try { b = await osm(); } catch (e) { log('! OSM', e.message); }
log(`OpenStreetMap : ${b.length} agences`);
const agences = [...a];
for (const o of b) {
  const proche = agences.find(x => distM(x, o) < 200);
  if (proche) { proche.telephone ||= o.telephone; proche.site_web ||= o.site_web; }
  else agences.push(o);
}
for (const x of agences) x.maj = debut;
log(`Total après dédoublonnage : ${agences.length} agences`);
if (agences.length < 50) { log('!! Moins de 50 agences trouvées : import annulé pour ne pas vider la carte.'); process.exit(1); }
if (OUT) fs.writeFileSync(OUT, JSON.stringify(agences, null, 1));
if (SUPABASE_URL && KEY) {
  const h = { apikey: KEY, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal', ...(KEY.startsWith('eyJ') ? { authorization: 'Bearer ' + KEY } : {}) };
  for (let i = 0; i < agences.length; i += 500)
    await getJson(`${SUPABASE_URL}/rest/v1/agences?on_conflict=id`, { method: 'POST', body: JSON.stringify(agences.slice(i, i + 500)), headers: h });
  // agences fermées depuis le dernier import
  await getJson(`${SUPABASE_URL}/rest/v1/agences?enseigne=eq.${ENSEIGNE}&maj=lt.${encodeURIComponent(debut)}`, { method: 'DELETE', headers: h });
  log('→ Supabase : table agences à jour');
}
