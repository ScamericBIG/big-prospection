// Petits composants d'interface : toasts, modales, écran de chargement
import { esc } from './metier.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), type === 'erreur' ? 6000 : 3200);
}

let surFermeture = null;
export function ouvrirModale(html, { large = false, onClose } = {}) {
  const fond = $('#modale'), m = fond.firstElementChild;
  m.className = 'modale' + (large ? ' large' : '');
  m.innerHTML = html;
  fond.hidden = false;
  surFermeture = onClose || null;
  setTimeout(() => m.querySelector('input,select,textarea,button')?.focus(), 30);
  return m;
}
export function fermerModale() {
  $('#modale').hidden = true;
  const f = surFermeture; surFermeture = null; f?.();
}
document.addEventListener('click', e => {
  if (e.target.id === 'modale') fermerModale();
  if (e.target.closest('[data-fermer-modale]')) fermerModale();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modale').hidden) fermerModale(); });

export function confirmer(message, { ok = 'Confirmer', danger = false } = {}) {
  return new Promise(res => {
    const m = ouvrirModale(`<h3>Confirmation</h3><p>${esc(message)}</p>
      <div class="boutons"><button class="btn" data-r="0">Annuler</button><button class="btn ${danger ? 'btn-danger' : 'btn-primaire'}" data-r="1">${esc(ok)}</button></div>`,
      { onClose: () => res(false) });
    m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const v = b.dataset.r === '1'; $('#modale').hidden = true; surFermeture = null; res(v); });
  });
}

export function chargement(txt) {
  const c = $('#chargement');
  if (txt === false) { c.hidden = true; return; }
  c.hidden = false; $('#chargement-txt').textContent = txt || 'Chargement…';
}

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Lit les champs [name] d'un conteneur → objet (nombres et vides convertis)
export function lireForm(el) {
  const o = {};
  for (const f of el.querySelectorAll('[name]')) {
    let v = f.type === 'checkbox' ? f.checked : f.value.trim();
    if (f.type !== 'checkbox') {
      if (v === '') v = null;
      else if (f.type === 'number') v = Number(v);
      else if (f.type === 'datetime-local') v = new Date(v).toISOString();
    }
    o[f.name] = v;
  }
  return o;
}
export const versDatetimeLocal = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
