// Fiche d'un site : informations, qualification commerciale, contacts, historique
import { store } from './store.js';
import { etat, infos, emettre, ecouter, nomCA, sauverTournee, sitesFiltres } from './etat.js';
import {
  CATEGORIES, STATUTS, TYPES_ACTIVITE, ROLES_CONTACT, decennale, surfaceEstimee, anneeEstimee, emailDepuisFormat, deduireFormat, exempleFormat, distanceKm, etatEtab, fmtM2, fmtDate, fmtDateHeure, fmtEuro, esc, aujourdhui, ANNEE, uuid,
} from './metier.js';
import { $, $$, toast, ouvrirModale, fermerModale, confirmer, lireForm, versDatetimeLocal, debounce } from './ui.js';
import { marquerSelection, centrerSur, choisirPosition } from './carte.js';
import { agencesProches, lienItineraire, lienInfos, fmtKm } from './loueurs.js';
import { syntheseGroupe } from './strategie.js';
import { actusDuSite, CATEGORIES_ACTU } from './actualites.js';

export const NIVEAUX_DECISION = { local: 'local', regional: 'régional', national: 'national' };

let ongletFiche = 'fiche';

// Prospection de proche en proche : historique des sites parcourus avec « Site suivant »
let parcours = [];

export function initFiche() {
  ecouter('ouvrir-site', id => { parcours = [id]; ouvrirFiche(id); });
  document.addEventListener('keydown', e => {
    if ($('#fiche').hidden || !$('#modale').hidden || e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); allerSuivant(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); allerPrecedent(); }
  });
  store.on('change', d => {
    if (!etat.siteOuvert || !d?.distant) return;
    if (['sites', 'contacts', 'activites'].includes(d.table) && !document.activeElement?.closest('#fiche')) rendre();
  });
}

export function ouvrirFiche(id, onglet) {
  etat.siteOuvert = id;
  if (onglet) ongletFiche = onglet;
  $('#fiche').hidden = false;
  marquerSelection(id);
  rendre();
}
export function fermerFiche() {
  etat.siteOuvert = null; $('#fiche').hidden = true; marquerSelection(null);
}

const site = () => store.get('sites', etat.siteOuvert);

