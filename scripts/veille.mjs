#!/usr/bin/env node
/**
 * BIG Prospection — veille quotidienne
 *   1. Appels d'offres publics en cours (BOAMP) : sols industriels, dallage, résine, réparation béton, fissures…
 *   2. Actualités : presse (Google Actualités) sur les thèmes du métier et sur les groupes / clients de la base,
 *      + annonces de procédures collectives (BODACC) concernant les sites suivis.
 * Les résultats sont enregistrés dans les tables `appels_offres` et `actualites` (Supabase).
 *
 * Usage : SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/veille.mjs  [--out dossier] [--sans-supabase]
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AVEC_SUPABASE = SUPABASE_URL && KEY && !args.includes('--sans-supabase');
const JOURS_ACTU = 45;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sansAccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const empreinte = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
const aujourdhui = new Date().toISOString().slice(0, 10);
const hSupa = { apikey: KEY, 'content-type': 'application/json', ...(KEY.startsWith('eyJ') ? { authorization: 'Bearer ' + KEY } : {}) };

async function obtenir(url, { json = true, essais = 4, ...opts } = {}) {
  for (let i = 1; i <= essais; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'user-agent': 'Mozilla/5.0 (BIG-Prospection veille)', accept: json ? 'application/json' : '*/*', ...(opts.headers || {}) } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`), { fatal: true });
      const t = await r.text();
      return json ? (t ? JSON.parse(t) : null) : t;
    } catch (e) { if (e.fatal || i === essais) throw e; await sleep(2000 * i * i); }
  }
}

// ------------------------------------------------------------------ référentiel géographique
const DEPTS = require('@etalab/decoupage-administratif/data/departements.json');
const COMMUNES = require('@etalab/decoupage-administratif/data/communes.json');
const AMBIGUS = new Set(['orange', 'vienne', 'charge', 'nice', 'lens', 'agen', 'sens', 'tours', 'bar', 'pau', 'mars', 'saint', 'mont', 'riche', 'avril', 'aube', 'aude',
  'nord', 'cher', 'var', 'lot', 'ain', 'eure', 'orne', 'manche', 'meuse', 'creuse', 'somme', 'marne', 'loire', 'fontaine', 'montagne', 'liberte', 'france', 'porte',
  'plaisance', 'concorde', 'lumiere', 'vallee', 'chateau', 'fleury', 'michon', 'lambert', 'martin', 'laval-de-cere', 'bonneuil', 'moulins', 'royan', 'auch']);
const REGIONS = { 'ile-de-france': '75', idf: '75', 'hauts-de-france': '59', 'grand est': '67', 'grand-est': '67', alsace: '67', lorraine: '57', champagne: '51', picardie: '80',
  'auvergne-rhone-alpes': '69', 'rhone-alpes': '69', auvergne: '63', 'provence-alpes-cote d-azur': '13', paca: '13', provence: '13', 'cote d-azur': '06', 'region sud': '13',
  bretagne: '35', normandie: '76', 'nouvelle-aquitaine': '33', occitanie: '31', 'pays de la loire': '44', 'centre-val de loire': '45', 'bourgogne-franche-comte': '21', bourgogne: '21', 'franche-comte': '25', corse: '2A' };
