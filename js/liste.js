// Vue liste : tableau triable des sites filtrés + export CSV / Excel
import { store } from './store.js';
import { sitesFiltres, infos, ecouter, emettre, nomCA } from './etat.js';
import { CATEGORIES, STATUTS, decennale, surfaceEstimee, anneeEstimee, fmtN, fmtDate, esc, rappelEnRetard } from './metier.js';
import { $, $$, debounce, toast } from './ui.js';

const PAGE = 100;
let page = 0, tri = { col: 'score', sens: -1 }, visible = false;

const COLONNES = [
  { k: 'nom', t: 'Site', v: s => s.nom, cls: 'nom' },
  { k: 'ville', t: 'Ville', v: s => s.ville || '' },
  { k: 'cp', t: 'CP', v: s => s.code_postal || '' },
  { k: 'cat', t: 'Type', v: s => CATEGORIES[infos(s).cat].libelle, h: s => `<span class="badge"><span class="rond" style="background:${CATEGORIES[infos(s).cat].couleur}"></span>${esc(CATEGORIES[infos(s).cat].libelle)}</span>` },
  { k: 'surface', t: 'Surface (m²)', v: s => infos(s).surface ?? -1, h: s => (surfaceEstimee(s) ? '≈ ' : '') + fmtN(infos(s).surface), cls: 'num' },
  { k: 'annee', t: 'Année', v: s => infos(s).annee ?? 0, h: s => infos(s).annee ? (anneeEstimee(s) ? '≈ ' : '') + infos(s).annee : '—', cls: 'num' },
  { k: 'dec', t: 'Décennale', v: s => decennale(s).code, h: s => { const d = decennale(s); return d.code === 'inconnue' ? '—' : `<span class="badge ${d.classe}">${d.code === 'sous' ? 'Sous déc.' : 'Hors déc.'}</span>`; } },
  { k: 'score', t: 'Score', v: s => infos(s).score, h: s => `<span class="badge prio-${infos(s).prio}">${infos(s).prio} · ${infos(s).score}</span>` },
  { k: 'statut', t: 'Statut', v: s => STATUTS[s.statut]?.ordre ?? 0, h: s => `<span class="badge"><span class="rond" style="background:${STATUTS[s.statut]?.couleur}"></span>${esc(STATUTS[s.statut]?.libelle || '')}</span>` },
  { k: 'appel', t: 'Dernier appel', v: s => s.date_dernier_appel || '', h: s => fmtDate(s.date_dernier_appel) },
  { k: 'rappel', t: 'Prochain rappel', v: s => s.date_prochain_rappel || '9999', h: s => s.date_prochain_rappel ? `<span class="${rappelEnRetard(s) ? 'badge alerte' : ''}">${fmtDate(s.date_prochain_rappel)}</span>` : '—' },
  { k: 'ca', t: 'Chargé d\'affaires', v: s => s.assigne_a ? nomCA(s.assigne_a) : '', h: s => esc(s.assigne_a ? nomCA(s.assigne_a) : '—') },
];

export function initListe() {
  const re = debounce(() => { page = 0; if (visible) rendre(); }, 80);
  ecouter('filtres', re); ecouter('secteur', re); ecouter('autour', re);
  const rendreDiffere = debounce(() => visible && rendre(), 250);
  store.on('change', d => { if (visible && (!d || d.table === 'sites')) rendreDiffere(); });
  ecouter('vue', v => { visible = v === 'liste'; if (visible) rendre(); });
  $('#liste-csv').onclick = () => exporter('csv');
  $('#liste-xlsx').onclick = () => exporter('xlsx');
}

// Tri « décoré » : la clé de tri est calculée une seule fois par site ; résultat mémorisé tant que rien ne change
let memoTri = { l: null, col: null, sens: 0, res: null };
function trier(l) {
  if (memoTri.l === l && memoTri.col === tri.col && memoTri.sens === tri.sens) return memoTri.res;
  const c = COLONNES.find(x => x.k === tri.col);
  const d = l.map(s => [c.v(s), s]);
  d.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * tri.sens);
  const res = d.map(x => x[1]);
  memoTri = { l, col: tri.col, sens: tri.sens, res };
  return res;
}

