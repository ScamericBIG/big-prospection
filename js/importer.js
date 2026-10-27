// Import de sites : fichiers Excel / CSV de l'équipe (avec géocodage) et fichiers open data produits par le script
import { store } from './store.js';
import { CATEGORIES, STATUTS, esc, fmtN, sansAccent, distanceKm, uuid, deptDeCp } from './metier.js';
import { $, $$, toast, ouvrirModale, fermerModale } from './ui.js';
import { chargerScript } from './liste.js';

const CHAMPS = [
  ['nom', 'Nom du site / entreprise *', /^(nom|raison|entreprise|soci[eé]t[eé]|site|d[eé]nomination|client|compte)/],
  ['adresse', 'Adresse', /^(adresse|rue|voie|address)/],
  ['code_postal', 'Code postal', /(code.?postal|^cp$|postal|zip)/],
  ['ville', 'Ville', /^(ville|commune|localit|city)/],
  ['pays', 'Pays', /^pays|country/],
  ['lat', 'Latitude', /^(lat|latitude)$/],
  ['lng', 'Longitude', /^(lng|lon|long|longitude)$/],
  ['categorie', 'Type / activité', /(cat[eé]gor|type|activit[eé]|secteur d)/],
  ['surface_m2', 'Surface (m²)', /(surface|superficie|m2|m²)/],
  ['annee_construction', 'Année de construction', /(ann[eé]e|construction|anciennet)/],
  ['statut', 'Statut', /^(statut|status|[eé]tat)/],
  ['standard_tel', 'Tél. standard', /(standard|t[eé]l[eé]phone soci|tel.*site|^t[eé]l[eé]phone$|^tel$)/],
  ['contact_prenom', 'Contact : prénom', /pr[eé]nom/],
  ['contact_nom', 'Contact : nom', /(contact|interlocuteur|nom du contact)/],
  ['contact_fonction', 'Contact : fonction', /(fonction|poste|titre)/],
  ['contact_tel', 'Contact : téléphone', /(portable|mobile|t[eé]l.*contact|gsm)/],
  ['contact_email', 'Contact : email', /(mail|courriel)/],
  ['siret', 'SIRET / SIREN', /(siret|siren)/],
  ['groupe', 'Groupe / enseigne', /(groupe|enseigne|maison.?m[eè]re)/],
  ['commentaire', 'Commentaire', /(comment|remarque|note|observation)/],
  ['date_dernier_appel', 'Date dernier appel', /(dernier.*(appel|contact)|last call)/],
  ['date_prochain_rappel', 'Date prochain rappel', /(rappel|relance|prochain)/],
];

export function ouvrirImport() {
  const m = ouvrirModale(`<h3>Importer des sites</h3>
    <p>Choisissez un fichier :</p>
    <ul>
      <li><b>Excel ou CSV</b> de l'équipe (une ligne par site). Les colonnes sont reconnues automatiquement et les adresses sont géolocalisées (Base Adresse Nationale).</li>
      <li><b>Fichier open data</b> <code>sites-XX.json</code> produit par le script d'import (BDNB / OpenStreetMap).</li>
    </ul>
    <input type="file" id="im-fichier" accept=".xlsx,.xls,.csv,.json,.txt">
    <div id="im-suite"></div>
    <div class="boutons"><button class="btn" data-fermer-modale>Fermer</button></div>`, { large: true });
  $('#im-fichier', m).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      if (/\.json$/i.test(f.name)) await importJson(f, m);
      else await importTableur(f, m);
    } catch (err) { console.error(err); toast('Lecture impossible : ' + err.message, 'erreur'); }
  };
}

