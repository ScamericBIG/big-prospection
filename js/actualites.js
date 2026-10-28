// Onglet « Actualités » : presse et BODACC (incendies, défaillances, fermetures, ouvertures, rachats…) filtrés par secteur
import { store } from './store.js';
import { etat, ecouter, emettre } from './etat.js';
import { esc } from './metier.js';
import { $, $$, debounce, toast } from './ui.js';
import { secteursDeDepts, secteursDesGroupes, repondants, prenomNom, SECTIONS_ORDRE, ilYa, libDept, correspond, lienSur } from './veille-commun.js';

export const CATEGORIES_ACTU = {
  rachat:       { libelle: 'Rachat / fusion',        ico: '🤝', classe: 'rachat' },
  defaillance:  { libelle: 'Défaillance',            ico: '⚠️', classe: 'defaillance' },
  resultats:    { libelle: 'Santé financière',       ico: '📈', classe: 'resultats' },
  fermeture:    { libelle: 'Fermeture',              ico: '🚫', classe: 'fermeture' },
  travaux:      { libelle: 'Construction / travaux', ico: '🏗️', classe: 'travaux' },
  ouverture:    { libelle: 'Ouverture / implantation', ico: '📍', classe: 'ouverture' },
  demenagement: { libelle: 'Déménagement',           ico: '🚚', classe: 'demenagement' },
  incendie:     { libelle: 'Incendie',               ico: '🔥', classe: 'incendie' },
  autre:        { libelle: 'Autre',                  ico: '📰', classe: 'autre', cache: true },   // anciennes actualités hors thèmes
};
const PERIODES = { 7: '7 jours', 30: '30 jours', 90: '90 jours' };
const PAR_SECTION = 40;
let visible = false, cats = new Set(), periode = 30, nosComptes = false, voirMasques = false, texte = '', deplies = new Set(), vuAvant = null;
const cleVu = () => 'big_actu_vu_' + (store.profil?.email || '');

export function initActualites() {
  const rendreDiffere = debounce(() => visible && rendre(), 250);
  ecouter('vue', v => {
    const etaitVisible = visible; visible = v === 'actus';
    if (visible) { vuAvant = lireVu(); rendre(); ecrireVu(); majBadge(); }
    else if (etaitVisible) { ecrireVu(); majBadge(); }
  });
  ecouter('secteur', () => { majBadge(); if (visible) rendre(); });
  store.on('change', d => { if (!d || ['actualites', 'sites', 'groupes', 'secteur_departements'].includes(d.table)) { majBadgeDiffere(); rendreDiffere(); } });
  const majBadgeDiffere = debounce(majBadge, 500);
  majBadge();
}
function lireVu() { try { return localStorage.getItem(cleVu()) || null; } catch { return null; } }
function ecrireVu() { try { localStorage.setItem(cleVu(), new Date().toISOString()); } catch { } }

// secteurs concernés par une actualité : départements cités + secteurs des groupes et sites liés
function secteursActu(a, parGroupe) {
  const res = secteursDeDepts(a.departements); res.delete('hors');
  for (const g of a.groupes || []) for (const s of parGroupe.get(g) || []) res.add(s);
  for (const id of a.sites || []) { const s = store.get('sites', id); const sec = s && (s.secteur || store.secteurDe(s)); if (sec) res.add(sec); }
  res.delete('national');
  return res;
}
const date = a => a.date_publication || a.created_at || '';

function actusAvecSecteurs() {
  const parGroupe = secteursDesGroupes();
  return store.liste('actualites').map(a => ({ a, secteurs: secteursActu(a, parGroupe), liee: !!((a.groupes || []).length || (a.sites || []).length) }));
}
// Une actualité « nationale » : rien de localisé, ou un groupe présent dans 3 secteurs ou plus
const estNationale = x => x.secteurs.size === 0 || x.secteurs.size >= 3;
const concerne = (x, code) => code === 'national' || x.secteurs.has(code) || x.secteurs.size === 0;

function majBadge() {
  const b = document.querySelector('.onglets [data-vue=actus] .compteur'); if (!b) return;
  const vu = lireVu();
  const n = vu ? actusAvecSecteurs().filter(x => !x.a.masque && x.a.categorie !== 'autre' && (x.a.created_at || '') > vu && concerne(x, etat.secteur)).length : 0;
  b.textContent = n > 99 ? '99+' : n || ''; b.hidden = !n;
  b.title = `${n} nouvelle(s) actualité(s) depuis votre dernière visite`;
}

