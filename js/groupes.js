// Vue Groupes : enseignes / maisons-mères, sites rattachés, organigramme des contacts
import { store } from './store.js';
import { etat, infos, ecouter, emettre, nomCA, sitesDuSecteur } from './etat.js';
import { CATEGORIES, STATUTS, ROLES_CONTACT, fmtN, fmtM2, fmtM2court, esc, sansAccent } from './metier.js';
import { $, $$, toast, ouvrirModale, fermerModale, confirmer, debounce } from './ui.js';
import { nouveauGroupe, editerContact, modifierFormatEmail, NIVEAUX_DECISION } from './fiche.js';
import { exempleFormat } from './metier.js';

let groupeActif = null, recherche = '', visible = false;

export function initGroupes() {
  ecouter('vue', v => { visible = v === 'groupes'; if (visible) rendre(); });
  ecouter('voir-groupe', id => { groupeActif = id; emettre('aller-vue', 'groupes'); });
  ecouter('secteur', () => visible && rendre());
  store.on('change', d => { if (visible && ['groupes', 'contacts', 'sites'].includes(d?.table) && !document.activeElement?.closest('.groupe-detail')) rendre(); });
}

// Statistiques de tous les groupes en une seule passe sur les sites
function statsGroupes(sites) {
  const m = new Map();
  for (const x of sites) {
    if (!x.groupe_id) continue;
    const st = m.get(x.groupe_id) || { n: 0, surf: 0, clients: 0 };
    st.n++; st.surf += infos(x).surface || 0; if (x.statut === 'client') st.clients++;
    m.set(x.groupe_id, st);
  }
  return m;
}

function rendre() {
  const el = $('#vue-groupes');
  const sites = store.liste('sites');
  const q = sansAccent(recherche);
  const stats = statsGroupes(sites), vide = { n: 0, surf: 0, clients: 0 };
  const groupes = store.liste('groupes').filter(g => !q || sansAccent(g.nom).includes(q))
    .map(g => ({ g, st: stats.get(g.id) || vide })).sort((a, b) => b.st.n - a.st.n || a.g.nom.localeCompare(b.g.nom));
  if (!groupeActif && groupes.length) groupeActif = groupes[0].g.id;
  el.innerHTML = `
    <div class="groupes-liste">
      <div class="outils"><input type="search" id="gr-recherche" placeholder="Rechercher un groupe" value="${esc(recherche)}"><button class="btn btn-primaire btn-petit" id="gr-nouveau">+ Groupe</button></div>
      <ul>${groupes.map(({ g, st }) => `<li data-id="${g.id}" class="${g.id === groupeActif ? 'actif' : ''}"><b>${esc(g.nom)}</b>${g.reference ? ' <span class="badge ok" title="BIG est référencé">✓ Référencé</span>' : ''}<small>${st.n} site${st.n > 1 ? 's' : ''} · ${fmtM2court(st.surf)}${st.clients ? ` · ${st.clients} client${st.clients > 1 ? 's' : ''}` : ''}</small></li>`).join('') || '<li class="vide">Aucun groupe. Créez-en un pour regrouper les sites d’une même enseigne.</li>'}</ul>
    </div>
    <div class="groupe-detail" id="gr-detail"></div>`;
  const champ = $('#gr-recherche');
  champ.oninput = debounce(() => { recherche = champ.value; rendre(); const c = $('#gr-recherche'); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }, 200);
  $('#gr-nouveau').onclick = async () => { const g = await nouveauGroupe(); if (g) { groupeActif = g.id; rendre(); } };
  $$('.groupes-liste li[data-id]', el).forEach(li => li.onclick = () => { groupeActif = li.dataset.id; rendre(); });
  rendreDetail();
}

