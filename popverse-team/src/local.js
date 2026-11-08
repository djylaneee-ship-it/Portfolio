// Moteur « démo » : même interface que le moteur Supabase, mais tout reste dans ce navigateur
// (localStorage). Les onglets ouverts se synchronisent entre eux (BroadcastChannel), ce qui permet
// d'essayer le chat ou les tâches « en temps réel » sans base en ligne.
const KEY = 'pt.demo.v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export function createLocal() {
  let db = load();
  const subs = new Set();
  const authListeners = new Set();
  let bc = null;
  try { bc = new BroadcastChannel('pt-demo'); } catch {}
  const presenceSubs = new Map();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('Démo : stockage plein', e); }
  }
  const rows = t => (db[t] ||= []);
  const me = () => (db.session ? rows('pt_profiles').find(p => p.id === db.session) || null : null);

  function emit(table, type, row, old, remote) {
    subs.forEach(s => {
      if (s.table !== table) return;
      const r = row || old;
      if (s.col && r && String(r[s.col]) !== String(s.val)) return;
      try { s.cb({ type, row, old }); } catch (e) { console.error(e); }
    });
    if (!remote && bc) bc.postMessage({ kind: 'db', table, type, row, old });
  }
  if (bc) bc.onmessage = ({ data }) => {
    if (data.kind === 'db') { db = load(); emit(data.table, data.type, data.row, data.old, true); }
    if (data.kind === 'presence') presenceSubs.get(data.name)?.forEach(p => p.remote(data));
  };

  const matches = (r, opt) => {
    for (const [k, v] of Object.entries(opt.eq || {})) if ((r[k] ?? null) !== v && String(r[k]) !== String(v)) return false;
    for (const [k, v] of Object.entries(opt.in || {})) if (!v.map(String).includes(String(r[k]))) return false;
    for (const [k, v] of Object.entries(opt.gte || {})) if (!(r[k] >= v)) return false;
    for (const [k, v] of Object.entries(opt.lte || {})) if (!(r[k] <= v)) return false;
    for (const [k, v] of Object.entries(opt.contains || {})) if (!v.every(x => (r[k] || []).includes(x))) return false;
    for (const [k, v] of Object.entries(opt.ilike || {})) {
      const re = new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
      if (!re.test(r[k] || '')) return false;
    }
    return true;
  };
  const clone = x => JSON.parse(JSON.stringify(x));

  function seed() {
    if (db.seeded) return;
    db.seeded = true;
    rows('pt_settings').push({ id: 'invite_code', key: 'invite_code', value: 'POPVERSE-DEMO' });
    rows('pt_channels').push({ id: uid(), project_id: null, name: 'général', topic: 'Discussion de toute l\'équipe', kind: 'text', position: 0, created_at: new Date().toISOString() });
    rows('pt_channels').push({ id: uid(), project_id: null, name: 'annonces', topic: 'Les infos importantes du studio', kind: 'text', position: 1, created_at: new Date().toISOString() });
    save();
  }
  seed();

  const api = {
    mode: 'demo',
    get me() { return me(); },
    async init() { return me(); },
    onAuth(cb) { authListeners.add(cb); return () => authListeners.delete(cb); },
    async signIn(email, password) {
      const acc = (db.accounts || []).find(a => a.email.toLowerCase() === email.toLowerCase().trim());
      if (!acc || acc.password !== password) throw new Error('E-mail ou mot de passe incorrect.');
      db.session = acc.id; save();
      authListeners.forEach(cb => cb(me()));
      return me();
    },
    async signUp({ email, password, username, code }) {
      db.accounts ||= [];
      email = email.trim();
      if (db.accounts.some(a => a.email.toLowerCase() === email.toLowerCase())) throw new Error('Cet e-mail a déjà un compte.');
      if (password.length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères.');
      const first = rows('pt_profiles').length === 0;
      const invite = rows('pt_settings').find(s => s.key === 'invite_code')?.value;
      if (!first && code.trim().toUpperCase() !== String(invite).toUpperCase()) throw new Error('Code d\'équipe invalide.');
      const id = uid();
      db.accounts.push({ id, email, password });
      const colors = ['#F5B935', '#E8833A', '#E25D6A', '#B676F0', '#4FA3F7', '#3CC9A0', '#9CCB4A'];
      rows('pt_profiles').push({
        id, username, display_name: username, role: first ? 'owner' : 'member', title: first ? 'Fondateur' : 'Développeur',
        color: colors[rows('pt_profiles').length % colors.length], avatar_url: null, bio: '', created_at: new Date().toISOString(), last_seen: new Date().toISOString(),
      });
      db.session = id; save();
      authListeners.forEach(cb => cb(me()));
      return { me: me() };
    },
    async resetPassword() { throw new Error('En mode démo, il n\'y a pas d\'e-mail : recrée un compte.'); },
    onRecovery() {},
    async updatePassword() {},
    async signOut() { db.session = null; save(); authListeners.forEach(cb => cb(null)); },
    async refreshMe() { db = load(); return me(); },

    async select(table, opt = {}) {
      db = load();
      let out = rows(table).filter(r => matches(r, opt));
      for (const o of [].concat(opt.order || []).reverse()) {
        if (!o) continue;
        const [col, dir] = Array.isArray(o) ? o : [o, 'asc'];
        out = out.slice().sort((a, b) => {
          const x = a[col] ?? '', y = b[col] ?? '';
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          return dir === 'desc' ? -c : c;
        });
      }
      if (opt.limit) out = out.slice(0, opt.limit);
      return clone(out);
    },
    async get(table, id) { db = load(); const r = rows(table).find(r => r.id === id); return r ? clone(r) : null; },
    async insert(table, input) {
      db = load();
      const list = [].concat(input).map(r => ({ id: uid(), created_at: new Date().toISOString(), ...r }));
      rows(table).push(...list); save();
      list.forEach(r => emit(table, 'INSERT', clone(r), null));
      return Array.isArray(input) ? clone(list) : clone(list[0]);
    },
    async update(table, id, patch) {
      db = load();
      const r = rows(table).find(r => r.id === id);
      if (!r) return null;
      const old = clone(r);
      Object.assign(r, patch, 'updated_at' in r || table !== 'pt_settings' ? { updated_at: new Date().toISOString() } : {});
      save(); emit(table, 'UPDATE', clone(r), old);
      return clone(r);
    },
    async updateWhere(table, eq, patch) {
      const list = await api.select(table, { eq });
      return Promise.all(list.map(r => api.update(table, r.id, patch)));
    },
    async remove(table, id) {
      db = load();
      const i = rows(table).findIndex(r => r.id === id);
      if (i < 0) return;
      const [old] = rows(table).splice(i, 1); save();
      emit(table, 'DELETE', null, old);
    },
    async removeWhere(table, eq) {
      const list = await api.select(table, { eq });
      for (const r of list) await api.remove(table, r.id);
    },
    async rpc(name, args) {
      if (name === 'pt_invite_code') return rows('pt_settings').find(s => s.key === 'invite_code')?.value;
      if (name === 'pt_set_invite_code') {
        const s = rows('pt_settings').find(s => s.key === 'invite_code');
        s.value = args.code; save(); return args.code;
      }
      throw new Error('Fonction indisponible en mode démo : ' + name);
    },
    subscribe(table, filter, cb) {
      const [col, val] = Object.entries(filter || {})[0] || [];
      const s = { table, col, val, cb };
      subs.add(s);
      return () => subs.delete(s);
    },
    presence(name, meta, cb) {
      const others = new Map();
      const self = { id: me()?.id || uid() };
      let current = { ...meta };
      const push = () => cb([current, ...others.values()]);
      const entry = {
        remote(data) {
          if (data.from === self.id) return;
          if (data.event === 'track') { others.set(data.from, data.meta); push(); }
          if (data.event === 'leave') { others.delete(data.from); push(); }
          if (data.event === 'ping') cb(null, data.payload);
          if (data.event === 'hello') bc?.postMessage({ kind: 'presence', name, from: self.id, event: 'track', meta: current });
        },
      };
      if (!presenceSubs.has(name)) presenceSubs.set(name, new Set());
      presenceSubs.get(name).add(entry);
      bc?.postMessage({ kind: 'presence', name, from: self.id, event: 'track', meta: current });
      bc?.postMessage({ kind: 'presence', name, from: self.id, event: 'hello' });
      setTimeout(push, 0);
      return {
        update(m) { current = { ...m }; bc?.postMessage({ kind: 'presence', name, from: self.id, event: 'track', meta: current }); push(); },
        send(payload) { bc?.postMessage({ kind: 'presence', name, from: self.id, event: 'ping', payload }); },
        close() { presenceSubs.get(name)?.delete(entry); bc?.postMessage({ kind: 'presence', name, from: self.id, event: 'leave' }); },
      };
    },
    async upload(file) {
      if (file.size > 3 * 1024 * 1024) throw new Error('Mode démo : fichier limité à 3 Mo (pas de stockage en ligne).');
      return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result); fr.onerror = rej;
        fr.readAsDataURL(file);
      });
    },
    async fn(name, body) {
      if (name === 'pt-ai') {
        await new Promise(r => setTimeout(r, 600));
        return {
          reply: '**Mode démo** : l\'assistant IA a besoin de la base en ligne (fonction `pt-ai`). Une fois Supabase branché, je connaîtrai ton jeu par cœur (lore, tâches, tableaux, progrès) et je pourrai créer des tâches pour toi.\n\nExemple de ce que je proposerai :',
          actions: body?.mode === 'chat' ? [{ type: 'create_tasks', tasks: [
            { title: 'Écrire le script de la boutique', description: 'Interface + achats de Robux (MarketplaceService).', priority: 'high', labels: ['Script'] },
            { title: 'Modéliser le lobby', description: 'Zone de spawn, portails vers les modes.', priority: 'medium', labels: ['Build'] },
          ] }] : [],
        };
      }
      if (name === 'pt-roblox') {
        if (body?.action === 'resolve') throw new Error('Mode démo : la recherche de jeux Roblox a besoin de la base en ligne.');
        return { ok: true, demo: true, stats: [] };
      }
      throw new Error('Fonction indisponible en mode démo : ' + name);
    },
  };
  return api;
}