// Site le plus proche parmi les sites affichés (filtres + secteur), hors sites déjà parcourus
function plusProche(s) {
  if (!s?.lat) return null;
  const vus = new Set(parcours);
  let best = null, bd = Infinity;
  for (const x of sitesFiltres()) {
    if (x.lat == null || vus.has(x.id) || x.id === s.id) continue;
    const dLat = x.lat - s.lat; if (dLat * dLat > bd) continue;          // élagage rapide
    const d = dLat * dLat + ((x.lng - s.lng) * Math.cos(s.lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = x; }
  }
  return best ? { site: best, km: distanceKm(s, best) } : null;
}
function allerSuivant() {
  const s = site(), n = plusProche(s);
  if (!n) { toast(s?.lat ? 'Plus aucun site à proximité avec les filtres actuels' : 'Ce site n’a pas de position sur la carte', 'erreur'); return; }
  if (!parcours.length || parcours[parcours.length - 1] !== s.id) parcours.push(s.id);
  parcours.push(n.site.id);
  ouvrirFiche(n.site.id);
  centrerSur(n.site, 14);
}
function allerPrecedent() {
  if (parcours.length < 2) return;
  parcours.pop();
  const id = parcours[parcours.length - 1], s = store.get('sites', id);
  ouvrirFiche(id); if (s) centrerSur(s, 14);
}

function rendre() {
  const s = site(); if (!s) return fermerFiche();
  const i = infos(s), dec = decennale(s), cat = CATEGORIES[i.cat], st = STATUTS[s.statut] || STATUTS.a_qualifier;
  const nbContacts = store.liste('contacts').filter(c => c.site_id === s.id).length;
  const nbAct = store.liste('activites').filter(a => a.site_id === s.id).length;
  const f = $('#fiche');
  f.innerHTML = `
    <div class="fiche-entete">
      <button class="btn-icone fermer" aria-label="Fermer la fiche">✕</button>
      <h2>${esc(s.nom)}</h2>
      <div class="fiche-sous">${esc([s.adresse, [s.code_postal, s.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adresse non renseignée')}${s.pays === 'BE' ? ' — Belgique' : ''}</div>
      <div class="badges">
        <span class="badge"><span class="rond" style="background:${cat.couleur}"></span>${esc(cat.libelle)}</span>
        <span class="badge prio-${i.prio}" title="Score de potentiel : surface, ancienneté, activité">Priorité ${i.prio} · ${i.score}/100</span>
        <span class="badge"><span class="rond" style="background:${st.couleur}"></span>${esc(st.libelle)}</span>
        <span class="badge ${dec.classe}">${esc(dec.court || dec.libelle)}</span>
        ${etatEtab(s) === 'ferme' ? `<span class="badge alerte" title="Établissement fermé d'après la base SIRENE">⛔ Établissement fermé${s.date_fermeture ? ' le ' + fmtDate(s.date_fermeture) : ''}</span>` : etatEtab(s) === 'actif' ? '<span class="badge ok" title="Établissement actif d’après la base SIRENE">✅ Actif</span>' : ''}
        ${(() => { const g = s.groupe_id && store.get('groupes', s.groupe_id); return g?.reference ? `<span class="badge ok" title="BIG est référencé chez ${esc(g.nom)}">✓ Référencé ${esc(g.nom)}</span>` : ''; })()}
      </div>
    </div>
    <div class="fiche-onglets" role="tablist">
      <button data-o="fiche" class="${ongletFiche === 'fiche' ? 'actif' : ''}">Fiche & qualification</button>
      <button data-o="contacts" class="${ongletFiche === 'contacts' ? 'actif' : ''}">Contacts (${nbContacts})</button>
      <button data-o="historique" class="${ongletFiche === 'historique' ? 'actif' : ''}">Historique (${nbAct})</button>
    </div>
    <div class="fiche-corps" id="fiche-corps"></div>
    <div class="fiche-pied">
      <button class="btn btn-petit" id="fi-tournee">${etat.tournee.includes(s.id) ? '✓ Dans la tournée' : '+ Tournée'}</button>
      <button class="btn btn-petit btn-danger" id="fi-suppr">Supprimer</button>
      <span id="fi-etat" class="vide"></span>
      <span class="navigation-sites">
        <button class="btn btn-petit" id="fi-prec" title="Site précédent (flèche ←)" ${parcours.length < 2 ? 'disabled' : ''}>◀</button>
        <button class="btn btn-petit btn-primaire" id="fi-suiv" title="Site le plus proche (flèche →)">${(() => { const n = plusProche(s); return n ? `Site suivant ▶ <small>${n.km < 0.05 ? 'même lieu' : fmtKm(n.km)}</small>` : 'Site suivant ▶'; })()}</button>
      </span>
    </div>`;
  f.querySelector('.fermer').onclick = fermerFiche;
  $('#fi-suiv').onclick = allerSuivant;
  $('#fi-prec').onclick = allerPrecedent;
  $$('.fiche-onglets button', f).forEach(b => b.onclick = () => { ongletFiche = b.dataset.o; rendre(); });
  $('#fi-tournee').onclick = () => {
    const k = etat.tournee.indexOf(s.id);
    k >= 0 ? etat.tournee.splice(k, 1) : etat.tournee.push(s.id);
    sauverTournee(); emettre('tournee'); rendre();
    toast(k >= 0 ? 'Retiré de la tournée' : 'Ajouté à la tournée (voir Filtres › Itinéraire & tournée)');
  };
  $('#fi-suppr').onclick = async () => {
    if (!(await confirmer(`Supprimer « ${s.nom} » ? Le site disparaîtra pour toute l'équipe.`, { ok: 'Supprimer', danger: true }))) return;
    await store.supprimer('sites', s.id); fermerFiche(); toast('Site supprimé');
  };
  const corps = $('#fiche-corps');
  if (ongletFiche === 'fiche') rendreFiche(corps, s);
  else if (ongletFiche === 'contacts') rendreContacts(corps, s);
  else rendreHistorique(corps, s);
}

// ------------------------------------------------------------------ onglet Fiche
function rendreFiche(corps, s) {
  const i = infos(s), dec = decennale(s), od = s.infos_od || {};
  const groupe = s.groupe_id && store.get('groupes', s.groupe_id);
  const q = encodeURIComponent([s.adresse, s.code_postal, s.ville].filter(Boolean).join(' ') || `${s.lat},${s.lng}`);
  const age = i.annee ? ANNEE - i.annee : null;
  const profils = store.liste('profils').filter(p => p.actif !== false);
  const groupes = store.liste('groupes').sort((a, b) => a.nom.localeCompare(b.nom));
  corps.innerHTML = `
    <div class="chiffres">
      <div class="chiffre"><span>Surface${surfaceEstimee(s) ? ' (estimée)' : ''}</span><b>${surfaceEstimee(s) ? '≈ ' : ''}${fmtM2(i.surface)}</b></div>
      <div class="chiffre"><span>Construit en${anneeEstimee(s) ? ' (estimé)' : ''}</span><b>${anneeEstimee(s) && i.annee ? '≈ ' : ''}${i.annee || '—'}</b>${age != null ? `<span>${age} an${age > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="chiffre"><span>Score</span><b>${i.score}/100</b><span>Priorité ${i.prio}</span></div>
    </div>
    ${od.nouvel_occupant ? (() => { const o = od.nouvel_occupant; return `<div class="occupant ${o.possible ? 'possible' : ''}">
      ${o.possible ? '🔎 Entreprise trouvée à cette adresse' : '🔁 Nouvel occupant probable'} : <b>${esc(o.nom)}</b>
      <small>${o.siret ? 'SIRET ' + esc(o.siret) + ' · ' : ''}${o.distance_m != null ? 'à ' + o.distance_m + ' m · ' : ''}base SIRENE${o.le ? ', ' + fmtDate(o.le) : ''}</small>
      <div class="occupant-actions"><button class="btn btn-petit" id="fi-occupant">Renommer le site « ${esc(o.nom)} »</button>${o.siret ? ` <a class="btn btn-petit" target="_blank" rel="noopener" href="https://annuaire-entreprises.data.gouv.fr/etablissement/${esc(o.siret)}">🏢 Annuaire</a>` : ''}</div></div>`; })() : ''}
    <details class="infos-repliables" ${infosOuvertes() ? 'open' : ''}>
    <summary>Informations du site <small>(adresse, activité, décennale, SIRET, groupe, source…)</small></summary>
    <dl class="infos">
      <dt>Adresse postale</dt><dd>${esc(s.adresse || '—')}<br>${esc([s.code_postal, s.ville].filter(Boolean).join(' '))}${s.pays === 'BE' ? ', Belgique' : ''}</dd>
      <dt>Type d'entreprise</dt><dd>${esc(CATEGORIES[i.cat].libelle)}${s.naf ? `<br><small>NAF ${esc(s.naf)}${s.naf_libelle ? ' — ' + esc(s.naf_libelle) : ''}</small>` : ''}</dd>
      <dt>Garantie décennale</dt><dd>${esc(dec.libelle)}</dd>
      ${s.enseigne ? `<dt>Raison sociale</dt><dd>${esc(s.enseigne)}</dd>` : ''}
      ${s.proprietaire ? `<dt>Propriétaire</dt><dd>${esc(s.proprietaire)}</dd>` : ''}
      ${s.siren || s.siret ? `<dt>SIREN / SIRET</dt><dd>${esc(s.siret || s.siren)}</dd>` : ''}
      ${groupe ? `<dt>Groupe</dt><dd><a href="#" id="fi-voir-groupe">${esc(groupe.nom)}</a></dd>` : ''}
      ${od.icpe ? `<dt>ICPE</dt><dd>${esc(od.icpe.nom || '')}<br><small>${esc(od.icpe.regime || '')}${od.icpe.rubriques?.length ? ' · rubriques ' + esc(od.icpe.rubriques.join(', ')) : ''}${od.icpe.seveso ? ' · Seveso ' + esc(od.icpe.seveso) : ''}</small></dd>` : ''}
      ${!s.lat ? `<dt>Position</dt><dd><span class="badge alerte">Inconnue — non visible sur la carte</span></dd>` : od.position_approx ? `<dt>Position</dt><dd><span class="badge alerte">Approximative (centre de la commune)</span></dd>` : ''}
      <dt>Source</dt><dd><small>${esc({ bdnb: 'BDNB (open data bâtiments)', osm: 'OpenStreetMap', import: 'Import de fichier', manuel: 'Saisie manuelle', demo: 'Données de démonstration', ebauche: 'Ancienne base (ébauche)' }[s.source] || s.source)}${s.surface_m2 != null || s.annee_construction != null || s.categorie ? ' · corrigé par l’équipe' : ''}</small></dd>
    </dl>
    </details>
    <div class="liens-rapides">
      <a class="btn btn-petit" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat && s.lng ? s.lat + ',' + s.lng : q}">🧭 Itinéraire</a>
      ${s.lat ? `<a class="btn btn-petit" target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lng}">👁 Street View</a>` : ''}
      ${s.lat ? '<button class="btn btn-petit" id="fi-zoom">🛰 Voir le site</button>' : ''}
      <button class="btn btn-petit" id="fi-position">📍 ${s.lat ? 'Déplacer le point' : 'Placer sur la carte'}</button>
      ${s.siren ? `<a class="btn btn-petit" target="_blank" rel="noopener" href="https://annuaire-entreprises.data.gouv.fr/entreprise/${esc(s.siren)}">🏢 Annuaire</a>` : ''}
      <a class="btn btn-petit" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent((s.nom || '') + ' ' + (s.ville || ''))}">🔎 Google</a>
    </div>

    <div class="actions-rapides">
      <button class="btn" data-rapide="appel">📞 Appel passé</button>
      <button class="btn" data-rapide="rdv">📅 Planifier un RDV</button>
      <button class="btn" data-rapide="note">📝 Note</button>
    </div>

    <div class="section-titre">Contacts sur site</div>
    ${blocContacts(s)}
    <button class="btn btn-primaire btn-petit" id="fi-contact-plus">+ Ajouter un contact</button>

    ${s.groupe_id ? syntheseGroupe(s.groupe_id, { exclureSite: s.id }) : '<p class="vide" style="font-size:12.5px">🤝 Rattachez ce site à un groupe (section Caractéristiques) pour voir ce que l’équipe sait de ce groupe.</p>'}

    ${blocActus(s)}

    ${blocAgences(s)}

    <form id="fi-form" autocomplete="off">
      <div class="section-titre">Qualification</div>
      <div class="grille-form">
        <label>Statut<select name="statut">${Object.entries(STATUTS).map(([k, v]) => `<option value="${k}" ${s.statut === k ? 'selected' : ''}>${v.libelle}</option>`).join('')}</select></label>
        <label>Chargé d'affaires<select name="assigne_a"><option value="">— Non assigné —</option>${profils.map(p => `<option value="${esc(p.email)}" ${s.assigne_a === p.email ? 'selected' : ''}>${esc(p.prenom + ' ' + p.nom)}</option>`).join('')}</select></label>
        <label>N° du standard<input type="tel" name="standard_tel" value="${esc(s.standard_tel || '')}" placeholder="03 20 …"></label>
        <label>Site web<input type="url" name="site_web" value="${esc(s.site_web || '')}" placeholder="https://"></label>
        <label>Date du dernier appel<input type="date" name="date_dernier_appel" value="${esc(s.date_dernier_appel || '')}"></label>
        <label>Date du prochain rappel<input type="date" name="date_prochain_rappel" value="${esc(s.date_prochain_rappel || '')}"></label>
        <label class="plein">Date du rendez-vous<input type="datetime-local" name="date_rdv" value="${versDatetimeLocal(s.date_rdv)}"></label>
        <label class="plein">Commentaire<textarea name="commentaire" rows="4" placeholder="État du dallage, besoins, interlocuteurs, concurrence…">${esc(s.commentaire || '')}</textarea></label>
      </div>
      <div class="section-titre">Caractéristiques du site</div>
      <div class="grille-form">
        <label>Type de site<select name="categorie"><option value="">Auto : ${esc(CATEGORIES[s.categorie_auto || 'AUTRE'].libelle)}</option>${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${s.categorie === k ? 'selected' : ''}>${v.libelle}</option>`).join('')}</select></label>
        <label>Groupe<select name="groupe_id"><option value="">— Aucun —</option>${groupes.map(g => `<option value="${g.id}" ${s.groupe_id === g.id ? 'selected' : ''}>${esc(g.nom)}</option>`).join('')}<option value="_nouveau">+ Nouveau groupe…</option></select></label>
        <label>Surface (m²)<input type="number" name="surface_m2" min="0" step="100" value="${s.surface_m2 ?? ''}" placeholder="${s.surface_auto ? (surfaceEstimee(s) ? 'Estimation : ' : 'Open data : ') + s.surface_auto : ''}"></label>
        <label>Année de construction<input type="number" name="annee_construction" min="1850" max="${ANNEE + 2}" value="${s.annee_construction ?? ''}" placeholder="${s.annee_auto ? (anneeEstimee(s) ? 'Estimation : ' : 'Open data : ') + s.annee_auto : 'Inconnue'}"></label>
      </div>
      <details style="margin-top:12px"><summary class="lien" style="text-decoration:none">✎ Modifier le nom / l'adresse</summary>
        <div class="grille-form" style="margin-top:10px">
          <label class="plein">Nom du site<input type="text" name="nom" value="${esc(s.nom || '')}" required></label>
          <label class="plein">Adresse<input type="text" name="adresse" value="${esc(s.adresse || '')}"></label>
          <label>Code postal<input type="text" name="code_postal" value="${esc(s.code_postal || '')}"></label>
          <label>Ville<input type="text" name="ville" value="${esc(s.ville || '')}"></label>
        </div>
      </details>
    </form>`;

  corps.querySelector('.infos-repliables').addEventListener('toggle', e => { try { localStorage.setItem('big_infos_site', e.target.open ? '1' : '0'); } catch { } });
  $('#fi-zoom')?.addEventListener('click', () => { centrerSur(s, 17); emettre('aller-vue', 'carte'); });
  $('#fi-position').onclick = () => {
    emettre('aller-vue', 'carte');
    if (s.lat) centrerSur(s, 16);
    toast('Cliquez sur la carte à l’emplacement exact du site (vue « Satellite » conseillée)');
    if (window.innerWidth < 860) $('#fiche').hidden = true;
    choisirPosition(async ll => {
      const actuel = store.get('sites', s.id);
      const od2 = { ...(actuel.infos_od || {}) }; delete od2.position_approx;
      await store.enregistrer('sites', { ...actuel, lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), infos_od: od2 });
      toast('Position enregistrée', 'ok');
      ouvrirFiche(s.id);
    });
  };
  $('#fi-voir-groupe')?.addEventListener('click', e => { e.preventDefault(); emettre('voir-groupe', s.groupe_id); });
  $$('[data-rapide]', corps).forEach(b => b.onclick = () => actionRapide(b.dataset.rapide, s));
  $('#fi-contact-plus').onclick = () => editerContact({ site_id: s.id, groupe_id: s.groupe_id || null, role: 'contact', ca_big: store.profil.email }, rendre);
  $$('[data-edit-contact]', corps).forEach(b => b.onclick = () => editerContact(store.get('contacts', b.dataset.editContact), rendre));
  $('#fi-format-email').onclick = () => modifierFormatEmail(s, rendre);
  $$('[data-voir-groupe]', corps).forEach(b => b.onclick = () => emettre('voir-groupe', b.dataset.voirGroupe));
  $('#fi-occupant')?.addEventListener('click', async () => {
    const od = s.infos_od || {}, o = od.nouvel_occupant;
    if (!(await confirmer(`Renommer « ${s.nom} » en « ${o.nom} » ? Le suivi, les contacts et l’historique du site sont conservés.`, { ok: 'Renommer' }))) return;
    const { nouvel_occupant, ...reste } = od;
    await store.enregistrer('sites', { ...s, nom: o.nom, siret: o.siret || s.siret, siren: o.siret ? o.siret.slice(0, 9) : s.siren, naf: o.naf || s.naf,
      etat_etablissement: 'actif', date_fermeture: null, infos_od: { ...reste, ancien_nom: s.nom } });
    toast('Site renommé', 'ok');
  });
  $('[data-aller-actus]', corps)?.addEventListener('click', e => { e.preventDefault(); emettre('aller-vue', 'actus'); });

  const form = $('#fi-form');
  const enregistrer = debounce(async () => {
    const v = lireForm(form);
    if (v.groupe_id === '_nouveau') return;
    const etatEl = document.getElementById('fi-etat');
    if (!v.nom) { if (etatEl) etatEl.textContent = 'Le nom est obligatoire'; return; }
    const avant = store.get('sites', s.id);   // id figé : la fiche a pu changer entre-temps
    const apres = { ...avant, ...v, categorie: v.categorie || null, groupe_id: v.groupe_id || null, assigne_a: v.assigne_a || null };
    if (apres.code_postal !== avant.code_postal) apres.departement = null;
    await store.enregistrer('sites', apres);
    if (avant.statut !== apres.statut) {
      await store.enregistrer('activites', { site_id: s.id, type: 'statut', date: new Date().toISOString(), statut: 'fait', contenu: `${STATUTS[avant.statut]?.libelle || avant.statut} → ${STATUTS[apres.statut].libelle}`, auteur: store.profil.email });
    }
    if (etatEl?.isConnected && etat.siteOuvert === s.id) { etatEl.textContent = 'Enregistré ✓'; setTimeout(() => { etatEl.textContent = ''; }, 2000); }
  }, 500);
  form.addEventListener('input', e => { if (e.target.tagName !== 'SELECT') { $('#fi-etat').textContent = '…'; enregistrer(); } });
  form.addEventListener('change', async e => {
    if (e.target.name === 'groupe_id' && e.target.value === '_nouveau') {
      const g = await nouveauGroupe();
      if (g) { await store.enregistrer('sites', { ...store.get('sites', s.id), groupe_id: g.id }); rendre(); }
      else e.target.value = site().groupe_id || '';
      return;
    }
    if (e.target.tagName === 'SELECT') { enregistrer(); if (['statut', 'categorie'].includes(e.target.name)) setTimeout(() => { if (etat.siteOuvert === s.id) rendre(); }, 700); }
  });
  form.addEventListener('submit', e => e.preventDefault());
}

