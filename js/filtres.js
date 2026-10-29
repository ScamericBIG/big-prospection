// Panneau de filtres (commun carte / liste)
import { store } from './store.js';
import { etat, FILTRES_VIDES, emettre, ecouter, sitesFiltres, infos, nomCA } from './etat.js';
import { CATEGORIES, STATUTS, ETATS_ETAB, etatEtab, fmtN, fmtM2court, esc } from './metier.js';
import { $, $$, debounce } from './ui.js';
import { effacerItineraire } from './tournee.js';
import { mesStrategies } from './strategies-core.js';

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
  $('#f-etats').innerHTML = Object.entries(ETATS_ETAB).map(([k, e]) => `<button class="puce" data-v="${k}">${e.ico} ${esc(e.libelle)} <small data-ne="${k}"></small></button>`).join('');
  bascule($('#f-etats'), () => etat.filtres.etats);
  syncEtats();
  $('#f-strategie').addEventListener('change', e => { etat.filtres.strategie = e.target.value; if (e.target.value && !etat.filtres.strategieAFaire) { etat.filtres.strategieAFaire = true; } syncStrategie(); changer(); });
  $('#f-strategie-afaire').addEventListener('click', () => { etat.filtres.strategieAFaire = !etat.filtres.strategieAFaire; syncStrategie(); changer(); });
  ecouter('filtres-externes', () => { syncStrategie(); majResultat(); });
  $('#f-nom-identifie').addEventListener('click', e => { etat.filtres.nomIdentifie = !etat.filtres.nomIdentifie; e.currentTarget.classList.toggle('actif', etat.filtres.nomIdentifie); changer(); });
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
  $('#f-reference').addEventListener('click', e => { etat.filtres.reference = !etat.filtres.reference; e.currentTarget.classList.toggle('actif', etat.filtres.reference); changer(); });
  $('#f-semaine').addEventListener('click', e => { etat.filtres.semaine = !etat.filtres.semaine; e.currentTarget.classList.toggle('actif', etat.filtres.semaine); changer(); });

  $('#f-reset').addEventListener('click', () => {
    const masq = etat.filtres.categoriesMasquees;
    etat.filtres = FILTRES_VIDES(); etat.filtres.categoriesMasquees = masq;
    $$('#filtres input[type=search], #filtres input[type=text], #filtres input[type=number]').forEach(i => { if (i.id !== 'it-adresse') i.value = ''; });
    $$('#filtres select').forEach(s => s.value = '');
    $$('#filtres .puce.actif').forEach(p => p.classList.remove('actif'));
    syncEtats(); syncStrategie();
    if (etat.autour || etat.depart?.auto) effacerItineraire();
    changer();
  });

  $('#btn-menu-filtres').addEventListener('click', () => $('#filtres').classList.add('ouvert'));
  $('#f-fermer').addEventListener('click', () => $('#filtres').classList.remove('ouvert'));

  majListes();
  const majResultatDiffere = debounce(majResultat, 200);
  syncStrategie();
  store.on('change', d => {
    if (d?.table === 'strategies') syncStrategie();
    if (['profils', 'groupes'].includes(d?.table)) majListes();
    if (!d || ['sites', 'strategies', 'strategie_sites'].includes(d.table) || (etat.filtres.strategie && ['activites', 'contacts'].includes(d.table))) majResultatDiffere();
  });
  ecouter('secteur', majResultat);
  ecouter('autour', majResultat);
}

function syncStrategie() {
  const sel = $('#f-strategie'), moi = store.profil?.email;
  const toutes = store.liste('strategies').filter(x => x.statut !== 'brouillon').sort((a, b) => a.titre.localeCompare(b.titre));
  const mes = toutes.filter(x => x.statut === 'en_cours' && (x.membres || []).includes(moi)), autres = toutes.filter(x => !mes.includes(x));
  const opt = x => `<option value="${x.id}">${esc(x.titre)}${x.statut === 'terminee' ? ' (terminée)' : ''}</option>`;
  sel.innerHTML = '<option value="">Aucune (tous les sites)</option>' + (mes.length ? `<option value="_mes">⭐ Ma stratégie : tous mes sites en mission</option><optgroup label="Mes sites dans…">${mes.map(x => `<option value="moi:${x.id}">👤 ${esc(x.titre)} — mes sites</option>`).join('')}</optgroup><optgroup label="Toute l’équipe dans…">${mes.map(opt).join('')}</optgroup>` : '')
    + (autres.length ? `<optgroup label="Équipe">${autres.map(opt).join('')}</optgroup>` : '');
  if (etat.filtres.strategie && !sel.querySelector(`option[value="${etat.filtres.strategie}"]`)) etat.filtres.strategie = '';
  sel.value = etat.filtres.strategie;
  $('#f-strategie-afaire').hidden = !etat.filtres.strategie;
  $('#f-strategie-afaire').classList.toggle('actif', etat.filtres.strategieAFaire);
  $('#f-strategie-bloc').classList.toggle('actif', !!etat.filtres.strategie);
  $('#f-strategie-bloc').hidden = !toutes.length && !etat.filtres.strategie;
}
const syncEtats = () => $$('#f-etats .puce').forEach(b => b.classList.toggle('actif', etat.filtres.etats.has(b.dataset.v)));

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
  // nombre de sites par état, tous états confondus (les autres filtres restent appliqués)
  const f = etat.filtres, sauv = f.etats; f.etats = new Set();
  const parEtat = {}; for (const s of sitesFiltres({ ignorerMasquees: true })) { const k = etatEtab(s); parEtat[k] = (parEtat[k] || 0) + 1; }
  f.etats = sauv;
  $$('#f-etats [data-ne]').forEach(e => e.textContent = parEtat[e.dataset.ne] ? fmtN(parEtat[e.dataset.ne]) : '');
}
