// Onglet « Appels d'offres » : avis BOAMP en cours (date limite non dépassée), regroupés par secteur pour savoir qui répond
import { store } from './store.js';
import { etat, ecouter } from './etat.js';
import { esc, fmtDate, fmtDateHeure } from './metier.js';
import { DALLAGE } from './pole.js';
import { $, $$, debounce, toast, ouvrirModale, fermerModale } from './ui.js';
import { secteursDeDepts, repondants, prenomNom, SECTIONS_ORDRE, echeance, libDept, correspond, lienSur } from './veille-commun.js';

export const SUIVIS = {
  nouveau:    { libelle: 'À trier',      classe: 'nouveau' },
  a_etudier:  { libelle: 'À étudier',    classe: 'etudier' },
  on_repond:  { libelle: 'On répond',    classe: 'repond' },
  repondu:    { libelle: 'Offre remise', classe: 'remis' },
  sans_suite: { libelle: 'Sans suite',   classe: 'sans-suite' },
};
const VUES = {
  actifs:   { libelle: 'À traiter + retenus', test: a => a.suivi !== 'sans_suite' },
  nouveau:  { libelle: 'À trier',             test: a => (a.suivi || 'nouveau') === 'nouveau' },
  retenus:  { libelle: 'Retenus',             test: a => ['a_etudier', 'on_repond', 'repondu'].includes(a.suivi) },
  mes:      { libelle: 'Mes AO',              test: (a, sec) => (a.responsable || defautResp(sec)) === store.profil?.email },
  sans:     { libelle: 'Sans suite',          test: a => a.suivi === 'sans_suite' },
  tous:     { libelle: 'Tous',                test: () => true },
};
let visible = false, vue = 'actifs', texte = '', urgents = false;
const defautResp = code => repondants(code)[0]?.email || null;

export function initAppelsOffres() {
  const rendreDiffere = debounce(() => visible && rendre(), 250);
  ecouter('vue', v => { visible = v === 'ao'; if (visible) rendre(); });
  ecouter('secteur', () => { majBadge(); if (visible) rendre(); });
  store.on('change', d => { if (!d || ['appels_offres', 'profils', 'secteur_departements'].includes(d.table)) { majBadge(); rendreDiffere(); } });
  setInterval(majBadge, 30 * 60 * 1000);   // une échéance peut passer pendant la journée
  majBadge();
}

// AO encore ouverts, avec leurs secteurs
function enCours() {
  const maintenant = new Date().toISOString();
  return store.liste('appels_offres').filter(a => a.date_limite && a.date_limite >= maintenant)
    .map(a => ({ a, secteurs: secteursDeDepts(a.departements) }));
}
const dansSecteur = (x, code) => code === 'national' || x.secteurs.has(code) || !x.secteurs.size;

function majBadge() {
  const b = document.querySelector('.onglets [data-vue=ao] .compteur'); if (!b) return;
  const n = enCours().filter(x => dansSecteur(x, etat.secteur) && (x.a.suivi || 'nouveau') === 'nouveau').length;
  b.textContent = n || ''; b.hidden = !n;
  b.title = `${n} appel(s) d’offres à trier`;
}

