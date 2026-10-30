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
// accepte aussi une adresse copiée avec « /rest/v1/ » à la fin
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AVEC_SUPABASE = SUPABASE_URL && KEY && !args.includes('--sans-supabase');
const JOURS_ACTU = 45;
// --pole dallage : veille du pôle Dallage (construction neuve, Nouvelle-Aquitaine), tables dal_*
const DALLAGE = args.includes('--pole') && args[args.indexOf('--pole') + 1] === 'dallage';
const T = t => DALLAGE ? 'dal_' + t : t;
const DEPTS_NA = ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sansAccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const empreinte = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
const aujourdhui = new Date().toISOString().slice(0, 10);
// user-agent sans « Mozilla » : Supabase refuse la clé secrète quand la requête ressemble à un navigateur
const hSupa = { apikey: KEY, 'content-type': 'application/json', 'user-agent': 'BIG-Prospection/1.0 (veille)', ...(KEY.startsWith('eyJ') ? { authorization: 'Bearer ' + KEY } : {}) };

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
let RECHERCHES_AO = ['dallage', 'sol industriel', 'sols industriels', 'résine', 'resine', 'revêtement de sol', 'revêtements de sols', 'revetement de sol',
  'ragréage', 'ragreage', 'réfection des sols', 'réfection de sol', 'reprise de sol', 'fissure', 'réparation de béton', 'réparation béton', 'réparations béton',
  'chape', 'peinture de sol', 'sol béton', 'traitement de sol', 'joints de dallage', 'entrepôt', 'plateforme logistique'];
