// Espace Co-work : projets partagés entre plusieurs IDs (tâches façon Trello, tableau d'idées façon Milanote).
// Tout vit dans la base en ligne (supabase/rovex-cowork.sql, fonctions rovex_cw_*), appelée avec l'ID d'accès de la
// session ; l'app ne garde ici que le cache des images (media/cowork/).
const fs = require('fs');
const path = require('path');
const cloud = require('./cloud');
const db = require('./db');

const CACHE = path.join(db.MEDIA_DIR, 'cowork');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const err = (key, message, code = 400) => Object.assign(new Error(message), { key, code });

function uuid(x) {
  if (!UUID.test(String(x || ''))) throw err('cwBad', 'Invalid id');
  return x;
}

async function call(fn, session, args = {}) {
  if (!cloud.enabled || !session || !session.cred) throw err('cwOffline', 'Co-work needs the online Rovex server');
  let out;
  try {
    out = await cloud.rpc(fn, { p_code: session.cred, ...args }, 20000);
  } catch (e) {
    // Fonction absente : le fichier SQL du co-work n'a pas encore été lancé dans Supabase.
    if (e.status === 404) throw err('cwSetup', 'Co-work is not set up yet on the Rovex server', 503);
    throw e;
  }
  if (out && out.ok) return out;
  const key = (out && out.err) || 'cloudDown';
  throw err(key, key, { unknownId: 401, cwNotMember: 403, cwOwnerOnly: 403, cwNoUser: 404, cwNoFile: 404 }[key] || 400);
}

const projects = (s) => call('rovex_cw_projects', s);
const profile = (s, name) => call('rovex_cw_profile', s, name === undefined ? {} : { p_name: String(name).slice(0, 40) });
const create = (s, b) => call('rovex_cw_create', s, { p_name: String(b.name || '').slice(0, 60), p_color: b.color || null });
const update = (s, id, b) => call('rovex_cw_update', s, { p_project: uuid(id), p_name: b.name || null, p_color: b.color || null });
const remove = (s, id) => call('rovex_cw_delete', s, { p_project: uuid(id) });
const invite = (s, id, publicId) => call('rovex_cw_invite', s, { p_project: uuid(id), p_public: String(publicId || '').slice(0, 40) });
const kick = (s, id, member) => call('rovex_cw_remove', s, { p_project: uuid(id), p_member: String(member || '').slice(0, 40) });
const sync = (s, id, since) => call('rovex_cw_sync', s, { p_project: uuid(id), p_since: since && !Number.isNaN(Date.parse(since)) ? since : null });

function put(s, id, nodes) {
  if (!Array.isArray(nodes) || !nodes.length) throw err('cwBad', 'Nothing to save');
  const clean = nodes.slice(0, 200).map((n) => ({
    id: uuid(n.id), parent: n.parent ? uuid(n.parent) : null, kind: String(n.kind || ''), data: n.data && typeof n.data === 'object' ? n.data : {},
    pos: Number(n.pos) || 0, deleted: Boolean(n.deleted),
  }));
  return call('rovex_cw_put', s, { p_project: uuid(id), p_nodes: clean });
}

// Image : envoyée une fois (data URL déjà réduite par l'interface), puis gardée en cache local.
async function filePut(s, id, data) {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(data || ''))) throw err('cwFile', 'Unsupported image');
  const out = await call('rovex_cw_file_put', s, { p_project: uuid(id), p_data: data });
  saveCache(out.id, data);
  return { id: out.id };
}

function saveCache(fid, data) {
  const m = String(data).match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) return null;
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${fid}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

async function file(s, id, fid) {
  uuid(fid);
  for (const ext of ['jpg', 'png', 'webp']) {
    const f = path.join(CACHE, `${fid}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  const out = await call('rovex_cw_file_get', s, { p_project: uuid(id), p_id: fid });
  return saveCache(fid, out.data);
}

module.exports = { projects, profile, create, update, remove, invite, kick, sync, put, filePut, file };
