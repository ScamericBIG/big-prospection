// Vue Performances : indicateurs, entonnoir, activité mensuelle, classements, alertes
import { store } from './store.js';
import { etat, infos, ecouter, emettre, nomCA, sitesDuSecteur } from './etat.js';
import { CATEGORIES, STATUTS, ENTONNOIR, fmtN, fmtEuro, fmtM2court, fmtDate, fmtDateHeure, esc, rappelEnRetard, aujourdhui, ANNEE } from './metier.js';
import { $, $$ } from './ui.js';

let annee = ANNEE, ca = '', visible = false;
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const SERIES = [{ k: 'appel', t: 'Appels', c: '#505EB6' }, { k: 'rdv', t: 'RDV & visites', c: '#EB6834' }, { k: 'devis', t: 'Devis', c: '#1BAF7A' }];

export function initPerfs() {
  ecouter('vue', v => { visible = v === 'perfs'; if (visible) rendre(); });
  ecouter('secteur', () => visible && rendre());
  store.on('change', d => { if (visible && ['sites', 'activites'].includes(d?.table)) rendre(); });
}

function rendre() {
  const el = $('#vue-perfs');
  const sites = sitesDuSecteur();
  const idsSecteur = new Set(sites.map(s => s.id));
  const toutesActs = store.liste('activites').filter(a => idsSecteur.has(a.site_id) && (!ca || a.auteur === ca));
  const acts = toutesActs.filter(a => a.statut !== 'annule' && a.date?.startsWith(String(annee)));
  const faits = acts.filter(a => a.statut === 'fait');
  const sitesCA = ca ? sites.filter(s => s.assigne_a === ca) : sites;
  const annees = [...new Set(store.liste('activites').map(a => +a.date?.slice(0, 4)).filter(Boolean)), ANNEE].sort().reverse();

  const nb = t => faits.filter(a => a.type === t).length;
  const devis = faits.filter(a => a.type === 'devis');
  const montantDevis = devis.reduce((t, a) => t + (Number(a.montant) || 0), 0);
  const nouveauxClients = new Set(acts.filter(a => a.type === 'statut' && /→ Client$/.test(a.contenu || '')).map(a => a.site_id)).size;
  const sitesTravailles = new Set(faits.map(a => a.site_id)).size;
  const qualifies = sitesCA.filter(s => s.statut !== 'a_qualifier').length;

  el.innerHTML = `
    <div class="perfs-filtres">
      <label>Année<select id="pf-annee">${annees.map(a => `<option ${a === annee ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <label>Chargé d'affaires<select id="pf-ca"><option value="">Toute l'équipe</option>${store.liste('profils').map(p => `<option value="${esc(p.email)}" ${ca === p.email ? 'selected' : ''}>${esc(p.prenom + ' ' + p.nom)}</option>`).join('')}</select></label>
      <p class="vide" style="margin:0 0 8px">Périmètre : secteur <b>${esc(store.get('secteurs', etat.secteur)?.libelle || etat.secteur)}</b> (changez-le dans le bandeau bleu).</p>
    </div>
    <div class="kpis">
      <div class="kpi"><span>Appels passés</span><b>${fmtN(nb('appel'))}</b><small>${annee}</small></div>
      <div class="kpi"><span>RDV & visites réalisés</span><b>${fmtN(nb('rdv') + nb('visite'))}</b><small>${acts.filter(a => ['rdv', 'visite'].includes(a.type) && a.statut === 'planifie').length} planifié(s)</small></div>
      <div class="kpi"><span>Devis envoyés</span><b>${fmtN(devis.length)}</b><small>${fmtEuro(montantDevis)}</small></div>
      <div class="kpi"><span>Nouveaux clients</span><b>${fmtN(nouveauxClients)}</b><small>${sitesCA.filter(s => s.statut === 'client').length} clients au total</small></div>
      <div class="kpi"><span>Sites travaillés</span><b>${fmtN(sitesTravailles)}</b><small>${fmtN(qualifies)} qualifiés / ${fmtN(sitesCA.length)}</small></div>
    </div>
    <div class="grille-perfs">
      <div class="panneau"><h3>Activité mensuelle ${annee}</h3>${graphMensuel(faits)}</div>
      <div class="panneau"><h3>Entonnoir commercial (sites${ca ? ' assignés' : ''} du secteur)</h3>${entonnoir(sitesCA)}</div>
      <div class="panneau"><h3>⚠ Alertes</h3>${alertes(sitesCA, toutesActs)}</div>
      <div class="panneau"><h3>Couverture par priorité</h3>${priorites(sitesCA)}</div>
      <div class="panneau"><h3>Classement des chargés d'affaires — ${annee}</h3>${classementCA(sites, idsSecteur)}</div>
      <div class="panneau"><h3>Par type de site</h3>${parCategorie(sitesCA)}</div>
      <div class="panneau" style="grid-column:1/-1"><h3>Par département</h3>${parDepartement(sitesCA, faits)}</div>
    </div>`;
  $('#pf-annee').onchange = e => { annee = +e.target.value; rendre(); };
  $('#pf-ca').onchange = e => { ca = e.target.value; rendre(); };
  $$('[data-site]', el).forEach(a => a.onclick = e => { e.preventDefault(); emettre('ouvrir-site', a.dataset.site); });
  brancherBulles(el);
}

function graphMensuel(faits) {
  const d = SERIES.map(s => MOIS.map((_, m) => faits.filter(a => (s.k === 'rdv' ? ['rdv', 'visite'].includes(a.type) : a.type === s.k) && +a.date.slice(5, 7) === m + 1).length));
  const max = Math.max(4, ...d.flat());
  const W = 640, H = 230, g = 34, b = 24, larg = (W - g - 8) / 12, bw = Math.min(14, (larg - 8) / 3);
  const y = v => H - b - (v / max) * (H - b - 12);
  const pas = Math.ceil(max / 4);
  let svg = `<div class="legende-graph">${SERIES.map(s => `<span><i style="background:${s.c}"></i>${s.t}</span>`).join('')}</div><svg class="graphique" viewBox="0 0 ${W} ${H}" role="img" aria-label="Activité mensuelle">`;
  for (let v = 0; v <= max; v += pas) svg += `<line x1="${g}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="#EEEFF2"/><text x="${g - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  MOIS.forEach((mo, m) => {
    const x0 = g + m * larg + (larg - bw * 3 - 4) / 2;
    SERIES.forEach((s, k) => {
      const v = d[k][m], x = x0 + k * (bw + 2), h = H - b - y(v);
      if (v > 0) svg += `<path d="M${x},${H - b} v${-(h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${h - 3} z" fill="${s.c}" data-bulle="${mo} — ${s.t} : ${v}"/>`;
    });
    svg += `<text x="${g + m * larg + larg / 2}" y="${H - 6}" text-anchor="middle">${mo}</text>`;
  });
  svg += `<line x1="${g}" x2="${W - 4}" y1="${H - b}" y2="${H - b}" stroke="#D7D8DB"/></svg>`;
  const tot = SERIES.map((s, k) => `${s.t} ${d[k].reduce((a, c) => a + c, 0)}`).join(' · ');
  return svg + `<p class="vide" style="margin:6px 0 0">Total ${tot}</p>`;
}

