// Outils communs aux onglets « Appels d'offres » et « Actualités » : rattachement aux secteurs, répondants, libellés
import { store } from './store.js';
import { sansAccent } from './metier.js';

export const NOMS_DEPTS = Object.fromEntries("01:Ain|02:Aisne|03:Allier|04:Alpes-de-Haute-Provence|05:Hautes-Alpes|06:Alpes-Maritimes|07:Ardèche|08:Ardennes|09:Ariège|10:Aube|11:Aude|12:Aveyron|13:Bouches-du-Rhône|14:Calvados|15:Cantal|16:Charente|17:Charente-Maritime|18:Cher|19:Corrèze|21:Côte-d'Or|22:Côtes-d'Armor|23:Creuse|24:Dordogne|25:Doubs|26:Drôme|27:Eure|28:Eure-et-Loir|29:Finistère|2A:Corse-du-Sud|2B:Haute-Corse|30:Gard|31:Haute-Garonne|32:Gers|33:Gironde|34:Hérault|35:Ille-et-Vilaine|36:Indre|37:Indre-et-Loire|38:Isère|39:Jura|40:Landes|41:Loir-et-Cher|42:Loire|43:Haute-Loire|44:Loire-Atlantique|45:Loiret|46:Lot|47:Lot-et-Garonne|48:Lozère|49:Maine-et-Loire|50:Manche|51:Marne|52:Haute-Marne|53:Mayenne|54:Meurthe-et-Moselle|55:Meuse|56:Morbihan|57:Moselle|58:Nièvre|59:Nord|60:Oise|61:Orne|62:Pas-de-Calais|63:Puy-de-Dôme|64:Pyrénées-Atlantiques|65:Hautes-Pyrénées|66:Pyrénées-Orientales|67:Bas-Rhin|68:Haut-Rhin|69:Rhône|70:Haute-Saône|71:Saône-et-Loire|72:Sarthe|73:Savoie|74:Haute-Savoie|75:Paris|76:Seine-Maritime|77:Seine-et-Marne|78:Yvelines|79:Deux-Sèvres|80:Somme|81:Tarn|82:Tarn-et-Garonne|83:Var|84:Vaucluse|85:Vendée|86:Vienne|87:Haute-Vienne|88:Vosges|89:Yonne|90:Territoire de Belfort|91:Essonne|92:Hauts-de-Seine|93:Seine-Saint-Denis|94:Val-de-Marne|95:Val-d'Oise|971:Guadeloupe|972:Martinique|973:Guyane|974:La Réunion|976:Mayotte|975:Saint-Pierre-et-Miquelon|977:Saint-Barthélemy|978:Saint-Martin|BE:Belgique".split('|').map(x => x.split(':')));
export const libDept = d => NOMS_DEPTS[d] ? `${d === 'BE' ? '' : d + ' '}${NOMS_DEPTS[d]}` : d;

// secteurs (hors « national ») d'une liste de départements
export function secteursDeDepts(deps = []) {
  const res = new Set();
  for (const d of deps || []) { const s = store.data.secteur_departements.get(String(d))?.secteur; if (s && s !== 'national') res.add(s); else if (d) res.add('hors'); }
  return res;
}

// chargé(s) d'affaires d'un secteur — « qui répond »
export function repondants(code) {
  return store.liste('profils').filter(p => p.secteur === code && p.actif !== false && p.role !== 'directeur');
}
export const prenomNom = p => p ? `${p.prenom} ${p.nom}` : '';

// secteurs couverts par chaque groupe (d'après ses sites) — recalculé quand les sites changent
let memoGroupes = null;
store.on('change', d => { if (!d || ['sites', 'groupes', 'secteur_departements'].includes(d.table)) memoGroupes = null; });
export function secteursDesGroupes() {
  if (memoGroupes) return memoGroupes;
  memoGroupes = new Map();
  for (const s of store.liste('sites')) {
    if (!s.groupe_id) continue;
    const sec = s.secteur || store.secteurDe(s); if (!sec) continue;
    let e = memoGroupes.get(s.groupe_id); if (!e) memoGroupes.set(s.groupe_id, e = new Set());
    e.add(sec);
  }
  return memoGroupes;
}

export const SECTIONS_ORDRE = () => store.liste('secteurs').filter(s => s.code !== 'national').sort((a, b) => a.ordre - b.ordre);

// « J-5 », « aujourd'hui », « clos »
export function echeance(iso) {
  if (!iso) return { txt: 'sans date', jours: Infinity, classe: '' };
  const d = new Date(iso), maintenant = new Date();
  const debut = x => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y; };
  const jours = Math.round((debut(d) - debut(maintenant)) / 864e5);
  if (d < maintenant) return { txt: 'clos', jours: -1, classe: 'clos' };
  return { txt: jours === 0 ? 'aujourd’hui' : jours === 1 ? 'demain' : 'J-' + jours, jours, classe: jours <= 7 ? 'urgent' : jours <= 14 ? 'proche' : '' };
}
export function ilYa(iso) {
  if (!iso) return '';
  const min = (Date.now() - new Date(iso)) / 6e4;
  if (min < 60) return 'à l’instant';
  if (min < 1440) return `il y a ${Math.round(min / 60)} h`;
  const j = Math.round(min / 1440);
  return j === 1 ? 'hier' : j < 31 ? `il y a ${j} j` : new Date(iso).toLocaleDateString('fr-FR');
}
export const correspond = (texte, q) => !q || sansAccent(texte).includes(sansAccent(q));
export const lienSur = u => /^https?:\/\//i.test(u || '') ? u : null;