let POIDS = [
  [/dallage/, 40, 'Dallage'], [/sols? industriels?/, 40, 'Sol industriel'], [/(revetements?|reprises?|refections?|renovations?) (des |de |du )?sols?/, 30, 'Revêtement / réfection de sol'],
  [/resine/, 25, 'Résine'], [/ragreage/, 25, 'Ragréage'], [/fissur/, 25, 'Fissures'], [/(reparations?|reprises?) (de |des |du )?betons?|betons? (degrade|endommage)/, 25, 'Réparation béton'],
  [/joints? (de )?(dallage|dilatation|sol)/, 25, 'Joints'], [/peinture (de |des )?sols?/, 20, 'Peinture de sol'], [/chape/, 15, 'Chape'], [/traitement (de |des )?sols?/, 15, 'Traitement de sol'],
  [/entrepots?|plate-?formes? logistiques?|logistique/, 12, 'Entrepôt / logistique'], [/(atelier|usine|industriel|hangar|quai)/, 8, 'Site industriel'],
];
let EXCLUSIONS = [/sportif|gymnase|terrain de (sport|foot)|gazon|tartan|aire de jeux|piscine|cour d.ecole|chaussee|voirie|enrobe|route departementale/];
let SEUIL_AO = 25;
if (DALLAGE) {
  // construction neuve de bâtiments d'activité / lots gros œuvre et dallage (pas de réparation)
  RECHERCHES_AO = ['dallage', 'gros oeuvre', 'gros œuvre', 'construction d%entrep', 'plateforme logistique', 'plate-forme logistique', 'batiment d%activit', 'bâtiment d%activit',
    'batiment industriel', 'bâtiment industriel', 'construction d%usine', 'construction d%un atelier', 'construction d%un hangar', 'hangar', 'hôtel d%entreprises', 'pépinière d%entreprises',
    'centre technique', 'conception-réalisation', 'conception réalisation', 'entrepôt frigorifique', 'centre de tri', 'halle', 'extension d%un bâtiment', 'zone d%activit'];
  POIDS = [
    [/dallage/, 40, 'Dallage'], [/gros (oe|œ)uvre/, 30, 'Gros œuvre'],
    [/(construction|realisation|edification|creation) (d.un |d.une |de |des |du )?(nouv\w* )?(entrepots?|plate-?formes? logistiques?|batiments? (d.activites?|industriels?|logistiques?|de stockage)|usines?|hangars?|ateliers?|halles?|centres? (techniques?|de tri)|hotels? d.entreprises|pepinieres? d.entreprises)/, 45, 'Construction bâtiment d’activité'],
    [/entrepots?|plate-?formes? logistiques?/, 20, 'Entrepôt / logistique'], [/batiments? (d.activites?|industriels?)|usines?|hangars?|ateliers?/, 15, 'Bâtiment d’activité'],
    [/extension/, 10, 'Extension'], [/conception.realisation/, 10, 'Conception-réalisation'], [/sols? industriels?|beton/, 10, 'Béton / sol industriel'],
    [/zones? d.activites?|parcs? d.activites?/, 8, 'Zone d’activités'], [/frigorifique/, 10, 'Frigorifique'],
  ];
  EXCLUSIONS = [/logements?|ecole|college|lycee|creche|gymnase|salle (de sport|polyvalente|des fetes)|ehpad|piscine|voirie|chaussee|enrobe|assainissement|eau potable|eclairage public|espaces verts|mediatheque|reparation|refection|entretien|maintenance|renovation energetique|desamiantage/];
  SEUIL_AO = 30;
}
function evaluerAO(texte) {
  const t = sansAccent(texte); let score = 0; const mots = [];
  for (const [re, p, lib] of POIDS) if (re.test(t)) { score += p; mots.push(lib); }
  if (EXCLUSIONS.some(re => re.test(t)) && !(DALLAGE ? /dallage|construction d.(un |une )?(entrepot|usine|batiment d.activit)/ : /dallage|sols? industriels?/).test(t)) score -= 40;
  return { score, mots };
}
async function appelsOffres() {
  const res = new Map();
  for (const mot of RECHERCHES_AO) {
    for (let offset = 0; offset < 300; offset += 100) {
      const where = `(objet LIKE '%${mot}%' OR descripteur_libelle LIKE '%${mot}%') AND datelimitereponse >= date'${aujourdhui}'`
        + (DALLAGE ? ` AND (${DEPTS_NA.map(d => `code_departement="${d}"`).join(' OR ')})` : '');
      let j;
      try { j = await obtenir(`${BOAMP}?where=${encodeURIComponent(where)}&order_by=${encodeURIComponent('datelimitereponse ASC')}&limit=100&offset=${offset}`); }
      catch (e) { log(`  ! BOAMP « ${mot} »`, e.message); break; }
      const l = j?.results || [];
      for (const r of l) {
        if (!r.idweb || res.has(r.idweb)) continue;
        const desc = [].concat(r.descripteur_libelle || []).join(', ');
        const { score, mots } = evaluerAO(`${r.objet || ''} ${desc}`);
        if (score < SEUIL_AO) continue;
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
// <classement>
// Thèmes recherchés : bâtiments (construction, rénovation, extension), déménagements, rachats / fusions,
// santé financière, fermetures, incendies. Tout le reste (produits, marketing, sport, magasins…) est écarté.
let THEMES = [
  'incendie entrepôt', 'incendie plateforme logistique', 'incendie usine', 'incendie site industriel',
  'liquidation judiciaire logistique', 'redressement judiciaire transporteur', 'redressement judiciaire usine', 'liquidation judiciaire usine', 'procédure de sauvegarde industriel',
  'fermeture usine', 'fermeture entrepôt', 'fermeture site logistique', 'plan social usine',
  'ouverture plateforme logistique', 'nouvel entrepôt logistique', 'nouvelle zone logistique', 'extension entrepôt', 'permis de construire entrepôt', 'inauguration plateforme logistique',
  'construction entrepôt', 'rénovation entrepôt', 'réhabilitation site industriel', 'travaux usine agrandissement', 'investissement usine',
  'déménagement entrepôt', 'déménagement siège logistique', 'transfert activité usine', 'regroupement sites logistiques',
  'rachat logisticien', 'rachat groupe logistique', 'acquisition logistique', 'fusion transport logistique', 'rachat transporteur',
  'reprise site logistique', 'reprend entrepôt', 'reprise usine', 'cession entrepôt',
  'résultats logisticien', 'difficultés financières logistique', 'difficultés financières industriel',
  'entrepôt Belgique incendie', 'nouvel entrepôt Belgique', 'rachat logistique Belgique',
];
const BATI = /entrepots?|plate-?formes?|logisti|usines?|sites? (industriel|logistique|de production)|ateliers?|hangars?|batiments?|zones? (d.activites?|industrielle|logistique)|parcs? (d.activites?|logistique)|centres? (de distribution|logistique)|data ?centers?|\bhub\b|messagerie|frigorifique|industriel|siege|locaux|surface|m2|m²/;
let CATEGORIES_ACTU = [
  ['incendie',     /incendie|\bfeu\b(?! vert)|ravage|brule|flammes|sinistre|fumee|pompiers|explosion/, true],
  ['defaillance',  /liquidation|redressement judiciaire|procedure de sauvegarde|plan de sauvegarde|placee? en sauvegarde|faillite|cessation de paiements?|tribunal de commerce|procedure collective|depot de bilan|difficultes financieres|en difficulte|conciliation|mandat ad hoc|surendett/, false],
  ['fermeture',    /fermeture|ferme (ses portes|son site|son usine|son entrepot|l.usine|l.entrepot|le site)|plan social|\bpse\b|licenciements?|suppressions? (de|d.)? ?postes|delocalis|cessation d.activite|arret de (la )?production/, false],
  ['rachat',       /rachat|rachete|acquisition|acquiert|cession|\bcede\b|fusion|fusionne|repreneur|reprise (du|de l.|d.un|d.une|de la|des) |reprend (le|la|l.|les|un|une) |prise de participation|\blbo\b|\bopa\b|offre publique|rapprochement|adosse/, false],
  ['demenagement', /demenag|transfert (d.activite|de (son|l.|la|ses)|du site|du siege)|relocalis|s.installe|nouveau siege|regroupe(ment)? (ses|de ses|des)/, true],
  ['travaux',      /renov|rehabilit|reconstru|travaux|chantier|construction|construit|extension|agrandi|permis de construire|modernis|reamenag|mise aux normes|desamiant|sols? industriels?|dallage/, true],
  ['ouverture',    /ouverture|ouvre (un|une|son|sa|ses|le|la)|inaugur|nouvel(le)? (entrepot|plateforme|site|usine|centre|hub|batiment)|implantation|s.implante|investit|investissement|zone logistique|parc logistique/, true],
  ['resultats',    /chiffre d.affaires|\bca\b (en|de)|resultats?\b|benefices?|pertes?\b|deficit|croissance|levee de fonds|leve \d|rentabilite|ebitda|\bmarges?\b|endette|dettes?\b|notation|avertissement|tresorerie|recapitalis|augmentation de capital/, false],
];
// sujets hors cible, même si un mot-clé apparaît (produits, commerce de détail, sport, people, emploi…)
let HORS_SUJET = /nouveaux? produits?|nouvelle (gamme|collection)|\bcollection\b|\bgamme\b|soldes|promo|black friday|bon plan|code promo|\btest\b|\bavis\b|velo|trottinette|chaussure|sneaker|maillot|vetement|textile|jouet|recette|sponsor|\bmatch\b|ligue|championnat|footbal|rugby|marathon|course a pied|influenceu|publicite|campagne (publicitaire|de pub)|offre d.emploi|recrute|recrutement|salon de |rachat de credits?|rachat de trimestres|assurance.vie|appartement|maison individuelle|logement|immobilier residentiel|magasin|boutique|supermarche|hypermarche|galerie commerciale|\bmeteo\b|faits divers/;
const HORS_SUJET_SAUF = /entrepot|plate-?forme logistique|usine|site logistique|siege|centre de distribution/;
if (DALLAGE) {
  THEMES = ['permis de construire entrepôt Gironde', 'permis de construire usine Nouvelle-Aquitaine', 'permis de construire plateforme logistique Nouvelle-Aquitaine',
    'plateforme logistique Bordeaux', 'entrepôt logistique Gironde', 'construction usine Nouvelle-Aquitaine', 'extension usine Gironde', 'extension usine Landes',
    'extension usine Vienne', 'extension usine Charente', 'zone d’activités Nouvelle-Aquitaine projet', 'implantation entreprise Bordeaux Métropole', 'implantation usine Poitiers',
    'entrepôt Pau construction', 'nouvelle plateforme logistique Charente-Maritime', 'parc logistique Nouvelle-Aquitaine', 'bâtiment d’activités construction Landes',
    'promoteur logistique Bordeaux', 'investissement industriel Nouvelle-Aquitaine', 'usine Limoges projet', 'entrepôt La Rochelle construction', 'Agen plateforme logistique',
    'Niort entrepôt construction', 'Bayonne zone d’activités entreprise', 'Dordogne usine extension', 'Corrèze usine investissement', 'Deux-Sèvres usine extension', 'Haute-Vienne entrepôt projet'];
  HORS_SUJET = new RegExp(HORS_SUJET.source.replace('|promo|', '|\\bpromo\\b|'));   // « promotion immobilière » ne doit pas être écarté
  CATEGORIES_ACTU = [['permis', /permis de construire|depot (du|d.un|de son) permis|permis (accorde|delivre|depose)/, true], ...CATEGORIES_ACTU];
}
function categoriser(texte) {
  const s = sansAccent(texte);
  if (HORS_SUJET.test(s) && !HORS_SUJET_SAUF.test(s)) return null;
  for (const [c, re, bati] of CATEGORIES_ACTU) if (re.test(s) && (!bati || BATI.test(s))) return c;
  return null;                                   // hors thèmes : non retenu
}
// </classement>
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
    groupes = (await lireTable(T('groupes'), 'id,nom,reference', '&supprime=eq.false'));
    suivis = await lireTable(T('sites'), 'id,nom,enseigne,siret,siren,groupe_id,statut' + (DALLAGE ? ',categorie_auto,categorie' : ''), '&supprime=eq.false&statut=in.(client,en_contact,rdv,devis)');
    // Dallage : les promoteurs, contractants, majors et sièges suivis sont aussi recherchés dans la presse
    if (DALLAGE) for (const s of suivis.filter(x => ['PROMOTEUR', 'CONTRACTANT', 'MAJOR', 'SIEGE'].includes(x.categorie || x.categorie_auto)).slice(0, 80))
      groupes.push({ id: null, site: s.id, nom: (s.enseigne || s.nom).replace(/\s+—.*$/, ''), reference: s.statut === 'client' });
    log(`Base : ${groupes.length} groupes, ${suivis.length} sites suivis (client / en contact / RDV / devis)`);
  } catch (e) { log('! lecture de la base', e.message); }
}

log('Appels d’offres BOAMP…');
const aos = await appelsOffres();
log(`  ${aos.length} appels d’offres pertinents en cours`);

log('Actualités…');
const actus = new Map(), vusTitres = new Set(); let horsSujet = 0;
const ajouter = (it, extra) => {
  const cleT = sansAccent(it.titre).replace(/[^a-z0-9]/g, '').slice(0, 90);
  if (vusTitres.has(cleT)) { const e = [...actus.values()].find(a => a._t === cleT); if (e && extra.groupes) e.groupes = [...new Set([...e.groupes, ...extra.groupes])]; return; }
  const categorie = it.categorie || categoriser(it.titre + ' ' + (it.resume || ''));
  if (!categorie) { horsSujet++; return; }
  vusTitres.add(cleT);
  const id = it.id || empreinte(it.url);
  actus.set(id, { id, _t: cleT, titre: it.titre.slice(0, 500), url: it.url, media: it.media, date_publication: it.date_publication, resume: it.resume || null,
    categorie, departements: it.departements?.length ? it.departements : departementsDe(it.titre + ' ' + (it.resume || '')),
    groupes: extra.groupes || [], sites: extra.sites || [], requete: extra.requete, source: it.source || 'presse', pertinence: extra.pertinence || 50, maj: new Date().toISOString() });
};
for (const q of THEMES) {
  try { for (const it of await googleActus(q, /belgique/i.test(q) ? 'BE' : 'FR')) {
    if (DALLAGE && !departementsDe(it.titre + ' ' + (it.resume || '')).some(d => DEPTS_NA.includes(d))) { horsSujet++; continue; }   // hors Nouvelle-Aquitaine
    ajouter(it, { requete: q, pertinence: 50 });
  } }
  catch (e) { log(`  ! « ${q} »`, e.message); }
  await sleep(1200);
}
// actualités des groupes de la base (le nom du groupe doit apparaître dans le titre)
for (const g of groupes) {
  const nom = g.nom.split(' / ')[0].trim();
  if (nom.length < 3) continue;
  try {
    for (const it of await googleActus(`"${nom}" (entrepôt OR usine OR site OR plateforme OR rachat OR rachète OR acquisition OR fusion OR cession OR reprise OR déménagement OR construction OR extension OR travaux OR fermeture OR liquidation OR redressement OR sauvegarde OR résultats OR "chiffre d'affaires" OR incendie)`)) {
      if (!sansAccent(it.titre + ' ' + (it.resume || '')).includes(sansAccent(nom))) continue;
      ajouter(it, { groupes: g.id ? [g.id] : [], sites: g.site ? [g.site] : [], requete: 'groupe ' + nom, pertinence: g.reference ? 90 : 75 });
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
log(`  ${listeActus.length} actualités retenues (${JOURS_ACTU} derniers jours) — ${horsSujet} écartées (hors thèmes)`);

if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/appels_offres.json`, JSON.stringify(aos, null, 1)); fs.writeFileSync(`${OUT}/actualites.json`, JSON.stringify(listeActus, null, 1)); }
if (AVEC_SUPABASE) {
  let echec = false;
  for (const [t, l] of [[T('appels_offres'), aos], [T('actualites'), listeActus]]) {
    try { await ecrire(t, l); log(`  ${t} : ${l.length} lignes enregistrées`); }
    catch (e) { echec = true; log(`! écriture ${t}`, e.message); }
  }
  if (echec) { log('✗ Échec d’écriture dans Supabase (voir ci-dessus)'); process.exit(1); }
  // reclassement des actualités déjà en base avec les règles actuelles : les hors-sujet sont masquées
  try {
    const existantes = await lireTable(T('actualites'), 'id,titre,resume,categorie', '&source=eq.presse&masque=eq.false');
    const masquer = [], parCat = new Map();
    for (const a of existantes) {
      const c = categoriser(a.titre + ' ' + (a.resume || ''));
      if (!c) masquer.push(a.id);
      else if (c !== a.categorie) (parCat.get(c) || parCat.set(c, []).get(c)).push(a.id);
    }
    const patch = async (ids, corps) => {
      for (let i = 0; i < ids.length; i += 80)
        await obtenir(`${SUPABASE_URL}/rest/v1/${T('actualites')}?id=in.(${ids.slice(i, i + 80).map(encodeURIComponent).join(',')})`, { method: 'PATCH', body: JSON.stringify(corps), headers: { ...hSupa, prefer: 'return=minimal' } });
    };
    await patch(masquer, { masque: true, updated_by: 'veille (hors thèmes)' });
    for (const [c, ids] of parCat) await patch(ids, { categorie: c });
    log(`  reclassement : ${masquer.length} actualités hors thèmes masquées, ${[...parCat.values()].reduce((n, l) => n + l.length, 0)} recatégorisées`);
  } catch (e) { log('! reclassement', e.message); }
  // ménage : appels d'offres clos depuis plus de 30 jours, actualités de plus de 90 jours
  const ao30 = new Date(Date.now() - 30 * 864e5).toISOString(), ac90 = new Date(Date.now() - 90 * 864e5).toISOString();
  await obtenir(`${SUPABASE_URL}/rest/v1/${T('appels_offres')}?date_limite=lt.${encodeURIComponent(ao30)}&suivi=in.(nouveau,sans_suite)`, { method: 'DELETE', headers: hSupa }).catch(e => log('! ménage AO', e.message));
  await obtenir(`${SUPABASE_URL}/rest/v1/${T('actualites')}?date_publication=lt.${encodeURIComponent(ac90)}`, { method: 'DELETE', headers: hSupa }).catch(e => log('! ménage actus', e.message));
  log('→ Supabase à jour');
}