export function nouveauGroupe(nomPropose = '') {
  return new Promise(res => {
    const m = ouvrirModale(`<h3>Nouveau groupe</h3>
      <label>Nom du groupe / de l'enseigne<input type="text" id="ng-nom" value="${esc(nomPropose)}" placeholder="Ex. : Groupe Carrefour Supply Chain"></label>
      <label style="margin-top:10px">Notes<textarea id="ng-notes"></textarea></label>
      <div class="boutons"><button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="ng-ok">Créer</button></div>`, { onClose: () => res(null) });
    $('#ng-ok', m).onclick = async () => {
      const nom = $('#ng-nom', m).value.trim(); if (!nom) return;
      if (store.liste('groupes').some(g => g.nom.toLowerCase() === nom.toLowerCase())) { toast('Ce groupe existe déjà', 'erreur'); return; }
      const g = await store.enregistrer('groupes', { nom, notes: $('#ng-notes', m).value.trim() || null, supprime: false });
      $('#modale').hidden = true; res(g);
    };
  });
}

const infosOuvertes = () => { try { return localStorage.getItem('big_infos_site') === '1'; } catch { return false; } };

// Format d'email applicable à un site : saisi sur le site > saisi sur le groupe > déduit des contacts déjà connus
export function formatEmail(siteId, groupeId) {
  const s = siteId && store.get('sites', siteId), gid = groupeId || s?.groupe_id, g = gid && store.get('groupes', gid);
  if (s?.email_format) return { format: s.email_format, origine: 'site' };
  if (g?.email_format) return { format: g.email_format, origine: 'groupe ' + g.nom };
  const connus = store.liste('contacts').filter(c => c.email && (c.site_id === siteId || (gid && c.groupe_id === gid)));
  for (const c of connus) { const f = deduireFormat(c); if (f) return { format: f, origine: 'déduit de ' + [c.prenom, c.nom].filter(Boolean).join(' ') }; }
  return null;
}
function libelleDecision(c) { return c.decisionnaire ? `Décisionnaire${c.niveau_decision ? ' ' + NIVEAUX_DECISION[c.niveau_decision] : ''}` : ''; }