function rendreDetail() {
  const d = $('#gr-detail');
  const g = groupeActif && store.get('groupes', groupeActif);
  if (!g || g.supprime) { d.innerHTML = '<p class="vide">Sélectionnez un groupe.</p>'; return; }
  const sites = store.liste('sites').filter(s => s.groupe_id === g.id).sort((a, b) => infos(b).score - infos(a).score);
  const contacts = store.liste('contacts').filter(c => c.groupe_id === g.id);
  const surf = sites.reduce((t, s) => t + (infos(s).surface || 0), 0);
  const parStatut = {}; sites.forEach(s => parStatut[s.statut] = (parStatut[s.statut] || 0) + 1);
  d.innerHTML = `
    <div style="display:flex;gap:12px;align-items:start;flex-wrap:wrap">
      <div style="flex:1;min-width:240px"><h2 contenteditable="true" id="gr-nom" spellcheck="false" title="Cliquer pour renommer">${esc(g.nom)}</h2></div>
      <button class="btn btn-petit" id="gr-rattacher">🔗 Rattacher des sites</button>
      <button class="btn btn-petit" id="gr-filtrer">🗺 Voir sur la carte</button>
      <button class="btn btn-petit btn-danger" id="gr-suppr">Supprimer</button>
    </div>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi"><span>Sites</span><b>${sites.length}</b></div>
      <div class="kpi"><span>Surface cumulée</span><b style="font-size:20px">${fmtM2(surf)}</b></div>
      <div class="kpi"><span>Clients</span><b>${parStatut.client || 0}</b></div>
      <div class="kpi"><span>Contacts</span><b>${contacts.length}</b></div>
    </div>
    <div class="groupe-reglages">
      <label class="case ${g.reference ? 'coche' : ''}"><input type="checkbox" id="gr-reference" ${g.reference ? 'checked' : ''}> BIG est <b>référencé</b> chez ce groupe</label>
      <input type="text" id="gr-reference-note" value="${esc(g.reference_note || '')}" placeholder="Précisions : depuis quand, contrat cadre, acheteur…" ${g.reference ? '' : 'hidden'}>
      <p class="format-email">✉️ Format des emails : ${g.email_format ? `<code>${esc(g.email_format)}</code> <small>— ex. ${esc(exempleFormat(g.email_format) || '')}</small>` : '<small>inconnu</small>'} <button class="lien" id="gr-format">${g.email_format ? 'modifier' : 'renseigner'}</button></p>
    </div>
    <label>Notes sur le groupe<textarea id="gr-notes" rows="3" placeholder="Politique achats, contrats cadres, interlocuteurs nationaux…">${esc(g.notes || '')}</textarea></label>

    <div class="section-titre">Organigramme</div>
    <div class="organigramme">${organigramme(contacts) || '<p class="vide">Aucun contact. Ajoutez le décideur national puis ses relais en sites.</p>'}</div>
    <button class="btn btn-primaire btn-petit" id="gr-contact">+ Ajouter un contact</button>

    <div class="section-titre">Sites du groupe</div>
    ${sites.length ? `<div class="table-defile"><table class="table"><thead><tr><th>Site</th><th>Ville</th><th>Type</th><th class="num">Surface</th><th>Statut</th><th>Chargé d'affaires</th></tr></thead><tbody>
      ${sites.map(s => `<tr data-site="${s.id}"><td class="nom">${esc(s.nom)}</td><td>${esc(s.ville || '')}</td><td>${esc(CATEGORIES[infos(s).cat].libelle)}</td><td class="num">${fmtN(infos(s).surface)}</td>
        <td><span class="badge"><span class="rond" style="background:${STATUTS[s.statut]?.couleur}"></span>${esc(STATUTS[s.statut]?.libelle || '')}</span></td><td>${esc(s.assigne_a ? nomCA(s.assigne_a) : '—')}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="vide">Aucun site rattaché.</p>'}`;

  const nom = $('#gr-nom');
  nom.onblur = async () => {
    const v = nom.textContent.trim();
    if (v && v !== g.nom) { await store.enregistrer('groupes', { ...g, nom: v }); toast('Groupe renommé', 'ok'); }
    else nom.textContent = g.nom;
  };
  nom.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nom.blur(); } };
  $('#gr-reference').onchange = async e => {
    await store.enregistrer('groupes', { ...store.get('groupes', g.id), reference: e.target.checked });
    toast(e.target.checked ? 'Groupe marqué « référencé »' : 'Référencement retiré', 'ok'); rendre();
  };
  $('#gr-reference-note').onchange = e => store.enregistrer('groupes', { ...store.get('groupes', g.id), reference_note: e.target.value.trim() || null });
  $('#gr-format').onclick = () => modifierFormatEmail(null, rendre, store.get('groupes', g.id));
  $('#gr-notes').onchange = e => store.enregistrer('groupes', { ...store.get('groupes', g.id), notes: e.target.value.trim() || null });
  $('#gr-contact').onclick = () => editerContact({ groupe_id: g.id, role: 'decideur', ca_big: store.profil.email }, rendre);
  $$('.noeud', d).forEach(n => n.onclick = () => editerContact(store.get('contacts', n.dataset.id), rendre));
  $$('tr[data-site]', d).forEach(tr => tr.onclick = () => emettre('ouvrir-site', tr.dataset.site));
  $('#gr-suppr').onclick = async () => {
    if (!(await confirmer(`Supprimer le groupe « ${g.nom} » ? Les sites restent, ils sont simplement détachés.`, { ok: 'Supprimer', danger: true }))) return;
    for (const s of sites) await store.enregistrer('sites', { ...s, groupe_id: null });
    await store.supprimer('groupes', g.id); groupeActif = null; rendre();
  };
  $('#gr-filtrer').onclick = () => {
    etat.filtres.groupe = g.id; $('#f-groupe').value = g.id;
    if (etat.secteur !== 'national') emettre('changer-secteur', 'national');
    emettre('filtres'); emettre('aller-vue', 'carte');
  };
  $('#gr-rattacher').onclick = () => rattacher(g);
}

