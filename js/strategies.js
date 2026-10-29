// Onglet « Stratégie » : missions commerciales confiées par Christophe (ou créées par chacun pour soi)
import { store } from './store.js';
import { etat, ecouter, emettre, nomCA } from './etat.js';
import { CATEGORIES, STATUTS, ANNEE, esc, fmtN, fmtDate, fmtM2court, aujourdhui, uuid } from './metier.js';
import { $, $$, debounce, toast, ouvrirModale, fermerModale, confirmer } from './ui.js';
import { geocoder } from './tournee.js';
import { OBJECTIFS, MODELES, bilan, versFiltres, depuisFiltres, caActifs, peutModifier, estManager, mesStrategies, marquer } from './strategies-core.js';
import { infos } from './etat.js';

let visible = false, choixTactile = null;
const COLONNES = { brouillon: 'Brouillons', en_cours: 'En cours', terminee: 'Terminées' };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const prenom = e => store.get('profils', e)?.prenom || e;
const echeance = d => { if (!d) return ''; const j = Math.round((new Date(d + 'T12:00') - new Date(aujourdhui() + 'T12:00')) / 864e5); return j < 0 ? `<span class="ech depassee">échue depuis ${-j} j</span>` : `<span class="ech ${j <= 14 ? 'proche' : ''}">J-${j}</span>`; };

export function initStrategies() {
  const rendreDiffere = debounce(() => visible && rendre(), 300);
  ecouter('vue', v => { visible = v === 'strategie'; if (visible) rendre(); });
  store.on('change', d => { if (!d || ['strategies', 'strategie_sites', 'sites', 'contacts', 'activites', 'profils'].includes(d.table)) { rendreDiffere(); badgeDiffere(); } });
  const badgeDiffere = debounce(majBadge, 800);
  ecouter('nouvelle-strategie', crit => editer(null, crit));
  majBadge();
}

function majBadge() {
  const b = document.querySelector('.onglets [data-vue=strategie] .compteur'); if (!b) return;
  const moi = store.profil?.email;
  const n = mesStrategies().filter(st => { const p = bilan(st).parMembre.get(moi); return p && p.faits < p.total; }).length;
  b.textContent = n || ''; b.hidden = !n; b.title = `${n} mission(s) en cours`;
}

// ------------------------------------------------------------------ écran principal
function rendre() {
  const el = $('#vue-strategie'), moi = store.profil?.email, manager = estManager();
  const toutes = store.liste('strategies').sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999'));
  const mes = toutes.filter(st => st.statut === 'en_cours' && (st.membres || []).includes(moi));
  el.innerHTML = `
    <div class="strat-outils">
      <div><h2>🎯 Stratégie commerciale</h2><small>${manager ? 'Créez une stratégie, puis glissez les chargés d’affaires dessus. L’avancement se met à jour tout seul.' : 'Vos missions et celles de l’équipe. Créez aussi vos propres stratégies.'}</small></div>
      <button class="btn btn-primaire" id="st-nouvelle">+ Nouvelle stratégie</button>
    </div>
    ${manager ? `<div class="strat-equipe" id="st-equipe"><span>Équipe :</span>${caActifs().map(p => `<span class="pastille-ca ${choixTactile === p.email ? 'choisie' : ''}" draggable="true" data-ca="${esc(p.email)}" style="--c:${store.get('secteurs', p.secteur)?.couleur || '#505EB6'}" title="Glisser sur une stratégie (ou toucher puis toucher la stratégie)">${esc(p.prenom)}</span>`).join('')}
      ${choixTactile ? `<small class="aide-tactile">Touchez maintenant la stratégie à confier à ${esc(prenom(choixTactile))}</small>` : ''}</div>` : ''}
    <div class="strat-defile">
      <section class="strat-mes"><h3>Mes missions <small>${mes.length}</small></h3>
        ${mes.length ? `<div class="strat-grille">${mes.map(st => carteMission(st, moi)).join('')}</div>` : '<p class="vide">Aucune mission en cours pour vous. Créez votre propre stratégie avec « + Nouvelle stratégie ».</p>'}
      </section>
      <section><h3>Stratégies de l’équipe</h3>
        <div class="strat-tableau">${Object.entries(COLONNES).map(([k, lib]) => {
          const l = toutes.filter(st => st.statut === k);
          return `<div class="strat-col" data-col="${k}"><div class="strat-col-titre">${lib} <small>${l.length}</small></div>${l.map(carte).join('') || '<p class="vide">—</p>'}</div>`;
        }).join('')}</div>
      </section>
    </div>`;
  $('#st-nouvelle', el).onclick = () => editer(null);
  $$('[data-ouvrir]', el).forEach(b => b.onclick = e => { if (e.target.closest('button, a')) return; if (choixTactile) return confier(b.dataset.ouvrir, choixTactile); detail(b.dataset.ouvrir); });
  $$('[data-voir]', el).forEach(b => b.onclick = e => { e.stopPropagation(); voir(b.dataset.voir, b.dataset.vue || 'carte'); });
  $$('[data-retirer]', el).forEach(b => b.onclick = async e => { e.stopPropagation(); const [id, ca] = b.dataset.retirer.split('|'); const st = store.get('strategies', id); await store.enregistrer('strategies', { ...st, membres: st.membres.filter(x => x !== ca) }); });
  if (manager) brancherGlisser(el);
}