function rendre() {
  const el = $('#vue-ao');
  const tous = enCours();
  const code = etat.secteur;
  // sections : un secteur précis → ce secteur + AO non localisés ; national → tous les secteurs
  const sections = [];
  const secteurs = code === 'national' ? SECTIONS_ORDRE() : SECTIONS_ORDRE().filter(s => s.code === code);
  for (const s of secteurs) sections.push({ code: s.code, titre: `Secteur ${s.libelle}`, couleur: s.couleur, zones: s.zones, test: x => x.secteurs.has(s.code) });
  if (code === 'national') sections.push({ code: 'hors', titre: 'Hors secteurs (outre-mer…)', couleur: '#8F9092', test: x => x.secteurs.has('hors') && x.secteurs.size === 1 });
  sections.push({ code: 'aucun', titre: 'Lieu non précisé', couleur: '#8F9092', zones: 'Accords-cadres nationaux, avis sans département : à attribuer', test: x => !x.secteurs.size });

  const filtre = (x, sec) => VUES[vue].test(x.a, sec) && (!urgents || echeance(x.a.date_limite).jours <= 14)
    && correspond(`${x.a.titre} ${x.a.acheteur || ''} ${x.a.description || ''} ${(x.a.departements || []).map(libDept).join(' ')}`, texte);
  const visibles = tous.filter(x => dansSecteur(x, code));
  const nTrier = visibles.filter(x => (x.a.suivi || 'nouveau') === 'nouveau').length, nUrg = visibles.filter(x => echeance(x.a.date_limite).jours <= 7).length;
  const majVeille = tous.reduce((m, x) => x.a.maj > m ? x.a.maj : m, '');
  const libSecteur = store.get('secteurs', code)?.libelle || code;

  let html = `
    <div class="rappels-outils veille-outils">
      <div><b>${visibles.length} appel${visibles.length > 1 ? 's' : ''} d’offres en cours</b> — ${code === 'national' ? 'tous secteurs' : 'secteur ' + esc(libSecteur)}
        <span class="pastille nouveau">${nTrier} à trier</span><span class="pastille retard">${nUrg} à rendre sous 7 j</span></div>
      <div class="puces">
        ${Object.entries(VUES).map(([k, v]) => `<button class="puce ${vue === k ? 'actif' : ''}" data-v="${k}">${v.libelle}</button>`).join('')}
        <span class="separateur"></span>
        <button class="puce ${urgents ? 'actif' : ''}" data-urg>⏱ Sous 14 jours</button>
        <input type="search" class="recherche-veille" placeholder="Rechercher (objet, acheteur, ville…)" value="${esc(texte)}">
      </div>
    </div>
    <div class="veille-defile">
    <p class="veille-source">${DALLAGE ? 'Pôle Dallage — construction de bâtiments d’activité, entrepôts, usines, lots gros œuvre / dallage en Nouvelle-Aquitaine. ' : ''}Source : BOAMP (marchés publics français), mis à jour chaque matin${majVeille ? ` — dernière collecte ${fmtDateHeure(majVeille)}` : ''}. Seuls les avis dont la date limite n’est pas dépassée sont affichés.</p>`;

  let total = 0;
  for (const sec of sections) {
    const liste = visibles.filter(sec.test).filter(x => filtre(x, sec.code)).sort((p, q) => p.a.date_limite.localeCompare(q.a.date_limite));
    if (!liste.length && (sec.code === 'hors' || sec.code === 'aucun')) continue;
    total += liste.length;
    const reps = ['hors', 'aucun'].includes(sec.code) ? [] : repondants(sec.code);
    html += `<section class="veille-section">
      <h3 class="veille-titre" style="--c:${sec.couleur}"><span class="rond"></span>${esc(sec.titre)} <small>${liste.length}</small>
        <span class="repondant">${reps.length ? '👤 Répondant : <b>' + reps.map(p => esc(prenomNom(p))).join(', ') + '</b>' : esc(sec.zones || '')}</span></h3>
      ${liste.length ? liste.map(x => carte(x, sec.code)).join('') : '<p class="vide">Aucun appel d’offres dans cette sélection.</p>'}
    </section>`;
  }
  if (!tous.length) html += `<div class="veille-vide"><b>Aucun appel d’offres pour l’instant.</b><br>La liste est alimentée chaque matin par la collecte automatique (GitHub → Actions → « Veille (appels d’offres et actualités) »). Lancez-la une première fois à la main après l’installation.</div>`;
  html += '</div>';
  el.innerHTML = html;

  $$('[data-v]', el).forEach(b => b.onclick = () => { vue = b.dataset.v; rendre(); });
  $('[data-urg]', el).onclick = () => { urgents = !urgents; rendre(); };
  const rech = $('.recherche-veille', el);
  rech.oninput = debounce(() => { texte = rech.value; rendre(); const r = $('.recherche-veille', el); r.focus(); r.setSelectionRange(r.value.length, r.value.length); }, 300);
  $$('[data-suivi]', el).forEach(s => s.onchange = () => modifier(s.dataset.suivi, { suivi: s.value }));
  $$('[data-resp]', el).forEach(s => s.onchange = () => modifier(s.dataset.resp, { responsable: s.value || null }));
  $$('[data-note]', el).forEach(b => b.onclick = () => editerNote(b.dataset.note));
}

