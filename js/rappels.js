// Onglet « Rappels » : sites à rappeler, triés par date ; orange = en retard, jaune = cette semaine
import { store } from './store.js';
import { etat, ecouter, emettre, sitesDuSecteur, nomCA } from './etat.js';
import { fmtDate, fmtDateHeure, esc, aujourdhui, STATUTS } from './metier.js';
import { $, $$, debounce, toast } from './ui.js';

let visible = false, perimetre = null, horizon = 'tout';
const EXCLUS = new Set(['perdu', 'non_pertinent']);
const plusJours = (iso, j) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + j); return d.toISOString().slice(0, 10); };
const tel = t => t ? `<a href="tel:${esc(t.replace(/[^\d+]/g, ''))}" onclick="event.stopPropagation()">${esc(t)}</a>` : '';

export function initRappels() {
  const rendreDiffere = debounce(() => visible && rendre(), 250), badgeDiffere = debounce(majBadge, 400);
  ecouter('vue', v => { visible = v === 'rappels'; if (visible) rendre(); });
  ecouter('secteur', () => { majBadge(); if (visible) rendre(); });
  store.on('change', d => { if (!d || ['sites', 'contacts', 'activites', 'profils'].includes(d.table)) { badgeDiffere(); rendreDiffere(); } });
  majBadge();
}

function rappels() {
  if (!perimetre) perimetre = store.profil?.role === 'ca' ? 'moi' : 'tous';
  const moi = store.profil?.email;
  return sitesDuSecteur().filter(s => s.date_prochain_rappel && !EXCLUS.has(s.statut) && (perimetre === 'tous' || s.assigne_a === moi || (perimetre === 'moi_libres' && !s.assigne_a)))
    .sort((a, b) => a.date_prochain_rappel.localeCompare(b.date_prochain_rappel) || a.nom.localeCompare(b.nom));
}

function majBadge() {
  const b = document.querySelector('.onglets [data-vue=rappels] .compteur'); if (!b) return;
  const auj = aujourdhui(), moi = store.profil?.email;
  const n = sitesDuSecteur().filter(s => s.date_prochain_rappel && s.date_prochain_rappel <= auj && !EXCLUS.has(s.statut) && (store.profil?.role !== 'ca' || s.assigne_a === moi)).length;
  b.textContent = n || ''; b.hidden = !n;
  b.title = `${n} rappel(s) en retard ou du jour`;
}

