// Génère data/demo-sites.json : jeu de données FICTIF pour le mode démo (noms inventés, suffixe « démo »)
import fs from 'node:fs';
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const id = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = rnd() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const HUBS = [
  [50.585, 3.095, 'Lesquin', '59810', '59', 130], [50.435, 2.98, 'Dourges', '62119', '62', 110], [50.36, 3.52, 'Valenciennes', '59300', '59', 50],
  [51.02, 2.37, 'Dunkerque', '59640', '59', 40], [49.88, 2.33, 'Amiens', '80000', '80', 40], [49.25, 4.03, 'Reims', '51100', '51', 40],
  [49.11, 6.2, 'Metz', '57000', '57', 40], [48.56, 7.72, 'Strasbourg', '67100', '67', 45], [48.69, 6.18, 'Nancy', '54000', '54', 30], [49.85, 3.29, 'Saint-Quentin', '02100', '02', 25],
  [49.0, 2.55, 'Roissy-en-France', '95700', '95', 120], [48.84, 2.69, 'Bussy-Saint-Georges', '77600', '77', 90], [48.6, 2.6, 'Lieusaint', '77127', '77', 80],
  [48.935, 2.29, 'Gennevilliers', '92230', '92', 50], [48.76, 2.38, 'Rungis', '94150', '94', 60], [48.95, 2.05, 'Achères', '78260', '78', 30],
  [45.7, 4.92, 'Saint-Priest', '69800', '69', 110], [45.63, 5.13, 'Saint-Quentin-Fallavier', '38070', '38', 100], [43.45, 5.0, 'Miramas', '13140', '13', 70],
  [43.43, 5.22, 'Vitrolles', '13127', '13', 50], [43.93, 4.86, 'Avignon', '84000', '84', 40], [45.18, 5.72, 'Grenoble', '38000', '38', 30],
  [45.78, 3.12, 'Clermont-Ferrand', '63000', '63', 30], [43.67, 7.2, 'Nice', '06200', '06', 20], [45.45, 4.39, 'Saint-Étienne', '42000', '42', 30], [47.31, 5.04, 'Dijon', '21000', '21', 30],
  [47.95, 1.87, 'Saran', '45770', '45', 80], [49.48, 0.17, 'Le Havre', '76600', '76', 60], [49.4, 1.05, 'Rouen', '76000', '76', 40], [47.29, -1.48, 'Carquefou', '44470', '44', 50],
  [48.1, -1.65, 'Rennes', '35000', '35', 40], [44.9, -0.53, 'Bassens', '33530', '33', 50], [43.68, 1.4, 'Fenouillet', '31150', '31', 50], [47.4, 0.7, 'Tours', '37000', '37', 30],
  [48.0, 0.2, 'Le Mans', '72000', '72', 30], [49.18, -0.35, 'Caen', '14000', '14', 25], [43.6, 3.9, 'Montpellier', '34000', '34', 25], [46.58, 0.35, 'Poitiers', '86000', '86', 20],
  [51.25, 4.4, 'Antwerpen', '2030', 'BE', 70], [50.63, 5.57, 'Liège', '4000', 'BE', 40], [50.43, 4.45, 'Charleroi', '6000', 'BE', 35], [50.93, 4.42, 'Vilvoorde', '1800', 'BE', 35],
  [51.1, 3.75, 'Gent', '9000', 'BE', 35], [50.74, 3.21, 'Mouscron', '7700', 'BE', 25],
];
const CATS = [['LOG', 40], ['TRANSPORT', 12], ['FRIGO', 10], ['IND', 18], ['AGRO', 8], ['PHARMA', 4], ['CHIMIE', 3], ['COMMERCE', 3], ['AUTRE', 6]];
const wpick = list => { let t = list.reduce((s, x) => s + x[x.length - 1], 0) * rnd(); for (const x of list) { t -= x[x.length - 1]; if (t <= 0) return x; } return list[0]; };
const P1 = ['Alba', 'Norvia', 'Trans', 'Logi', 'Frigo', 'Indus', 'Sopra', 'Valo', 'Distri', 'Euro', 'Atlan', 'Septen', 'Orbi', 'Cap', 'Delta', 'Hexa', 'Prima', 'Sigma'];
const P2 = { LOG: ['Logistique', 'Distribution', 'Supply', 'Entrepôts'], TRANSPORT: ['Transports', 'Express', 'Fret', 'Messagerie'], FRIGO: ['Froid', 'Frais', 'Cold Logistics'], IND: ['Industries', 'Métal', 'Composites', 'Plastiques', 'Mécanique'], AGRO: ['Agro', 'Laiterie', 'Conserverie', 'Boulangerie industrielle'], PHARMA: ['Pharma', 'Santé Distribution'], CHIMIE: ['Chimie', 'Résines'], COMMERCE: ['Hyper Distribution', 'Cash & Carry'], AUTRE: ['Services', 'Développement'] };
const RUES = ['rue de l’Industrie', 'avenue de l’Europe', 'ZAC des Portes', 'rue du Commerce', 'boulevard de la Logistique', 'rue Gustave Eiffel', 'allée des Entrepôts', 'rue Denis Papin', 'chemin du Port', 'rue de la Gare'];
const EQUIPE = { nord: 'enieps@big-france.com', idf: 'zejjanhani@big-france.com', est: 'mguerreiro@big-france.com', ouest: 'mpineau@big-france.com' };
const SECT = d => d === 'BE' || '02 59 60 62 80 08 10 51 52 54 55 57 67 68 88'.split(' ').includes(d) ? 'nord' : '75 77 78 91 92 93 94 95'.split(' ').includes(d) ? 'idf' : '01 03 07 15 26 38 42 43 63 69 73 74 04 05 06 13 83 84 21 25 39 58 70 71 89 90 30 34 48'.split(' ').includes(d) ? 'est' : 'ouest';

