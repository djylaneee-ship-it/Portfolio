// Base en ligne de Rovex Hub (Supabase) : IDs d'accès partagés entre tous les PC, et contenu
// publié par les admins (exemples, skills, prompts). L'app n'appelle que les fonctions rovex_*,
// les tables elles-mêmes ne sont pas lisibles avec la clé publique.
const URL_ = process.env.ROVEX_SUPABASE_URL || 'https://owupuxmgxtjmslhhawaf.supabase.co';
const KEY = process.env.ROVEX_SUPABASE_KEY || 'sb_publishable__eVSL4bz7tZOZmjkOlMy8Q_rmyr55sN';
const enabled = !process.env.ROVEX_LOCAL_AUTH;

async function rpc(fn, args = {}, timeout = 12000) {
  let res;
  try {
    res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw Object.assign(new Error('Cannot reach the Rovex server'), { key: 'cloudDown', offline: true });
  }
  if (!res.ok) throw Object.assign(new Error(`Rovex server error (HTTP ${res.status})`), { key: 'cloudDown', status: res.status, offline: res.status >= 500 || res.status === 404 });
  return res.json();
}

// Erreur « métier » renvoyée par une fonction rovex_* ({ ok: false, err }).
function must(out) {
  if (out && out.ok) return out;
  const key = (out && out.err) || 'cloudDown';
  const code = { adminOnly: 403, idNotFound: 404, unknownId: 401, idBlocked: 401, idExpired: 401 }[key] || 400;
  throw Object.assign(new Error(key), { key, code });
}

// ---------- Contenu partagé : exemples, skills et prompts des admins ----------
const stamp = (x) => Date.parse(x.updatedAt || x.createdAt || 0) || 0;

// Fusionne deux listes par id : la version la plus récente gagne, les suppressions sont gardées.
function mergeList(local = [], remote = { items: [], deleted: {} }, deletedLocal = {}) {
  const deleted = { ...(remote.deleted || {}) };
  for (const [id, t] of Object.entries(deletedLocal)) if (!deleted[id] || deleted[id] < t) deleted[id] = t;
  const map = new Map(local.map((x) => [x.id, x]));
  for (const r of remote.items || []) {
    const l = map.get(r.id);
    if (!l || stamp(r) > stamp(l)) map.set(r.id, r);
  }
  const items = [...map.values()].filter((x) => !(deleted[x.id] && deleted[x.id] >= stamp(x)));
  return { items, deleted };
}

function mergeSkills(local = {}, remote = {}) {
  const out = { ...local };
  for (const [cat, r] of Object.entries(remote || {})) {
    if (!out[cat] || stamp(r) > stamp(out[cat])) out[cat] = r;
  }
  return out;
}

// Récupère le contenu publié et le fusionne dans la base locale. Renvoie true si quelque chose a changé.
async function pull(state, cred) {
  const out = must(await rpc('rovex_get_shared', { p_code: cred }));
  const sh = out.shared || {};
  const before = JSON.stringify([state.examples, state.skills, state.prompts, state.textures]);
  const del = (state.sharedDeleted = state.sharedDeleted || { examples: {}, prompts: {} });
  if (sh.examples) {
    const m = mergeList(state.examples, sh.examples.data, del.examples);
    state.examples = m.items.sort((a, b) => stamp(b) - stamp(a));
    del.examples = m.deleted;
  }
  if (sh.prompts) {
    const m = mergeList(state.prompts, sh.prompts.data, del.prompts);
    state.prompts = m.items.sort((a, b) => stamp(b) - stamp(a));
    del.prompts = m.deleted;
  }
  if (sh.skills) state.skills = mergeSkills(state.skills, sh.skills.data);
  // Leçons partagées par les admins (atelier d'apprentissage) : dans leur propre fichier.
  let lessonsChanged = false;
  if (sh.lessons) { try { lessonsChanged = require('./lessons').mergeShared(sh.lessons.data); } catch {} }
  // Textures VFX ajoutées par l'admin : la version la plus récente gagne.
  if (sh.textures && sh.textures.data && (!state.textures || stamp(sh.textures.data) > stamp(state.textures))) state.textures = sh.textures.data;
  return lessonsChanged || before !== JSON.stringify([state.examples, state.skills, state.prompts, state.textures]);
}

// Publie (ou retire) une leçon validée pour tout le monde (admins). Le reste du contenu partagé ne bouge pas.
async function shareLesson(cred, item, remove = false) {
  const out = must(await rpc('rovex_get_shared', { p_code: cred }));
  const cur = ((out.shared || {}).lessons || {}).data || { items: [] };
  const items = (cur.items || []).filter((x) => x && x.id !== (remove ? item : item.id));
  if (!remove) items.unshift(item);
  const r = await rpc('rovex_put_shared', { p_key: cred, p_name: 'lessons', p_data: { items: items.slice(0, 300) } });
  if (r && r.err === 'badName') throw Object.assign(new Error('lessonsSetup'), { key: 'lessonsSetup', code: 503 });
  must(r);
  return { shared: items.length };
}

// Publie le contenu local (admins seulement) après l'avoir fusionné avec ce qui est en ligne.
async function push(state, cred) {
  try { await pull(state, cred); } catch (e) { if (e.offline) throw e; }
  const del = state.sharedDeleted || { examples: {}, prompts: {} };
  must(await rpc('rovex_put_shared', { p_key: cred, p_name: 'examples', p_data: { items: state.examples || [], deleted: del.examples || {} } }));
  must(await rpc('rovex_put_shared', { p_key: cred, p_name: 'prompts', p_data: { items: state.prompts || [], deleted: del.prompts || {} } }));
  must(await rpc('rovex_put_shared', { p_key: cred, p_name: 'skills', p_data: state.skills || {} }));
  // Textures : seulement si la base en ligne les accepte (supabase/rovex-library.sql lancé).
  if (state.textures) { try { await rpc('rovex_put_shared', { p_key: cred, p_name: 'textures', p_data: state.textures }); } catch {} }
}

module.exports = { enabled, rpc, must, pull, push, shareLesson, mergeList, URL: URL_, KEY };
