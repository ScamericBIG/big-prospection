// Données fictives de veille pour le mode démo (dates calculées à partir d'aujourd'hui)
const J = 864e5;
const dans = (j, h = 12) => { const d = new Date(Date.now() + j * J); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const jour = j => dans(j).slice(0, 10);

const AO = [
  // [titre, acheteur, départements, j avant date limite, mots-clés, pertinence, procédure]
  ['Réfection du dallage béton de l’entrepôt n°3 — plateforme logistique', 'Port autonome de Dunkerque (démo)', ['59'], 12, ['Dallage', 'Entrepôt / logistique'], 92, 'Procédure adaptée'],
  ['Traitement des fissures et reprise des joints de dallage — atelier de maintenance', 'Métropole Européenne de Lille (démo)', ['59'], 5, ['Fissures', 'Joints'], 80, 'Procédure adaptée'],
  ['Revêtement de sol résine — cuisine centrale', 'Ville d’Amiens (démo)', ['80'], 21, ['Résine', 'Revêtement / réfection de sol'], 55, 'Procédure adaptée'],
  ['Rénovation des sols industriels du centre technique municipal', 'Ville de Reims (démo)', ['51'], 9, ['Sol industriel'], 78, 'Appel d’offres ouvert'],
  ['Réparation béton et ragréage des quais de chargement', 'Grand Port fluvial de Strasbourg (démo)', ['67'], 2, ['Réparation béton', 'Ragréage'], 70, 'Procédure adaptée'],
  ['Marché de travaux de sols — extension de la plateforme logistique hospitalière', 'Assistance Publique — Hôpitaux de Paris (démo)', ['94'], 18, ['Sol industriel', 'Entrepôt / logistique'], 88, 'Appel d’offres ouvert'],
  ['Remplacement du revêtement de sol époxy — ateliers RATP', 'RATP (démo)', ['93'], 7, ['Résine', 'Revêtement / réfection de sol'], 66, 'Procédure négociée'],
  ['Réfection de sols — marché d’entretien à bons de commande', 'Département de Seine-et-Marne (démo)', ['77'], 26, ['Revêtement / réfection de sol'], 48, 'Appel d’offres ouvert'],
  ['Reprise du dallage fissuré du magasin général', 'SNCF Réseau — Établissement Lyon (démo)', ['69'], 15, ['Dallage', 'Fissures'], 90, 'Procédure adaptée'],
  ['Peinture de sol et marquage — entrepôt du MIN de Marseille', 'Ville de Marseille (démo)', ['13'], 4, ['Peinture de sol', 'Entrepôt / logistique'], 58, 'Procédure adaptée'],
  ['Travaux de résine anti-acide — station d’épuration', 'Grenoble-Alpes Métropole (démo)', ['38'], 33, ['Résine'], 45, 'Appel d’offres ouvert'],
  ['Réhabilitation du sol industriel du hangar de maintenance', 'Aéroport Nice Côte d’Azur (démo)', ['06'], 11, ['Sol industriel', 'Site industriel'], 76, 'Procédure négociée'],
  ['Réfection du dallage de l’entrepôt de stockage du centre de tri', 'Nantes Métropole (démo)', ['44'], 8, ['Dallage', 'Entrepôt / logistique'], 86, 'Procédure adaptée'],
  ['Réparation des fissures du dallage — base logistique', 'Région Nouvelle-Aquitaine (démo)', ['33'], 19, ['Fissures', 'Dallage'], 84, 'Procédure adaptée'],
  ['Ragréage et revêtement de sol — atelier mécanique du dépôt de bus', 'Rennes Métropole (démo)', ['35'], 3, ['Ragréage', 'Revêtement / réfection de sol'], 52, 'Procédure adaptée'],
  ['Chape et sol industriel — construction d’un entrepôt frigorifique', 'Toulouse Métropole (démo)', ['31'], 24, ['Sol industriel', 'Chape'], 62, 'Appel d’offres ouvert'],
  ['Remise en état des sols des ateliers municipaux (lots multiples)', 'Ville de Tours (démo)', ['37', '41'], 14, ['Revêtement / réfection de sol', 'Site industriel'], 50, 'Procédure adaptée'],
  ['Accord-cadre national : entretien et réparation de dallages industriels', 'UGAP (démo)', [], 30, ['Dallage', 'Réparation béton'], 95, 'Appel d’offres ouvert'],
  ['Réfection des sols de l’entrepôt douanier', 'Port de Fort-de-France (démo)', ['972'], 10, ['Dallage'], 60, 'Procédure adaptée'],
  ['Dallage béton du nouvel atelier — clos depuis hier (ne doit pas apparaître)', 'Ville de Lens (démo)', ['62'], -1, ['Dallage'], 80, 'Procédure adaptée'],
];

export function genererVeilleDemo(store) {
  const appels_offres = AO.map(([titre, acheteur, departements, j, mots, pertinence, procedure], i) => ({
    id: 'demo-ao:' + (i + 1), source: 'boamp', titre, acheteur, description: mots.join(', '), departements, lieu: departements.join(', ') || null,
    type_marche: 'TRAVAUX', procedure, date_publication: jour(Math.min(j, 0) - 6 - (i % 5)), date_limite: dans(j, 12), url: 'https://www.boamp.fr/',
    mots_cles: mots, categorie: mots[0], pertinence, suivi: i === 0 ? 'on_repond' : i === 8 ? 'a_etudier' : 'nouveau',
    responsable: i === 0 ? 'enieps@big-france.com' : null, note: i === 0 ? 'Visite de site prévue — métrés à faire' : null,
    maj: dans(0, 6), created_at: dans(-((i % 4) + 1), 6), updated_at: dans(0, 6), updated_by: null,
  }));

  // actualités : mélange de sujets génériques et de sujets liés aux groupes / sites de la base démo
  const groupes = [...store.data.groupes.values()].filter(g => !g.supprime);
  const sites = [...store.data.sites.values()].filter(s => !s.supprime && s.lat);
  const parSecteur = code => sites.filter(s => s.secteur === code);
  const g = k => groupes[k % Math.max(1, groupes.length)];
  const s = (code, k) => { const l = parSecteur(code); return l[k % Math.max(1, l.length)]; };
  const items = [];
  const ajouter = (titre, categorie, j, o = {}) => items.push({
    id: 'demo-actu:' + (items.length + 1), titre, url: 'https://news.google.com/', media: o.media || 'Presse régionale (démo)', date_publication: dans(-j, 8 + (items.length % 9)),
    categorie, resume: o.resume || null, departements: o.departements || [], groupes: o.groupes || [], sites: o.sites || [], requete: o.requete || 'démo',
    pertinence: o.pertinence || 50, source: o.source || 'presse', masque: false, maj: dans(0, 6), created_at: dans(-Math.min(j, 3), 6), updated_at: dans(0, 6), updated_by: null,
  });
  const sNord = s('nord', 3), sEst = s('est', 7), sOuest = s('ouest', 2), sIdf = s('idf', 5);
  ajouter('Incendie dans un entrepôt logistique de la zone d’activités de Lesquin : 8 000 m² détruits', 'incendie', 1, { departements: ['59'], media: 'La Voix du Nord (démo)', pertinence: 70 });
  ajouter('Un nouveau parc logistique de 120 000 m² validé près d’Arras', 'ouverture', 3, { departements: ['62'], pertinence: 60 });
  ajouter('Fermeture annoncée de l’usine agroalimentaire de Saint-Quentin, 180 salariés concernés', 'fermeture', 6, { departements: ['02'] });
  ajouter('Belgique : un logisticien flamand rachète trois entrepôts à Liège', 'rachat', 9, { departements: ['BE'], media: 'L’Echo (démo)' });
  ajouter('Reims : la zone logistique de la Pompelle s’agrandit', 'ouverture', 4, { departements: ['51'] });
  ajouter('Feu dans un site industriel à Mulhouse, les pompiers mobilisés toute la nuit', 'incendie', 2, { departements: ['68'], media: 'L’Alsace (démo)' });
  ajouter('Redressement judiciaire pour un transporteur de Gonesse', 'defaillance', 5, { departements: ['95'], media: 'BODACC (démo)', source: 'bodacc', pertinence: 80 });
  ajouter('Roissy : livraison d’une plateforme messagerie de 45 000 m²', 'ouverture', 12, { departements: ['95', '77'] });
  ajouter('Lyon Saint-Exupéry : un entrepôt frigorifique change de mains', 'rachat', 7, { departements: ['69'] });
  ajouter('Fos-sur-Mer : liquidation d’un exploitant de plateforme portuaire', 'defaillance', 15, { departements: ['13'], pertinence: 70 });
  ajouter('Grenoble : la fermeture du site chimique se confirme pour 2027', 'fermeture', 20, { departements: ['38'] });
  ajouter('Nantes : incendie dans un entrepôt de la zone de Carquefou', 'incendie', 3, { departements: ['44'], media: 'Ouest-France (démo)' });
  ajouter('Bordeaux : un nouvel entrepôt XXL pour le e-commerce à Saint-Jean-d’Illac', 'ouverture', 10, { departements: ['33'] });
  ajouter('Toulouse : un groupe agroalimentaire annonce un plan de sauvegarde', 'defaillance', 18, { departements: ['31'] });
  ajouter('Immobilier logistique : la demande placée recule de 12 % au 3e trimestre', 'resultats', 4, { media: 'Business Immo (démo)', resume: 'Le marché français de l’entrepôt ralentit, la construction neuve aussi — la rénovation des bâtiments existants progresse.' });
  ajouter('Un fonds américain rachète un portefeuille de 25 entrepôts en France', 'rachat', 8, { media: 'Les Echos (démo)', pertinence: 60 });
  if (groupes.length) {
    ajouter(`${g(0).nom} : chiffre d’affaires en hausse de 9 % et nouvelles ouvertures annoncées`, 'resultats', 2, { groupes: [g(0).id], pertinence: 90, requete: 'groupe ' + g(0).nom });
    ajouter(`${g(1).nom} reprend un concurrent régional`, 'rachat', 11, { groupes: [g(1).id], pertinence: 75, requete: 'groupe ' + g(1).nom });
    ajouter(`${g(2).nom} placé en procédure de sauvegarde`, 'defaillance', 6, { groupes: [g(2).id], pertinence: 95, source: 'bodacc', media: 'BODACC (démo)', requete: 'bodacc' });
    ajouter(`${g(3).nom} ferme un site et regroupe son activité`, 'fermeture', 14, { groupes: [g(3).id], pertinence: 85, requete: 'groupe ' + g(3).nom });
  }
  for (const [x, cat, j, titre] of [[sNord, 'incendie', 1, 'Départ de feu maîtrisé sur le site'], [sEst, 'resultats', 5, 'Investissement de 4 M€ annoncé sur le site'], [sOuest, 'fermeture', 9, 'Cessation d’activité envisagée sur le site'], [sIdf, 'ouverture', 13, 'Extension de 10 000 m² prévue sur le site']]) {
    if (!x) continue;
    ajouter(`${titre} ${x.nom} (${x.ville})`, cat, j, { sites: [x.id], groupes: x.groupe_id ? [x.groupe_id] : [], departements: [x.departement], pertinence: 85 });
  }
  ajouter('Article ancien de plus de 30 jours (filtre de période)', 'autre', 45, { departements: ['59'] });
  return { appels_offres, actualites: items };
}
