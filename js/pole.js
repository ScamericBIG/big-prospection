// Pôle actif : « maintenance » (partie historique) ou « dallage » (réservé au directeur / profils autorisés).
// Le pôle Dallage réutilise les mêmes écrans avec ses propres tables (dal_*), catégories, secteur et veille.
const CLE = 'big_pole';
let p = 'maintenance';
try { if (localStorage.getItem(CLE) === 'dallage') p = 'dallage'; } catch { }
export const POLE = p;
export const DALLAGE = POLE === 'dallage';
export function changerPole(nouveau) { try { localStorage.setItem(CLE, nouveau); } catch { } location.reload(); }
export const aAccesDallage = profil => !!profil && profil.actif !== false && (['directeur', 'admin'].includes(profil.role) || !!profil.acces_dallage);

// ---- secteur Dallage : Nouvelle-Aquitaine
export const DEPTS_DALLAGE = ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'];
export const SECTEURS_DALLAGE = [
  { code: 'nouvelle_aquitaine', libelle: 'Nouvelle-Aquitaine', zones: '12 départements : 16, 17, 19, 23, 24, 33, 40, 47, 64, 79, 86, 87', couleur: '#2E8B6A', ordre: 1 },
  { code: 'national', libelle: 'Toute la France', zones: 'Y compris les acteurs hors Nouvelle-Aquitaine (majors, promoteurs nationaux…)', couleur: '#3B4796', ordre: 5 },
];
export const DEPARTEMENTS_DALLAGE = Object.fromEntries(DEPTS_DALLAGE.map(d => [d, 'nouvelle_aquitaine']));
export const EMPRISE_DALLAGE = [[42.75, -1.9], [47.2, 2.65]];

// ---- types d'acteurs (même palette validée que la partie Maintenance, ordre conservé)
export const CATEGORIES_DALLAGE = {
  PROMOTEUR:   { libelle: 'Promoteur / investisseur', couleur: '#505EB6' },
  CONTRACTANT: { libelle: 'Contractant général / constructeur', couleur: '#EB6834' },
  ARCHI:       { libelle: 'Architecte', couleur: '#1BAF7A' },
  AMO:         { libelle: 'AMO / maître d’œuvre', couleur: '#EDA100' },
  BET:         { libelle: 'Bureau d’études', couleur: '#E87BA4' },
  SIEGE:       { libelle: 'Siège social / donneur d’ordre', couleur: '#008300' },
  PROJET:      { libelle: 'Projet (permis de construire)', couleur: '#E34948' },
  MAJOR:       { libelle: 'Major du BTP', couleur: '#0F8FB3' },
  AUTRE:       { libelle: 'À qualifier', couleur: '#8F9092' },
};
export const ETAPES_PROJET = {
  permis_accorde: 'Permis accordé', travaux: 'Chantier ouvert', livre: 'Achevé', annule: 'Annulé', depose: 'Permis déposé',
};

// Recherches LinkedIn pré-remplies (ouvertes dans le navigateur, avec le compte de l'utilisateur)
export const POSTES_LINKEDIN = {
  PROJET: ['responsable immobilier', 'directeur immobilier', 'directeur des travaux', 'directeur technique'],
  SIEGE: ['responsable immobilier', 'directeur immobilier', 'directeur technique', 'directeur supply chain', 'directeur des services généraux'],
  PROMOTEUR: ['directeur de programmes', 'directeur technique', 'responsable développement', 'asset manager'],
  CONTRACTANT: ['directeur d’agence', 'directeur travaux', 'conducteur de travaux principal', 'acheteur'],
  MAJOR: ['directeur d’agence', 'directeur travaux', 'acheteur', 'directeur régional'],
  ARCHI: ['architecte associé', 'gérant', 'chef de projet'],
  AMO: ['directeur de projet', 'chef de projet', 'gérant'],
  BET: ['ingénieur structure', 'chef de projet', 'directeur d’agence'],
  AUTRE: ['directeur', 'responsable immobilier'],
};
export const lienLinkedIn = (poste, entreprise) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`"${poste}" ${entreprise || ''}`.trim())}&origin=GLOBAL_SEARCH_HEADER`;