function barres(lignes, couleur = '#505EB6') {
  const max = Math.max(1, ...lignes.map(l => l.v));
  return lignes.map(l => `<div class="barre-h"><span>${l.t}</span><div class="piste"><div class="rempli" style="width:${(l.v / max) * 100}%;background:${l.c || couleur}" data-bulle="${esc(l.t.replace(/<[^>]+>/g, ''))} : ${fmtN(l.v)}"></div></div><span class="val">${l.lib ?? fmtN(l.v)}</span></div>`).join('');
}

function entonnoir(sites) {
  const n = k => sites.filter(s => s.statut === k).length;
  // cumul : un site au stade « devis » est aussi passé par prospect / contact / RDV
  const cumul = ENTONNOIR.map((k, i) => ({ k, v: ENTONNOIR.slice(i).reduce((t, x) => t + n(x), 0) }));
  const base = cumul[0].v || 1;
  return barres(cumul.map(c => ({ t: STATUTS[c.k].libelle, v: c.v, lib: `${fmtN(c.v)} · ${Math.round(c.v / base * 100)} %` })))
    + `<p class="vide" style="margin-top:8px">Hors entonnoir : ${fmtN(n('a_qualifier'))} à qualifier · ${fmtN(n('perdu'))} perdus · ${fmtN(n('non_pertinent'))} non pertinents</p>`;
}

