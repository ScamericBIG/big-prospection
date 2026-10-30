// Données fictives du pôle Dallage (mode démo) : projets (permis), architectes, AMO, BET, promoteurs, contractants, majors, sièges
let graine = 7;
const alea = () => { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; };
const choix = l => l[Math.floor(alea() * l.length)];
const id = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(alea() * 16); return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const jours = n => new Date(Date.now() - n * 864e5).toISOString();

const VILLES = [
  ['Bordeaux', '33000', 44.84, -0.58], ['Mérignac', '33700', 44.84, -0.65], ['Bruges', '33520', 44.88, -0.61], ['Saint-Jean-d’Illac', '33127', 44.81, -0.78],
  ['Ambarès-et-Lagrave', '33440', 44.95, -0.48], ['Cestas', '33610', 44.74, -0.68], ['Libourne', '33500', 44.92, -0.24], ['Bègles', '33130', 44.80, -0.55],
  ['Mont-de-Marsan', '40000', 43.89, -0.50], ['Dax', '40100', 43.71, -1.05], ['Bayonne', '64100', 43.49, -1.47], ['Pau', '64000', 43.30, -0.37],
  ['Agen', '47000', 44.20, 0.62], ['Marmande', '47200', 44.50, 0.17], ['Périgueux', '24000', 45.18, 0.72], ['Bergerac', '24100', 44.85, 0.48],
  ['Brive-la-Gaillarde', '19100', 45.16, 1.53], ['Limoges', '87000', 45.83, 1.26], ['Poitiers', '86000', 46.58, 0.34], ['Châtellerault', '86100', 46.82, 0.55],
  ['Niort', '79000', 46.32, -0.46], ['La Rochelle', '17000', 46.16, -1.15], ['Rochefort', '17300', 45.94, -0.96], ['Saintes', '17100', 45.75, -0.63],
  ['Angoulême', '16000', 45.65, 0.16], ['Cognac', '16100', 45.69, -0.33], ['Guéret', '23000', 46.17, 1.87], ['Bressuire', '79300', 46.84, -0.49],
];
const NOMS = {
  PROMOTEUR: ['Atlantique Logistique Promotion', 'Garonne Parcs d’Activités', 'Sud Invest Immo', 'Aquitaine Développement Foncier', 'Estuaire Logistics Real Estate'],
  CONTRACTANT: ['Bâti Clé en Main Atlantique', 'Cobat Constructions', 'Halle & Structures', 'Les Constructeurs Landais', 'Arcade Bâtiment Industriel', 'Océan Contractant'],
  MAJOR: ['Major BTP Régional', 'Grand Groupe Construction Agence Bordeaux', 'Constructeur National — Direction Sud-Ouest', 'Génie Civil Majeur Aquitaine'],
  ARCHI: ['Atelier Gironde Architectes', 'Arcane Architecture Industrielle', 'Studio Volumes', 'Ateliers du Littoral', 'Archi & Process', 'Lignes Architectes'],
  AMO: ['Pilotage Projets Immobiliers', 'AMO Atlantique', 'Maîtrise d’Œuvre Conseil', 'Programmation & Co'],
  BET: ['BET Structure Aquitaine', 'Ingénierie Dallages & Sols', 'Bureau Technique Garonne', 'Fondations Études'],
  SIEGE: ['Conserveries de l’Adour', 'Aéro Composants Sud-Ouest', 'Transports Charentais', 'Distribution Agricole Limousine', 'Papeteries de la Vienne', 'Logistique Froid Atlantique'],
};
const DEST = [['entrepot', 'Entrepôt'], ['industrie', 'Industrie'], ['artisanat', 'Artisanat'], ['agricole', 'Agricole']];

