// Stratégie commerciale — moteur : modèles, périmètre « vivant », avancement calculé automatiquement
import { store } from './store.js';
import { etat, sitesDuSecteur, construireTest, brancherFiltreStrategie } from './etat.js';
import { ANNEE, uuid } from './metier.js';

// ------------------------------------------------------------------ objectifs (quand un site est-il « fait » ?)
export const OBJECTIFS = {
  decideur: { libelle: 'Identifier le décideur',            fait: 'décideur identifié',  aide: 'un contact « décisionnaire » est renseigné sur le site' },
  qualifie: { libelle: 'Appeler et qualifier le site',      fait: 'site qualifié',       aide: 'un appel, email, RDV ou visite est enregistré depuis le début de la stratégie (ou le site est classé perdu / non pertinent)' },
  contacte: { libelle: 'Contacter le site',                 fait: 'site contacté',       aide: 'un appel, email, RDV ou visite est enregistré depuis le début de la stratégie' },
  rdv:      { libelle: 'Obtenir un rendez-vous',            fait: 'RDV obtenu',          aide: 'un rendez-vous est enregistré (planifié ou réalisé) depuis le début de la stratégie' },
  visite:   { libelle: 'Visiter le site',                   fait: 'site visité',         aide: 'une visite terrain ou un chantier est enregistré depuis le début de la stratégie' },
  devis:    { libelle: 'Envoyer un devis',                  fait: 'devis envoyé',        aide: 'un devis est enregistré depuis le début de la stratégie (ou le site est devenu client)' },
  relance:  { libelle: 'Relancer (devis, proposition)',     fait: 'relance faite',       aide: 'un appel ou email est enregistré depuis le début de la stratégie (ou le site est client / perdu)' },
};

// ------------------------------------------------------------------ modèles prêts à l'emploi
export const MODELES = {
  decideurs_groupe: { ico: '👔', libelle: 'Qualifier les décideurs d’un groupe', desc: 'Tous les sites d’un groupe : identifier le décideur de chaque site.',
    objectif: 'decideur', titre: c => `Décideurs ${nomGroupe(c.groupe) || 'du groupe'}`, criteres: { secteur: 'national' }, champs: ['groupe'] },
  zone: { ico: '📍', libelle: 'Développer une ville / une zone', desc: 'Sites non clients autour d’une adresse ou dans des codes postaux.',
    objectif: 'qualifie', titre: c => `Développer ${c.autour?.libelle?.split(',')[0] || c.ville || c.cp || 'la zone'}`, criteres: { statuts: ['a_qualifier', 'prospect', 'en_contact'] }, champs: ['autour', 'cp', 'ville'] },
  patrimoine: { ico: '🏚', libelle: 'Patrimoine vieillissant', desc: 'Grands sites hors décennale de plus de 20 ans : décrocher des RDV.',
    objectif: 'rdv', titre: () => 'Grands sites de plus de 20 ans', criteres: { decennale: ['hors'], anneeMax: ANNEE - 20, surfMin: 20000, statuts: ['a_qualifier', 'prospect', 'en_contact'] }, champs: ['surfMin', 'age'] },
  referencement: { ico: '✓', libelle: 'Étendre un référencement', desc: 'Sites des groupes où BIG est référencé, pas encore clients.',
    objectif: 'contacte', titre: () => 'Étendre nos référencements', criteres: { reference: true, statuts: ['a_qualifier', 'prospect', 'en_contact'], secteur: 'national' }, champs: ['groupe'] },
  devis: { ico: '💶', libelle: 'Relancer les devis', desc: 'Devis envoyés sans réponse depuis plus de 30 jours.',
    objectif: 'relance', titre: () => 'Relance des devis en attente', criteres: { statuts: ['devis'], special: { devisJours: 30 } }, champs: ['devisJours'] },
  dormants: { ico: '💤', libelle: 'Réveiller les dossiers dormants', desc: 'Sites déjà contactés, sans échange depuis 6 mois.',
    objectif: 'contacte', titre: () => 'Réveil des dossiers dormants', criteres: { statuts: ['prospect', 'en_contact', 'rdv', 'devis'], special: { sansContactMois: 6 } }, champs: ['sansContactMois'] },
  fideliser: { ico: '🤝', libelle: 'Fidéliser les clients', desc: 'Clients sans visite ni chantier depuis plus d’un an.',
    objectif: 'visite', titre: () => 'Visite annuelle des clients', criteres: { statuts: ['client'], special: { chantierMois: 12 } }, champs: ['chantierMois'] },
  veille: { ico: '📰', libelle: 'Exploiter la veille', desc: 'Sites touchés par une actualité (rachat, déménagement, incendie…) ou ayant changé d’occupant.',
    objectif: 'contacte', titre: () => 'Appeler les sites dans l’actualité', criteres: { special: { actualiteJours: 30, nouvelOccupant: true } }, champs: ['actualiteJours'] },
  metier: { ico: '🏭', libelle: 'Campagne par métier', desc: 'Un type de site (frigorifique, agroalimentaire, industrie…) dans un secteur.',
    objectif: 'rdv', titre: c => `Campagne ${(c.categories || []).join(', ') || 'métier'}`, criteres: { categories: ['FRIGO'], statuts: ['a_qualifier', 'prospect', 'en_contact'] }, champs: ['categories', 'surfMin'] },
  tournee: { ico: '🚗', libelle: 'Préparer une tournée / un salon', desc: 'Sites autour d’un lieu, pour planifier des RDV sur place.',
    objectif: 'rdv', titre: c => `Tournée ${c.autour?.libelle?.split(',')[0] || ''}`.trim(), criteres: { statuts: ['a_qualifier', 'prospect', 'en_contact', 'rdv', 'devis'] }, champs: ['autour'] },
  perso: { ico: '✏️', libelle: 'Stratégie personnalisée', desc: 'Objectif et périmètre libres (ex. industriels des Hauts-de-France de plus de 10 000 m²).',
    objectif: 'qualifie', titre: () => '', criteres: {}, champs: [] },
};
const nomGroupe = id => id ? store.get('groupes', id)?.nom : null;