const groupes = ['Groupe Alba (démo)', 'Norvia Supply (démo)', 'Frigo Atlan (démo)', 'Hexa Industries (démo)', 'Delta Express (démo)'].map(nom => ({ id: id(), nom, notes: 'Groupe fictif du mode démo', supprime: false, created_at: '2025-01-05T09:00:00Z', updated_at: '2025-01-05T09:00:00Z' }));
const sites = [], contacts = [], activites = [];
const STAT = [['a_qualifier', 62], ['prospect', 16], ['en_contact', 9], ['rdv', 4], ['devis', 3], ['client', 3], ['perdu', 2], ['non_pertinent', 1]];
let n = 0;
for (const [lat, lng, ville, cp, dep, nb] of HUBS) {
  for (let i = 0; i < nb; i++) {
    n++;
    const [cat] = wpick(CATS);
    const surf = Math.round(Math.min(220000, 5000 * Math.exp(Math.abs(gauss()) * 1.25)) / 100) * 100;
    const annee = rnd() < 0.15 ? null : Math.round(Math.max(1965, Math.min(2025, 2001 + gauss() * 13)));
    const nom = `${pick(P1)}${pick(['', 'is', 'ia', 'o', 'ex'])} ${pick(P2[cat])} (démo)`;
    const r = (rnd() < 0.5 ? 0.012 : 0.05) * Math.sqrt(-Math.log(rnd() || 0.01));
    const a = rnd() * 2 * Math.PI;
    const [statut] = wpick(STAT);
    const sect = SECT(dep);
    const s = {
      id: id(), nom, enseigne: null, proprietaire: rnd() < 0.5 ? `SCI ${pick(P1)} Immo (démo)` : null, siren: null, siret: null, naf: null, naf_libelle: null,
      groupe_id: rnd() < 0.08 ? pick(groupes).id : null,
      adresse: `${1 + Math.floor(rnd() * 180)} ${pick(RUES)}`, code_postal: cp, ville, departement: dep, pays: dep === 'BE' ? 'BE' : 'FR',
      lat: +(lat + r * Math.sin(a)).toFixed(6), lng: +(lng + r * Math.cos(a) * 1.4).toFixed(6), secteur: sect,
      categorie: null, categorie_auto: cat, surface_m2: null, surface_auto: surf, annee_construction: null, annee_auto: annee,
      statut, standard_tel: statut !== 'a_qualifier' ? `03 ${String(Math.floor(rnd() * 1e8)).padStart(8, '0').replace(/(\d\d)(?=\d)/g, '$1 ')}` : null,
      site_web: null, commentaire: null, date_dernier_appel: null, date_prochain_rappel: null, date_rdv: null,
      assigne_a: statut !== 'a_qualifier' ? EQUIPE[sect] : null, source: 'demo', source_id: 'demo-' + n, infos_od: {}, supprime: false,
      created_at: '2025-01-05T09:00:00Z', updated_at: '2025-01-05T09:00:00Z', updated_by: null,
    };
    if (statut !== 'a_qualifier' && statut !== 'non_pertinent') {
      const auteur = EQUIPE[sect];
      const nbAct = 1 + Math.floor(rnd() * 5);
      let last = null;
      for (let k = 0; k < nbAct; k++) {
        const d = new Date(Date.UTC(2025, 0, 1) + rnd() * (Date.UTC(2026, 9, 26) - Date.UTC(2025, 0, 1)));
        const type = k === 0 ? 'appel' : pick(['appel', 'appel', 'email', 'rdv', 'visite', 'devis', 'note']);
        activites.push({ id: id(), site_id: s.id, type, date: d.toISOString(), statut: 'fait', montant: type === 'devis' ? Math.round(5 + rnd() * 120) * 1000 : null, contenu: type === 'note' ? 'Note de suivi (démo)' : null, auteur, supprime: false, created_at: d.toISOString(), updated_at: d.toISOString() });
        if (type === 'appel' && (!last || d > last)) last = d;
      }
      s.date_dernier_appel = last ? last.toISOString().slice(0, 10) : null;
      if (['prospect', 'en_contact', 'rdv', 'devis'].includes(statut)) {
        s.date_prochain_rappel = new Date(Date.UTC(2026, 9, 27) + (rnd() - 0.4) * 40 * 864e5).toISOString().slice(0, 10);
        contacts.push({ id: id(), site_id: s.id, groupe_id: s.groupe_id, parent_id: null, prenom: pick(['Julien', 'Sophie', 'Karim', 'Laura', 'Thomas', 'Nadia', 'Pierre', 'Claire']), nom: pick(['Martin', 'Bernard', 'Durand', 'Lefebvre', 'Moreau', 'Laurent', 'Garcia', 'Roux']) + ' (démo)', fonction: pick(['Responsable maintenance', 'Directeur de site', 'Responsable services généraux', 'Responsable travaux']), telephone: null, email: null, role: pick(['decideur', 'contact']), ca_big: auteur, notes: null, supprime: false, created_at: '2025-02-01T09:00:00Z', updated_at: '2025-02-01T09:00:00Z' });
      }
      if (statut === 'rdv') { const d = new Date(Date.UTC(2026, 9, 28) + rnd() * 20 * 864e5); d.setUTCHours(8 + Math.floor(rnd() * 8)); s.date_rdv = d.toISOString(); activites.push({ id: id(), site_id: s.id, type: 'rdv', date: s.date_rdv, statut: 'planifie', contenu: 'Visite de l’état du dallage (démo)', auteur, supprime: false, created_at: s.created_at, updated_at: s.created_at }); }
    }
    sites.push(s);
  }
}
fs.writeFileSync(new URL('../data/demo-sites.json', import.meta.url), JSON.stringify({ groupes, sites, contacts, activites }));
console.log(sites.length, 'sites,', contacts.length, 'contacts,', activites.length, 'activités');