function barre(faits, total, cible) {
  const p = cible ? Math.min(100, pct(faits, cible)) : pct(faits, total);
  return `<div class="barre"><i style="width:${p}%"></i></div><small class="barre-txt">${cible ? `${faits} / ${cible} visés` : `${faits} / ${total} sites`} · ${p} %</small>`;
}
function carteMission(st, moi) {
  const b = bilan(st), p = b.parMembre.get(moi) || { total: 0, faits: 0 }, o = OBJECTIFS[st.objectif];
  return `<article class="strat-carte mission" data-ouvrir="${st.id}">
    <div class="sc-tete"><b>${esc(MODELES[st.modele]?.ico || '🎯')} ${esc(st.titre)}</b>${st.personnelle ? '<span class="badge">Perso</span>' : ''}${echeance(st.echeance)}</div>
    <div class="sc-meta">${esc(o?.libelle || '')}${st.consigne ? ` — <i>${esc(st.consigne.length > 120 ? st.consigne.slice(0, 120) + '…' : st.consigne)}</i>` : ''}</div>
    ${barre(p.faits, p.total, st.cible && (st.membres || []).length === 1 ? st.cible : null)}
    <div class="sc-actions"><button class="btn btn-primaire btn-petit" data-voir="moi:${st.id}">🗺 Mes ${fmtN(p.total - p.faits)} sites à traiter</button><button class="btn btn-petit" data-voir="moi:${st.id}" data-vue="liste">📋 Liste</button></div>
  </article>`;
}
function carte(st) {
  const b = bilan(st), o = OBJECTIFS[st.objectif], ed = peutModifier(st);
  const debut = st.debut || (st.created_at || '').slice(0, 10), vieux = st.statut === 'en_cours' && debut && (Date.now() - new Date(debut)) > 14 * 864e5;
  return `<article class="strat-carte" data-ouvrir="${st.id}" data-strat="${st.id}" ${estManager() ? 'draggable="true"' : ''}>
    <div class="sc-tete"><b>${esc(MODELES[st.modele]?.ico || '🎯')} ${esc(st.titre)}</b>${st.personnelle ? `<span class="badge" title="Créée par ${esc(nomCA(st.cree_par))}">Perso · ${esc(prenom(st.cree_par))}</span>` : ''}${echeance(st.echeance)}</div>
    <div class="sc-meta">${esc(o?.libelle || '')} · ${fmtN(b.total)} sites${b.sansObjet ? ` (+${b.sansObjet} sans objet)` : ''}</div>
    ${barre(b.faits, b.total, st.cible)}
    <div class="sc-membres">${(st.membres || []).map(e => { const p = b.parMembre.get(e) || { total: 0, faits: 0 }; const alerte = vieux && p.total && !p.faits;
      return `<span class="membre ${alerte ? 'alerte' : ''}" title="${alerte ? 'Aucun avancement depuis 14 jours' : ''}">${esc(prenom(e))} <b>${p.faits}/${p.total}</b>${alerte ? ' ⚠' : ''}${ed && estManager() ? `<button class="x" data-retirer="${st.id}|${esc(e)}" title="Retirer">×</button>` : ''}</span>`; }).join('') || '<span class="vide">Glissez un chargé d’affaires ici</span>'}
      ${b.nonAttribues ? `<span class="membre alerte" title="Sites sans chargé d’affaires (répartition manuelle)">${b.nonAttribues} non attribués</span>` : ''}</div>
  </article>`;
}