// ------------------------------------------------------------------ version des données (pour les mémos)
let version = 0;
store.on('change', d => { if (!d || ['sites', 'contacts', 'activites', 'strategies', 'strategie_sites', 'groupes', 'actualites', 'secteur_departements', 'profils'].includes(d.table)) version++; });

// index : activités et décideurs par site, exceptions par stratégie
let idx = null, idxV = -1;
function index() {
  if (idx && idxV === version) return idx;
  const acts = new Map(), decideurs = new Set(), exceptions = new Map();
  for (const a of store.liste('activites')) {
    if (!a.site_id || a.statut === 'annule') continue;
    (acts.get(a.site_id) || acts.set(a.site_id, []).get(a.site_id)).push(a);
  }
  for (const c of store.liste('contacts')) if (c.site_id && c.decisionnaire) decideurs.add(c.site_id);
  for (const x of store.liste('strategie_sites')) (exceptions.get(x.strategie_id) || exceptions.set(x.strategie_id, new Map()).get(x.strategie_id)).set(x.site_id, x);
  idx = { acts, decideurs, exceptions }; idxV = version;
  return idx;
}

// critères JSON → filtres utilisables par construireTest
export function versFiltres(c = {}) {
  const S = v => new Set(v || []);
  return {
    texte: c.texte || '', cp: c.cp || '', ville: c.ville || '', categories: S(c.categories), surfMin: c.surfMin || null, surfMax: c.surfMax || null,
    decennale: S(c.decennale), anneeMin: c.anneeMin || null, anneeMax: c.anneeMax || null, statuts: S(c.statuts), priorites: S(c.priorites),
    reference: !!c.reference, assigne: c.assigne || '', groupe: c.groupe || '', etats: S(c.etats || ['actif', 'inconnu']), nomIdentifie: !!c.nomIdentifie,
  };
}
// filtres du panneau → critères JSON (« reprendre les filtres de la carte »)
export function depuisFiltres(f, autour, secteur) {
  const A = s => [...(s || [])];
  const c = { secteur, texte: f.texte || undefined, cp: f.cp || undefined, ville: f.ville || undefined, categories: A(f.categories), surfMin: f.surfMin, surfMax: f.surfMax,
    decennale: A(f.decennale), anneeMin: f.anneeMin, anneeMax: f.anneeMax, statuts: A(f.statuts), priorites: A(f.priorites), reference: f.reference || undefined,
    assigne: f.assigne || undefined, groupe: f.groupe || undefined, etats: A(f.etats), nomIdentifie: f.nomIdentifie || undefined, autour: autour || undefined };
  for (const k of Object.keys(c)) if (c[k] == null || (Array.isArray(c[k]) && !c[k].length)) delete c[k];
  return c;
}

