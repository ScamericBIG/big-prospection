// Données : cache local IndexedDB (hors connexion) + synchronisation Supabase + file d'attente des modifications
import { CONFIG, MODE_DEMO } from './config.js';
import { SECTEURS_DEFAUT, DEPARTEMENTS_DEFAUT, deptDeCp, uuid } from './metier.js';

const TABLES = {
  sites:                { key: 'id' },
  groupes:              { key: 'id' },
  contacts:             { key: 'id' },
  activites:            { key: 'id' },
  profils:              { key: 'email', complet: true },
  secteurs:             { key: 'code', complet: true },
  secteur_departements: { key: 'departement', complet: true },
};

export const PROFILS_DEMO = [
  { email: 'enieps@big-france.com', prenom: 'Emeric', nom: 'NIEPS', secteur: 'nord', role: 'ca', actif: true },
  { email: 'zejjanhani@big-france.com', prenom: 'Zineb', nom: 'EJJANHANI', secteur: 'idf', role: 'ca', actif: true },
  { email: 'mguerreiro@big-france.com', prenom: 'Marie', nom: 'GUERREIRO', secteur: 'est', role: 'ca', actif: true },
  { email: 'mpineau@big-france.com', prenom: 'Mathis', nom: 'PINEAU', secteur: 'ouest', role: 'ca', actif: true },
  { email: 'cdragne@big-france.com', prenom: 'Christophe', nom: 'DRAGNE', secteur: 'national', role: 'directeur', actif: true },
];

// ---------------------------------------------------------------- IndexedDB minimaliste
function ouvrirIdb() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('big-prospection', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [t, c] of Object.entries(TABLES)) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: c.key });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'n', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
const req = r => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
const fin = tx => new Promise((ok, ko) => { tx.oncomplete = ok; tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error); });

