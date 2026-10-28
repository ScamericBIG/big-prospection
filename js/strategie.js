// Stratégie commerciale de groupe : ce que les autres chargés d'affaires savent / ont fait chez le même groupe
import { store } from './store.js';
import { STATUTS, fmtDate, fmtEuro, esc, aujourdhui } from './metier.js';

const NIVEAU = { national: 'national', regional: 'régional', local: 'local' };
const RANG = { national: 0, regional: 1, local: 2 };
const EN_COURS = new Set(['prospect', 'en_contact', 'rdv', 'devis']);
const AVANCE = new Set(['rdv', 'devis', 'client']);

const qui = email => {
  if (!email) return 'Quelqu’un';
  if (email === store.profil?.email) return 'Vous';
  const p = store.get('profils', email);
  return p ? p.prenom : email.split('@')[0];
};
const nomContact = c => c ? [c.prenom, c.nom].filter(Boolean).join(' ') : '';
const lieu = s => `<b>${esc(s.nom)}</b>${s.ville ? ` (${esc(s.ville)})` : ''}`;

function phraseActivite(a, s) {
  const c = a.contact_id && store.get('contacts', a.contact_id);
  const avec = c ? ` avec ${esc(nomContact(c))}${c.fonction ? `, ${esc(c.fonction)}` : ''}` : '';
  const futur = a.statut === 'planifie' && a.date.slice(0, 10) >= aujourdhui();
  const d = fmtDate(a.date), w = qui(a.auteur), v = w === 'Vous';
  switch (a.type) {
    case 'rdv': return futur ? `${w} ${v ? 'avez' : 'a'} un RDV le ${d} sur ${lieu(s)}${avec}` : `${w} ${v ? 'avez' : 'a'} eu un RDV le ${d} sur ${lieu(s)}${avec}`;
    case 'visite': return futur ? `${w} ${v ? 'visiterez' : 'visitera'} ${lieu(s)} le ${d}${avec}` : `${w} ${v ? 'avez' : 'a'} visité ${lieu(s)} le ${d}${avec}`;
    case 'devis': return `${w} ${v ? 'avez' : 'a'} envoyé un devis${a.montant ? ` de ${fmtEuro(Number(a.montant))}` : ''} le ${d} pour ${lieu(s)}${avec}`;
    case 'chantier': return `${w} ${v ? 'avez' : 'a'} réalisé un chantier le ${d} sur ${lieu(s)}${avec}${a.montant ? ` (${fmtEuro(Number(a.montant))})` : ''}`;
    case 'statut': return `${w} ${v ? 'avez' : 'a'} passé ${lieu(s)} en « ${esc((a.contenu || '').split('→').pop().trim())} » le ${d}`;
    default: return null;
  }
}