const TYPES_CONTACT = new Set(['appel', 'email', 'rdv', 'visite']);
const dateAct = a => a.created_at || a.date || '';
const ilYaJours = j => new Date(Date.now() - j * 864e5).toISOString();

// critères « spéciaux » (dépendent de l'historique ou de la veille)
function testSpecial(sp = {}) {
  const tests = [];
  const { acts } = index();
  if (sp.devisJours) {
    const lim = ilYaJours(sp.devisJours);
    tests.push(s => { const d = (acts.get(s.id) || []).filter(a => a.type === 'devis').map(a => a.date || '').sort().pop(); return !d || d < lim; });
  }
  if (sp.sansContactMois) {
    const lim = ilYaJours(sp.sansContactMois * 30.5);
    tests.push(s => { const l = (acts.get(s.id) || []).filter(a => TYPES_CONTACT.has(a.type) && a.statut !== 'planifie'); return l.length > 0 && l.every(a => (a.date || '') < lim); });
  }
  if (sp.chantierMois) {
    const lim = ilYaJours(sp.chantierMois * 30.5);
    tests.push(s => !(acts.get(s.id) || []).some(a => ['visite', 'chantier'].includes(a.type) && (a.date || '') >= lim));
  }
  if (sp.actualiteJours || sp.nouvelOccupant) {
    const lim = ilYaJours(sp.actualiteJours || 30), sites = new Set(), groupes = new Set();
    for (const a of store.liste('actualites')) {
      if (a.masque || a.categorie === 'autre' || (a.date_publication || a.created_at || '') < lim) continue;
      (a.sites || []).forEach(x => sites.add(x)); (a.groupes || []).forEach(x => groupes.add(x));
    }
    tests.push(s => sites.has(s.id) || (s.groupe_id && groupes.has(s.groupe_id)) || (sp.nouvelOccupant && !!s.infos_od?.nouvel_occupant));
  }
  return s => tests.every(t => t(s));
}

// le site a-t-il atteint l'objectif ?
function atteint(strat, s, i) {
  const debut = strat.debut || (strat.created_at || '').slice(0, 10) || '2000-01-01';
  const l = (i.acts.get(s.id) || []).filter(a => dateAct(a) >= debut);
  switch (strat.objectif) {
    case 'decideur': return i.decideurs.has(s.id);
    case 'qualifie': return l.some(a => TYPES_CONTACT.has(a.type) || a.type === 'devis') || ['perdu', 'non_pertinent'].includes(s.statut);
    case 'contacte': return l.some(a => TYPES_CONTACT.has(a.type));
    case 'rdv':      return l.some(a => a.type === 'rdv') || (s.date_rdv && s.date_rdv.slice(0, 10) >= debut);
    case 'visite':   return l.some(a => a.type === 'visite' || a.type === 'chantier');
    case 'devis':    return l.some(a => a.type === 'devis') || s.statut === 'client';
    case 'relance':  return l.some(a => ['appel', 'email', 'rdv', 'visite'].includes(a.type)) || ['client', 'perdu'].includes(s.statut);
    default:         return false;
  }
}

export const caActifs = () => store.liste('profils').filter(p => p.actif !== false && p.role !== 'directeur' && p.secteur !== 'national');
export const peutModifier = strat => ['directeur', 'admin'].includes(store.profil?.role) || strat.cree_par === store.profil?.email;
export const estManager = () => ['directeur', 'admin'].includes(store.profil?.role);