function rendre() {
  const el = $('#vue-actus');
  const code = etat.secteur;
  const limite = new Date(Date.now() - periode * 864e5).toISOString();
  const toutes = actusAvecSecteurs();
  const base = toutes.filter(x => concerne(x, code) && date(x.a) >= limite && (voirMasques || (!x.a.masque && !CATEGORIES_ACTU[x.a.categorie || 'autre']?.cache)) && (!nosComptes || x.liee));
  const nbCat = {}; for (const x of base) { const c = x.a.categorie || 'autre'; nbCat[c] = (nbCat[c] || 0) + 1; }
  const liste = base.filter(x => (!cats.size || cats.has(x.a.categorie || 'autre')) && correspond(`${x.a.titre} ${x.a.resume || ''} ${x.a.media || ''}`, texte))
    .sort((p, q) => date(q.a).localeCompare(date(p.a)));

  const sections = [];
  if (code === 'national') {
    for (const s of SECTIONS_ORDRE()) sections.push({ code: s.code, titre: `Secteur ${s.libelle}`, couleur: s.couleur, test: x => !estNationale(x) && x.secteurs.has(s.code) });
  } else {
    const s = store.get('secteurs', code);
    sections.push({ code, titre: `Secteur ${s?.libelle || code}`, couleur: s?.couleur || '#505EB6', test: x => x.secteurs.has(code) });
  }
  sections.push({ code: 'national', titre: code === 'national' ? 'National / plusieurs secteurs' : 'National / non localisé', couleur: '#3B4796', test: x => code === 'national' ? estNationale(x) : x.secteurs.size === 0 });

  let html = `
    <div class="rappels-outils veille-outils">
      <div><b>${liste.length} actualité${liste.length > 1 ? 's' : ''}</b> — ${code === 'national' ? 'tous secteurs' : 'secteur ' + esc(store.get('secteurs', code)?.libelle || code)}, ${PERIODES[periode]}</div>
      <div class="puces">
        ${Object.entries(CATEGORIES_ACTU).filter(([k, c]) => !c.cache || nbCat[k]).map(([k, c]) => `<button class="puce ${cats.has(k) ? 'actif' : ''}" data-cat="${k}">${c.ico} ${c.libelle} <small>${nbCat[k] || 0}</small></button>`).join('')}
      </div>
      <div class="puces">
        ${Object.entries(PERIODES).map(([k, v]) => `<button class="puce ${+k === periode ? 'actif' : ''}" data-per="${k}">${v}</button>`).join('')}
        <span class="separateur"></span>
        <button class="puce ${nosComptes ? 'actif' : ''}" data-nos title="Actualités qui citent un groupe ou un site de notre base">⭐ Nos groupes et sites</button>
        <button class="puce ${voirMasques ? 'actif' : ''}" data-masques>Afficher les masquées</button>
        <input type="search" class="recherche-veille" placeholder="Rechercher…" value="${esc(texte)}">
      </div>
    </div>
    <div class="veille-defile">
    <p class="veille-source">Sources : presse en ligne (Google Actualités) et BODACC (procédures collectives des sites suivis), collectées chaque matin. Les liens ouvrent l’article d’origine.</p>`;

  for (const sec of sections) {
    const l = liste.filter(sec.test);
    const reps = sec.code === 'national' ? [] : repondants(sec.code);
    const tout = deplies.has(sec.code);
    html += `<section class="veille-section">
      <h3 class="veille-titre" style="--c:${sec.couleur}"><span class="rond"></span>${esc(sec.titre)} <small>${l.length}</small>
        ${reps.length ? `<span class="repondant">👤 ${reps.map(p => esc(prenomNom(p))).join(', ')}</span>` : ''}</h3>
      ${l.length ? l.slice(0, tout ? l.length : PAR_SECTION).map(carte).join('') : '<p class="vide">Aucune actualité dans cette sélection.</p>'}
      ${l.length > PAR_SECTION && !tout ? `<button class="btn btn-petit plus" data-plus="${sec.code}">Afficher les ${l.length - PAR_SECTION} autres</button>` : ''}
    </section>`;
  }
  if (!store.data.actualites.size) html += `<div class="veille-vide"><b>Aucune actualité pour l’instant.</b><br>Elles sont collectées chaque matin par GitHub Actions (« Veille (appels d’offres et actualités) »). Lancez la collecte une première fois à la main après l’installation.</div>`;
  html += '</div>';
  el.innerHTML = html;

  $$('[data-cat]', el).forEach(b => b.onclick = () => { const k = b.dataset.cat; cats.has(k) ? cats.delete(k) : cats.add(k); rendre(); });
  $$('[data-per]', el).forEach(b => b.onclick = () => { periode = +b.dataset.per; rendre(); });
  $('[data-nos]', el).onclick = () => { nosComptes = !nosComptes; rendre(); };
  $('[data-masques]', el).onclick = () => { voirMasques = !voirMasques; rendre(); };
  $$('[data-plus]', el).forEach(b => b.onclick = () => { deplies.add(b.dataset.plus); rendre(); });
  const rech = $('.recherche-veille', el);
  rech.oninput = debounce(() => { texte = rech.value; rendre(); const r = $('.recherche-veille', el); r.focus(); r.setSelectionRange(r.value.length, r.value.length); }, 300);
  $$('[data-site]', el).forEach(b => b.onclick = () => emettre('ouvrir-site', b.dataset.site));
  $$('[data-groupe]', el).forEach(b => b.onclick = () => emettre('voir-groupe', b.dataset.groupe));
  $$('[data-masquer]', el).forEach(b => b.onclick = async () => {
    const a = store.get('actualites', b.dataset.masquer); if (!a) return;
    await store.enregistrer('actualites', { ...a, masque: !a.masque });
    toast(a.masque ? 'Actualité réaffichée' : 'Actualité masquée pour toute l’équipe', 'ok');
  });
}