function organigramme(contacts) {
  if (!contacts.length) return '';
  const ids = new Set(contacts.map(c => c.id));
  const enfants = c => contacts.filter(x => x.parent_id === c.id);
  const noeud = c => {
    const s = c.site_id && store.get('sites', c.site_id);
    const e = enfants(c);
    return `<li><div class="noeud ${c.decisionnaire ? 'decideur' : c.role}" data-id="${c.id}"><b>${esc([c.prenom, c.nom].filter(Boolean).join(' '))}</b><small>${esc(c.fonction || '')}</small>
      <small>${esc(c.decisionnaire ? 'Décisionnaire' + (c.niveau_decision ? ' ' + NIVEAUX_DECISION[c.niveau_decision] : '') : (ROLES_CONTACT[c.role] || ''))}${s ? ' · ' + esc(s.ville || s.nom) : ''}</small>${c.ca_big ? `<small>↔ ${esc(nomCA(c.ca_big))}</small>` : ''}</div>
      ${e.length ? `<ul>${e.map(noeud).join('')}</ul>` : ''}</li>`;
  };
  const racines = contacts.filter(c => !c.parent_id || !ids.has(c.parent_id));
  return `<ul class="org" style="display:flex;justify-content:center;gap:12px">${racines.map(noeud).join('')}</ul>`;
}

function rattacher(g) {
  const mots = sansAccent(g.nom).replace(/\(.*?\)|groupe|group|sas|sa\b|france/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const m = ouvrirModale(`<h3>Rattacher des sites à « ${esc(g.nom)} »</h3>
    <input type="search" id="ra-q" placeholder="Rechercher par nom, raison sociale, propriétaire, ville…" value="${esc(mots.join(' '))}">
    <p class="vide" id="ra-info"></p>
    <div class="apercu" id="ra-res"></div>
    <div class="boutons"><button class="btn" data-fermer-modale>Fermer</button><button class="btn btn-primaire" id="ra-ok">Rattacher la sélection</button></div>`, { large: true });
  const chercher = () => {
    const q = sansAccent($('#ra-q', m).value).split(/\s+/).filter(Boolean);
    const res = q.length ? sitesDuSecteur('national').filter(s => s.groupe_id !== g.id && q.some(w => infos(s).recherche.includes(w))).slice(0, 300) : [];
    $('#ra-info', m).textContent = q.length ? `${res.length}${res.length === 300 ? '+' : ''} site(s) trouvé(s)` : '';
    $('#ra-res', m).innerHTML = res.length ? `<table class="table"><tbody>${res.map(s => `<tr><td><input type="checkbox" value="${s.id}"></td><td class="nom">${esc(s.nom)}${s.enseigne ? `<br><small>${esc(s.enseigne)}</small>` : ''}</td><td>${esc(s.ville || '')}</td><td class="num">${fmtN(infos(s).surface)} m²</td><td>${s.groupe_id ? '<small>déjà dans ' + esc(store.get('groupes', s.groupe_id)?.nom || 'un groupe') + '</small>' : ''}</td></tr>`).join('')}</tbody></table>` : '';
  };
  $('#ra-q', m).oninput = debounce(chercher, 200); chercher();
  $('#ra-ok', m).onclick = async () => {
    const ids = $$('#ra-res input:checked', m).map(i => i.value);
    for (const id of ids) await store.enregistrer('sites', { ...store.get('sites', id), groupe_id: g.id });
    fermerModale(); toast(`${ids.length} site(s) rattaché(s)`, 'ok'); rendre();
  };
}