const geo = [];
const normGeo = s => sansAccent(s).replace(/[’']/g, '-').replace(/[^a-z0-9-]+/g, ' ').trim();   // on garde les traits d'union
for (const d of DEPTS) geo.push({ cle: normGeo(d.nom), dep: d.code, ambigu: AMBIGUS.has(sansAccent(d.nom)) });
for (const c of COMMUNES) {
  if (c.type !== 'commune-actuelle' || c.zone !== 'metro') continue;
  const pop = c.population || 0, cle = normGeo(c.nom);
  // grandes villes, ou communes moyennes au nom assez long (beaucoup de zones logistiques sont dans des communes de 3 000 à 10 000 hab.)
  if (pop >= 20000 || (pop >= 3000 && cle.length >= 6)) geo.push({ cle, dep: c.departement, ambigu: AMBIGUS.has(sansAccent(c.nom)) });
}
geo.sort((a, b) => b.cle.length - a.cle.length);
const VILLES_BE = { bruxelles: 'BE', brussel: 'BE', anvers: 'BE', antwerpen: 'BE', liege: 'BE', gand: 'BE', gent: 'BE', charleroi: 'BE', namur: 'BE', mons: 'BE', louvain: 'BE', bruges: 'BE', courtrai: 'BE', mouscron: 'BE', tournai: 'BE', wallonie: 'BE', flandre: 'BE', belgique: 'BE' };
function departementsDe(texte) {
  let t = ' ' + normGeo(texte) + ' ';
  const res = new Set();
  for (const m of String(texte).matchAll(/\((\d{2}|2A|2B)\)/g)) res.add(m[1]);
  for (const g of geo) {                                      // du nom le plus long au plus court ; un nom trouvé est retiré du texte
    if (g.ambigu) continue;
    const k = ' ' + g.cle + ' ';
    if (t.includes(k)) { res.add(g.dep); t = t.split(k).join(' '); }
  }
  for (const [v, c] of Object.entries(REGIONS)) if (t.includes(' ' + v + ' ')) res.add(c);
  for (const [v, c] of Object.entries(VILLES_BE)) if (t.includes(' ' + v + ' ')) res.add(c);
  return [...res];
}

// ------------------------------------------------------------------ 1. appels d'offres (BOAMP)
const BOAMP = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records';
const RECHERCHES_AO = ['dallage', 'sol industriel', 'sols industriels', 'résine', 'resine', 'revêtement de sol', 'revêtements de sols', 'revetement de sol',
  'ragréage', 'ragreage', 'réfection des sols', 'réfection de sol', 'reprise de sol', 'fissure', 'réparation de béton', 'réparation béton', 'réparations béton',
  'chape', 'peinture de sol', 'sol béton', 'traitement de sol', 'joints de dallage', 'entrepôt', 'plateforme logistique'];
const POIDS = [
  [/dallage/, 40, 'Dallage'], [/sols? industriels?/, 40, 'Sol industriel'], [/(revetements?|reprises?|refections?|renovations?) (des |de |du )?sols?/, 30, 'Revêtement / réfection de sol'],
  [/resine/, 25, 'Résine'], [/ragreage/, 25, 'Ragréage'], [/fissur/, 25, 'Fissures'], [/(reparations?|reprises?) (de |des |du )?betons?|betons? (degrade|endommage)/, 25, 'Réparation béton'],
  [/joints? (de )?(dallage|dilatation|sol)/, 25, 'Joints'], [/peinture (de |des )?sols?/, 20, 'Peinture de sol'], [/chape/, 15, 'Chape'], [/traitement (de |des )?sols?/, 15, 'Traitement de sol'],
  [/entrepots?|plate-?formes? logistiques?|logistique/, 12, 'Entrepôt / logistique'], [/(atelier|usine|industriel|hangar|quai)/, 8, 'Site industriel'],
];
const EXCLUSIONS = [/sportif|gymnase|terrain de (sport|foot)|gazon|tartan|aire de jeux|piscine|cour d.ecole|chaussee|voirie|enrobe|route departementale/];
function evaluerAO(texte) {
  const t = sansAccent(texte); let score = 0; const mots = [];
  for (const [re, p, lib] of POIDS) if (re.test(t)) { score += p; mots.push(lib); }
  if (EXCLUSIONS.some(re => re.test(t)) && !/dallage|sols? industriels?/.test(t)) score -= 40;
  return { score, mots };
}
async function appelsOffres() {
  const res = new Map();
  for (const mot of RECHERCHES_AO) {
    for (let offset = 0; offset < 300; offset += 100) {
      const where = `(objet LIKE '%${mot}%' OR descripteur_libelle LIKE '%${mot}%') AND datelimitereponse >= date'${aujourdhui}'`;
      let j;
      try { j = await obtenir(`${BOAMP}?where=${encodeURIComponent(where)}&order_by=${encodeURIComponent('datelimitereponse ASC')}&limit=100&offset=${offset}`); }
      catch (e) { log(`  ! BOAMP « ${mot} »`, e.message); break; }
      const l = j?.results || [];
      for (const r of l) {
        if (!r.idweb || res.has(r.idweb)) continue;
        const desc = [].concat(r.descripteur_libelle || []).join(', ');
        const { score, mots } = evaluerAO(`${r.objet || ''} ${desc}`);
        if (score < 25) continue;
        const deps = [].concat(r.code_departement || []).map(String).filter(Boolean);
        res.set(r.idweb, {
          id: 'boamp:' + r.idweb, source: 'boamp', titre: (r.objet || '').slice(0, 500) || 'Avis ' + r.idweb, acheteur: r.nomacheteur || null,
          description: desc || null, departements: deps, lieu: deps.join(', ') || null,
          type_marche: [].concat(r.type_marche_facette || r.type_marche || []).join(', ') || null, procedure: r.procedure_libelle || null,
          date_publication: (r.dateparution || '').slice(0, 10) || null, date_limite: r.datelimitereponse || null,
          url: r.url_avis || `https://www.boamp.fr/pages/avis/?q=idweb:%22${encodeURIComponent(r.idweb)}%22`,
          mots_cles: mots, categorie: mots[0] || null, pertinence: Math.min(100, score), maj: new Date().toISOString(),
        });
      }
      if (l.length < 100) break;
      await sleep(400);
    }
    await sleep(300);
  }
  return [...res.values()];
}

// ------------------------------------------------------------------ 2. actualités
const THEMES = [
  'incendie entrepôt', 'incendie plateforme logistique', 'incendie usine', 'incendie site industriel',
  'liquidation judiciaire logistique', 'redressement judiciaire transporteur', 'redressement judiciaire usine', 'liquidation judiciaire usine',
  'fermeture usine', 'fermeture entrepôt', 'fermeture site logistique', 'plan social usine',
  'ouverture plateforme logistique', 'nouvel entrepôt logistique', 'nouvelle zone logistique', 'extension entrepôt', 'permis de construire entrepôt', "inauguration plateforme logistique",
  'rachat logisticien', 'acquisition groupe logistique', 'rachat transporteur', 'reprise usine',
  'entrepôt Belgique incendie', 'nouvel entrepôt Belgique',
];
const CATEGORIES_ACTU = [
  ['incendie', /incendie|feu |brule|flammes|sinistre|fumee|pompiers/],
  ['defaillance', /liquidation|redressement judiciaire|sauvegarde|faillite|cessation de paiement|tribunal de commerce|procedure collective/],
  ['fermeture', /fermeture|ferme ses portes|plan social|\bpse\b|licenciement|suppression de postes|delocalis/],
  ['rachat', /rachat|rachete|acquisition|acquiert|cession|fusion|reprise|reprend|prise de participation|lbo/],
  ['ouverture', /ouverture|ouvre|inaugur|nouvel(le)? (entrepot|plateforme|site|usine)|s.implante|implantation|construction|extension|agrandi|permis de construire|zone logistique|investit/],
  ['resultats', /chiffre d.affaires|resultats|benefice|perte|croissance|levee de fonds/],
];
const categoriser = t => { const s = sansAccent(t); for (const [c, re] of CATEGORIES_ACTU) if (re.test(s)) return c; return 'autre'; };
const decoder = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function googleActus(requete, pays = 'FR') {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(requete + ' when:7d')}&hl=fr&gl=${pays}&ceid=${pays}:fr`;
  const xml = await obtenir(url, { json: false, headers: { accept: 'application/rss+xml, application/xml' } });
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1], g = tag => (b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1];
    const media = decoder(g('source'));
    let titre = decoder(g('title'));
    if (media && titre.endsWith(' - ' + media)) titre = titre.slice(0, -(media.length + 3));
    const lien = decoder(g('link')), date = new Date(decoder(g('pubDate')));
    if (!titre || !lien) continue;
    items.push({ titre, url: lien, media: media || null, date_publication: isNaN(date) ? null : date.toISOString(), resume: decoder(g('description')).slice(0, 400) || null });
  }
  return items;
}

// BODACC : procédures collectives publiées pour les entreprises suivies
const BODACC = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';
async function bodacc(sirens) {
  const res = [], depuis = new Date(Date.now() - JOURS_ACTU * 864e5).toISOString().slice(0, 10);
  const liste = [...sirens];
  for (let i = 0; i < liste.length; i += 25) {
    const lot = liste.slice(i, i + 25);
    const where = `familleavis="collective" AND dateparution >= date'${depuis}' AND (${lot.map(s => `registre LIKE '%${s}%'`).join(' OR ')})`;
    try {
      const j = await obtenir(`${BODACC}?where=${encodeURIComponent(where)}&limit=100`);
      for (const r of j?.results || []) {
        let jug = r.jugement; try { if (typeof jug === 'string') jug = JSON.parse(jug); } catch { }
        const siren = lot.find(s => String(r.registre || '').replace(/\s/g, '').includes(s));
        res.push({
          id: 'bodacc:' + (r.id || empreinte(JSON.stringify(r))), source: 'bodacc', siren,
          titre: `${jug?.nature || r.familleavis_lib || 'Procédure collective'} — ${r.commercant || ''}${r.ville ? ' (' + r.ville + ')' : ''}`.trim(),
          url: r.url_complete || `https://www.bodacc.fr/pages/annonces-commerciales/?q.id=id:${encodeURIComponent(r.id || '')}`,
          media: 'BODACC', date_publication: r.dateparution ? new Date(r.dateparution).toISOString() : null,
          resume: jug?.complementJugement ? String(jug.complementJugement).slice(0, 400) : null, categorie: 'defaillance',
          departements: r.cp ? [String(r.cp).slice(0, 2)] : [],
        });
      }
    } catch (e) { log('  ! BODACC', e.message); }
    await sleep(400);
  }
  return res;
}