// Contacts du site, affichés directement sur la fiche
function blocContacts(s) {
  const l = store.liste('contacts').filter(c => c.site_id === s.id)
    .sort((a, b) => (a.role === 'decideur' ? -1 : 0) - (b.role === 'decideur' ? -1 : 0));
  const tel = t => `<a href="tel:${esc(t.replace(/[^\d+]/g, ''))}">📞 ${esc(t)}</a>`;
  return `<div class="contacts-fiche">
    ${s.standard_tel ? `<div class="contact-ligne"><div><b>Standard</b></div><div>${tel(s.standard_tel)}</div></div>` : ''}
    ${l.map(c => `<div class="contact-ligne">
        <div><b>${esc([c.prenom, c.nom].filter(Boolean).join(' '))}</b> ${c.decisionnaire ? `<span class="badge prio-A">${esc(libelleDecision(c))}</span>` : `<span class="badge">${esc(ROLES_CONTACT[c.role] || c.role)}</span>`}${c.fonction ? `<br><small>${esc(c.fonction)}</small>` : ''}</div>
        <div>${c.telephone ? tel(c.telephone) : ''}${c.email ? `<br><a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>` : ''}</div>
        <button class="btn-icone" data-edit-contact="${c.id}" title="Modifier">✎</button></div>`).join('')}
    ${!l.length && !s.standard_tel ? '<p class="vide">Aucun contact pour l’instant.</p>' : ''}
    ${(() => { const f = formatEmail(s.id); return `<p class="format-email">✉️ Format des emails : ${f ? `<code>${esc(f.format)}</code> <small>(${esc(f.origine)}) — ex. ${esc(exempleFormat(f.format) || '')}</small>` : '<small>inconnu</small>'} <button class="lien" id="fi-format-email">${f ? 'modifier' : 'renseigner'}</button></p>`; })()}</div>`;
}

