// Chat Claude de Rovex, seulement par MCP : une conversation de Claude Desktop (abonnement de l'utilisateur)
// écoute le chat avec l'outil chat_listen et répond avec chat_reply (voir mcp.js). L'app garde la conversation et
// les messages en attente (requête longue /agent/inbox), et prévient l'interface en direct.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const AGENT_FILE = path.join(db.DATA_DIR, 'agent.json');
const CHAT_FILE = path.join(db.DATA_DIR, 'agent-chat.json');
// Images de référence envoyées à Claude (photos, captures, images clés des vidéos) : media/chat/.
const CHAT_MEDIA = path.join(db.MEDIA_DIR, 'chat');
const MAX_FILES = 8;
const MAX_FRAMES = 8;
const ONLINE_MS = 45e3;

const claude = { lastSeen: 0, wait: null, queue: [], working: false };
const listeners = new Set();
let chat = [];
try { chat = (JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')).messages || []).filter((m) => ['user', 'claude', 'status'].includes(m.role)); } catch {}

// Clé locale lue par mcp.js (même PC) : seul un process qui lit le dossier des données parle à l'app.
function init(port) {
  let a = {};
  try { a = JSON.parse(fs.readFileSync(AGENT_FILE, 'utf8')); } catch {}
  a = { key: a.key || crypto.randomBytes(24).toString('hex'), port };
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(AGENT_FILE, JSON.stringify(a), { mode: 0o600 });
  return a;
}
const keyOk = (k) => {
  try { return Boolean(k) && k === JSON.parse(fs.readFileSync(AGENT_FILE, 'utf8')).key; } catch { return false; }
};

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages: chat.slice(-600) })); } catch {}
  }, 300);
}
function emit(ev) { for (const fn of listeners) fn(ev); }
function add(m) {
  const msg = { id: crypto.randomUUID(), t: new Date().toISOString(), ...m };
  chat.push(msg);
  if (chat.length > 800) chat = chat.slice(-600);
  persist();
  emit({ type: 'msg', msg });
  return msg;
}

// À l'écoute : en attente d'un message, vu il y a peu, ou en plein travail sur une demande.
const online = () => Boolean(claude.wait) || Date.now() - claude.lastSeen < ONLINE_MS || (claude.working && Date.now() - claude.lastSeen < 20 * 60e3);
const state = () => ({ online: online(), working: claude.working, waiting: claude.queue.length });
let last = '';
function changed() {
  const s = JSON.stringify(state());
  if (s === last) return;
  last = s;
  emit({ type: 'state', claude: state() });
}
setInterval(changed, 5000).unref();

// ---------- Côté mcp.js (clé requise) ----------
// Requête longue : renvoie tout de suite les messages en attente, sinon attend (40 s au plus par défaut).
function inbox(q, res) {
  claude.lastSeen = Date.now();
  const wait = Math.max(5, Math.min(55, Number(q.get('wait')) || 40)) * 1000;
  const flush = () => {
    const items = claude.queue.splice(0);
    claude.wait = null;
    claude.lastSeen = Date.now();
    if (items.length) claude.working = true;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ items }));
    changed();
  };
  if (claude.queue.length) return flush();
  if (claude.wait) claude.wait.flush(); // ancienne attente (conversation relancée) : on la libère
  const timer = setTimeout(flush, wait);
  claude.wait = { flush: () => { clearTimeout(timer); flush(); } };
  res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) { claude.wait = null; claude.lastSeen = Date.now(); changed(); } });
  changed();
}

function reply(b) {
  claude.lastSeen = Date.now();
  claude.working = false;
  add({ role: 'claude', text: String(b.text || '').slice(0, 100000) });
  changed();
  return { ok: true };
}
function status(b) {
  claude.lastSeen = Date.now();
  claude.working = true;
  add({ role: 'status', text: String(b.text || '').slice(0, 500) });
  changed();
  return { ok: true };
}

// ---------- Côté interface ----------
const view = () => ({ claude: state(), messages: chat.slice(-300) });
// Pièces jointes : images déjà réduites par l'interface (JPEG / PNG / WebP en data URL). Une vidéo arrive en
// quelques images clés avec leur instant, que Claude regarde comme une suite.
function saveFiles(list) {
  if (!Array.isArray(list)) return [];
  fs.mkdirSync(CHAT_MEDIA, { recursive: true });
  return list.slice(0, MAX_FILES).map((f) => {
    const frames = (Array.isArray(f.frames) ? f.frames : []).slice(0, MAX_FRAMES).map((src) => {
      const m = String(src).match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw Object.assign(new Error('Unsupported file'), { key: 'chatFileBad' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 3 * 1024 * 1024) throw Object.assign(new Error('File too large'), { key: 'tooBig' });
      const name = `${crypto.randomBytes(8).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`;
      fs.writeFileSync(path.join(CHAT_MEDIA, name), buf);
      return 'chat/' + name;
    });
    if (!frames.length) return null;
    const kind = f.kind === 'video' ? 'video' : 'image';
    const times = kind === 'video' && Array.isArray(f.times) ? f.times.slice(0, frames.length).map((x) => Math.round(Number(x) * 10) / 10 || 0) : undefined;
    return { kind, name: String(f.name || '').slice(0, 120), frames, ...(times && { times }), ...(kind === 'video' && { duration: Math.round(Number(f.duration) * 10) / 10 || 0 }) };
  }).filter(Boolean);
}

// Le message attend Claude s'il n'écoute pas encore : il le reçoit dès qu'il se connecte.
function send(b) {
  const text = String(b.text || '').trim().slice(0, 20000);
  const files = saveFiles(b.files);
  if (!text && !files.length) throw Object.assign(new Error('Empty message'), { key: 'chatEmpty' });
  const msg = add({ role: 'user', text, ...(files.length && { files }) });
  claude.queue.push({ kind: 'chat', text, ...(files.length && { files }) });
  if (claude.wait) claude.wait.flush();
  changed();
  return { ok: true, msg };
}
function clear() {
  chat = [];
  claude.queue = [];
  persist();
  fs.rm(CHAT_MEDIA, { recursive: true, force: true }, () => {});
  emit({ type: 'reset' });
  changed();
  return { ok: true };
}
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { CHAT_MEDIA, init, keyOk, inbox, reply, status, view, send, clear, subscribe, state };