// ------------------------------------------------------------------ base Supabase (groupes et sites suivis)
async function lireTable(table, select, filtre = '') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const l = await obtenir(`${SUPABASE_URL}/rest/v1/${table}?select=${select}${filtre}&order=id&offset=${from}&limit=1000`, { headers: hSupa });
    out.push(...l); if (l.length < 1000) break;
  }
  return out;
}
async function ecrire(table, lignes) {
  for (let i = 0; i < lignes.length; i += 300)
    await obtenir(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, { method: 'POST', body: JSON.stringify(lignes.slice(i, i + 300)), headers: { ...hSupa, prefer: 'resolution=merge-duplicates,return=minimal' } });
}

// ------------------------------------------------------------------ exécution
let groupes = [], suivis = [];
if (AVEC_SUPABASE) {
  try {
    groupes = (await lireTable('groupes', 'id,nom,reference', '&supprime=eq.false'));
    suivis = await lireTable('sites', 'id,nom,enseigne,siret,siren,groupe_id,statut', '&supprime=eq.false&statut=in.(client,en_contact,rdv,devis)');
    log(`Base : ${groupes.length} groupes, ${suivis.length} sites suivis (client / en contact / RDV / devis)`);
  } catch (e) { log('! lecture de la base', e.message); }
}

log('Appels d’offres BOAMP…');
const aos = await appelsOffres();
log(`  ${aos.length} appels d’offres pertinents en cours`);