// ------------------------------------------------------------------ bilan d'une stratégie (mémorisé)
const memo = new Map();
export function bilan(strat) {
  const cle = strat.id + '|' + strat.updated_at + '|' + version;
  const m = memo.get(strat.id); if (m && m.cle === cle) return m.res;
  const i = index(), c = strat.criteres || {};
  const exc = i.exceptions.get(strat.id) || new Map();
  const test = construireTest(versFiltres(c), c.autour || null), sp = testSpecial(c.special);
  const vus = new Set(), liste = [];
  for (const s of sitesDuSecteur(c.secteur || 'national')) if (test(s, true) && sp(s)) { liste.push(s); vus.add(s.id); }
  for (const [sid, x] of exc) if (!x.supprime && x.affecte_a && !vus.has(sid)) { const s = store.get('sites', sid); if (s && !s.supprime) { liste.push(s); vus.add(sid); } }   // ajoutés à la main
  // attribution : choix manuel > chargé d'affaires du site s'il fait partie de l'équipe > règle de répartition
  const membres = strat.membres || [];
  const secteurDe = new Map(membres.map(e => [store.get('profils', e)?.secteur, e]));
  const restants = [];
  const sites = liste.map(s => {
    const x = exc.get(s.id);
    let resp = x && !x.supprime && x.affecte_a && membres.includes(x.affecte_a) ? x.affecte_a : null;
    if (!resp && strat.repartition !== 'equitable' && s.assigne_a && membres.includes(s.assigne_a)) resp = s.assigne_a;
    if (!resp && membres.length === 1) resp = membres[0];
    if (!resp && membres.length && strat.repartition === 'secteur') resp = secteurDe.get(s.secteur || store.secteurDe(s)) || null;
    const o = { s, resp, sansObjet: x?.etat === 'sans_objet' && !x.supprime, manuel: x?.etat === 'fait' && !x.supprime, raison: x?.raison || null };
    o.fait = !o.sansObjet && (o.manuel || atteint(strat, s, i));
    if (!resp && membres.length && strat.repartition !== 'manuel') restants.push(o);
    return o;
  });
  // répartition équitable des sites restants, d'ouest en est (chacun garde une zone cohérente)
  if (restants.length) {
    restants.sort((a, b) => (a.s.lng ?? 99) - (b.s.lng ?? 99));
    const charge = new Map(membres.map(e => [e, sites.filter(o => o.resp === e).length]));
    const cibleParMembre = Math.ceil((sites.length) / membres.length);
    let k = 0;
    for (const o of restants) {
      while (charge.get(membres[k]) >= cibleParMembre && k < membres.length - 1) k++;
      o.resp = membres[k]; charge.set(membres[k], charge.get(membres[k]) + 1);
    }
  }
  const parMembre = new Map(membres.map(e => [e, { total: 0, faits: 0 }]));
  let total = 0, faits = 0, sansObjet = 0;
  for (const o of sites) {
    if (o.sansObjet) { sansObjet++; continue; }
    total++; if (o.fait) faits++;
    const pm = o.resp && parMembre.get(o.resp); if (pm) { pm.total++; if (o.fait) pm.faits++; }
  }
  const res = { sites, total, faits, sansObjet, parMembre, nonAttribues: membres.length ? sites.filter(o => !o.resp && !o.sansObjet).length : 0,
    parId: new Map(sites.map(o => [o.s.id, o])) };
  memo.set(strat.id, { cle, res });
  return res;
}

export const strategiesActives = () => store.liste('strategies').filter(x => x.statut === 'en_cours');
export const mesStrategies = () => strategiesActives().filter(x => (x.membres || []).includes(store.profil?.email));
// stratégies en cours qui concernent un site
export function strategiesDuSite(id) {
  return strategiesActives().map(st => ({ st, o: bilan(st).parId.get(id) })).filter(x => x.o);
}

