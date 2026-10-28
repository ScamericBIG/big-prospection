// Point d'entrée : connexion, bandeau secteur, onglets, menu utilisateur, synchronisation
import { CONFIG, MODE_DEMO } from './config.js';
import { store } from './store.js';
import { etat, emettre, ecouter, sitesDuSecteur, infos, invalider, prechauffer } from './etat.js';
import { fmtN, fmtM2court, esc, rappelEnRetard, fmtDateHeure } from './metier.js';
import { $, $$, toast, ouvrirModale, fermerModale, chargement } from './ui.js';
import { initFiltres, majResultat } from './filtres.js';
import { initCarte, cadrerSecteur, choisirPosition, prechargerTuiles } from './carte.js';
import { initFiche, nouveauSite, fermerFiche } from './fiche.js';
import { initListe } from './liste.js';
import { initGroupes } from './groupes.js';
import { initPerfs } from './perfs.js';
import { initTournee } from './tournee.js';
import { ouvrirImport } from './importer.js';
import { initLoueurs } from './loueurs.js';

// ------------------------------------------------------------------ service worker (hors connexion)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const avaitVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    // vérifie les mises à jour au retour sur l'appli (sans attendre le prochain rechargement)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => { }); });
  }).catch(e => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitVersion || document.querySelector('.maj-dispo')) return;
    const b = document.createElement('div');
    b.className = 'maj-dispo';
    b.innerHTML = '<span>Nouvelle version de l’application installée</span><button>Recharger</button>';
    b.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(b);
  });
}

async function demarrer() {
  try {
    await store.ouvrir();
  } catch (e) {
    chargement(false); toast('Stockage local indisponible (navigation privée ?) : ' + e.message, 'erreur');
  }
  store.surRecuperationMdp(() => setTimeout(() => modaleMotDePasse(true), 300));
  const session = await store.sessionExistante().catch(() => null);
  if (session) {
    try { await entrer(session.email); return; }
    catch (e) { console.warn(e); toast(e.message, 'erreur'); await store.deconnexion(); }
  }
  chargement(false);
  afficherConnexion();
}

// ------------------------------------------------------------------ écran de connexion
function afficherConnexion() {
  $('#ecran-connexion').hidden = false;
  $('#appli').hidden = true;
  $('#cx-demo').hidden = !MODE_DEMO;
  const dernier = localStorage.getItem('big_dernier_email');
  if (dernier) { $('#cx-email').value = dernier; $('#cx-mdp').focus(); } else $('#cx-email').focus();
}
$('#cx-voir').onclick = () => { const i = $('#cx-mdp'); i.type = i.type === 'password' ? 'text' : 'password'; };
$('#form-connexion').onsubmit = async e => {
  e.preventDefault();
  const email = $('#cx-email').value.trim().toLowerCase(), mdp = $('#cx-mdp').value;
  $('#cx-erreur').textContent = '';
  if (!email || !mdp) { $('#cx-erreur').textContent = 'Saisissez votre email et votre mot de passe.'; return; }
  $('#cx-valider').disabled = true; $('#cx-valider').textContent = 'Connexion…';
  try {
    const s = await store.connexion(email, mdp);
    localStorage.setItem('big_dernier_email', email);
    localStorage.removeItem('big_secteur_' + email);   // à la connexion : on affiche son propre secteur
    await entrer(s.email);
    $('#cx-mdp').value = '';
  } catch (err) {
    $('#cx-erreur').textContent = err.message;
    chargement(false);
  } finally { $('#cx-valider').disabled = false; $('#cx-valider').textContent = 'Se connecter'; }
};
$('#cx-oubli').onclick = async () => {
  const email = $('#cx-email').value.trim();
  if (!email) { $('#cx-erreur').textContent = 'Saisissez d’abord votre email.'; return; }
  try { await store.motDePasseOublie(email); toast('Un email de réinitialisation vous a été envoyé', 'ok'); }
  catch (e) { $('#cx-erreur').textContent = e.message; }
};

// ------------------------------------------------------------------ entrée dans l'application
let initialise = false;
async function entrer(email) {
  chargement('Chargement de vos données…');
  const profil = await store.demarrerSession(email);
  $('#ecran-connexion').hidden = true;
  $('#appli').hidden = false;
  etat.secteur = localStorage.getItem('big_secteur_' + profil.email) || profil.secteur;
  if (!store.get('secteurs', etat.secteur)) etat.secteur = profil.secteur;
  if (!initialise) {
    initialise = true;
    initFiltres(); initCarte(); initLoueurs(); initFiche(); initListe(); initGroupes(); initPerfs(); initTournee();
    brancherInterface();
  }
  rendreEntete();
  rendreSecteur();
  cadrerSecteur();
  majResultat();
  chargement(false);
  majEtatSync();
  prechauffer();
  // première synchro : peut être longue (plusieurs dizaines de milliers de sites)
  if (!MODE_DEMO && store.enLigne) {
    const premiere = !store.derniereSync;
    if (premiere) chargement('Première synchronisation : téléchargement des sites…');
    await store.synchroniser();
    if (premiere) { chargement(false); invalider(); emettre('filtres'); cadrerSecteur(); rendreSecteur(); prechauffer(); }
  }
  setInterval(() => store.synchroniser(), 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.synchroniser(); });
  bienvenue(profil);
}

