// Panneau de filtres (commun carte / liste)
import { store } from './store.js';
import { etat, FILTRES_VIDES, emettre, ecouter, sitesFiltres, infos, nomCA } from './etat.js';
import { CATEGORIES, STATUTS, fmtN, fmtM2court, esc } from './metier.js';
import { $, $$, debounce } from './ui.js';

const changer = () => { emettre('filtres'); majResultat(); };

export function initFiltres() {
  // catégories
  $('#f-categories').innerHTML = Object.entries(CATEGORIES).map(([k, c]) =>
    `<button class="puce" data-v="${k}"><span class="rond" style="background:${c.couleur}"></span>${esc(c.libelle)} <small data-n="${k}"></small></button>`).join('');
  $('#f-statuts').innerHTML = Object.entries(STATUTS).map(([k, s]) =>
    `<button class="puce" data-v="${k}"><span class="rond" style="background:${s.couleur}"></span>${esc(s.libelle)}</button>`).join('');

  const bascule = (conteneur, ens) => conteneur.addEventListener('click', e => {
    const b = e.target.closest('.puce[data-v]'); if (!b) return;
    const v = b.dataset.v;
    ens().has(v) ? ens().delete(v) : ens().add(v);
    b.classList.toggle('actif', ens().has(v));
    changer();
  });
  bascule($('#f-categories'), () => etat.filtres.categories);
  bascule($('#f-statuts'), () => etat.filtres.statuts);
  bascule($('#f-decennale'), () => etat.filtres.decennale);
  bascule($('#f-priorites'), () => etat.filtres.priorites);

  const txt = debounce(changer, 200);
  $('#f-texte').addEventListener('input', e => { etat.filtres.texte = e.target.value; txt(); });
  $('#f-cp').addEventListener('input', e => { etat.filtres.cp = e.target.value; txt(); });
  $('#f-ville').addEventListener('input', e => { etat.filtres.ville = e.target.value; txt(); });
  const num = (id, k) => $(id).addEventListener('change', e => { etat.filtres[k] = e.target.value ? Number(e.target.value) : null; changer(); });
  num('#f-surf-min', 'surfMin'); num('#f-surf-max', 'surfMax'); num('#f-annee-min', 'anneeMin'); num('#f-annee-max', 'anneeMax');
  $('#f-assigne').addEventListener('change', e => { etat.filtres.assigne = e.target.value; changer(); });
  $('#f-groupe').addEventListener('change', e => { etat.filtres.groupe = e.target.value; changer(); });
  $('#f-retard').addEventListener('click', e => { etat.filtres.retard = !etat.filtres.retard; e.currentTarget.classList.toggle('actif', etat.filtres.retard); changer(); });
  $('#f-semaine').addEventListener('click', e => { etat.filtres.semaine = !etat.filtres.semaine; e.currentTarget.classList.toggle('actif', etat.filtres.semaine); changer(); });

  $('#f-reset').addEventListener('click', () => {
    const masq = etat.filtres.categoriesMasquees;
    etat.filtres = FILTRES_VIDES(); etat.filtres.categoriesMasquees = masq;
    $$('#filtres input[type=search], #filtres input[type=text], #filtres input[type=number]').forEach(i => { if (i.id !== 'it-adresse') i.value = ''; });
    $$('#filtres select').forEach(s => s.value = '');
    $$('#filtres .puce.actif').forEach(p => p.classList.remove('actif'));
    changer();
  });

  $('#btn-menu-filtres').addEventListener('click', () => $('#filtres').classList.add('ouvert'));
  $('#f-fermer').addEventListener('click', () => $('#filtres').classList.remove('ouvert'));

  majListes();
  store.on('change', d => { if (['profils', 'groupes'].includes(d?.table)) majListes(); if (!d || d.table === 'sites') majResultat(); });
  ecouter('secteur', majResultat);
  ecouter('autour', majResultat);
}

export function majListes() {
  const a = $('#f-assigne'), va = a.value;
  a.innerHTML = '<option value="">Tous les chargés d\'affaires</option><option value="_aucun">Non assignés</option>' +
    store.liste('profils').filter(p => p.actif !== false).map(p => `<option value="${esc(p.email)}">${esc(nomCA(p.email))}</option>`).join('');
  a.value = va;
  const g = $('#f-groupe'), vg = g.value;
  g.innerHTML = '<option value="">Tous les groupes</option>' +
    store.liste('groupes').sort((x, y) => x.nom.localeCompare(y.nom)).map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join('');
  g.value = vg;
}

export function majResultat() {
  const l = sitesFiltres({ ignorerMasquees: true });
  let surf = 0; const parCat = {};
  for (const s of l) { const i = infos(s); surf += i.surface || 0; parCat[i.cat] = (parCat[i.cat] || 0) + 1; }
  $('#f-resultat').innerHTML = `<b>${fmtN(l.length)}</b> site${l.length > 1 ? 's' : ''} · ${fmtM2court(surf)}`;
  $$('#f-categories [data-n]').forEach(e => e.textContent = parCat[e.dataset.n] ? fmtN(parCat[e.dataset.n]) : '');
}
