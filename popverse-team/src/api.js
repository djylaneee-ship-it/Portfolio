// Accès aux données. Deux moteurs avec la même interface :
//  - Supabase (en ligne, temps réel, comptes partagés par toute l'équipe) ;
//  - Démo (localStorage + BroadcastChannel) quand la base n'est pas encore configurée.
// Toutes les vues passent par `api` : select / insert / update / remove / subscribe / upload / fn / presence.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, WEB_URL } from './config.js';
import { createLocal } from './local.js';

function savedConfig() {
  try { return JSON.parse(localStorage.getItem('pt.db') || 'null'); } catch { return null; }
}

export function dbConfig() {
  const s = savedConfig();
  if (s?.url && s?.key) return { url: s.url, key: s.key, source: 'saved' };
  if (SUPABASE_URL && SUPABASE_KEY) return { url: SUPABASE_URL, key: SUPABASE_KEY, source: 'build' };
  return null;
}
export function saveDbConfig(cfg) {
  try { cfg ? localStorage.setItem('pt.db', JSON.stringify(cfg)) : localStorage.removeItem('pt.db'); } catch {}
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));

function createSupabase({ url, key }) {
  const sb = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pt.auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const listeners = new Set();
  let me = null;

  async function loadMe(user) {
    if (!user) { me = null; return null; }
    const { data } = await sb.from('pt_profiles').select('*').eq('id', user.id).maybeSingle();
    me = data ? { ...data, email: user.email } : null;
    return me;
  }
  let recovery = null;
  sb.auth.onAuthStateChange(async (evt, session) => {
    if (evt === 'TOKEN_REFRESHED') return;
    if (evt === 'PASSWORD_RECOVERY') setTimeout(() => recovery?.(), 300);
    await loadMe(session?.user);
    listeners.forEach(cb => cb(me));
  });

  function applyQuery(q, opt = {}) {
    for (const [k, v] of Object.entries(opt.eq || {})) q = v === null ? q.is(k, null) : q.eq(k, v);
    for (const [k, v] of Object.entries(opt.in || {})) q = q.in(k, v);
    for (const [k, v] of Object.entries(opt.gte || {})) q = q.gte(k, v);
    for (const [k, v] of Object.entries(opt.lte || {})) q = q.lte(k, v);
    for (const [k, v] of Object.entries(opt.contains || {})) q = q.contains(k, v);
    if (opt.ilike) for (const [k, v] of Object.entries(opt.ilike)) q = q.ilike(k, v);
    for (const o of [].concat(opt.order || [])) {
      if (!o) continue;
      const [col, dir] = Array.isArray(o) ? o : [o, 'asc'];
      q = q.order(col, { ascending: dir !== 'desc' });
    }
    if (opt.limit) q = q.limit(opt.limit);
    return q;
  }
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  return {
    mode: 'online',
    client: sb,
    get me() { return me; },
    async init() {
      const { data } = await sb.auth.getSession();
      await loadMe(data.session?.user);
      return me;
    },
    onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
      return loadMe((await sb.auth.getUser()).data.user);
    },
    async signUp({ email, password, username, code }) {
      const res = check(await sb.auth.signUp({ email, password, options: { data: { username, invite_code: code } } }));
      if (!res.session) return { needsConfirm: true };
      return { me: await loadMe(res.user) };
    },
    async resetPassword(email) { check(await sb.auth.resetPasswordForEmail(email, { redirectTo: WEB_URL })); },
    onRecovery(cb) { recovery = cb; },
    async updatePassword(password) { check(await sb.auth.updateUser({ password })); },
    async signOut() { await sb.auth.signOut(); me = null; },
    async refreshMe() { return loadMe((await sb.auth.getUser()).data.user); },

    async select(table, opt = {}) { return check(await applyQuery(sb.from(table).select(opt.columns || '*'), opt)); },
    async get(table, id) { return check(await sb.from(table).select('*').eq('id', id).maybeSingle()); },
    async insert(table, rows) {
      const many = Array.isArray(rows);
      const data = check(await sb.from(table).insert(rows).select());
      return many ? data : data[0];
    },
    async update(table, id, patch) { return check(await sb.from(table).update(patch).eq('id', id).select().maybeSingle()); },
    async updateWhere(table, eq, patch) { return check(await applyQuery(sb.from(table).update(patch), { eq }).select()); },
    async remove(table, id) { check(await sb.from(table).delete().eq('id', id)); },
    async removeWhere(table, eq) { check(await applyQuery(sb.from(table).delete(), { eq })); },
    async rpc(name, args = {}) { return check(await sb.rpc(name, args)); },

    // Temps réel : cb({ type: 'INSERT'|'UPDATE'|'DELETE', row, old }). `filter` = { colonne: valeur } (une seule).
    subscribe(table, filter, cb) {
      const [col, val] = Object.entries(filter || {})[0] || [];
      const name = `pt:${table}:${col || 'all'}:${val || ''}:${uid().slice(0, 8)}`;
      const ch = sb.channel(name).on('postgres_changes',
        { event: '*', schema: 'public', table, ...(col ? { filter: `${col}=eq.${val}` } : {}) },
        p => cb({ type: p.eventType, row: p.new && Object.keys(p.new).length ? p.new : null, old: p.old }))
        .subscribe();
      return () => sb.removeChannel(ch);
    },

    // Présence (qui est en ligne, qui écrit…) sur un canal nommé.
    presence(name, meta, cb) {
      const ch = sb.channel('pt-presence:' + name, { config: { presence: { key: me?.id || uid() } } });
      const emit = () => cb(Object.values(ch.presenceState()).map(a => a[0]));
      ch.on('presence', { event: 'sync' }, emit)
        .on('broadcast', { event: 'ping' }, ({ payload }) => cb(null, payload))
        .subscribe(async s => { if (s === 'SUBSCRIBED') await ch.track(meta); });
      return {
        update: m => ch.track(m),
        send: payload => ch.send({ type: 'broadcast', event: 'ping', payload }),
        close: () => sb.removeChannel(ch),
      };
    },

    async upload(file, folder = 'files') {
      const ext = (file.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${folder}/${uid()}.${ext}`;
      check(await sb.storage.from('pt-files').upload(path, file, { contentType: file.type || undefined, upsert: false }));
      return sb.storage.from('pt-files').getPublicUrl(path).data.publicUrl;
    },

    async fn(name, body) {
      const { data, error } = await sb.functions.invoke(name, { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      return data;
    },
  };
}

export const api = (() => {
  const cfg = dbConfig();
  return cfg ? createSupabase(cfg) : createLocal();
})();

export { uid };