function priorites(sites) {
  const t = ['A', 'B', 'C'].map(p => {
    const l = sites.filter(s => infos(s).prio === p), c = l.filter(s => s.statut !== 'a_qualifier').length;
    return { p, n: l.length, c, pct: l.length ? Math.round(c / l.length * 100) : 0 };
  });
  return `<table class="table"><thead><tr><th>Priorité</th><th class="num">Sites</th><th class="num">Qualifiés</th><th>Couverture</th></tr></thead><tbody>
    ${t.map(x => `<tr><td><span class="badge prio-${x.p}">${x.p}</span></td><td class="num">${fmtN(x.n)}</td><td class="num">${fmtN(x.c)}</td><td style="width:40%"><div class="barre-h" style="grid-template-columns:1fr 44px;margin:0"><div class="piste"><div class="rempli" style="width:${x.pct}%" data-bulle="Priorité ${x.p} : ${x.pct} % qualifiés"></div></div><span class="val">${x.pct} %</span></div></td></tr>`).join('')}
    </tbody></table><p class="vide" style="margin-top:8px">A ≥ 65 pts, B ≥ 45 pts (surface + ancienneté + activité).</p>`;
}

function classementCA(sites, idsSecteur) {
  const acts = store.liste('activites').filter(a => idsSecteur.has(a.site_id) && a.statut === 'fait' && a.date?.startsWith(String(annee)));
  const lignes = store.liste('profils').map(p => {
    const a = acts.filter(x => x.auteur === p.email);
    return {
      p, appels: a.filter(x => x.type === 'appel').length, rdv: a.filter(x => ['rdv', 'visite'].includes(x.type)).length,
      devis: a.filter(x => x.type === 'devis').length, montant: a.filter(x => x.type === 'devis').reduce((t, x) => t + (Number(x.montant) || 0), 0),
      clients: sites.filter(s => s.assigne_a === p.email && s.statut === 'client').length,
    };
  }).sort((a, b) => (b.rdv * 3 + b.devis * 5 + b.appels) - (a.rdv * 3 + a.devis * 5 + a.appels));
  return `<table class="table"><thead><tr><th>Chargé d'affaires</th><th class="num">Appels</th><th class="num">RDV</th><th class="num">Devis</th><th class="num">Montant devis</th><th class="num">Clients</th></tr></thead><tbody>
    ${lignes.map(l => `<tr><td>${esc(l.p.prenom + ' ' + l.p.nom)}</td><td class="num">${l.appels}</td><td class="num">${l.rdv}</td><td class="num">${l.devis}</td><td class="num">${fmtEuro(l.montant)}</td><td class="num">${l.clients}</td></tr>`).join('')}</tbody></table>`;
}

function parCategorie(sites) {
  return barres(Object.entries(CATEGORIES).map(([k, c]) => {
    const l = sites.filter(s => infos(s).cat === k);
    return { t: c.libelle, v: l.length, c: c.couleur, lib: `${fmtN(l.length)} · ${l.filter(s => s.statut === 'client').length} cl.` };
  }).filter(x => x.v));
}