export function genererDallageDemo() {
  graine = 7;
  const groupes = [], sites = [], contacts = [], activites = [];
  const mo = ['Promoteur Atlantique', 'Foncière Logistique Ouest', 'Groupe Agroalimentaire Landais', 'Industrie Aéronautique Gironde', 'Coopérative Agricole Charente', 'Distribution Régionale Poitou'];
  for (const n of mo) groupes.push({ id: id(), nom: n + ' (démo)', reference: false, supprime: false, created_at: jours(400), updated_at: jours(400) });
  const ajouter = (cat, nom, v, extra = {}) => {
    const [ville, cp, lat, lng] = v;
    const s = { id: id(), nom, enseigne: null, proprietaire: null, siren: String(300000000 + Math.floor(alea() * 6e8)), siret: null, naf: null, naf_libelle: null, groupe_id: null,
      adresse: `${1 + Math.floor(alea() * 120)} ${choix(['rue', 'avenue', 'allée', 'zone d’activités'])} ${choix(['des Pins', 'de l’Industrie', 'du Port', 'Gustave Eiffel', 'de la Garonne', 'des Landes'])}`,
      code_postal: cp, ville, departement: cp.slice(0, 2), pays: 'FR', lat: +(lat + (alea() - .5) * .12).toFixed(5), lng: +(lng + (alea() - .5) * .16).toFixed(5), secteur: 'nouvelle_aquitaine',
      categorie: null, categorie_auto: cat, surface_m2: null, surface_auto: null, annee_construction: null, annee_auto: null,
      statut: choix(['a_qualifier', 'a_qualifier', 'a_qualifier', 'prospect', 'en_contact', 'rdv', 'devis', 'client']), standard_tel: `05 ${Math.floor(10 + alea() * 89)} ${Math.floor(10 + alea() * 89)} ${Math.floor(10 + alea() * 89)} ${Math.floor(10 + alea() * 89)}`,
      site_web: null, commentaire: null, date_dernier_appel: null, date_prochain_rappel: null, date_rdv: null, assigne_a: 'cdragne@big-france.com',
      source: 'demo', source_id: 'dal-demo-' + sites.length, infos_od: {}, supprime: false, created_at: jours(200), updated_at: jours(200), updated_by: null, ...extra };
    if (s.statut === 'a_qualifier') s.assigne_a = null;
    if (['en_contact', 'rdv', 'devis'].includes(s.statut) && alea() < .6) s.date_prochain_rappel = jours(-Math.floor(alea() * 20 - 5)).slice(0, 10);
    sites.push(s); return s;
  };
  // projets : permis de construire de locaux d'activité ≥ 500 m²
  for (let k = 0; k < 90; k++) {
    const v = choix(VILLES), [dest, lib] = choix(DEST), surf = Math.round((500 + Math.pow(alea(), 2.2) * 40000) / 50) * 50, age = Math.floor(alea() * 700);
    const g = choix(groupes);
    const etape = age > 500 ? 'livre' : age > 120 && alea() < .6 ? 'travaux' : 'permis_accorde';
    const s = ajouter('PROJET', `${lib} ${(surf / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k m² — ${v[0]} (démo)`, v, {
      proprietaire: g.nom, groupe_id: g.id, surface_auto: surf, annee_auto: null,
      infos_od: { permis: { num: `PC 0${v[1].slice(0, 2)} ${100 + k} 25 ${String(10000 + k).slice(1)}`, date: jours(age).slice(0, 10), etape, nature: alea() < .75 ? 'Construction neuve' : 'Extension',
        surfaces: { [dest]: surf }, demandeur: g.nom, terrain_m2: Math.round(surf * (2 + alea() * 3)) } },
    });
    if (alea() < .15) s.statut = 'a_qualifier';
  }
  for (const [cat, noms] of Object.entries(NOMS)) for (const n of noms) for (let r = 0; r < (cat === 'ARCHI' ? 3 : 2); r++) {
    const v = choix(VILLES);
    ajouter(cat, `${n}${r ? ' — ' + v[0] : ''} (démo)`, v, { infos_od: { effectif: choix(['02', '03', '11', '12', '21', '22', '31', '32', '41']), nb_projets: cat === 'ARCHI' || cat === 'PROMOTEUR' ? Math.floor(alea() * 4) : 0 } });
  }
  // quelques contacts et échanges
  for (const s of sites.filter(x => x.statut !== 'a_qualifier').slice(0, 60)) {
    const c = { id: id(), site_id: s.id, groupe_id: null, prenom: choix(['Julien', 'Sophie', 'Marc', 'Claire', 'Thomas', 'Nathalie']), nom: choix(['Lafitte', 'Duprat', 'Larrieu', 'Bernadet', 'Cazaux', 'Laborde']) + ' (démo)',
      fonction: choix(['Responsable immobilier', 'Directeur de programmes', 'Architecte associé', 'Directeur travaux', 'Chef de projet']), telephone: null, email: null, role: 'contact',
      decisionnaire: alea() < .4, niveau_decision: 'regional', ca_big: 'cdragne@big-france.com', supprime: false, created_at: jours(100), updated_at: jours(100) };
    contacts.push(c);
    activites.push({ id: id(), site_id: s.id, type: choix(['appel', 'appel', 'rdv', 'email']), date: jours(Math.floor(alea() * 90)), statut: 'fait', contenu: choix(['Projet en phase APD, consultation dallage prévue au printemps', 'Envoyer nos références plateformes logistiques', 'Rappeler après dépôt du permis', 'Intéressé par une variante fibres']),
      auteur: 'cdragne@big-france.com', supprime: false, created_at: jours(30), updated_at: jours(30) });
  }
  return { groupes, sites, contacts, activites };
}
