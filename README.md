# BIG Prospection — Bordas Industrial Group

Outil de prospection commerciale des sites industriels et logistiques (France + Belgique) pour l'équipe réparation de dallages.

- **Application web installable (PWA)** : fonctionne sur PC, tablette et smartphone, **y compris hors connexion** (les modifications sont synchronisées au retour du réseau).
- **Hébergement** : GitHub Pages (fichiers statiques, aucun serveur à maintenir).
- **Base de données & comptes** : Supabase (PostgreSQL + authentification).

---

## 1. Fonctionnalités

| Écran | Contenu |
|---|---|
| **Connexion** | Email `@big-france.com` + mot de passe personnel, « mot de passe oublié », changement de mot de passe. |
| **Bandeau secteur** | Secteur du chargé d'affaires connecté (zones, nb de sites, m² de dallage, clients, rappels en retard) ; bascule en un clic vers Nord / IDF / Est / Ouest / National. |
| **Carte** | France + Belgique, points regroupés (clusters) qui se séparent au zoom ; taille du point = surface ; couleur = activité ; anneau = client / rappel en retard / en cours ; fonds Plan, Détaillé, Satellite, Photo IGN. |
| **Fiche site** (clic sur un point) | Adresse, type d'entreprise, surface, année de construction, **garantie décennale** (sous / hors décennale), score de potentiel A/B/C, liens Itinéraire / Street View / Annuaire des entreprises ; **qualification** : statut, chargé d'affaires, n° du standard, commentaire, dates du dernier appel / prochain rappel / RDV (enregistrement automatique) ; **contacts** (nom, fonction, téléphone, email, rôle) ; **historique** (appels, RDV, visites, devis avec montant, notes). |
| **Filtres** | Recherche texte, code postal / département, ville, type de site, surface, ancienneté / décennale, statut, priorité, rappels en retard / de la semaine, chargé d'affaires, groupe. |
| **Itinéraire & tournée** | Sites dans un rayon autour d'une adresse ou de ma position ; tournée optimisée (ordre le plus court) ouverte dans Google Maps. |
| **Liste** | Tableau triable des sites filtrés, export CSV / Excel. |
| **Groupes** | Enseignes / maisons-mères : sites rattachés, surface cumulée, **organigramme** des contacts (décideur, en contact, standard, prescripteur). |
| **Performances** | Appels, RDV, devis (montants), nouveaux clients ; activité mensuelle ; entonnoir commercial ; couverture par priorité ; classement des chargés d'affaires ; répartition par type et par département ; alertes (RDV à venir, rappels en retard, dossiers dormants). |
| **Appels d'offres** | Avis de marchés publics (BOAMP) en cours sur la réfection de sols, dallages, résine, fissures, réparation béton… classés par secteur avec le chargé d'affaires qui répond ; suivi partagé (à trier / à étudier / on répond / offre remise / sans suite), répondant, note. |
| **Actualités** | Presse et BODACC classés par secteur : incendies, défaillances, fermetures, ouvertures de zones logistiques, rachats, résultats ; actualités des groupes et sites de la base (aussi visibles dans la fiche du site). |
| **Import** | Fichiers Excel / CSV de l'équipe (colonnes reconnues automatiquement, adresses géolocalisées, dédoublonnage) et fichiers open data. |