function carte({ a, secteurs }) {
  const c = CATEGORIES_ACTU[a.categorie] || CATEGORIES_ACTU.autre;
  const url = lienSur(a.url);
  const nouveau = vuAvant && (a.created_at || '') > vuAvant;
  const groupes = (a.groupes || []).map(id => store.get('groupes', id)).filter(g => g && !g.supprime);
  const sites = (a.sites || []).map(id => store.get('sites', id)).filter(s => s && !s.supprime);
  const lieux = (a.departements || []).map(libDept);
  return `<article class="actu cat-${c.classe} ${a.masque ? 'masquee' : ''}">
    <div class="actu-ico" aria-hidden="true">${c.ico}</div>
    <div class="actu-corps">
      <div class="actu-meta"><span class="badge-cat">${c.libelle}</span>${a.source === 'bodacc' ? '<span class="badge-cat bodacc">BODACC</span>' : ''}
        ${nouveau ? '<span class="badge-nouveau">Nouveau</span>' : ''}
        <span>${esc(a.media || '')}</span> · <span title="${esc(new Date(date(a)).toLocaleString('fr-FR'))}">${ilYa(date(a))}</span>${lieux.length ? ' · 📍 ' + esc(lieux.slice(0, 3).join(', ')) : ''}</div>
      ${url ? `<a class="actu-titre" href="${esc(url)}" target="_blank" rel="noopener">${esc(a.titre)}</a>` : `<span class="actu-titre">${esc(a.titre)}</span>`}
      ${a.resume ? `<p class="actu-resume">${esc(a.resume.length > 280 ? a.resume.slice(0, 280) + '…' : a.resume)}</p>` : ''}
      ${groupes.length || sites.length ? `<div class="actu-liens">${groupes.map(g => `<button class="lien-puce" data-groupe="${g.id}" title="Voir le groupe">🏢 ${esc(g.nom)}${g.reference ? ' ✓' : ''}</button>`).join('')}${sites.slice(0, 6).map(s => `<button class="lien-puce" data-site="${s.id}" title="Ouvrir la fiche">📍 ${esc(s.nom)} — ${esc(s.ville || '')}</button>`).join('')}${sites.length > 6 ? `<small>+${sites.length - 6} sites</small>` : ''}</div>` : ''}
    </div>
    <button class="btn-icone actu-masquer" data-masquer="${esc(a.id)}" title="${a.masque ? 'Réafficher' : 'Masquer (hors sujet) pour toute l’équipe'}">${a.masque ? '↺' : '✕'}</button>
  </article>`;
}

// Actualités liées à un site ou à son groupe (affichées dans la fiche)
export function actusDuSite(s, limite = 3) {
  const res = store.liste('actualites').filter(a => !a.masque && a.categorie !== 'autre' && ((a.sites || []).includes(s.id) || (s.groupe_id && (a.groupes || []).includes(s.groupe_id))));
  return res.sort((p, q) => date(q).localeCompare(date(p))).slice(0, limite);
}