log('Actualités…');
const actus = new Map(), vusTitres = new Set();
const ajouter = (it, extra) => {
  const cleT = sansAccent(it.titre).replace(/[^a-z0-9]/g, '').slice(0, 90);
  if (vusTitres.has(cleT)) { const e = [...actus.values()].find(a => a._t === cleT); if (e && extra.groupes) e.groupes = [...new Set([...e.groupes, ...extra.groupes])]; return; }
  vusTitres.add(cleT);
  const id = it.id || empreinte(it.url);
  actus.set(id, { id, _t: cleT, titre: it.titre.slice(0, 500), url: it.url, media: it.media, date_publication: it.date_publication, resume: it.resume || null,
    categorie: it.categorie || categoriser(it.titre + ' ' + (it.resume || '')), departements: it.departements?.length ? it.departements : departementsDe(it.titre + ' ' + (it.resume || '')),
    groupes: extra.groupes || [], sites: extra.sites || [], requete: extra.requete, source: it.source || 'presse', pertinence: extra.pertinence || 50, maj: new Date().toISOString() });
};
for (const q of THEMES) {
  try { for (const it of await googleActus(q, /belgique/i.test(q) ? 'BE' : 'FR')) ajouter(it, { requete: q, pertinence: 50 }); }
  catch (e) { log(`  ! « ${q} »`, e.message); }
  await sleep(1200);
}
// actualités des groupes de la base (le nom du groupe doit apparaître dans le titre)
for (const g of groupes) {
  const nom = g.nom.split(' / ')[0].trim();
  if (nom.length < 3) continue;
  try {
    for (const it of await googleActus(`"${nom}"`)) {
      if (!sansAccent(it.titre + ' ' + (it.resume || '')).includes(sansAccent(nom))) continue;
      ajouter(it, { groupes: [g.id], requete: 'groupe ' + nom, pertinence: g.reference ? 90 : 75 });
    }
  } catch (e) { log(`  ! groupe ${nom}`, e.message); }
  await sleep(1200);
}
// procédures collectives (BODACC) des sites suivis
const sirens = new Set(suivis.map(s => (s.siren || s.siret || '').slice(0, 9)).filter(s => /^\d{9}$/.test(s)));
if (sirens.size) {
  const parSiren = new Map(); for (const s of suivis) { const k = (s.siren || s.siret || '').slice(0, 9); (parSiren.get(k) || parSiren.set(k, []).get(k)).push(s); }
  for (const a of await bodacc(sirens)) {
    const sites = parSiren.get(a.siren) || [];
    ajouter(a, { sites: sites.map(s => s.id), groupes: [...new Set(sites.map(s => s.groupe_id).filter(Boolean))], requete: 'bodacc', pertinence: 95 });
  }
}
const limite = new Date(Date.now() - JOURS_ACTU * 864e5).toISOString();
const listeActus = [...actus.values()].filter(a => !a.date_publication || a.date_publication >= limite).map(({ _t, ...a }) => a);
log(`  ${listeActus.length} actualités (${JOURS_ACTU} derniers jours)`);

if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/appels_offres.json`, JSON.stringify(aos, null, 1)); fs.writeFileSync(`${OUT}/actualites.json`, JSON.stringify(listeActus, null, 1)); }
if (AVEC_SUPABASE) {
  await ecrire('appels_offres', aos);
  await ecrire('actualites', listeActus);
  // ménage : appels d'offres clos depuis plus de 30 jours, actualités de plus de 90 jours
  const ao30 = new Date(Date.now() - 30 * 864e5).toISOString(), ac90 = new Date(Date.now() - 90 * 864e5).toISOString();
  await obtenir(`${SUPABASE_URL}/rest/v1/appels_offres?date_limite=lt.${encodeURIComponent(ao30)}&suivi=in.(nouveau,sans_suite)`, { method: 'DELETE', headers: hSupa }).catch(e => log('! ménage AO', e.message));
  await obtenir(`${SUPABASE_URL}/rest/v1/actualites?date_publication=lt.${encodeURIComponent(ac90)}`, { method: 'DELETE', headers: hSupa }).catch(e => log('! ménage actus', e.message));
  log('→ Supabase à jour');
}