// glisser-déposer : pastille → stratégie (confier), carte → colonne (changer le statut)
function brancherGlisser(el) {
  $$('.pastille-ca', el).forEach(p => {
    p.ondragstart = e => { e.dataTransfer.setData('text/plain', 'ca:' + p.dataset.ca); e.dataTransfer.effectAllowed = 'copy'; };
    p.onclick = () => { choixTactile = choixTactile === p.dataset.ca ? null : p.dataset.ca; rendre(); };
  });
  $$('.strat-carte[data-strat]', el).forEach(c => {
    c.ondragstart = e => { if (e.target.closest('.pastille-ca')) return; e.dataTransfer.setData('text/plain', 'st:' + c.dataset.strat); };
    c.ondragover = e => { e.preventDefault(); c.classList.add('survol'); };
    c.ondragleave = () => c.classList.remove('survol');
    c.ondrop = e => { const v = e.dataTransfer.getData('text/plain'); c.classList.remove('survol'); if (v.startsWith('ca:')) { e.preventDefault(); e.stopPropagation(); confier(c.dataset.strat, v.slice(3)); } };
  });
  $$('.strat-col', el).forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('survol'); };
    col.ondragleave = () => col.classList.remove('survol');
    col.ondrop = async e => {
      col.classList.remove('survol');
      const v = e.dataTransfer.getData('text/plain'); if (!v.startsWith('st:')) return;
      const st = store.get('strategies', v.slice(3)); if (!st || st.statut === col.dataset.col) return;
      await store.enregistrer('strategies', { ...st, statut: col.dataset.col, debut: st.statut === 'brouillon' && col.dataset.col === 'en_cours' ? aujourdhui() : st.debut });
      toast(`« ${st.titre} » → ${COLONNES[col.dataset.col]}`, 'ok');
    };
  });
}
async function confier(id, ca) {
  choixTactile = null;
  const st = store.get('strategies', id); if (!st) return;
  if ((st.membres || []).includes(ca)) { rendre(); return toast(`${prenom(ca)} fait déjà partie de cette stratégie`); }
  await store.enregistrer('strategies', { ...st, membres: [...(st.membres || []), ca] });
  toast(`Stratégie confiée à ${prenom(ca)}`, 'ok');
}

// « Voir sur la carte / la liste » : applique le filtre Stratégie (sites à traiter)
export function voir(id, vue = 'carte', aFaire = true) {
  const st = store.get('strategies', id.replace(/^moi:/, ''));
  etat.filtres.strategie = id; etat.filtres.strategieAFaire = aFaire;
  emettre('filtres-externes'); emettre('filtres');
  emettre('aller-vue', vue);
  if (vue === 'carte') setTimeout(() => emettre('cadrer-filtres'), 150);
  toast(`Filtre « ${st?.titre || 'Stratégie'} » appliqué — sites ${aFaire ? 'à traiter' : 'de la stratégie'}`);
}