function rendre() {
  const el = $('#vue-rappels');
  const auj = aujourdhui(), finSemaine = plusJours(auj, 6);
  let liste = rappels();
  const nRetard = liste.filter(s => s.date_prochain_rappel < auj).length, nSemaine = liste.filter(s => s.date_prochain_rappel >= auj && s.date_prochain_rappel <= finSemaine).length;
  if (horizon === 'semaine') liste = liste.filter(s => s.date_prochain_rappel <= finSemaine);
  // contact principal (décisionnaire d'abord) et dernier commentaire de chaque site
  const ids = new Set(liste.map(s => s.id)), contacts = new Map(), derniers = new Map();
  for (const c of store.liste('contacts')) {
    if (!ids.has(c.site_id)) continue;
    const e = contacts.get(c.site_id);
    if (!e || (c.decisionnaire && !e.decisionnaire)) contacts.set(c.site_id, c);
  }
  for (const a of store.liste('activites')) {
    if (!ids.has(a.site_id) || !a.contenu || a.type === 'statut') continue;
    const e = derniers.get(a.site_id);
    if (!e || a.date > e.date) derniers.set(a.site_id, a);
  }
  const secteur = store.get('secteurs', etat.secteur)?.libelle || etat.secteur;
  el.innerHTML = `
    <div class="rappels-outils">
      <div><b>${liste.length} rappel${liste.length > 1 ? 's' : ''}</b> — secteur ${esc(secteur)}
        <span class="pastille retard">${nRetard} en retard</span><span class="pastille semaine">${nSemaine} cette semaine</span></div>
      <div class="puces">
        <button class="puce ${perimetre === 'moi' ? 'actif' : ''}" data-p="moi">Mes rappels</button>
        <button class="puce ${perimetre === 'moi_libres' ? 'actif' : ''}" data-p="moi_libres">Mes rappels + sites non assignés</button>
        <button class="puce ${perimetre === 'tous' ? 'actif' : ''}" data-p="tous">Toute l'équipe</button>
        <span class="separateur"></span>
        <button class="puce ${horizon === 'semaine' ? 'actif' : ''}" data-h="semaine">Retard + 7 jours</button>
        <button class="puce ${horizon === 'tout' ? 'actif' : ''}" data-h="tout">Tous</button>
      </div>
    </div>
    <div class="table-defile">
    ${liste.length ? `<table class="table table-rappels"><thead><tr>
      <th>Rappel</th><th>Site</th><th>Ville</th><th>CP</th><th>Téléphone</th><th>Contact</th><th>Fonction</th><th>Tél. contact</th><th>Dernier commentaire</th><th></th></tr></thead><tbody>
      ${liste.map(s => {
        const c = contacts.get(s.id), d = derniers.get(s.id);
        const classe = s.date_prochain_rappel < auj ? 'en-retard' : s.date_prochain_rappel <= finSemaine ? 'cette-semaine' : '';
        const com = d ? `${fmtDate(d.date)} · ${d.contenu}` : (s.commentaire || '');
        return `<tr data-id="${s.id}" class="${classe}">
          <td class="date">${fmtDate(s.date_prochain_rappel)}${classe === 'en-retard' ? '<br><small>en retard</small>' : s.date_prochain_rappel === auj ? '<br><small>aujourd’hui</small>' : ''}</td>
          <td class="nom">${esc(s.nom)}${perimetre !== 'moi' && s.assigne_a ? `<br><small>${esc(nomCA(s.assigne_a))}</small>` : ''}${s.statut !== 'a_qualifier' ? `<br><small>${esc(STATUTS[s.statut]?.libelle || '')}</small>` : ''}</td>
          <td>${esc(s.ville || '')}</td><td>${esc(s.code_postal || '')}</td>
          <td>${tel(s.standard_tel)}</td>
          <td>${c ? esc([c.prenom, c.nom].filter(Boolean).join(' ')) + (c.decisionnaire ? ' <span title="Décisionnaire">★</span>' : '') : '<span class="vide">—</span>'}</td>
          <td>${c?.fonction ? esc(c.fonction) : ''}</td>
          <td>${tel(c?.telephone)}</td>
          <td class="commentaire" title="${esc(com)}">${esc(com.length > 110 ? com.slice(0, 110) + '…' : com)}</td>
          <td class="actions"><button class="btn btn-petit" data-reporter="${s.id}" title="Reporter le rappel d’une semaine">+7 j</button></td>
        </tr>`;
      }).join('')}</tbody></table>` : '<p class="vide" style="padding:20px">Aucun rappel programmé. Ils se créent depuis la fiche d’un site (« 📞 Appel passé » → prochain rappel, ou champ « Date du prochain rappel »).</p>'}
    </div>`;
  $$('[data-p]', el).forEach(b => b.onclick = () => { perimetre = b.dataset.p; rendre(); });
  $$('[data-h]', el).forEach(b => b.onclick = () => { horizon = b.dataset.h; rendre(); });
  $$('tbody tr', el).forEach(tr => tr.onclick = () => emettre('ouvrir-site', tr.dataset.id));
  $$('[data-reporter]', el).forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const s = store.get('sites', b.dataset.reporter);
    const base = s.date_prochain_rappel < auj ? auj : s.date_prochain_rappel;
    await store.enregistrer('sites', { ...s, date_prochain_rappel: plusJours(base, 7) });
    toast(`Rappel reporté au ${fmtDate(plusJours(base, 7))}`, 'ok');
  });
}