function bienvenue(p) {
  const sites = sitesDuSecteur(p.secteur === 'national' ? 'national' : p.secteur);
  const retard = sites.filter(s => rappelEnRetard(s) && (!s.assigne_a || s.assigne_a === p.email)).length;
  toast(`Bonjour ${p.prenom} — ${fmtN(sites.length)} sites dans votre secteur${retard ? `, ${retard} rappel(s) en retard` : ''}`);
}

function rendreEntete() {
  const p = store.profil;
  $('#btn-utilisateur').textContent = (p.prenom[0] + p.nom[0]).toUpperCase();
  const sp = store.get('secteurs', p.secteur);
  $('#menu-identite').innerHTML = `<b>${esc(p.prenom)} ${esc(p.nom)}</b>${esc(p.email)}<br>${p.role === 'directeur' ? 'Directeur national' : 'Chargé d’affaires'} — secteur ${esc(sp?.libelle || p.secteur)}${MODE_DEMO ? '<br><b style="color:var(--orange)">Mode démo (données fictives)</b>' : ''}`;
}

function rendreSecteur() {
  const secteurs = store.liste('secteurs').sort((a, b) => a.ordre - b.ordre);
  const s = store.get('secteurs', etat.secteur);
  const resp = store.liste('profils').filter(p => p.secteur === etat.secteur && p.actif !== false);
  const moi = etat.secteur === store.profil.secteur;
  $('#secteur-titre').innerHTML = `Secteur ${esc(s?.libelle || etat.secteur)} <span style="font-weight:400;opacity:.85">— ${resp.map(p => esc(p.prenom + ' ' + p.nom)).join(', ') || '—'}${moi ? ' (vous)' : ''}</span>`;
  $('#secteur-zones').textContent = s?.zones || '';
  $('#secteur-pastille').style.background = s?.couleur || '#fff';
  $('#secteur-choix').innerHTML = secteurs.map(x => {
    const r = store.liste('profils').find(p => p.secteur === x.code);
    return `<button role="radio" aria-checked="${x.code === etat.secteur}" class="${x.code === etat.secteur ? 'actif' : ''}" data-s="${x.code}" title="${esc(x.zones)}">${esc(x.libelle)}${r && x.code !== 'national' ? ` <small>${esc(r.prenom)}</small>` : ''}</button>`;
  }).join('');
  const sites = sitesDuSecteur();
  let surf = 0, retard = 0, clients = 0;
  for (const x of sites) { surf += infos(x).surface || 0; if (rappelEnRetard(x)) retard++; if (x.statut === 'client') clients++; }
  $('#secteur-stats').innerHTML = `<div><b>${fmtN(sites.length)}</b>sites</div><div><b>${fmtM2court(surf)}</b>de dallage</div><div><b>${fmtN(clients)}</b>clients</div><div><b>${fmtN(retard)}</b>rappels en retard</div>`;
}

function changerSecteur(code) {
  etat.secteur = code;
  localStorage.setItem('big_secteur_' + store.profil.email, code);
  rendreSecteur(); emettre('secteur');
}