// Agences de location de matériel les plus proches du site (préparation de chantier)
// Dernières actualités sur ce site ou son groupe (santé financière, incendie, rachat…)
function blocActus(s) {
  const l = actusDuSite(s);
  if (!l.length) return '';
  return `<div class="strategie actus-fiche"><h4>📰 Actualités du site et du groupe <a href="#" data-aller-actus>tout voir</a></h4><ul>${l.map(a => {
    const c = CATEGORIES_ACTU[a.categorie] || CATEGORIES_ACTU.autre;
    const u = /^https?:\/\//.test(a.url || '') ? a.url : null;
    return `<li>${c.ico} <b>${esc(c.libelle)}</b> · <span class="quand">${fmtDate(a.date_publication)}</span><br>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(a.titre)}</a>` : esc(a.titre)}</li>`;
  }).join('')}</ul></div>`;
}

function blocAgences(s) {
  const l = agencesProches(s, 3);
  if (!l.length) return '';
  return `<div class="section-titre">Location de matériel à proximité</div>
    <div class="agences-fiche">${l.map(({ a, d }) => `<div class="contact-ligne">
      <div><b>${esc(a.nom)}</b><br><small>${esc([a.adresse, a.code_postal, a.ville].filter(Boolean).join(' '))}</small></div>
      <div><b>${fmtKm(d)}</b><br><small>à vol d'oiseau</small></div>
      <div class="liens">${a.telephone ? `<a class="btn-icone" href="tel:${esc(a.telephone.replace(/\s/g, ''))}" title="Appeler">📞</a>` : ''}<a class="btn-icone" target="_blank" rel="noopener" href="${lienItineraire(a, s)}" title="Itinéraire depuis le site">🧭</a><a class="btn-icone" target="_blank" rel="noopener" href="${lienInfos(a)}" title="Horaires et téléphone">🔎</a></div>
    </div>`).join('')}</div>`;
}

export function modifierFormatEmail(s, apres, groupeSeul = null) {
  const g = groupeSeul || (s?.groupe_id && store.get('groupes', s.groupe_id));
  const actuel = (groupeSeul ? g.email_format : (s.email_format || g?.email_format)) || '';
  const m = ouvrirModale(`<h3>Format des adresses email</h3>
    <p class="vide">Jetons : <code>{prenom}</code> <code>{nom}</code> <code>{p}</code> = initiale du prénom, <code>{n}</code> = initiale du nom.<br>
    Exemples : <code>{p}{nom}@log.com</code> → cbrunel@log.com · <code>{prenom}.{nom}@geodis.com</code> → cedric.brunel@geodis.com</p>
    <label>Format<input type="text" id="fe-format" value="${esc(actuel)}" placeholder="{prenom}.{nom}@entreprise.fr"></label>
    <p id="fe-ex" class="vide"></p>
    ${!groupeSeul && g ? `<label style="font-weight:400"><input type="checkbox" id="fe-groupe" ${s.email_format ? '' : 'checked'}> Appliquer à tout le groupe « ${esc(g.nom)} » (sinon uniquement à ce site)</label>` : ''}
    <div class="boutons"><button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="fe-ok">Enregistrer</button></div>`);
  const maj = () => { const f = $('#fe-format', m).value.trim(); $('#fe-ex', m).textContent = f ? (exempleFormat(f) ? 'Exemple : ' + exempleFormat(f) : 'Format incomplet (il faut au moins {nom} et @domaine)') : ''; };
  $('#fe-format', m).oninput = maj; maj();
  $('#fe-ok', m).onclick = async () => {
    const f = $('#fe-format', m).value.trim() || null;
    if (f && !exempleFormat(f)) { toast('Format incomplet', 'erreur'); return; }
    if (groupeSeul || (g && $('#fe-groupe', m)?.checked)) {
      await store.enregistrer('groupes', { ...store.get('groupes', g.id), email_format: f });
      if (s?.email_format) await store.enregistrer('sites', { ...store.get('sites', s.id), email_format: null });
    } else await store.enregistrer('sites', { ...store.get('sites', s.id), email_format: f });
    fermerModale(); toast('Format enregistré', 'ok'); apres?.();
  };
}

// Liste déroulante des contacts du site (pour rattacher un appel, un RDV, un chantier… à un interlocuteur)
function selectContact(s, id, name) {
  const l = store.liste('contacts').filter(c => c.site_id === s.id);
  if (!l.length) return '';
  return `<label class="${id ? 'plein' : ''}">${id ? 'Avec' : ''}<select ${id ? `id="${id}"` : ''} ${name ? `name="${name}"` : ''} aria-label="Contact">
    <option value="">${id ? '— Contact (facultatif) —' : 'Avec… (facultatif)'}</option>
    ${l.map(c => `<option value="${c.id}">${esc([c.prenom, c.nom].filter(Boolean).join(' '))}${c.fonction ? ' — ' + esc(c.fonction) : ''}</option>`).join('')}</select></label>`;
}

// ------------------------------------------------------------------ actions rapides
function actionRapide(type, s) {
  const dans = j => new Date(Date.now() + j * 864e5).toISOString().slice(0, 10);
  const titres = { appel: '📞 Appel passé', rdv: '📅 Planifier un rendez-vous', note: '📝 Ajouter une note' };
  const m = ouvrirModale(`<h3>${titres[type]} — ${esc(s.nom)}</h3>
    <div class="grille-form">
      ${type === 'rdv' ? `<label class="plein">Date et heure du RDV<input type="datetime-local" id="ar-date" required></label>
        <label class="plein">Type<select id="ar-type"><option value="rdv">Rendez-vous</option><option value="visite">Visite terrain / état des lieux</option></select></label>` : ''}
      ${type === 'appel' ? `<label>Résultat<select id="ar-resultat"><option>Interlocuteur joint</option><option>Messagerie / absent</option><option>Barrage standard</option><option>Pas intéressé</option><option>Rappel demandé</option></select></label>
        <label>Prochain rappel<select id="ar-rappel"><option value="">Aucun</option><option value="${dans(2)}">Dans 2 jours</option><option value="${dans(7)}" selected>Dans 1 semaine</option><option value="${dans(14)}">Dans 2 semaines</option><option value="${dans(30)}">Dans 1 mois</option><option value="${dans(90)}">Dans 3 mois</option><option value="${dans(180)}">Dans 6 mois</option></select></label>` : ''}
      ${type !== 'note' ? selectContact(s, 'ar-contact') : ''}
      <label class="plein">${type === 'note' ? 'Note' : 'Commentaire'}<textarea id="ar-texte" rows="4"></textarea></label>
    </div>
    <div class="boutons"><button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="ar-ok">Enregistrer</button></div>`);
  $('#ar-ok', m).onclick = async () => {
    const texte = $('#ar-texte', m).value.trim();
    const maj = { ...site() };
    if (type === 'appel') {
      const res = $('#ar-resultat', m).value, rappel = $('#ar-rappel', m).value;
      await store.enregistrer('activites', { site_id: s.id, type: 'appel', date: new Date().toISOString(), statut: 'fait', contenu: res + (texte ? ' — ' + texte : ''), auteur: store.profil.email, contact_id: $('#ar-contact', m)?.value || null });
      maj.date_dernier_appel = aujourdhui();
      if (rappel) maj.date_prochain_rappel = rappel;
      if (maj.statut === 'a_qualifier' || maj.statut === 'prospect') {
        maj.statut = res === 'Interlocuteur joint' || res === 'Rappel demandé' ? 'en_contact' : 'prospect';
      }
    } else if (type === 'rdv') {
      const d = $('#ar-date', m).value; if (!d) { toast('Indiquez la date du RDV', 'erreur'); return; }
      const iso = new Date(d).toISOString();
      await store.enregistrer('activites', { site_id: s.id, type: $('#ar-type', m).value, date: iso, statut: 'planifie', contenu: texte || null, auteur: store.profil.email, contact_id: $('#ar-contact', m)?.value || null });
      maj.date_rdv = iso;
      if (STATUTS[maj.statut].ordre < STATUTS.rdv.ordre) maj.statut = 'rdv';
    } else {
      if (!texte) return;
      await store.enregistrer('activites', { site_id: s.id, type: 'note', date: new Date().toISOString(), statut: 'fait', contenu: texte, auteur: store.profil.email });
    }
    if (!maj.assigne_a) maj.assigne_a = store.profil.email;
    await store.enregistrer('sites', maj);
    fermerModale(); rendre(); toast('Enregistré', 'ok');
  };
}

// ------------------------------------------------------------------ onglet Contacts
function rendreContacts(corps, s) {
  const contacts = store.liste('contacts').filter(c => c.site_id === s.id);
  corps.innerHTML = `
    ${s.standard_tel ? `<div class="carte-contact"><b>Standard</b><br><a href="tel:${esc(s.standard_tel.replace(/\s/g, ''))}">📞 ${esc(s.standard_tel)}</a></div>` : ''}
    ${contacts.map(c => `
      <div class="carte-contact">
        <div class="actions"><button class="btn-icone" data-edit="${c.id}" title="Modifier">✎</button></div>
        <b>${esc([c.prenom, c.nom].filter(Boolean).join(' '))}</b> ${c.decisionnaire ? `<span class="badge prio-A">${esc(libelleDecision(c))}</span>` : `<span class="badge">${esc(ROLES_CONTACT[c.role] || c.role)}</span>`}<br>
        ${c.fonction ? esc(c.fonction) + '<br>' : ''}
        ${c.telephone ? `<a href="tel:${esc(c.telephone.replace(/\s/g, ''))}">📞 ${esc(c.telephone)}</a><br>` : ''}
        ${c.email ? `<a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a><br>` : ''}
        ${c.ca_big ? `<small class="vide">Suivi par ${esc(nomCA(c.ca_big))}</small>` : ''}
        ${c.notes ? `<div style="margin-top:4px">${esc(c.notes)}</div>` : ''}
      </div>`).join('') || '<p class="vide">Aucun contact pour ce site.</p>'}
    <button class="btn btn-primaire" id="fi-ajout-contact">+ Ajouter un contact</button>`;
  $('#fi-ajout-contact').onclick = () => editerContact({ site_id: s.id, groupe_id: s.groupe_id || null, role: 'contact', ca_big: store.profil.email }, rendre);
  $$('[data-edit]', corps).forEach(b => b.onclick = () => editerContact(store.get('contacts', b.dataset.edit), rendre));
}

export function editerContact(c, apres) {
  const nouveau = !c.id;
  const s = c.site_id && store.get('sites', c.site_id);
  const groupeId = c.groupe_id || s?.groupe_id || null;
  const parents = groupeId ? store.liste('contacts').filter(x => x.groupe_id === groupeId && x.id !== c.id) : [];
  const profils = store.liste('profils');
  const m = ouvrirModale(`<h3>${nouveau ? 'Nouveau contact' : 'Modifier le contact'}</h3>
    <div class="grille-form" id="ct-form">
      <label>Prénom<input type="text" name="prenom" value="${esc(c.prenom || '')}"></label>
      <label>Nom *<input type="text" name="nom" value="${esc(c.nom || '')}" required></label>
      <label class="plein">Fonction<input type="text" name="fonction" value="${esc(c.fonction || '')}" placeholder="Responsable maintenance, directeur de site…"></label>
      <label>Téléphone<input type="tel" name="telephone" value="${esc(c.telephone || '')}"></label>
      <label>Email<input type="email" name="email" value="${esc(c.email || '')}"><span class="suggestion-email" id="ct-sugg"></span></label>
      <label>Type de contact<select name="role">${Object.entries(ROLES_CONTACT).filter(([k]) => k !== 'decideur' || c.role === 'decideur').map(([k, v]) => `<option value="${k}" ${c.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="decision">
        <label class="case"><input type="checkbox" name="decisionnaire" ${c.decisionnaire || c.role === 'decideur' ? 'checked' : ''}> Décisionnaire</label>
        <select name="niveau_decision" aria-label="Niveau de décision" ${c.decisionnaire || c.role === 'decideur' ? '' : 'disabled'}>
          <option value="">Niveau…</option>${Object.entries(NIVEAUX_DECISION).map(([k, v]) => `<option value="${k}" ${c.niveau_decision === k ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
        </select>
      </div>
      <label>En contact avec (CA BIG)<select name="ca_big"><option value="">—</option>${profils.map(p => `<option value="${esc(p.email)}" ${c.ca_big === p.email ? 'selected' : ''}>${esc(p.prenom + ' ' + p.nom)}</option>`).join('')}</select></label>
      ${groupeId ? `<label class="plein">Rattaché à (organigramme du groupe)<select name="parent_id"><option value="">— Sommet de l'organigramme —</option>${parents.map(p => `<option value="${p.id}" ${c.parent_id === p.id ? 'selected' : ''}>${esc([p.prenom, p.nom].filter(Boolean).join(' '))}${p.fonction ? ' — ' + esc(p.fonction) : ''}</option>`).join('')}</select></label>` : ''}
      <label class="plein">Notes<textarea name="notes">${esc(c.notes || '')}</textarea></label>
    </div>
    <div class="boutons">${nouveau ? '' : '<button class="btn btn-danger" id="ct-suppr" style="margin-right:auto">Supprimer</button>'}<button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="ct-ok">Enregistrer</button></div>`);
  // Suggestion d'email selon le format de l'entreprise
  const fmt = formatEmail(c.site_id, groupeId), champMail = $('#ct-form [name=email]', m), sugg = $('#ct-sugg', m);
  let mailSaisi = !!c.email;
  champMail.addEventListener('input', () => { mailSaisi = !!champMail.value.trim(); majSugg(); });
  const majSugg = () => {
    const e = fmt && emailDepuisFormat(fmt.format, $('#ct-form [name=prenom]', m).value, $('#ct-form [name=nom]', m).value);
    if (!e || champMail.value.trim().toLowerCase() === e) { sugg.innerHTML = fmt ? '' : '<small class="vide">Format d’email de l’entreprise inconnu</small>'; return; }
    sugg.innerHTML = `Suggestion : <button type="button" class="lien">${esc(e)}</button> <small class="vide">(${esc(fmt.origine)})</small>`;
    sugg.querySelector('button').onclick = () => { champMail.value = e; mailSaisi = true; majSugg(); };
  };
  ['prenom', 'nom'].forEach(n => $(`#ct-form [name=${n}]`, m).addEventListener('input', majSugg));
  majSugg();
  const caseDec = $('#ct-form [name=decisionnaire]', m), niv = $('#ct-form [name=niveau_decision]', m);
  caseDec.onchange = () => { niv.disabled = !caseDec.checked; if (!caseDec.checked) niv.value = ''; };
  $('#ct-ok', m).onclick = async () => {
    const v = lireForm($('#ct-form', m));
    if (!v.nom) { toast('Le nom est obligatoire', 'erreur'); return; }
    if (v.role === 'decideur') v.role = 'contact';
    if (!v.decisionnaire) v.niveau_decision = null;
    await store.enregistrer('contacts', { ...c, ...v, groupe_id: groupeId, parent_id: v.parent_id || null, ca_big: v.ca_big || null, supprime: false });
    fermerModale(); apres?.();
  };
  $('#ct-suppr', m)?.addEventListener('click', async () => {
    if (!(await confirmer('Supprimer ce contact ?', { ok: 'Supprimer', danger: true }))) return;
    await store.supprimer('contacts', c.id); apres?.();
  });
}

// ------------------------------------------------------------------ onglet Historique
function rendreHistorique(corps, s) {
  const acts = store.liste('activites').filter(a => a.site_id === s.id).sort((a, b) => b.date.localeCompare(a.date));
  corps.innerHTML = `
    <form class="ajout-activite" id="act-form">
      <select name="type">${Object.entries(TYPES_ACTIVITE).filter(([k]) => k !== 'statut').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input type="datetime-local" name="date" value="${versDatetimeLocal(new Date().toISOString())}">
      <select name="statut"><option value="fait">Fait</option><option value="planifie">Planifié</option></select>
      <input type="number" name="montant" placeholder="Montant devis / chantier (€)" min="0" step="100">
      ${selectContact(s, null, 'contact_id')}
      <textarea name="contenu" placeholder="Compte rendu, objet du devis…"></textarea>
      <button class="btn btn-primaire" type="submit">Ajouter à l'historique</button>
    </form>
    <ul class="chrono">${acts.map(a => `
      <li class="${a.statut}">
        <b>${TYPES_ACTIVITE[a.type] || a.type}</b>${a.contact_id && store.get('contacts', a.contact_id) ? ` <span class="vide">avec ${esc([store.get('contacts', a.contact_id).prenom, store.get('contacts', a.contact_id).nom].filter(Boolean).join(' '))}</span>` : ''}${a.statut === 'planifie' ? ' <span class="badge info">planifié</span>' : ''}${a.statut === 'annule' ? ' <span class="badge">annulé</span>' : ''}
        ${a.montant ? ` · ${fmtEuro(Number(a.montant))}` : ''}
        <div class="meta">${fmtDateHeure(a.date)} — ${esc(nomCA(a.auteur))}
          ${a.statut === 'planifie' ? ` · <button class="lien" data-fait="${a.id}">marquer fait</button> · <button class="lien" data-annule="${a.id}">annuler</button>` : ''}
          ${a.auteur === store.profil.email || store.profil.role !== 'ca' ? ` · <button class="lien" data-suppr="${a.id}">supprimer</button>` : ''}</div>
        ${a.contenu ? `<div>${esc(a.contenu)}</div>` : ''}
      </li>`).join('') || '<p class="vide">Aucun échange enregistré.</p>'}</ul>`;
  $('#act-form').onsubmit = async e => {
    e.preventDefault();
    const v = lireForm(e.target);
    if (!v.date) v.date = new Date().toISOString();
    await store.enregistrer('activites', { ...v, site_id: s.id, auteur: store.profil.email, supprime: false });
    const maj = { ...site() };
    if (v.type === 'appel' && v.statut === 'fait' && (!maj.date_dernier_appel || maj.date_dernier_appel < v.date.slice(0, 10))) maj.date_dernier_appel = v.date.slice(0, 10);
    if ((v.type === 'rdv' || v.type === 'visite') && v.statut === 'planifie') { maj.date_rdv = v.date; if (STATUTS[maj.statut].ordre < STATUTS.rdv.ordre) maj.statut = 'rdv'; }
    if (v.type === 'devis' && STATUTS[maj.statut].ordre < STATUTS.devis.ordre) maj.statut = 'devis';
    if (v.type === 'chantier' && v.statut === 'fait' && STATUTS[maj.statut].ordre < STATUTS.client.ordre) maj.statut = 'client';
    await store.enregistrer('sites', maj);
    rendre(); toast('Ajouté à l’historique', 'ok');
  };
  const maj = (id, ch) => store.enregistrer('activites', { ...store.get('activites', id), ...ch }).then(rendre);
  $$('[data-fait]', corps).forEach(b => b.onclick = () => maj(b.dataset.fait, { statut: 'fait' }));
  $$('[data-annule]', corps).forEach(b => b.onclick = () => maj(b.dataset.annule, { statut: 'annule' }));
  $$('[data-suppr]', corps).forEach(b => b.onclick = async () => { if (await confirmer('Supprimer cette entrée ?', { ok: 'Supprimer', danger: true })) maj(b.dataset.suppr, { supprime: true }); });
}

// ------------------------------------------------------------------ création d'un site
export function nouveauSite(pos = {}) {
  const m = ouvrirModale(`<h3>Nouveau site</h3>
    <div class="grille-form" id="ns-form">
      <label class="plein">Nom du site / de l'entreprise *<input type="text" name="nom" required></label>
      <label class="plein">Adresse<input type="text" name="adresse" value="${esc(pos.adresse || '')}"></label>
      <label>Code postal<input type="text" name="code_postal" value="${esc(pos.code_postal || '')}"></label>
      <label>Ville<input type="text" name="ville" value="${esc(pos.ville || '')}"></label>
      <label>Pays<select name="pays"><option value="FR">France</option><option value="BE" ${pos.pays === 'BE' ? 'selected' : ''}>Belgique</option></select></label>
      <label>Type de site<select name="categorie">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v.libelle}</option>`).join('')}</select></label>
      <label>Surface estimée (m²)<input type="number" name="surface_m2" min="0" step="100"></label>
      <label>Année de construction<input type="number" name="annee_construction" min="1850" max="${ANNEE + 2}"></label>
      <label class="plein">Commentaire<textarea name="commentaire"></textarea></label>
    </div>
    <p class="vide" id="ns-pos">${pos.lat ? `📍 Position : ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : 'La position sera calculée à partir de l’adresse (connexion requise), ou cliquez « Placer sur la carte ».'}</p>
    <div class="boutons"><button class="btn" id="ns-placer" style="margin-right:auto">📍 Placer sur la carte</button><button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="ns-ok">Créer le site</button></div>`);
  $('#ns-placer', m).onclick = () => { fermerModale(); toast('Cliquez sur la carte à l’emplacement du site'); emettre('aller-vue', 'carte'); emettre('placer-site'); };
  $('#ns-ok', m).onclick = async () => {
    const v = lireForm($('#ns-form', m));
    if (!v.nom) { toast('Le nom est obligatoire', 'erreur'); return; }
    let { lat, lng } = pos;
    if (!lat && v.adresse && navigator.onLine) {
      try {
        const r = await (await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent([v.adresse, v.code_postal, v.ville].join(' '))}&limit=1`)).json();
        const f = r.features?.[0]; if (f) { [lng, lat] = f.geometry.coordinates; v.code_postal ||= f.properties.postcode; v.ville ||= f.properties.city; }
      } catch { }
    }
    const s = await store.enregistrer('sites', {
      ...v, lat: lat ?? null, lng: lng ?? null, statut: 'prospect', source: 'manuel', source_id: uuid(),
      assigne_a: store.profil.email, infos_od: {}, supprime: false,
    });
    fermerModale(); toast('Site créé', 'ok');
    if (!s.lat) toast('Position inconnue : le site n’apparaîtra pas sur la carte (visible dans la liste).');
    ouvrirFiche(s.id);
    if (s.lat) centrerSur(s, 15);
  };
}