// ------------------------------------------------------------------ détail d'une stratégie
function detail(id) {
  const st = store.get('strategies', id); if (!st) return;
  const b = bilan(st), ed = peutModifier(st), o = OBJECTIFS[st.objectif], moi = store.profil?.email;
  const profils = (st.membres || []);
  const lignes = [...b.sites].sort((x, y) => (x.fait - y.fait) || (x.sansObjet - y.sansObjet) || (infos(y.s).score - infos(x.s).score));
  const m = ouvrirModale(`<h3>${esc(MODELES[st.modele]?.ico || '🎯')} ${esc(st.titre)} ${st.personnelle ? '<span class="badge">Perso</span>' : ''}</h3>
    <p class="vide">${esc(o?.libelle || '')} — un site est compté « fait » quand ${esc(o?.aide || '')}.${st.echeance ? ` Échéance : <b>${fmtDate(st.echeance)}</b>.` : ''}${st.cible ? ` Objectif : <b>${st.cible}</b>.` : ''} Créée par ${esc(nomCA(st.cree_par))}.</p>
    ${st.consigne ? `<p class="consigne">📌 ${esc(st.consigne)}</p>` : ''}
    ${barre(b.faits, b.total, st.cible)}
    <table class="table strat-membres"><thead><tr><th>Chargé d’affaires</th><th>Sites</th><th>Faits</th><th></th></tr></thead><tbody>
      ${profils.map(e => { const p = b.parMembre.get(e) || { total: 0, faits: 0 }; return `<tr><td>${esc(nomCA(e))}</td><td>${p.total}</td><td>${p.faits} (${pct(p.faits, p.total)} %)</td><td><div class="barre mini"><i style="width:${pct(p.faits, p.total)}%"></i></div></td></tr>`; }).join('')}
      ${b.nonAttribues ? `<tr><td><i>Non attribués</i></td><td>${b.nonAttribues}</td><td></td><td></td></tr>` : ''}
    </tbody></table>
    <div class="boutons gauche">
      <button class="btn btn-primaire" data-v="carte">🗺 ${(st.membres || []).includes(moi) ? 'Mes sites' : 'Sites'} à traiter sur la carte</button><button class="btn" data-v="tous">🗺 Tous les sites</button><button class="btn" data-v="liste">📋 Liste</button>
      ${ed ? `<button class="btn" id="sd-modifier">✏️ Modifier</button>${st.statut !== 'terminee' ? '<button class="btn" id="sd-terminer">✓ Terminer</button>' : '<button class="btn" id="sd-reactiver">↺ Réactiver</button>'}<button class="btn btn-danger" id="sd-supprimer">Supprimer</button>` : ''}
    </div>
    <h4 style="margin:14px 0 6px">Sites (${fmtN(b.sites.length)})</h4>
    <div class="table-defile" style="max-height:340px"><table class="table strat-sites"><thead><tr><th>Site</th><th>Ville</th><th>Statut</th><th>Attribué à</th><th>Avancement</th></tr></thead><tbody>
      ${lignes.slice(0, 300).map(x => `<tr data-site="${x.s.id}" class="${x.fait ? 'fait' : x.sansObjet ? 'sans-objet' : ''}">
        <td class="nom">${esc(x.s.nom)}</td><td>${esc(x.s.ville || '')}</td><td>${esc(STATUTS[x.s.statut]?.libelle || '')}</td>
        <td>${ed && profils.length > 1 ? `<select data-affecter="${x.s.id}">${profils.map(e => `<option value="${esc(e)}" ${x.resp === e ? 'selected' : ''}>${esc(prenom(e))}</option>`).join('')}${!x.resp ? '<option selected value="">—</option>' : ''}</select>` : esc(x.resp ? prenom(x.resp) : '—')}</td>
        <td>${x.sansObjet ? `Sans objet${x.raison ? ' — ' + esc(x.raison) : ''}` : x.fait ? `✓ ${esc(o?.fait || 'fait')}${x.manuel ? ' (manuel)' : ''}` : 'À traiter'}</td></tr>`).join('')}
    </tbody></table>${lignes.length > 300 ? `<p class="vide">… et ${lignes.length - 300} autres (voir la liste)</p>` : ''}</div>
    <div class="boutons"><button class="btn" data-fermer-modale>Fermer</button></div>`, { large: true });
  $$('[data-v]', m).forEach(x => x.onclick = () => { fermerModale(); voir((st.membres || []).includes(moi) && x.dataset.v === 'carte' ? 'moi:' + id : id, x.dataset.v === 'liste' ? 'liste' : 'carte', x.dataset.v === 'carte'); });
  $$('tr[data-site] td.nom', m).forEach(td => td.onclick = () => { fermerModale(); emettre('ouvrir-site', td.parentElement.dataset.site); });
  $$('[data-affecter]', m).forEach(s => s.onchange = () => marquer(st, s.dataset.affecter, { affecte_a: s.value || null }));
  $('#sd-modifier', m)?.addEventListener('click', () => { fermerModale(); editer(st); });
  $('#sd-terminer', m)?.addEventListener('click', async () => { await store.enregistrer('strategies', { ...st, statut: 'terminee' }); fermerModale(); toast('Stratégie terminée', 'ok'); });
  $('#sd-reactiver', m)?.addEventListener('click', async () => { await store.enregistrer('strategies', { ...st, statut: 'en_cours' }); fermerModale(); });
  $('#sd-supprimer', m)?.addEventListener('click', async () => {
    if (!(await confirmer(`Supprimer la stratégie « ${st.titre} » ? Les sites et leur historique ne sont pas touchés.`, { ok: 'Supprimer', danger: true }))) return;
    await store.enregistrer('strategies', { ...st, supprime: true });
    if (etat.filtres.strategie === st.id) { etat.filtres.strategie = ''; emettre('filtres-externes'); emettre('filtres'); }
    toast('Stratégie supprimée');
  });
}