**Score de potentiel (0-100)** : surface (jusqu'à 50 pts, échelle logarithmique) + ancienneté (jusqu'à 40 pts, maximum à 30 ans) + activité (jusqu'à 10 pts, logistique/frigo en tête). Priorité A ≥ 65, B ≥ 45, C sinon. Exemple : 100 000 m² de 1995 en logistique → A (100/100) ; 5 000 m² de 2024 → C.

---

## 2. Mise en service (≈ 30 minutes)

### 2.1 Supabase

1. Créer un projet sur <https://supabase.com> (région **Paris / eu-west-3** conseillée). Un **projet neuf** est recommandé : le schéma de l'ébauche (tables `sites`, `activites`, `rendez_vous`) est différent.
2. **SQL Editor** → coller le contenu de `supabase/schema.sql` → **Run**. Cela crée les tables, la répartition des départements par secteur, les 5 profils de l'équipe et les règles de sécurité.
3. **Authentication → Sign In / Providers** : désactiver **« Allow new users to sign up »** (seul l'administrateur crée les comptes).
4. **Authentication → Users → Add user → Create new user**, pour chacun des 5 membres : email, mot de passe personnel, cocher **Auto Confirm User**.

   | Email | Personne | Secteur |
   |---|---|---|
   | enieps@big-france.com | Emeric NIEPS | Nord |
   | zejjanhani@big-france.com | Zineb EJJANHANI | IDF |
   | mguerreiro@big-france.com | Marie GUERREIRO | Est |
   | mpineau@big-france.com | Mathis PINEAU | Ouest |
   | cdragne@big-france.com | Christophe DRAGNE | National (directeur) |

   > Si une adresse diffère, modifiez-la dans **Table Editor → profils** avant de créer le compte. Toute adresse hors `@big-france.com` est refusée par la base.
5. **Authentication → URL Configuration** : *Site URL* = l'adresse GitHub Pages de l'appli (ex. `https://scamericbig.github.io/big-prospection/`) — nécessaire pour le lien « mot de passe oublié ».
6. Bouton **Connect** (ou **Settings → API Keys**) : copier *Project URL* et la **Publishable key** (`sb_publishable_…`) dans `js/config.js`.

### 2.2 GitHub Pages

1. Déposer le contenu de ce dossier à la racine du dépôt `big-prospection` (il remplace `index.html` ; l'ancien `prospection.html` peut être supprimé).
2. **Settings → Pages** : *Deploy from a branch* → `main` / `/ (root)`.
3. L'application est en ligne à l'adresse `https://<compte>.github.io/big-prospection/`.

Sur smartphone / tablette : ouvrir l'adresse puis **« Ajouter à l'écran d'accueil »** pour l'installer comme une application.

> **Mise à jour du code** : après chaque modification, incrémentez `VERSION` dans `sw.js` pour que les appareils récupèrent la nouvelle version.

### 2.3 Mode démo

Tant que `js/config.js` est vide, l'application tourne en **mode démo** : ~2 200 sites **fictifs**, stockés uniquement dans le navigateur, mot de passe `demo` pour les 5 comptes. Pratique pour tester avant de brancher Supabase.

---

## 3. Alimenter la base de sites (open data)

Le script `scripts/import-opendata.mjs` construit la base de prospection à partir de sources publiques :

| Source | Apport |
|---|---|
| **BDNB** (Base de données nationale des bâtiments, CSTB) | Bâtiments ≥ 5 000 m² d'emprise : **surface**, **année de construction**, propriétaire, adresse, hauteur. |
| **Géorisques – ICPE** | Exploitant, rubriques (1510 entrepôts, 1511 entrepôts frigorifiques…), Seveso. |
| **API Recherche d'entreprises** (INSEE / SIRENE) | Établissement présent sur place : raison sociale, SIRET, **code NAF** → catégorie (logistique, frigorifique, transport, agro, pharma…). |
| **OpenStreetMap** | Belgique : bâtiments `warehouse` / `industrial` ≥ 5 000 m². |

Les bâtiments résidentiels, écoles, hôpitaux, bureaux, etc. sont écartés. Les sites d'un même propriétaire distants de moins de 200 m sont regroupés.

### Lancer l'import depuis GitHub (recommandé)

1. Dépôt GitHub → **Settings → Secrets and variables → Actions** → ajouter :
   - `SUPABASE_URL` : Project URL ;
   - `SUPABASE_SERVICE_ROLE_KEY` : **Secret key** (`sb_secret_…`, Settings → API Keys). ⚠ Clé secrète : uniquement dans les secrets GitHub, jamais dans le code.
2. **Actions → Import open data (sites) → Run workflow** : indiquer les départements (`59,62,80` ou `all`) et cocher Belgique si besoin.
3. Durée indicative : 5 à 20 min par département (l’enrichissement SIRENE est limité à 7 requêtes/s). Avec « all », le travail est découpé automatiquement en lots de 6 départements traités en parallèle (3 à la fois) : comptez quelques heures pour toute la France. Un import trimestriel automatique est programmé.

Les ré-imports **ne touchent jamais** au nom, à l'adresse ni à la qualification saisis par l'équipe ; seules les données open data (`*_auto`) sont rafraîchies. Les corrections de l'équipe (surface, année, type) restent prioritaires.

### En local (alternative)

```bash
npm install
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/import-opendata.mjs --dep 59,62 --be
# ou sans Supabase : produit sites-59.json, importable via le menu « Importer des sites »
node scripts/import-opendata.mjs --dep 59 --out ./sortie
```

Options : `--min 10000` (surface minimale), `--enrichir false` (sans SIRENE, plus rapide).

**Limites connues** : l'année de construction est absente pour une partie des bâtiments industriels dans la BDNB (affichée « Année inconnue », à compléter dans la fiche) ; l'occupant identifié automatiquement est l'établissement actif le plus probable à l'adresse — à vérifier lors de la qualification.

### Contacts, formats d'email et référencement (v1.3)

- **Format des emails** d'une entreprise (sur la fiche site ou sur le groupe) : jetons `{prenom}`, `{nom}`, `{p}` (initiale du prénom), `{n}`. Ex. `{p}{nom}@log.com` → Cédric BRUNEL = cbrunel@log.com, proposé automatiquement à la saisie d'un contact. Sans format saisi, il est déduit d'un contact déjà connu du site ou du groupe. 15 grands groupes sont pré-remplis à partir d'annuaires publics (à confirmer).
- **Décisionnaire** (case à cocher) + niveau local / régional / national sur chaque contact.
- **Groupes** : case « BIG est référencé chez ce groupe » (+ précisions) ; badge sur les fiches des sites et filtre « Groupes où BIG est référencé ».
- **Fiche** : bloc d'informations repliable ; boutons ◀ / **Site suivant ▶** (ou flèches ← → du clavier) pour passer au site le plus proche parmi les sites affichés.

### Rappels, stratégie de groupe et segmentation (v1.4)

- **Onglet Rappels** : sites à rappeler du secteur affiché (mes rappels / + non assignés / toute l'équipe), triés par date ; ligne **orange** = en retard, **jaune** = dans les 7 jours ; téléphone du standard et du contact principal cliquables, dernier commentaire, bouton « +7 j ». Le compteur rouge de l'onglet = rappels en retard ou du jour.
- **Stratégie groupe** (fiche d'un site rattaché à un groupe, et écran Groupes) : référencement BIG, répartition des sites du groupe entre chargés d'affaires, interlocuteurs clés (décisionnaires national > régional > local, contact « avancé » si RDV / devis / client) et derniers RDV, visites, devis et **chantiers** sur les autres sites du groupe, avec l'interlocuteur concerné (champ « Avec » des appels, RDV et de l'historique).
- **Segmentation secteurs** (bouton sur la carte) : zones de chaque chargé d'affaires en pointillés et couleur, étiquettes, et légende du nombre de sites filtrés par secteur sur toute la France (ex. filtre « Client » → répartition des clients). Les contours suivent la table `secteur_departements`.

### Appels d'offres et actualités (v1.5)

Collecte automatique chaque matin (vers 6 h, heure de Paris) par `scripts/veille.mjs` : **Actions → Veille (appels d'offres et actualités) → Run workflow** pour la lancer à la main (mêmes secrets que l'import open data).

- **Appels d'offres** : API du BOAMP (marchés publics français), recherche par mots-clés (dallage, sol industriel, résine, ragréage, fissures, réparation béton, joints, peinture de sol, chape, entrepôt…), indice de pertinence, exclusion des sols sportifs / voirie. Seuls les avis dont la date limite n'est pas dépassée s'affichent ; ils sont rangés par secteur d'après le département du marché (accords-cadres sans département : section « Lieu non précisé »). Le suivi, le répondant et la note sont partagés par toute l'équipe. Les marchés privés (appels d'offres de logisticiens, foncières…) ne sont pas publiés sur le BOAMP et n'apparaissent donc pas.
- **Actualités** : Google Actualités (thèmes : incendie d'entrepôt, liquidation / redressement, fermeture de site, nouvelle plateforme logistique, rachat… + une recherche par groupe de la base) et BODACC (procédures collectives des entreprises des sites clients, en contact, RDV ou devis). Chaque actualité est rattachée aux secteurs des départements cités et des groupes / sites concernés ; une actualité d'un groupe présent dans 3 secteurs ou plus est classée « National ». « ✕ » masque une actualité hors sujet pour toute l'équipe.
- Les AO clos depuis plus de 30 jours et les actualités de plus de 90 jours sont supprimés automatiquement.
- Mots-clés et thèmes modifiables en tête de `scripts/veille.mjs` (`RECHERCHES_AO`, `POIDS`, `THEMES`).

### Agences Kiloutou

Le bouton **🔧 Kiloutou** (en haut à gauche de la carte) affiche les agences du secteur et une liste triée par distance (au site ouvert, sinon au centre de la carte). Chaque fiche site indique aussi les 3 agences les plus proches, avec itinéraire depuis le site.

La liste est construite par le script `scripts/import-agences.mjs` (base SIRENE + OpenStreetMap) et enregistrée dans la table `agences` :
**Actions → Import agences Kiloutou → Run workflow** (il se relance aussi automatiquement chaque mois). Mêmes secrets que l'import open data.

Logo : déposez si vous le souhaitez l'image du logo fournie par Kiloutou sous `img/kiloutou.png` ; le bouton l'affichera à la place du texte.

---

## 4. Hors connexion

- Toutes les données (sites, contacts, historique) sont copiées sur l'appareil à la connexion et resynchronisées toutes les 3 minutes.
- Sans réseau, on peut consulter, filtrer, qualifier, ajouter contacts et notes : l'indicateur en haut à droite affiche « Hors connexion · N modif. en attente », envoyées automatiquement au retour du réseau.
- Menu utilisateur → **Préparer le hors connexion** : télécharge le fond de carte du secteur affiché. Les zones consultées en ligne sont également mémorisées.
- La **première** connexion sur un appareil doit se faire en ligne.

---

## 5. Paramétrage courant

| Besoin | Où |
|---|---|
| Changer la répartition des départements entre secteurs | Supabase → Table Editor → `secteur_departements` (puis recalcul : `update sites set updated_at = now();`) |
| Ajouter / désactiver un chargé d'affaires | `profils` (+ créer son compte dans Authentication) |
| Couleurs, logo | `css/app.css` (variables en tête de fichier), `img/` |
| Catégories et règles NAF | `js/categories.js` |
| Score de potentiel | `js/metier.js` → `score()` |

## 6. Structure

```
index.html            page unique (connexion + application)
css/app.css           charte graphique BIG
js/config.js          ← URL et clé Supabase
js/main.js            démarrage, connexion, bandeau secteur, menus
js/store.js           cache local IndexedDB + synchronisation Supabase + file d'attente hors connexion
js/carte.js           carte Leaflet : sites dessinés sur un canvas, regroupement calculé dans js/cluster-worker.js
js/fiche.js           fiche site, qualification, contacts, historique
js/filtres.js · js/liste.js · js/groupes.js · js/perfs.js · js/tournee.js · js/importer.js
js/rappels.js · js/strategie.js · js/segmentation.js · js/loueurs.js
js/appelsoffres.js · js/actualites.js · js/veille-commun.js   onglets de veille (js/veille-demo.js : données fictives du mode démo)
js/metier.js          secteurs, statuts, score, décennale
js/categories.js      catégories + classement NAF / ICPE (partagé avec le script d'import)
sw.js                 service worker (hors connexion)
supabase/schema.sql   base de données
scripts/              import open data, agences, veille (AO + actualités), générateur des données de démo
.github/workflows/    import automatisé
vendor/               bibliothèques (Leaflet, Supercluster, Supabase, SheetJS) embarquées pour le hors connexion
```

Sources de données : BOAMP © DILA (Licence Ouverte), BODACC © DILA, Google Actualités (titres et liens vers les articles d'origine), BDNB © CSTB (Licence Ouverte), Géorisques © MTE/BRGM, Base SIRENE © INSEE, Base Adresse Nationale, © contributeurs OpenStreetMap (ODbL), fonds de carte © CARTO, © Esri, © IGN.