function carte({ a, secteurs }, codeSection) {
  const e = echeance(a.date_limite), suivi = a.suivi || 'nouveau';
  const autres = [...secteurs].filter(s => s !== codeSection && s !== 'hors').map(s => store.get('secteurs', s)?.libelle || s);
  const defaut = ['hors', 'aucun'].includes(codeSection) ? null : defautResp(codeSection);
  const profils = store.liste('profils').filter(p => p.actif !== false).sort((p, q) => p.prenom.localeCompare(q.prenom));
  const url = lienSur(a.url);
  return `<article class="ao-carte suivi-${SUIVIS[suivi]?.classe || 'nouveau'}" data-id="${esc(a.id)}">
    <div class="ao-echeance ${e.classe}"><b>${e.txt}</b><small>${fmtDateHeure(a.date_limite)}</small></div>
    <div class="ao-corps">
      ${url ? `<a class="ao-titre" href="${esc(url)}" target="_blank" rel="noopener">${esc(a.titre)} ↗</a>` : `<span class="ao-titre">${esc(a.titre)}</span>`}
      <div class="ao-meta">${a.acheteur ? `<b>${esc(a.acheteur)}</b> · ` : ''}${(a.departements || []).length ? '📍 ' + a.departements.map(d => esc(libDept(d))).join(', ') + ' · ' : ''}${a.procedure ? esc(a.procedure) + ' · ' : ''}publié le ${fmtDate(a.date_publication)}
        ${autres.length ? `<span class="aussi">aussi secteur ${esc(autres.join(', '))}</span>` : ''}</div>
      <div class="ao-mots">${(a.mots_cles || []).map(m => `<span class="mot">${esc(m)}</span>`).join('')}<span class="pertinence" title="Indice de pertinence calculé à partir des mots-clés">pertinence ${a.pertinence ?? '—'}</span></div>
      ${a.note ? `<div class="ao-note">📝 ${esc(a.note)}${a.updated_by ? ` <small>— ${esc(store.get('profils', a.updated_by)?.prenom || a.updated_by)}</small>` : ''}</div>` : ''}
    </div>
    <div class="ao-suivi">
      <select data-suivi="${esc(a.id)}" aria-label="Suivi">${Object.entries(SUIVIS).map(([k, v]) => `<option value="${k}" ${k === suivi ? 'selected' : ''}>${v.libelle}</option>`).join('')}</select>
      <select data-resp="${esc(a.id)}" aria-label="Qui répond">
        <option value="">${defaut ? `Répondant : ${esc(store.get('profils', defaut)?.prenom || defaut)} (secteur)` : 'Répondant : à attribuer'}</option>
        ${profils.map(p => `<option value="${esc(p.email)}" ${a.responsable === p.email ? 'selected' : ''}>${esc(prenomNom(p))}</option>`).join('')}
      </select>
      <button class="btn btn-petit" data-note="${esc(a.id)}">📝 ${a.note ? 'Modifier la note' : 'Note'}</button>
    </div>
  </article>`;
}

async function modifier(id, champs) {
  const a = store.get('appels_offres', id); if (!a) return;
  await store.enregistrer('appels_offres', { ...a, ...champs });
  if (champs.suivi) toast(`« ${SUIVIS[champs.suivi].libelle} » — enregistré pour toute l’équipe`, 'ok');
}

function editerNote(id) {
  const a = store.get('appels_offres', id); if (!a) return;
  const m = ouvrirModale(`<h3>Note sur l’appel d’offres</h3><p class="vide">${esc(a.titre)}</p>
    <textarea id="ao-note" rows="5" style="width:100%" placeholder="Visite obligatoire, pièces à fournir, métrés, partenaire…">${esc(a.note || '')}</textarea>
    <div class="boutons"><button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="ao-note-ok">Enregistrer</button></div>`);
  $('#ao-note', m).focus();
  $('#ao-note-ok', m).onclick = async () => { await modifier(id, { note: $('#ao-note', m).value.trim() || null }); fermerModale(); };
}
