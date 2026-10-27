// Couleurs : palette catégorielle validée (contraste daltonisme, ordre fixe — ne pas réordonner).
// Catégories d'activité des sites + règles de classement automatique (partagé appli / script d'import)

export const CATEGORIES = {
  LOG:       { libelle: 'Logistique', couleur: '#505EB6' },
  TRANSPORT: { libelle: 'Transport', couleur: '#EB6834' },
  FRIGO:     { libelle: 'Frigorifique', couleur: '#1BAF7A' },
  IND:       { libelle: 'Industriel', couleur: '#EDA100' },
  PHARMA:    { libelle: 'Pharmaceutique', couleur: '#E87BA4' },
  AGRO:      { libelle: 'Agroalimentaire', couleur: '#008300' },
  CHIMIE:    { libelle: 'Chimie', couleur: '#E34948' },
  COMMERCE:  { libelle: 'Grande distribution', couleur: '#0F8FB3' },
  AUTRE:     { libelle: 'À qualifier', couleur: '#8F9092' },
};

const norm = naf => String(naf || '').replace(/[^0-9A-Z]/gi, '').toUpperCase();   // "52.10B" → "5210B"

export function categorieDepuisNaf(naf) {
  const n = norm(naf); if (!n) return null;
  const d2 = n.slice(0, 2), d4 = n.slice(0, 4);
  if (n.startsWith('5210A')) return 'FRIGO';
  if (d4 === '5210' || d4 === '5224' || d4 === '5229' || d2 === '46' || d2 === '53') return 'LOG';
  if (d2 === '49' || d2 === '50' || d2 === '51' || d4 === '5221' || d4 === '5222' || d4 === '5223') return 'TRANSPORT';
  if (['10', '11', '12'].includes(d2)) return 'AGRO';
  if (d2 === '21') return 'PHARMA';
  if (d2 === '20' || d2 === '19') return 'CHIMIE';
  if (d4 === '4711' || d4 === '4719') return 'COMMERCE';
  const v = parseInt(d2, 10);
  if ((v >= 5 && v <= 33) || (v >= 35 && v <= 39)) return 'IND';
  return 'AUTRE';
}

// Rubriques ICPE : 1511 entrepôts frigorifiques, 1510 entrepôts couverts, 1530/1532 dépôts papier/bois…
export function categorieDepuisRubriques(rubriques = []) {
  const r = rubriques.map(String);
  if (r.some(x => x.startsWith('1511'))) return 'FRIGO';
  if (r.some(x => x.startsWith('1510') || x.startsWith('1530') || x.startsWith('1532') || x.startsWith('2662') || x.startsWith('2663'))) return 'LOG';
  return null;
}

// Activités sans intérêt pour la réparation de dallage industriel (écoles, hôpitaux, bureaux, agriculture…)
const EXCLUS = new Set(['01', '02', '03', '55', '56', '64', '65', '66', '69', '70', '71', '72', '73', '74', '75', '78', '84', '85', '86', '87', '88', '90', '91', '92', '93', '94', '96', '97', '98', '99']);
export const nafExclu = naf => EXCLUS.has(norm(naf).slice(0, 2));

export const LIBELLES_NAF_DIVISION = {
  '05': 'Extraction de houille', '06': 'Extraction d’hydrocarbures', '07': 'Extraction de minerais', '08': 'Autres industries extractives', '09': 'Services de soutien aux industries extractives',
  '10': 'Industries alimentaires', '11': 'Fabrication de boissons', '12': 'Fabrication de produits à base de tabac', '13': 'Fabrication de textiles', '14': 'Industrie de l’habillement',
  '15': 'Industrie du cuir et de la chaussure', '16': 'Travail du bois', '17': 'Industrie du papier et du carton', '18': 'Imprimerie', '19': 'Cokéfaction et raffinage',
  '20': 'Industrie chimique', '21': 'Industrie pharmaceutique', '22': 'Produits en caoutchouc et plastique', '23': 'Autres produits minéraux non métalliques', '24': 'Métallurgie',
  '25': 'Fabrication de produits métalliques', '26': 'Produits informatiques et électroniques', '27': 'Équipements électriques', '28': 'Machines et équipements', '29': 'Industrie automobile',
  '30': 'Autres matériels de transport', '31': 'Fabrication de meubles', '32': 'Autres industries manufacturières', '33': 'Réparation et installation de machines',
  '35': 'Production et distribution d’énergie', '36': 'Captage et distribution d’eau', '37': 'Collecte et traitement des eaux usées', '38': 'Collecte et traitement des déchets', '39': 'Dépollution',
  '41': 'Construction de bâtiments', '42': 'Génie civil', '43': 'Travaux de construction spécialisés', '45': 'Commerce et réparation automobile', '46': 'Commerce de gros', '47': 'Commerce de détail',
  '49': 'Transports terrestres', '50': 'Transports par eau', '51': 'Transports aériens', '52': 'Entreposage et services auxiliaires des transports', '53': 'Activités de poste et de courrier',
  '58': 'Édition', '59': 'Production audiovisuelle', '60': 'Programmation et diffusion', '61': 'Télécommunications', '62': 'Programmation informatique', '63': 'Services d’information',
  '68': 'Activités immobilières', '77': 'Location et location-bail', '80': 'Enquêtes et sécurité', '81': 'Services relatifs aux bâtiments', '82': 'Activités administratives', '95': 'Réparation d’ordinateurs et de biens',
};