// ------------------------------------------------------------------ création / modification
function editer(st, critDepart = null, enCours = null) {
  const manager = estManager(), moi = store.profil.email;
  const nouveau = !st;
  let s = st ? structuredClone(st) : { id: uuid(), titre: '', modele: critDepart ? 'perso' : 'decideurs_groupe', consigne: '', criteres: critDepart || { ...MODELES.decideurs_groupe.criteres }, objectif: critDepart ? 'qualifie' : 'decideur',
    cible: null, echeance: null, debut: aujourdhui(), statut: 'en_cours', membres: manager ? [] : [moi], repartition: 'secteur', personnelle: !manager, cree_par: moi, supprime: false };
  if (nouveau && !critDepart && !manager) { s.modele = 'perso'; s.criteres = { secteur: store.profil.secteur }; s.objectif = 'qualifie'; }
  let titreAuto = nouveau;
  if (enCours) { s = enCours.s; titreAuto = enCours.titreAuto; }
  const secteurs = store.liste('secteurs').sort((a, b) => a.ordre - b.ordre);
  const groupes = store.liste('groupes').sort((a, b) => a.nom.localeCompare(b.nom));
  const c = () => s.criteres;
  const m = ouvrirModale(`<h3>${nouveau ? 'Nouvelle stratégie' : 'Modifier la stratégie'}</h3>
    <div class="etape"><span>1</span> Modèle</div>
    <div class="modeles" id="se-modeles">${Object.entries(MODELES).map(([k, x]) => `<button class="modele ${s.modele === k ? 'actif' : ''}" data-m="${k}"><b>${x.ico} ${esc(x.libelle)}</b><small>${esc(x.desc)}</small></button>`).join('')}</div>
    <div class="etape"><span>2</span> Objectif et périmètre <small>(périmètre vivant : les nouveaux sites qui correspondent entrent automatiquement)</small></div>
    <div class="grille-form">
      <label class="large">Titre<input type="text" id="se-titre" value="${esc(s.titre)}" placeholder="ex. Décideurs FM Logistic"></label>
      <label>Objectif (un site est « fait » quand…)<select id="se-objectif">${Object.entries(OBJECTIFS).map(([k, o]) => `<option value="${k}" ${s.objectif === k ? 'selected' : ''}>${esc(o.libelle)}</option>`).join('')}</select></label>
      <label>Secteur<select id="se-secteur">${secteurs.map(x => `<option value="${x.code}" ${(c().secteur || 'national') === x.code ? 'selected' : ''}>${esc(x.libelle)}</option>`).join('')}</select></label>
      <label>Groupe<select id="se-groupe"><option value="">Tous</option>${groupes.map(g => `<option value="${g.id}" ${c().groupe === g.id ? 'selected' : ''}>${esc(g.nom)}${g.reference ? ' ✓' : ''}</option>`).join('')}</select></label>
      <label class="case"><input type="checkbox" id="se-reference" ${c().reference ? 'checked' : ''}> Seulement les groupes où BIG est référencé</label>
      <label>Codes postaux / départements<input type="text" id="se-cp" value="${esc(c().cp || '')}" placeholder="ex. 59, 62, 80"></label>
      <label>Ville<input type="text" id="se-ville" value="${esc(c().ville || '')}"></label>
      <label class="large">Autour d’une adresse<span class="ligne"><input type="text" id="se-adresse" value="${esc(c().autour?.libelle || '')}" placeholder="ex. Lyon Saint-Exupéry"><select id="se-rayon">${[5, 10, 20, 30, 50, 80].map(r => `<option ${(c().autour?.rayon || 30) === r ? 'selected' : ''} value="${r}">${r} km</option>`).join('')}</select><button class="btn btn-petit" id="se-geo">Chercher</button>${c().autour ? '<button class="btn btn-petit" id="se-geo-x">×</button>' : ''}</span></label>
      <label>Surface minimale (m²)<input type="number" id="se-surf" step="1000" value="${c().surfMin || ''}"></label>
      <label>Ancienneté minimale (ans)<input type="number" id="se-age" value="${c().anneeMax ? ANNEE - c().anneeMax : ''}"></label>
      <div class="large"><small>Types de site</small><div class="puces" id="se-cats">${Object.entries(CATEGORIES).map(([k, x]) => `<button class="puce ${(c().categories || []).includes(k) ? 'actif' : ''}" data-v="${k}"><span class="rond" style="background:${x.couleur}"></span>${esc(x.libelle)}</button>`).join('')}</div></div>
      <div class="large"><small>Statuts</small><div class="puces" id="se-statuts">${Object.entries(STATUTS).map(([k, x]) => `<button class="puce ${(c().statuts || []).includes(k) ? 'actif' : ''}" data-v="${k}"><span class="rond" style="background:${x.couleur}"></span>${esc(x.libelle)}</button>`).join('')}</div></div>
      <div class="large" id="se-special"></div>
      <div class="large"><button class="btn btn-petit" id="se-depuis-carte">↧ Reprendre les filtres actuels de la carte</button></div>
    </div>
    <div class="apercu-strat" id="se-apercu"></div>
    <div class="etape"><span>3</span> Équipe, échéance, consigne</div>
    <div class="grille-form">
      <div class="large"><small>${manager ? 'Chargés d’affaires (cliquer pour ajouter / retirer)' : 'Stratégie personnelle : elle vous est attribuée'}</small><div class="puces" id="se-membres">${caActifs().map(p => `<button class="puce ${s.membres.includes(p.email) ? 'actif' : ''}" data-v="${esc(p.email)}" ${!manager ? 'disabled' : ''}><span class="rond" style="background:${store.get('secteurs', p.secteur)?.couleur || '#505EB6'}"></span>${esc(p.prenom)} ${esc(p.nom)}</button>`).join('')}</div></div>
      <label>Répartition entre plusieurs chargés d’affaires<select id="se-repartition"><option value="secteur" ${s.repartition === 'secteur' ? 'selected' : ''}>Par secteur (chacun ses sites)</option><option value="equitable" ${s.repartition === 'equitable' ? 'selected' : ''}>Équitable (même nombre, par zone)</option><option value="manuel" ${s.repartition === 'manuel' ? 'selected' : ''}>Manuelle (dans le détail)</option></select></label>
      <label>Échéance<input type="date" id="se-echeance" value="${s.echeance || ''}"></label>
      <label>Cible chiffrée (facultatif)<input type="number" id="se-cible" min="1" value="${s.cible || ''}" placeholder="ex. 10 RDV"></label>
      <label>Statut<select id="se-statut"><option value="en_cours" ${s.statut === 'en_cours' ? 'selected' : ''}>En cours (visible par l’équipe concernée)</option><option value="brouillon" ${s.statut === 'brouillon' ? 'selected' : ''}>Brouillon</option></select></label>
      <label class="large">Consigne<textarea id="se-consigne" rows="2" placeholder="ex. Identifier le directeur de site et le responsable maintenance">${esc(s.consigne || '')}</textarea></label>
    </div>
    <p class="erreur" id="se-err"></p>
    <div class="boutons"><button class="btn" data-fermer-modale>Annuler</button><button class="btn btn-primaire" id="se-ok">${nouveau ? 'Créer la stratégie' : 'Enregistrer'}</button></div>`, { large: true });

  const champSpecial = () => {
    const sp = c().special || {};
    const champs = [['devisJours', 'Devis sans réponse depuis (jours)'], ['sansContactMois', 'Sans échange depuis (mois)'], ['chantierMois', 'Sans visite ni chantier depuis (mois)'], ['actualiteJours', 'Actualité de moins de (jours)']]
      .filter(([k]) => sp[k] != null);
    $('#se-special', m).innerHTML = champs.map(([k, l]) => `<label style="display:inline-block;margin-right:12px">${l}<input type="number" data-sp="${k}" value="${sp[k]}" style="width:90px"></label>`).join('')
      + (sp.nouvelOccupant != null ? `<label class="case"><input type="checkbox" data-spb="nouvelOccupant" ${sp.nouvelOccupant ? 'checked' : ''}> Inclure les sites ayant un nouvel occupant</label>` : '');
    $$('[data-sp]', m).forEach(i => i.oninput = () => { c().special[i.dataset.sp] = Number(i.value) || 0; apercu(); });
    $$('[data-spb]', m).forEach(i => i.onchange = () => { c().special[i.dataset.spb] = i.checked; apercu(); });
  };
  const apercu = debounce(() => {
    const b = bilan({ ...s, updated_at: 'apercu-' + Math.random() });
    let surf = 0; const villes = new Map();
    for (const o of b.sites) { surf += infos(o.s).surface || 0; if (o.s.ville) villes.set(o.s.ville, (villes.get(o.s.ville) || 0) + 1); }
    const top = [...villes].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, n]) => `${esc(v)} (${n})`).join(', ');
    $('#se-apercu', m).innerHTML = `→ <b>${fmtN(b.sites.length)} sites</b> · ${fmtM2court(surf)}${top ? ` · ${top}` : ''}${b.sites.length ? ` · <b>${b.faits}</b> déjà « faits »` : ''}`
      + (s.membres.length > 1 ? `<br><small>${s.membres.map(e => `${esc(prenom(e))} : ${b.parMembre.get(e)?.total || 0}`).join(' · ')}${b.nonAttribues ? ` · non attribués : ${b.nonAttribues}` : ''}</small>` : '');
    if (titreAuto) { const t = MODELES[s.modele]?.titre(c()); if (t) $('#se-titre', m).value = s.titre = t; }
  }, 200);
  const lire = () => {
    const cr = c();
    cr.secteur = $('#se-secteur', m).value; cr.groupe = $('#se-groupe', m).value || undefined; cr.reference = $('#se-reference', m).checked || undefined;
    cr.cp = $('#se-cp', m).value.trim() || undefined; cr.ville = $('#se-ville', m).value.trim() || undefined;
    cr.surfMin = Number($('#se-surf', m).value) || undefined; const age = Number($('#se-age', m).value); cr.anneeMax = age ? ANNEE - age : undefined;
    if (cr.autour) cr.autour.rayon = Number($('#se-rayon', m).value);
    s.objectif = $('#se-objectif', m).value;
    apercu();
  };
  $$('#se-modeles .modele', m).forEach(x => x.onclick = () => {
    const mod = MODELES[x.dataset.m];
    s.modele = x.dataset.m; s.objectif = mod.objectif;
    s.criteres = { secteur: manager ? (mod.criteres.secteur || c().secteur || 'national') : store.profil.secteur, ...structuredClone(mod.criteres) };
    if (!manager) s.criteres.secteur = mod.criteres.secteur === 'national' ? 'national' : store.profil.secteur;
    titreAuto = true; reconstruire();
  });
  const reconstruire = () => { s.consigne = $('#se-consigne', m).value; s.echeance = $('#se-echeance', m).value || null; s.cible = Number($('#se-cible', m).value) || null; s.repartition = $('#se-repartition', m).value; const sauve = s; fermerModale(); setTimeout(() => editer(st, null, { s: sauve, titreAuto }), 0); };
  ['#se-secteur', '#se-groupe', '#se-reference', '#se-objectif', '#se-rayon'].forEach(q => $(q, m).onchange = lire);
  ['#se-cp', '#se-ville', '#se-surf', '#se-age'].forEach(q => $(q, m).oninput = lire);
  $('#se-repartition', m).onchange = e => { s.repartition = e.target.value; apercu(); };
  $('#se-titre', m).oninput = e => { s.titre = e.target.value; titreAuto = false; };
  const puces = (q, cle) => $(q, m).addEventListener('click', e => { const b = e.target.closest('.puce'); if (!b) return; const l = new Set(c()[cle] || []); l.has(b.dataset.v) ? l.delete(b.dataset.v) : l.add(b.dataset.v); c()[cle] = [...l]; b.classList.toggle('actif'); apercu(); });
  puces('#se-cats', 'categories'); puces('#se-statuts', 'statuts');
  $('#se-membres', m).addEventListener('click', e => { const b = e.target.closest('.puce'); if (!b || !manager) return; const l = new Set(s.membres); l.has(b.dataset.v) ? l.delete(b.dataset.v) : l.add(b.dataset.v); s.membres = [...l]; b.classList.toggle('actif'); apercu(); });
  $('#se-geo', m).onclick = async () => {
    const q = $('#se-adresse', m).value; const r = (await geocoder(q))[0];
    if (!r) return $('#se-err', m).textContent = 'Adresse introuvable';
    $('#se-err', m).textContent = '';
    c().autour = { lat: r.lat, lng: r.lng, rayon: Number($('#se-rayon', m).value), libelle: r.libelle }; $('#se-adresse', m).value = r.libelle; apercu();
  };
  $('#se-geo-x', m)?.addEventListener('click', () => { delete c().autour; $('#se-adresse', m).value = ''; apercu(); });
  $('#se-depuis-carte', m).onclick = () => {
    s.criteres = { ...depuisFiltres(etat.filtres, etat.autour, etat.secteur), special: c().special };
    if (!s.criteres.special) delete s.criteres.special;
    reconstruire();
  };
  $('#se-ok', m).onclick = async () => {
    lire();
    s.titre = $('#se-titre', m).value.trim(); s.consigne = $('#se-consigne', m).value.trim() || null;
    s.echeance = $('#se-echeance', m).value || null; s.cible = Number($('#se-cible', m).value) || null;
    s.repartition = $('#se-repartition', m).value;
    const statut = $('#se-statut', m).value;
    if (statut === 'en_cours' && s.statut === 'brouillon' && !nouveau) s.debut = aujourdhui();
    s.statut = st?.statut === 'terminee' ? 'terminee' : statut;
    if (!s.titre) return $('#se-err', m).textContent = 'Donnez un titre à la stratégie.';
    for (const k of Object.keys(s.criteres)) if (s.criteres[k] === undefined || (Array.isArray(s.criteres[k]) && !s.criteres[k].length)) delete s.criteres[k];
    await store.enregistrer('strategies', s);
    fermerModale();
    toast(nouveau ? 'Stratégie créée' : 'Stratégie enregistrée', 'ok');
    if (nouveau && !manager) voir('moi:' + s.id, 'carte');
  };
  champSpecial(); apercu();
}