// ------------------------------------------------------------------ open data JSON
async function importJson(f, m) {
  const brut = JSON.parse(await f.text());
  // Deux formats : tableau de sites (script open data) ou { groupes, sites, contacts } (reprise de l'ancienne base)
  const paquet = Array.isArray(brut) ? { sites: brut } : brut;
  if (!Array.isArray(paquet.sites) || !paquet.sites[0]?.source) throw new Error('format inattendu (attendu : sortie du script import-opendata ou fichier de reprise)');
  // groupes : réutilise un groupe existant du même nom
  const grExist = new Map(store.liste('groupes').map(g => [g.nom.toLowerCase(), g]));
  const remapGroupe = new Map(), groupes = [];
  for (const g of paquet.groupes || []) {
    const e = grExist.get(g.nom.toLowerCase());
    if (e) remapGroupe.set(g.id, e.id); else { groupes.push({ ...g, supprime: false }); remapGroupe.set(g.id, g.id); }
  }
  const existants = new Map(store.liste('sites', true).map(s => [s.source + '|' + s.source_id, s]));
  const remapSite = new Map();
  let nouveaux = 0;
  const lot = paquet.sites.map(r => {
    const e = existants.get(r.source + '|' + r.source_id);
    const gid = r.groupe_id ? remapGroupe.get(r.groupe_id) || null : null;
    if (!e) { nouveaux++; remapSite.set(r.id, r.id); return { ...r, groupe_id: gid, statut: r.statut || 'a_qualifier', supprime: false }; }
    remapSite.set(r.id, e.id);
    return { ...e, categorie_auto: r.categorie_auto, surface_auto: r.surface_auto, annee_auto: r.annee_auto ?? e.annee_auto,
      infos_od: { ...(e.infos_od || {}), ...(r.infos_od || {}) }, naf: e.naf || r.naf, naf_libelle: e.naf_libelle || r.naf_libelle,
      groupe_id: e.groupe_id || gid };
  });
  const ctExist = new Set(store.liste('contacts').map(c => c.site_id + '|' + (c.nom || '').toLowerCase()));
  const contacts = (paquet.contacts || []).map(c => ({ ...c, site_id: remapSite.get(c.site_id) || c.site_id, groupe_id: c.groupe_id ? remapGroupe.get(c.groupe_id) || null : null, supprime: false }))
    .filter(c => !ctExist.has(c.site_id + '|' + (c.nom || '').toLowerCase()));
  $('#im-suite', m).innerHTML = `<p>${fmtN(lot.length)} sites dans le fichier : <b>${fmtN(nouveaux)} nouveaux</b>, ${fmtN(lot.length - nouveaux)} déjà présents (mis à jour, qualifications conservées)${groupes.length ? ` · ${fmtN(groupes.length)} groupes` : ''}${contacts.length ? ` · ${fmtN(contacts.length)} contacts` : ''}.</p>
    <div class="progression"><div id="im-prog"></div></div><p class="vide" id="im-etat"></p><button class="btn btn-primaire" id="im-go">Importer</button>`;
  $('#im-go', m).onclick = async () => {
    $('#im-go', m).disabled = true;
    if (groupes.length) await store.enregistrerLot('groupes', groupes);
    await store.enregistrerLot('sites', lot, (n, t) => { $('#im-prog', m).style.width = (n / t * 100) + '%'; $('#im-etat', m).textContent = `Enregistrement sur l'appareil : ${fmtN(n)} / ${fmtN(t)}`; });
    if (contacts.length) await store.enregistrerLot('contacts', contacts);
    toast(`${fmtN(lot.length)} sites importés — envoi vers la base en cours, laissez la page ouverte jusqu'à « Synchronisé »`, 'ok'); fermerModale();
  };
}