// ------------------------------------------------------------------ interactions globales
function brancherInterface() {
  $('#secteur-choix').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) changerSecteur(b.dataset.s); });
  ecouter('changer-secteur', changerSecteur);

  const allerVue = v => {
    $$('.onglets button').forEach(b => b.classList.toggle('actif', b.dataset.vue === v));
    $$('.vue').forEach(x => x.classList.toggle('actif', x.id === 'vue-' + v));
    $('#filtres').hidden = !['carte', 'liste'].includes(v);
    if (!['carte', 'liste'].includes(v)) $('#filtres').classList.remove('ouvert');
    emettre('vue', v);
  };
  $$('.onglets button').forEach(b => b.onclick = () => allerVue(b.dataset.vue));
  ecouter('aller-vue', allerVue);
  ecouter('ouvrir-site', () => $('#filtres').classList.remove('ouvert'));

  store.on('change', d => { if (!d || d.table === 'sites') rendreSecteurDiffere(); if (d?.table === 'profils' || d?.table === 'secteurs') { rendreSecteur(); rendreEntete(); } });

  // menu utilisateur
  const menu = $('#menu-utilisateur');
  $('#btn-utilisateur').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', e => { if (!e.target.closest('.menu-utilisateur')) menu.hidden = true; });
  menu.addEventListener('click', async e => {
    const a = e.target.closest('[data-action]')?.dataset.action; if (!a) return;
    menu.hidden = true;
    if (a === 'deconnexion') { await store.deconnexion(); location.reload(); }
    if (a === 'mdp') modaleMotDePasse(false);
    if (a === 'import') ouvrirImport();
    if (a === 'synchro') {
      if (MODE_DEMO) return toast('Mode démo : aucune base distante configurée');
      if (!navigator.onLine) return toast('Hors connexion : la synchronisation reprendra automatiquement', 'erreur');
      await store.synchroniser(); toast('Données synchronisées', 'ok');
    }
    if (a === 'horsligne') preparerHorsLigne();
  });

  $('#btn-ajout-site').onclick = () => nouveauSite();
  ecouter('placer-site', () => choisirPosition(async ll => {
    const pos = { lat: ll.lat, lng: ll.lng };
    if (navigator.onLine) {
      try {
        const r = await (await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${ll.lng}&lat=${ll.lat}&limit=1`)).json();
        const f = r.features?.[0];
        if (f) Object.assign(pos, { adresse: f.properties.name, code_postal: f.properties.postcode, ville: f.properties.city });
        else if (ll.lat > 49.5 && ll.lng > 2.5) pos.pays = 'BE';
      } catch { }
    }
    nouveauSite(pos);
  }));

  store.on('sync', majEtatSync);
  store.on('reseau', () => { majEtatSync(); toast(store.enLigne ? 'Connexion rétablie — synchronisation…' : 'Hors connexion : vos modifications sont enregistrées sur cet appareil', store.enLigne ? 'ok' : ''); });
  store.on('progression', d => chargement(`Téléchargement des sites… ${fmtN(d.n)}`));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modale').hidden) fermerFiche(); });
}

let tSecteur;
const rendreSecteurDiffere = () => { clearTimeout(tSecteur); tSecteur = setTimeout(rendreSecteur, 300); };

function majEtatSync(d = {}) {
  const el = $('#etat-sync');
  el.className = 'etat-sync';
  let txt;
  if (MODE_DEMO) txt = 'Mode démo';
  else if (!store.enLigne) { el.classList.add('hors-ligne'); txt = 'Hors connexion' + (store.enAttente ? ` · ${store.enAttente} modif. en attente` : ''); }
  else if (d.enCours || store.syncEnCours) { el.classList.add('en-cours'); txt = 'Synchronisation…'; }
  else if (store.erreursSync.length) { el.classList.add('erreur'); txt = 'Erreur de synchro'; el.title = store.erreursSync.map(e => e.table + ' : ' + e.message).join('\n'); }
  else if (store.enAttente) { el.classList.add('en-cours'); txt = `${store.enAttente} modif. à envoyer`; }
  else { txt = 'Synchronisé'; el.title = store.derniereSync ? 'Dernière synchronisation : ' + fmtDateHeure(store.derniereSync) : ''; }
  el.innerHTML = `<span>${txt}</span>`;
}

function modaleMotDePasse(recuperation) {
  const m = ouvrirModale(`<h3>${recuperation ? 'Choisissez un nouveau mot de passe' : 'Changer mon mot de passe'}</h3>
    <label>Nouveau mot de passe (10 caractères minimum)<input type="password" id="mp-1" autocomplete="new-password"></label>
    <label style="margin-top:10px">Confirmation<input type="password" id="mp-2" autocomplete="new-password"></label>
    <p class="erreur" id="mp-err"></p>
    <div class="boutons"><button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="mp-ok">Enregistrer</button></div>`);
  $('#mp-ok', m).onclick = async () => {
    const a = $('#mp-1', m).value, b = $('#mp-2', m).value;
    if (a.length < 10) return $('#mp-err', m).textContent = 'Au moins 10 caractères.';
    if (a !== b) return $('#mp-err', m).textContent = 'Les deux saisies diffèrent.';
    try { await store.changerMotDePasse(a); fermerModale(); toast('Mot de passe modifié', 'ok'); }
    catch (e) { $('#mp-err', m).textContent = e.message; }
  };
}

async function preparerHorsLigne() {
  if (!navigator.onLine) return toast('Connectez-vous à internet pour préparer le mode hors connexion', 'erreur');
  const m = ouvrirModale(`<h3>Préparer le hors connexion</h3>
    <p>Les données de tous les sites sont déjà conservées sur cet appareil. Cette action télécharge en plus le fond « Plan IGN » (France) de votre secteur actuel
    (<b>${esc(store.get('secteurs', etat.secteur)?.libelle || '')}</b>) jusqu’au niveau « département », pour pouvoir consulter la carte sans réseau.
    Les zones que vous zoomez en ligne sont aussi mémorisées automatiquement.</p>
    <div class="progression"><div id="hl-prog"></div></div><p class="vide" id="hl-txt"></p>
    <div class="boutons"><button class="btn" data-fermer-modale>Fermer</button><button class="btn btn-primaire" id="hl-go">Télécharger</button></div>`);
  $('#hl-go', m).onclick = async () => {
    $('#hl-go', m).disabled = true;
    if (!MODE_DEMO) { $('#hl-txt', m).textContent = 'Synchronisation des données…'; await store.synchroniser(); }
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => { });
    let total = 0;
    await prechargerTuiles((n, t) => { if (t) total = t; $('#hl-prog', m).style.width = (total ? n / total * 100 : 0) + '%'; $('#hl-txt', m).textContent = `Fond de carte : ${n} / ${total} tuiles`; });
    $('#hl-txt', m).textContent = 'Prêt : l’application, les sites et la carte du secteur sont disponibles hors connexion.';
    toast('Mode hors connexion prêt', 'ok');
  };
}

demarrer();