class Store extends EventTarget {
  constructor() {
    super();
    this.db = null;
    this.sb = null;
    this.data = Object.fromEntries(Object.keys(TABLES).map(t => [t, new Map()]));
    this.profil = null;
    this.enLigne = navigator.onLine;
    this.enAttente = 0;
    this.erreursSync = [];
    this.derniereSync = null;
    this.syncEnCours = null;
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, e => fn(e.detail)); }

  // ---------------------------------------------------------- démarrage
  async ouvrir() {
    this.db = await ouvrirIdb();
    if (!MODE_DEMO && window.supabase) {
      this.sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    window.addEventListener('online', () => { this.enLigne = true; this.emit('reseau'); this.synchroniser(); });
    window.addEventListener('offline', () => { this.enLigne = false; this.emit('reseau'); });
  }

  async chargerCache() {
    for (const t of Object.keys(TABLES)) {
      const rows = await req(this.db.transaction(t).objectStore(t).getAll());
      const m = new Map(); for (const r of rows) m.set(r[TABLES[t].key], r);
      this.data[t] = m;
    }
    if (!this.data.secteurs.size) SECTEURS_DEFAUT.forEach(s => this.data.secteurs.set(s.code, s));
    if (!this.data.secteur_departements.size) Object.entries(DEPARTEMENTS_DEFAUT).forEach(([d, s]) => this.data.secteur_departements.set(d, { departement: d, secteur: s }));
    this.enAttente = await req(this.db.transaction('outbox').objectStore('outbox').count());
    this.derniereSync = await this.meta('derniereSync');
  }

  async meta(k, v) {
    if (v === undefined) return req(this.db.transaction('meta').objectStore('meta').get(k));
    const tx = this.db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(v, k); return fin(tx);
  }

  async ecrireIdb(table, rows) {
    const tx = this.db.transaction(table, 'readwrite'); const os = tx.objectStore(table);
    for (const r of rows) os.put(r);
    await fin(tx);
  }

  // ---------------------------------------------------------- authentification
  async sessionExistante() {
    if (MODE_DEMO) {
      const email = localStorage.getItem('big_demo_user');
      return email ? { email } : null;
    }
    // hors connexion : on se fie à la session mémorisée par Supabase
    try {
      const { data } = await this.sb.auth.getSession();
      if (data?.session?.user) return { email: data.session.user.email };
    } catch { /* réseau indisponible */ }
    const cle = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
    if (cle) { try { const s = JSON.parse(localStorage.getItem(cle)); const u = s?.user || s?.currentSession?.user; if (u?.email) return { email: u.email, horsLigne: true }; } catch { } }
    return null;
  }

  async connexion(email, mdp) {
    email = email.trim().toLowerCase();
    if (!email.endsWith('@' + CONFIG.DOMAINE_EMAIL)) throw new Error(`Utilisez votre adresse @${CONFIG.DOMAINE_EMAIL}`);
    if (MODE_DEMO) {
      if (!PROFILS_DEMO.some(p => p.email === email)) throw new Error('Compte inconnu (mode démo : utilisez l’un des 5 comptes de l’équipe)');
      if (mdp !== 'demo') throw new Error('Mot de passe incorrect (mode démo : « demo »)');
      localStorage.setItem('big_demo_user', email);
      return { email };
    }
    if (!navigator.onLine) throw new Error('Pas de connexion internet : la première connexion doit se faire en ligne.');
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password: mdp });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email ou mot de passe incorrect' : error.message);
    return { email: data.user.email };
  }

  async motDePasseOublie(email) {
    if (MODE_DEMO) throw new Error('Indisponible en mode démo');
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
  }
  async changerMotDePasse(mdp) {
    if (MODE_DEMO) throw new Error('Indisponible en mode démo');
    const { error } = await this.sb.auth.updateUser({ password: mdp });
    if (error) throw error;
  }
  surRecuperationMdp(fn) { this.sb?.auth.onAuthStateChange(evt => { if (evt === 'PASSWORD_RECOVERY') fn(); }); }

  async deconnexion() {
    if (MODE_DEMO) localStorage.removeItem('big_demo_user');
    else { try { await this.sb.auth.signOut(); } catch { } }
  }

  // Charge le cache puis identifie le profil de l'utilisateur connecté
  async demarrerSession(email) {
    await this.chargerCache();
    if (MODE_DEMO) await this.initDemo();
    if (this.enLigne && !MODE_DEMO) {
      try { await this.tirer(['profils', 'secteurs', 'secteur_departements']); } catch (e) { console.warn(e); }
    }
    this.profil = this.data.profils.get(email.toLowerCase()) || null;
    if (!this.profil) throw new Error('Votre compte n’est pas rattaché à un profil chargé d’affaires (table « profils »).');
    if (this.profil.actif === false) throw new Error('Compte désactivé');
    return this.profil;
  }

  async initDemo() {
    if (!this.data.profils.size) { await this.ecrireIdb('profils', PROFILS_DEMO); PROFILS_DEMO.forEach(p => this.data.profils.set(p.email, p)); }
    if (!(await this.meta('demoCharge'))) {
      const r = await fetch('data/demo-sites.json');
      const j = await r.json();
      for (const t of ['groupes', 'sites', 'contacts', 'activites']) {
        if (!j[t]) continue;
        await this.ecrireIdb(t, j[t]);
        j[t].forEach(x => this.data[t].set(x.id, x));
      }
      await this.meta('demoCharge', true);
    }
  }

  // ---------------------------------------------------------- lecture
  liste(table, inclureSupprimes = false) {
    const v = [...this.data[table].values()];
    return inclureSupprimes ? v : v.filter(x => !x.supprime);
  }
  get(table, id) { return this.data[table].get(id); }
  secteurDe(site) {
    const d = site.pays === 'BE' ? 'BE' : (site.departement || deptDeCp(site.code_postal));
    return this.data.secteur_departements.get(d)?.secteur || null;
  }

  // ---------------------------------------------------------- écriture (locale immédiate + file d'attente)
  async enregistrer(table, row) {
    const k = TABLES[table].key;
    if (!row[k]) row[k] = uuid();
    const now = new Date().toISOString();
    if (!row.created_at) row.created_at = now;
    row.updated_at = now;
    row.updated_by = this.profil?.email || null;
    if (table === 'sites') {
      if (row.pays === 'BE') row.departement = 'BE';
      else if (!row.departement && row.code_postal) row.departement = deptDeCp(row.code_postal);
      row.secteur = this.secteurDe(row);
    }
    this.data[table].set(row[k], row);
    const tx = this.db.transaction([table, 'outbox'], 'readwrite');
    tx.objectStore(table).put(row);
    if (!MODE_DEMO) tx.objectStore('outbox').put({ table, row: { ...row }, t: now });
    await fin(tx);
    if (!MODE_DEMO) { this.enAttente++; this.emit('sync'); }
    this.emit('change', { table, id: row[k] });
    if (!MODE_DEMO && this.enLigne) this.pousser().catch(() => { });
    return row;
  }
  async supprimer(table, id) {
    const r = this.get(table, id); if (!r) return;
    return this.enregistrer(table, { ...r, supprime: true });
  }

  async enregistrerLot(table, rows, progression) {
    for (let i = 0; i < rows.length; i += 500) {
      const lot = rows.slice(i, i + 500);
      const now = new Date().toISOString();
      const tx = this.db.transaction([table, 'outbox'], 'readwrite');
      for (const row of lot) {
        row.id = row.id || uuid(); row.created_at = row.created_at || now; row.updated_at = now; row.updated_by = this.profil?.email;
        if (table === 'sites') { if (!row.departement && row.code_postal) row.departement = deptDeCp(row.code_postal); row.secteur = this.secteurDe(row); }
        this.data[table].set(row.id, row);
        tx.objectStore(table).put(row);
        if (!MODE_DEMO) tx.objectStore('outbox').put({ table, row: { ...row }, t: now });
      }
      await fin(tx);
      if (!MODE_DEMO) this.enAttente += lot.length;
      progression?.(Math.min(rows.length, i + 500), rows.length);
    }
    this.emit('change', { table });
    this.emit('sync');
    if (!MODE_DEMO && this.enLigne) await this.pousser().catch(() => { });
  }

  // ---------------------------------------------------------- synchronisation
  async synchroniser() {
    if (MODE_DEMO || !this.enLigne || !this.profil) return;
    if (this.syncEnCours) return this.syncEnCours;
    this.syncEnCours = (async () => {
      this.emit('sync', { enCours: true });
      try {
        await this.pousser();
        await this.tirer(Object.keys(TABLES));
        this.derniereSync = new Date().toISOString();
        await this.meta('derniereSync', this.derniereSync);
      } catch (e) {
        console.warn('Synchronisation', e);
        if (!navigator.onLine) this.enLigne = false;
      } finally {
        this.syncEnCours = null;
        this.emit('sync', { enCours: false });
      }
    })();
    return this.syncEnCours;
  }

  async pousser() {
    if (MODE_DEMO || !this.sb) return;
    const items = await req(this.db.transaction('outbox').objectStore('outbox').getAll());
    if (!items.length) return;
    // regroupe par table, garde la dernière version de chaque ligne
    const parTable = {};
    for (const it of items) {
      const k = TABLES[it.table].key;
      (parTable[it.table] ||= new Map()).set(it.row[k], it);
    }
    const ordre = ['groupes', 'sites', 'contacts', 'activites'];
    const faits = [], erreurs = [];
    for (const t of ordre) {
      const m = parTable[t]; if (!m) continue;
      const lots = [...m.values()];
      for (let i = 0; i < lots.length; i += 200) {
        const part = lots.slice(i, i + 200);
        const rows = part.map(it => { const r = { ...it.row }; delete r.updated_at; for (const c of Object.keys(r)) if (c.startsWith('_')) delete r[c]; return r; });
        const { error } = await this.sb.from(t).upsert(rows, { onConflict: TABLES[t].key, defaultToNull: false });
        if (error) {
          if (/fetch|network/i.test(error.message)) throw error;
          erreurs.push({ table: t, message: error.message });
          // on retente ligne par ligne pour isoler la ligne fautive
          for (const it of part) {
            const r = { ...it.row }; delete r.updated_at;
            const { error: e2 } = await this.sb.from(t).upsert(r, { onConflict: TABLES[t].key, defaultToNull: false });
            if (!e2) faits.push(it);
            else erreurs.push({ table: t, id: r[TABLES[t].key], message: e2.message });
          }
        } else faits.push(...part);
      }
    }
    // retire de la file toutes les entrées traitées (y compris les doublons plus anciens)
    const okCles = new Set(faits.map(it => it.table + '|' + it.row[TABLES[it.table].key]));
    const tx = this.db.transaction('outbox', 'readwrite'); const os = tx.objectStore('outbox');
    for (const it of items) if (okCles.has(it.table + '|' + it.row[TABLES[it.table].key])) os.delete(it.n);
    await fin(tx);
    this.enAttente = await req(this.db.transaction('outbox').objectStore('outbox').count());
    this.erreursSync = erreurs;
    this.emit('sync');
  }

  async tirer(tables) {
    if (MODE_DEMO || !this.sb) return;
    const curseurs = (await this.meta('curseurs')) || {};
    for (const t of tables) {
      const c = TABLES[t];
      let from = 0, max = curseurs[t] || null, total = 0;
      const recu = [];
      for (; ;) {
        let q = this.sb.from(t).select('*');
        if (!c.complet) { if (curseurs[t]) q = q.gt('updated_at', curseurs[t]); q = q.order('updated_at').order(c.key); }
        const { data, error } = await q.range(from, from + 999);
        if (error) throw error;
        recu.push(...data); total += data.length;
        for (const r of data) if (r.updated_at && (!max || r.updated_at > max)) max = r.updated_at;
        if (data.length < 1000) break;
        from += 1000;
        if (t === 'sites') this.emit('progression', { table: t, n: total });
      }
      if (c.complet) {
        const tx = this.db.transaction(t, 'readwrite'); tx.objectStore(t).clear(); await fin(tx);
        this.data[t] = new Map();
      }
      if (recu.length) {
        // ne pas écraser une modification locale encore en attente d'envoi
        const attente = new Set((await req(this.db.transaction('outbox').objectStore('outbox').getAll())).filter(i => i.table === t).map(i => i.row[c.key]));
        const aEcrire = recu.filter(r => !attente.has(r[c.key]));
        await this.ecrireIdb(t, aEcrire);
        for (const r of aEcrire) this.data[t].set(r[c.key], r);
        this.emit('change', { table: t, distant: true });
      }
      if (!c.complet && max) curseurs[t] = max;
    }
    await this.meta('curseurs', curseurs);
  }

  async reinitialiserCache() {
    for (const t of [...Object.keys(TABLES), 'meta']) { const tx = this.db.transaction(t, 'readwrite'); tx.objectStore(t).clear(); await fin(tx); }
  }
}

export const store = new Store();