// Bloc HTML. options : exclureSite (ne pas répéter le site ouvert), limite (nombre d'échanges affichés)
export function syntheseGroupe(gid, { exclureSite = null, limite = 8, lienGroupe = true } = {}) {
  const g = gid && store.get('groupes', gid);
  if (!g || g.supprime) return '';
  const sites = store.liste('sites').filter(s => s.groupe_id === gid);
  const ids = new Set(sites.map(s => s.id));

  // répartition des sites du groupe entre chargés d'affaires
  const parCA = new Map(); let libres = 0, clients = 0, encours = 0;
  for (const s of sites) {
    if (s.statut === 'client') clients++; else if (EN_COURS.has(s.statut)) encours++;
    if (!s.assigne_a) { libres++; continue; }
    const e = parCA.get(s.assigne_a) || { n: 0, clients: 0, encours: 0 };
    e.n++; if (s.statut === 'client') e.clients++; else if (EN_COURS.has(s.statut)) e.encours++;
    parCA.set(s.assigne_a, e);
  }

  // interlocuteurs clés : décisionnaires d'abord (national > régional > local), puis contacts suivis par un CA
  const contacts = store.liste('contacts').filter(c => (c.groupe_id === gid || ids.has(c.site_id)) && (c.decisionnaire || c.ca_big))
    .sort((a, b) => (a.decisionnaire ? RANG[a.niveau_decision] ?? 3 : 9) - (b.decisionnaire ? RANG[b.niveau_decision] ?? 3 : 9));
  const lignesContacts = contacts.slice(0, 6).map(c => {
    const s = c.site_id && store.get('sites', c.site_id);
    const avance = s && AVANCE.has(s.statut);
    const role = c.decisionnaire ? `décisionnaire ${NIVEAU[c.niveau_decision] || ''}`.trim() : '';
    return `<li><span class="qui">${esc(qui(c.ca_big))}</span> ${c.ca_big ? (qui(c.ca_big) === 'Vous' ? 'êtes' : 'est') + ` en contact${avance ? ' <b>avancé</b>' : ''} avec` : '— contact connu :'} <b>${esc(nomContact(c))}</b>${c.fonction ? `, ${esc(c.fonction)}` : ''}${role ? ` <span class="badge prio-A">${esc(role)}</span>` : ''}
      ${s ? `<span class="quand"> · ${esc(s.ville || s.nom)} — ${esc(STATUTS[s.statut]?.libelle || '')}</span>` : ''}</li>`;
  });

  // derniers échanges marquants sur les autres sites du groupe
  const echanges = store.liste('activites')
    .filter(a => ids.has(a.site_id) && a.site_id !== exclureSite && a.statut !== 'annule' &&
      (['rdv', 'visite', 'devis', 'chantier'].includes(a.type) || (a.type === 'statut' && /→\s*(Client|Devis|RDV)/.test(a.contenu || ''))))
    .sort((a, b) => b.date.localeCompare(a.date));
  const lignesEchanges = echanges.slice(0, limite).map(a => { const p = phraseActivite(a, store.get('sites', a.site_id)); return p ? `<li>${p}</li>` : ''; }).filter(Boolean);

  const repart = [...parCA.entries()].sort((a, b) => b[1].n - a[1].n).map(([e, x]) => {
    const det = [];
    if (x.clients) det.push(`${x.clients} client${x.clients > 1 ? 's' : ''}`);
    if (x.encours) det.push(`${x.encours} en cours`);
    return `<span class="qui">${esc(qui(e))}</span> ${x.n} site${x.n > 1 ? 's' : ''}${det.length ? ` (${det.join(', ')})` : ''}`;
  }).join(' · ');

  return `<div class="strategie">
    <h4><span>🤝 Stratégie groupe — ${esc(g.nom)}</span>${lienGroupe ? `<button class="lien" data-voir-groupe="${g.id}">voir le groupe</button>` : ''}</h4>
    <ul>
      <li>${g.reference ? `<b style="color:var(--vert)">✓ BIG est référencé chez ce groupe</b>${g.reference_note ? ` — ${esc(g.reference_note)}` : ''}` : 'BIG n’est pas (encore) référencé chez ce groupe'}</li>
      <li>${sites.length} site${sites.length > 1 ? 's' : ''} dans le groupe · ${clients} client${clients > 1 ? 's' : ''} · ${encours} en cours${libres ? ` · ${libres} non assigné${libres > 1 ? 's' : ''}` : ''}${repart ? `<br>${repart}` : ''}</li>
    </ul>
    ${lignesContacts.length ? `<div class="sous-titre">Interlocuteurs clés</div><ul>${lignesContacts.join('')}</ul>` : ''}
    ${lignesEchanges.length ? `<div class="sous-titre">Derniers échanges${exclureSite ? ' sur les autres sites' : ''}</div><ul>${lignesEchanges.join('')}</ul>${echanges.length > limite ? `<small class="vide">… ${echanges.length - limite} autres échanges</small>` : ''}`
      : `<div class="sous-titre">Derniers échanges</div><p class="vide" style="margin:2px 0">Aucun RDV, devis ou chantier enregistré${exclureSite ? ' sur les autres sites' : ''} de ce groupe.</p>`}
    ${g.notes ? `<div class="sous-titre">Notes du groupe</div><p style="margin:2px 0">${esc(g.notes)}</p>` : ''}
  </div>`;
}