function parDepartement(sites, faits) {
  const m = new Map();
  const actParSite = new Set(faits.map(a => a.site_id));
  for (const s of sites) {
    const d = s.departement || '?'; const x = m.get(d) || { d, n: 0, surf: 0, travailles: 0, clients: 0, ville: new Map() };
    x.n++; x.surf += infos(s).surface || 0; if (actParSite.has(s.id)) x.travailles++; if (s.statut === 'client') x.clients++;
    if (s.ville) x.ville.set(s.ville, (x.ville.get(s.ville) || 0) + 1);
    m.set(d, x);
  }
  const l = [...m.values()].sort((a, b) => b.n - a.n).slice(0, 20);
  return `<div class="table-defile"><table class="table"><thead><tr><th>Dépt.</th><th class="num">Sites</th><th class="num">Surface</th><th class="num">Travaillés ${annee}</th><th class="num">Clients</th><th>Principale ville</th></tr></thead><tbody>
    ${l.map(x => `<tr><td><b>${esc(x.d)}</b></td><td class="num">${fmtN(x.n)}</td><td class="num">${fmtM2court(x.surf)}</td><td class="num">${fmtN(x.travailles)}</td><td class="num">${fmtN(x.clients)}</td><td>${esc([...x.ville.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

function alertes(sites, acts) {
  const auj = aujourdhui();
  const retard = sites.filter(rappelEnRetard).sort((a, b) => a.date_prochain_rappel.localeCompare(b.date_prochain_rappel));
  const derniere = new Map();
  for (const a of acts) if (a.statut === 'fait' && (!derniere.has(a.site_id) || a.date > derniere.get(a.site_id))) derniere.set(a.site_id, a.date);
  const il6mois = new Date(Date.now() - 182 * 864e5).toISOString();
  const dormants = sites.filter(s => ['en_contact', 'rdv', 'devis'].includes(s.statut) && (derniere.get(s.id) || s.date_dernier_appel || '') < il6mois);
  const dans14 = new Date(Date.now() + 14 * 864e5).toISOString();
  const rdv = acts.filter(a => ['rdv', 'visite'].includes(a.type) && a.statut === 'planifie' && a.date >= new Date().toISOString() && a.date <= dans14).sort((a, b) => a.date.localeCompare(b.date));
  const lien = s => `<a href="#" data-site="${s.id}">${esc(s.nom)}</a> <small class="vide">${esc(s.ville || '')}</small>`;
  return `
    <b>📅 RDV des 14 prochains jours (${rdv.length})</b>
    <ul class="alertes">${rdv.slice(0, 8).map(a => { const s = store.get('sites', a.site_id); return s ? `<li>${fmtDateHeure(a.date)} — ${lien(s)} <small class="vide">(${esc(nomCA(a.auteur))})</small></li>` : ''; }).join('') || '<li class="vide">Aucun</li>'}</ul>
    <b style="display:block;margin-top:10px">⏰ Rappels en retard (${retard.length})</b>
    <ul class="alertes">${retard.slice(0, 8).map(s => `<li>${fmtDate(s.date_prochain_rappel)} — ${lien(s)}</li>`).join('') || '<li class="vide">Aucun 👍</li>'}${retard.length > 8 ? `<li class="vide">… et ${retard.length - 8} autres (filtre « Rappels en retard »)</li>` : ''}</ul>
    <b style="display:block;margin-top:10px">💤 En cours sans contact depuis 6 mois (${dormants.length})</b>
    <ul class="alertes">${dormants.slice(0, 6).map(s => `<li>${lien(s)}</li>`).join('') || '<li class="vide">Aucun</li>'}</ul>`;
}

function brancherBulles(el) {
  let b = document.querySelector('.bulle-graph');
  if (!b) { b = document.createElement('div'); b.className = 'bulle-graph'; b.hidden = true; document.body.appendChild(b); }
  el.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-bulle]');
    if (!t) { b.hidden = true; return; }
    b.textContent = t.dataset.bulle; b.hidden = false;
    b.style.left = e.clientX + 12 + 'px'; b.style.top = e.clientY - 30 + 'px';
  });
  el.addEventListener('mouseleave', () => b.hidden = true);
}