// ------------------------------------------------------------------ Excel / CSV
async function importTableur(f, m) {
  if (!window.XLSX) await chargerScript('vendor/xlsx.full.min.js');
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  if (!rows.length) throw new Error('feuille vide');
  const cols = Object.keys(rows[0]);
  const auto = {};
  for (const [k, , re] of CHAMPS) {
    const c = cols.find(c => re.test(sansAccent(c).trim()) && !Object.values(auto).includes(c));
    if (c) auto[k] = c;
  }
  $('#im-suite', m).innerHTML = `
    <p><b>${fmtN(rows.length)} lignes</b> lues dans « ${esc(wb.SheetNames[0])} ». Vérifiez la correspondance des colonnes :</p>
    <div class="mapping">${CHAMPS.map(([k, lib]) => `<label>${lib}<select data-champ="${k}"><option value="">—</option>${cols.map(c => `<option ${auto[k] === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`).join('')}</div>
    <label style="font-weight:400"><input type="checkbox" id="im-maj" checked> Mettre à jour les sites déjà présents (même SIRET, ou même nom à moins de 300 m) au lieu de créer des doublons</label>
    <div class="apercu" style="margin-top:10px">${apercu(rows.slice(0, 6), cols)}</div>
    <div class="progression"><div id="im-prog"></div></div><p class="vide" id="im-etat"></p>
    <button class="btn btn-primaire" id="im-go">Importer ${fmtN(rows.length)} sites</button>`;
  $('#im-go', m).onclick = async () => {
    const map = {}; $$('[data-champ]', m).forEach(s => { if (s.value) map[s.dataset.champ] = s.value; });
    if (!map.nom) return toast('Indiquez la colonne du nom', 'erreur');
    $('#im-go', m).disabled = true;
    try { await traiter(rows, map, $('#im-maj', m).checked, (t, p) => { $('#im-etat', m).textContent = t; if (p != null) $('#im-prog', m).style.width = p + '%'; }); fermerModale(); }
    catch (e) { console.error(e); toast('Import interrompu : ' + e.message, 'erreur'); $('#im-go', m).disabled = false; }
  };
}

const apercu = (rows, cols) => `<table class="table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(val(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const val = v => v instanceof Date ? v.toLocaleDateString('fr-FR') : String(v ?? '').trim();
function date(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const s = String(v).trim(), m1 = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m1) return `${m1[3].length === 2 ? '20' + m1[3] : m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
const nombre = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[\s ]/g, '').replace(',', '.').replace(/[^\d.-]/g, '')); return isFinite(n) && n !== 0 ? n : null; };
function categorie(v) {
  const s = sansAccent(v); if (!s) return null;
  if (CATEGORIES[s.toUpperCase()]) return s.toUpperCase();
  if (/frigo|froid|surgel/.test(s)) return 'FRIGO';
  if (/pharma|sante|medic/.test(s)) return 'PHARMA';
  if (/chimi/.test(s)) return 'CHIMIE';
  if (/agro|aliment|lait|boisson/.test(s)) return 'AGRO';
  if (/transport|messager|fret|transit/.test(s)) return 'TRANSPORT';
  if (/logist|entrep|plateforme|stockage|log\b/.test(s)) return 'LOG';
  if (/hyper|super|grande distri|commerce|retail/.test(s)) return 'COMMERCE';
  if (/indus|usine|fabric|product|metal|auto|ind\b/.test(s)) return 'IND';
  return 'AUTRE';
}
function statut(v) {
  const s = sansAccent(v); if (!s) return null;
  if (STATUTS[s]) return s;
  if (/client/.test(s)) return 'client';
  if (/devis|offre/.test(s)) return 'devis';
  if (/rdv|rendez/.test(s)) return 'rdv';
  if (/contact|cours/.test(s)) return 'en_contact';
  if (/perdu|refus/.test(s)) return 'perdu';
  if (/pertinent|hors cible/.test(s)) return 'non_pertinent';
  return 'prospect';
}

async function traiter(rows, map, majExistants, etape) {
  const g = (r, k) => map[k] ? r[map[k]] : '';
  const lignes = rows.map(r => {
    const cp = val(g(r, 'code_postal')).replace(/\.0$/, '');
    const pays = /belg|^be$/i.test(val(g(r, 'pays'))) || (/^\d{4}$/.test(cp) && !/^\d{5}$/.test(cp)) ? 'BE' : 'FR';
    return {
      r, site: {
        nom: val(g(r, 'nom')), adresse: val(g(r, 'adresse')) || null, code_postal: pays === 'FR' && /^\d{4}$/.test(cp) ? '0' + cp : (cp || null),
        ville: val(g(r, 'ville')) || null, pays, lat: nombre(g(r, 'lat')), lng: nombre(g(r, 'lng')),
        categorie: categorie(g(r, 'categorie')), surface_m2: nombre(g(r, 'surface_m2')), annee_construction: nombre(g(r, 'annee_construction')) ? Math.round(nombre(g(r, 'annee_construction'))) : null,
        statut: statut(g(r, 'statut')), standard_tel: val(g(r, 'standard_tel')) || null, siret: val(g(r, 'siret')).replace(/\s/g, '') || null,
        commentaire: val(g(r, 'commentaire')) || null, date_dernier_appel: date(g(r, 'date_dernier_appel')), date_prochain_rappel: date(g(r, 'date_prochain_rappel')),
      },
    };
  }).filter(l => l.site.nom);

  // 1. géocodage des lignes sans coordonnées
  const aGeo = lignes.filter(l => l.site.lat == null || l.site.lng == null);
  if (aGeo.length) {
    if (!navigator.onLine) throw new Error('le géocodage des adresses nécessite une connexion');
    etape(`Géolocalisation de ${aGeo.length} adresses…`, 5);
    await geocoderLot(aGeo.map(l => l.site), n => etape(`Géolocalisation : ${n}/${aGeo.length}`, 5 + n / aGeo.length * 60));
  }
  // 2. groupes
  const groupes = new Map(store.liste('groupes').map(x => [x.nom.toLowerCase(), x]));
  for (const l of lignes) {
    const nomG = val(g(l.r, 'groupe')); if (!nomG) continue;
    let gr = groupes.get(nomG.toLowerCase());
    if (!gr) { gr = await store.enregistrer('groupes', { nom: nomG, supprime: false }); groupes.set(nomG.toLowerCase(), gr); }
    l.site.groupe_id = gr.id;
  }
  // 3. dédoublonnage
  etape('Préparation…', 70);
  const existants = store.liste('sites');
  const parSiret = new Map(existants.filter(s => s.siret).map(s => [s.siret, s]));
  const lot = [], contacts = [];
  let maj = 0;
  for (const l of lignes) {
    let e = null;
    if (majExistants) {
      e = (l.site.siret && parSiret.get(l.site.siret)) || null;
      if (!e && l.site.lat) {
        const n = sansAccent(l.site.nom);
        e = existants.find(s => s.lat && Math.abs(s.lat - l.site.lat) < 0.01 && distanceKm(s, l.site) < 0.3 && (sansAccent(s.nom) === n || sansAccent(s.enseigne) === n)) || null;
      }
    }
    const propres = Object.fromEntries(Object.entries(l.site).filter(([, v]) => v != null && v !== ''));
    let site;
    if (e) { site = { ...e, ...propres }; maj++; }
    else site = { statut: 'prospect', ...propres, id: uuid(), source: 'import', source_id: uuid(), infos_od: {}, assigne_a: propres.statut && propres.statut !== 'a_qualifier' ? store.profil.email : null, supprime: false };
    if (!site.departement && site.code_postal) site.departement = site.pays === 'BE' ? 'BE' : deptDeCp(site.code_postal);
    lot.push(site);
    const cn = val(g(l.r, 'contact_nom'));
    if (cn) contacts.push({ site_id: site.id, groupe_id: site.groupe_id || null, prenom: val(g(l.r, 'contact_prenom')) || null, nom: cn, fonction: val(g(l.r, 'contact_fonction')) || null, telephone: val(g(l.r, 'contact_tel')) || null, email: val(g(l.r, 'contact_email')) || null, role: 'contact', supprime: false });
  }
  await store.enregistrerLot('sites', lot, (n, t) => etape(`Enregistrement : ${n}/${t}`, 70 + n / t * 25));
  if (contacts.length) await store.enregistrerLot('contacts', contacts);
  const sansPos = lot.filter(s => s.lat == null).length;
  etape('Terminé', 100);
  toast(`${fmtN(lot.length - maj)} sites créés, ${fmtN(maj)} mis à jour${contacts.length ? `, ${contacts.length} contacts` : ''}${sansPos ? ` — ${sansPos} sans position (adresse introuvable)` : ''}`, 'ok');
}

// Base Adresse Nationale (France) ; Nominatim pour la Belgique
async function geocoderLot(sites, prog) {
  let n = 0;
  const fr = sites.filter(s => s.pays !== 'BE'), be = sites.filter(s => s.pays === 'BE');
  // géocodage en masse (CSV) par paquets de 1000
  for (let i = 0; i < fr.length; i += 1000) {
    const part = fr.slice(i, i + 1000);
    const q = v => `"${String(v || '').replace(/"/g, '""')}"`;
    const csv = 'i,adresse,cp,ville\n' + part.map((s, k) => [k, q(s.adresse), q(s.code_postal), q(s.ville)].join(',')).join('\n');
    const fd = new FormData();
    fd.append('data', new Blob([csv], { type: 'text/csv' }), 'a.csv');
    ['adresse', 'cp', 'ville'].forEach(c => fd.append('columns', c));
    fd.append('postcode', 'cp');
    let ok = false;
    try {
      const r = await fetch('https://api-adresse.data.gouv.fr/search/csv/', { method: 'POST', body: fd });
      if (r.ok) {
        const t = await r.text();
        const wbr = XLSX.read(t, { type: 'string', raw: true });
        const out = XLSX.utils.sheet_to_json(wbr.Sheets[wbr.SheetNames[0]], { defval: '' });
        for (const o of out) {
          const s = part[+o.i]; if (!s) continue;
          if (o.latitude && +o.result_score >= 0.35) {
            s.lat = +o.latitude; s.lng = +o.longitude;
            s.code_postal ||= String(o.result_postcode || '') || null; s.ville ||= o.result_city || null;
          }
        }
        ok = true;
      }
    } catch (e) { console.warn('géocodage en masse', e); }
    if (!ok) for (const s of part) { await geocoderUn(s); prog(++n); }
    else { n += part.length; prog(n); }
  }
  for (const s of be) {
    try {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=be&q=${encodeURIComponent([s.adresse, s.code_postal, s.ville].filter(Boolean).join(' '))}`)).json();
      if (r[0]) { s.lat = +r[0].lat; s.lng = +r[0].lon; }
    } catch { }
    prog(++n);
    await new Promise(r => setTimeout(r, 1100));   // règle d'usage Nominatim : 1 requête / seconde
  }
}
async function geocoderUn(s) {
  try {
    const r = await (await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent([s.adresse, s.code_postal, s.ville].filter(Boolean).join(' '))}&limit=1`)).json();
    const f = r.features?.[0];
    if (f && f.properties.score >= 0.35) { [s.lng, s.lat] = f.geometry.coordinates; s.code_postal ||= f.properties.postcode; s.ville ||= f.properties.city; }
  } catch { }
}