function rendre() {
  const l = trier(sitesFiltres());
  const nbPages = Math.max(1, Math.ceil(l.length / PAGE));
  page = Math.min(page, nbPages - 1);
  $('#liste-compte').innerHTML = `<b>${fmtN(l.length)}</b> sites`;
  const t = $('#liste-table');
  t.innerHTML = `<thead><tr>${COLONNES.map(c => `<th data-k="${c.k}" class="${tri.col === c.k ? (tri.sens > 0 ? 'tri-asc' : 'tri-desc') : ''} ${c.cls === 'num' ? 'num' : ''}">${c.t}</th>`).join('')}</tr></thead>
    <tbody>${l.slice(page * PAGE, (page + 1) * PAGE).map(s => `<tr data-id="${s.id}">${COLONNES.map(c => `<td class="${c.cls || ''}">${c.h ? c.h(s) : esc(c.v(s))}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $$('th', t).forEach(th => th.onclick = () => { const k = th.dataset.k; tri = { col: k, sens: tri.col === k ? -tri.sens : (['nom', 'ville', 'cp', 'rappel'].includes(k) ? 1 : -1) }; rendre(); });
  $$('tbody tr', t).forEach(tr => tr.onclick = () => emettre('ouvrir-site', tr.dataset.id));
  $('#liste-pagination').innerHTML = nbPages > 1 ? `<button class="btn btn-petit" id="lp-prec" ${page ? '' : 'disabled'}>‹ Précédent</button> Page ${page + 1} / ${nbPages} <button class="btn btn-petit" id="lp-suiv" ${page < nbPages - 1 ? '' : 'disabled'}>Suivant ›</button>` : '';
  $('#lp-prec')?.addEventListener('click', () => { page--; rendre(); $('.table-defile').scrollTop = 0; });
  $('#lp-suiv')?.addEventListener('click', () => { page++; rendre(); $('.table-defile').scrollTop = 0; });
}

function lignesExport() {
  return trier(sitesFiltres()).map(s => {
    const i = infos(s), g = s.groupe_id && store.get('groupes', s.groupe_id);
    return {
      'Nom': s.nom, 'Raison sociale': s.enseigne || '', 'Groupe': g?.nom || '', 'Adresse': s.adresse || '', 'Code postal': s.code_postal || '', 'Ville': s.ville || '', 'Pays': s.pays,
      'Type': CATEGORIES[i.cat].libelle, 'Surface m²': i.surface ?? '', 'Surface estimée': surfaceEstimee(s) ? 'oui' : '', 'Année construction': i.annee ?? '', 'Année estimée': anneeEstimee(s) ? 'oui' : '', 'Décennale': decennale(s).libelle,
      'Score': i.score, 'Priorité': i.prio, 'Statut': STATUTS[s.statut]?.libelle || '', 'Standard': s.standard_tel || '',
      'Dernier appel': s.date_dernier_appel || '', 'Prochain rappel': s.date_prochain_rappel || '', 'RDV': s.date_rdv ? new Date(s.date_rdv).toLocaleString('fr-FR') : '',
      "Chargé d'affaires": s.assigne_a ? nomCA(s.assigne_a) : '', 'Commentaire': s.commentaire || '', 'SIRET': s.siret || s.siren || '', 'NAF': s.naf || '',
      'Latitude': s.lat ?? '', 'Longitude': s.lng ?? '',
    };
  });
}

async function exporter(format) {
  const rows = lignesExport();
  if (!rows.length) return toast('Aucun site à exporter', 'erreur');
  const nom = `prospection-big-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'csv') {
    const cols = Object.keys(rows[0]);
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.map(q).join(';'), ...rows.map(r => cols.map(c => q(r[c])).join(';'))].join('\r\n');
    telecharger(new Blob([csv], { type: 'text/csv;charset=utf-8' }), nom + '.csv');
  } else {
    if (!window.XLSX) await chargerScript('vendor/xlsx.full.min.js');
    const ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
    ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Sites');
    XLSX.writeFile(wb, nom + '.xlsx');
  }
}
export function telecharger(blob, nom) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function chargerScript(src) {
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
}