// ------------------------------------------------------------------ filtre « Stratégie » de la carte et de la liste
let memoFiltre = { cle: null, res: null };
function idsFiltre(code, aFaire) {
  const cle = code + '|' + aFaire + '|' + version + '|' + store.liste('strategies').map(x => x.updated_at).join();
  if (memoFiltre.cle === cle) return memoFiltre.res;
  const moi = store.profil?.email, ids = new Set(), faits = new Set();
  // '_mes' : mes sites de toutes mes stratégies ; 'moi:<id>' : mes sites d'une stratégie ; '<id>' : toute la stratégie
  const seulMoi = code === '_mes' || code.startsWith('moi:');
  const strats = code === '_mes' ? mesStrategies() : [store.get('strategies', code.replace(/^moi:/, ''))].filter(Boolean);
  for (const st of strats) for (const o of bilan(st).sites) {
    if (seulMoi && o.resp !== moi) continue;
    if (o.sansObjet) continue;
    if (o.fait) faits.add(o.s.id);
    if (!aFaire || !o.fait) ids.add(o.s.id);
  }
  for (const id of ids) if (faits.has(id) && !aFaire) { /* gardé, affiché « fait » */ }
  memoFiltre = { cle, res: { ids, faits } };
  return memoFiltre.res;
}
brancherFiltreStrategie((code, aFaire) => idsFiltre(code, aFaire).ids);
// pour la carte : site déjà « fait » dans la stratégie filtrée (affiché en grisé)
export function faitDansFiltre(s) {
  const f = etat.filtres; if (!f.strategie || f.strategieAFaire) return false;
  return idsFiltre(f.strategie, false).faits.has(s.id);
}

// ------------------------------------------------------------------ exceptions site par site
export async function marquer(strat, siteId, champs) {
  const id = strat.id + ':' + siteId;
  const x = store.get('strategie_sites', id) || { id, strategie_id: strat.id, site_id: siteId };
  await store.enregistrer('strategie_sites', { ...x, supprime: false, ...champs });
}

// ------------------------------------------------------------------ démo
export function strategiesDemo(st) {
  const fm = [...st.data.groupes.values()].find(g => !g.supprime);
  const now = new Date().toISOString(), j = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  return [
    { id: uuid(), titre: `Décideurs ${fm?.nom || 'du groupe'}`, modele: 'decideurs_groupe', consigne: 'Identifier le directeur de site et le responsable maintenance de chaque site.', criteres: { secteur: 'national', groupe: fm?.id },
      objectif: 'decideur', cible: null, echeance: j(45), debut: j(-20), statut: 'en_cours', membres: ['enieps@big-france.com', 'mguerreiro@big-france.com', 'mpineau@big-france.com', 'zejjanhani@big-france.com'], repartition: 'secteur', personnelle: false, cree_par: 'cdragne@big-france.com', supprime: false, created_at: now, updated_at: now },
    { id: uuid(), titre: 'Grands sites de plus de 20 ans — Nord', modele: 'patrimoine', consigne: 'Priorité aux sites logistiques ; proposer un diagnostic dallage gratuit.', criteres: { secteur: 'nord', decennale: ['hors'], anneeMax: ANNEE - 20, surfMin: 20000, statuts: ['a_qualifier', 'prospect', 'en_contact'] },
      objectif: 'rdv', cible: 10, echeance: j(60), debut: j(-10), statut: 'en_cours', membres: ['enieps@big-france.com'], repartition: 'secteur', personnelle: false, cree_par: 'cdragne@big-france.com', supprime: false, created_at: now, updated_at: now },
    { id: uuid(), titre: 'Industriels Hauts-de-France > 10 000 m²', modele: 'perso', consigne: null, criteres: { secteur: 'nord', categories: ['IND'], surfMin: 10000, cp: '59,62,80,60,02' },
      objectif: 'qualifie', cible: null, echeance: null, debut: j(-5), statut: 'en_cours', membres: ['enieps@big-france.com'], repartition: 'secteur', personnelle: true, cree_par: 'enieps@big-france.com', supprime: false, created_at: now, updated_at: now },
    { id: uuid(), titre: 'Campagne frigorifique Ouest', modele: 'metier', consigne: 'À lancer après le salon SIRHA.', criteres: { secteur: 'ouest', categories: ['FRIGO'], statuts: ['a_qualifier', 'prospect', 'en_contact'] },
      objectif: 'rdv', cible: 8, echeance: j(90), debut: j(0), statut: 'brouillon', membres: [], repartition: 'secteur', personnelle: false, cree_par: 'cdragne@big-france.com', supprime: false, created_at: now, updated_at: now },
  ];
}
