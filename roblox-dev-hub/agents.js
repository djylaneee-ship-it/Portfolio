// Chat Claude de Rovex : les Claude Code connectés par le channel `channel.js` (abonnement Claude de
// l'utilisateur, session qui tourne en arrière-plan). L'app garde la liste des Claudes, leurs messages en
// attente (récupérés par requête longue), la conversation et les demandes d'autorisation, et prévient
// l'interface en direct. Lancement d'un Claude : un terminal avec `claude` dans un dossier de travail prêt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const db = require('./db');
const claude = require('./claude');

const AGENT_FILE = path.join(db.DATA_DIR, 'agent.json');
const CHAT_FILE = path.join(db.DATA_DIR, 'agent-chat.json');
const WORKSPACE = path.join(db.DATA_DIR, 'claude-workspace');
const CHANNEL_PATH = path.join(__dirname, 'channel.js');
const ONLINE_MS = 45e3;

const agents = new Map(); // id → { id, name, cwd, host, lastSeen, wait, queue, typing }
const listeners = new Set();
let chat = [];
try { chat = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')).messages || []; } catch {}

// Clé partagée avec channel.js (même PC) : seul un process qui lit le dossier des données peut parler à l'app.
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

// Connecté : en attente d'un message, vu récemment, ou en plein travail (Claude Desktop n'écoute pas pendant qu'il travaille).
const online = (a) => !a.gone && (Boolean(a.wait) || Date.now() - a.lastSeen < ONLINE_MS || (a.typing && Date.now() - a.lastSeen < 20 * 60e3));
const pub = (a) => ({ id: a.id, name: a.name, via: a.via, cwd: a.cwd, host: a.host, online: online(a), typing: a.typing, since: a.since });
function list() {
  for (const [id, a] of agents) if (!online(a) && Date.now() - a.lastSeen > 6 * 3600e3) agents.delete(id);
  const out = [...agents.values()].map(pub);
  // Claudes fermés qui ont une conversation : toujours dans la liste, pour relire l'historique.
  const seen = new Set(out.map((a) => a.id));
  for (const m of chat) {
    if (seen.has(m.agent)) continue;
    seen.add(m.agent);
    out.push({ id: m.agent, name: (chat.find((x) => x.agent === m.agent && x.name) || {}).name || m.agent, online: false, typing: false });
  }
  return out.sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
}
const changed = () => emit({ type: 'agents', agents: list() });

function agentOf(id, info = {}) {
  let a = agents.get(id);
  if (!a) {
    a = { id, name: info.name || 'Claude', cwd: info.cwd || '', host: info.host || '', lastSeen: Date.now(), since: new Date().toISOString(), wait: null, queue: [], typing: false };
    agents.set(id, a);
    add({ agent: id, role: 'system', key: 'agentOnline', name: a.name });
    changed();
  }
  a.lastSeen = Date.now();
  return a;
}

// ---------- Côté channel.js (clé requise) ----------
// Requête longue : renvoie tout de suite les messages en attente, sinon attend jusqu'à 25 s.
function inbox(q, res) {
  const a = agentOf(String(q.get('id') || ''), { name: q.get('name'), cwd: q.get('cwd'), host: q.get('host') });
  a.gone = false;
  a.via = q.get('via') === 'desktop' ? 'desktop' : 'code';
  const wait = Math.max(5, Math.min(110, Number(q.get('wait')) || 25)) * 1000;
  const flush = () => {
    const items = a.queue.splice(0);
    a.wait = null;
    a.lastSeen = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ items }));
  };
  if (a.queue.length) return flush();
  if (a.wait) a.wait.flush();
  const timer = setTimeout(flush, wait);
  a.wait = { flush: () => { clearTimeout(timer); flush(); } };
  res.on('close', () => { clearTimeout(timer); if (a.wait && !res.writableEnded) { a.wait = null; if (!a.gone) a.lastSeen = Date.now(); } });
}
function push(a, item) {
  a.queue.push(item);
  if (a.wait) a.wait.flush();
}

function reply(b) {
  const a = agentOf(String(b.id || ''));
  a.typing = false;
  add({ agent: a.id, role: 'claude', text: String(b.text || '').slice(0, 100000) });
  changed();
  return { ok: true };
}
function status(b) {
  const a = agentOf(String(b.id || ''));
  a.typing = true;
  add({ agent: a.id, role: 'status', text: String(b.text || '').slice(0, 500) });
  changed();
  return { ok: true };
}
function permission(b) {
  const a = agentOf(String(b.id || ''));
  if (!/^[a-km-z]{5}$/.test(String(b.request_id || ''))) throw Object.assign(new Error('Bad request id'), { code: 400 });
  add({ agent: a.id, role: 'perm', request_id: b.request_id, tool: String(b.tool_name || '').slice(0, 80), text: String(b.description || '').slice(0, 1000), preview: String(b.input_preview || '').slice(0, 4000), state: 'open' });
  return { ok: true };
}
function bye(b) {
  const a = agents.get(String(b.id || ''));
  if (a) {
    a.gone = true;
    a.lastSeen = 0;
    if (a.wait) { const w = a.wait; a.wait = null; w.flush(); a.lastSeen = 0; }
    a.typing = false;
    add({ agent: a.id, role: 'system', key: 'agentOffline', name: a.name });
    changed();
  }
  return { ok: true };
}

// ---------- Côté interface ----------
function view() {
  return { agents: list(), messages: chat.slice(-300) };
}
function send(b) {
  const a = agents.get(String(b.agent || ''));
  if (!a || !online(a)) throw Object.assign(new Error('This Claude is not connected'), { key: 'agentOffline' });
  const text = String(b.text || '').trim().slice(0, 20000);
  if (!text) throw Object.assign(new Error('Empty message'), { key: 'chatEmpty' });
  const msg = add({ agent: a.id, role: 'user', text });
  a.typing = true;
  push(a, { kind: 'chat', chat_id: a.id, sender: 'rovex-user', text });
  changed();
  return { ok: true, msg };
}
function verdict(b) {
  const m = chat.find((x) => x.id === b.msg && x.role === 'perm');
  if (!m || m.state !== 'open') throw Object.assign(new Error('Request already answered'), { key: 'permDone' });
  const a = agents.get(m.agent);
  if (!a || !online(a)) throw Object.assign(new Error('This Claude is not connected'), { key: 'agentOffline' });
  m.state = b.behavior === 'allow' ? 'allowed' : 'denied';
  push(a, { kind: 'verdict', request_id: m.request_id, behavior: m.state === 'allowed' ? 'allow' : 'deny' });
  persist();
  emit({ type: 'perm', msg: m });
  return { ok: true };
}
function clear(agent) {
  chat = agent ? chat.filter((m) => m.agent !== agent) : [];
  persist();
  emit({ type: 'reset' });
  return { ok: true };
}
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Lancer un Claude ----------
// Dossier de travail : le channel et les outils Rovex déjà déclarés et autorisés, consignes dans CLAUDE.md.
function workspace() {
  const base = claude.entry();
  const env = { ...(base.env || {}), ROVEX_DATA: process.env.ROVEX_DATA || path.dirname(db.DATA_DIR) };
  const entry = { ...base, env };
  const chan = { ...base, args: [CHANNEL_PATH], env };
  fs.mkdirSync(path.join(WORKSPACE, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, '.mcp.json'), JSON.stringify({ mcpServers: { 'rovex-chat': chan, 'rovex-hub': entry } }, null, 2));
  const settingsFile = path.join(WORKSPACE, '.claude', 'settings.local.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
  settings.enabledMcpjsonServers = [...new Set([...(settings.enabledMcpjsonServers || []), 'rovex-chat', 'rovex-hub'])];
  settings.permissions = settings.permissions || {};
  settings.permissions.allow = [...new Set([...(settings.permissions.allow || []), 'mcp__rovex-chat', 'mcp__rovex-hub'])];
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  const guide = path.join(WORKSPACE, 'CLAUDE.md');
  if (!fs.existsSync(guide)) {
    fs.writeFileSync(guide, `# Claude dans Rovex Hub

Tu travailles pour un développeur Roblox à travers l'app Rovex Hub. Il ne voit pas ce terminal : il te parle dans le Chat Claude de Rovex.

- Réponds toujours avec l'outil \`reply\` du serveur \`rovex-chat\` (avec le chat_id reçu), dans sa langue, simplement.
- Pendant une longue tâche, donne chaque étape avec l'outil \`status\`.
- Pour tout travail Roblox : \`load_skill\` d'abord, puis les exemples validés, \`find_vfx_textures\` pour chaque texture VFX, et les outils \`studio_*\` pour lire et modifier la place ouverte dans Roblox Studio.
`);
  }
  return WORKSPACE;
}

const safeName = (n) => String(n || 'Claude').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 30) || 'Claude';
function command(name) {
  const flag = 'claude --dangerously-load-development-channels server:rovex-chat';
  if (process.platform === 'win32') return `set MCP_PROTOCOL_NEGOTIATION=legacy&& set ROVEX_AGENT_NAME=${name}&& ${flag}`;
  return `MCP_PROTOCOL_NEGOTIATION=legacy ROVEX_AGENT_NAME='${name}' ${flag}`;
}

// Ouvre un terminal visible avec Claude Code (la session reste à toi : tu peux le réduire, pas le fermer).
async function launch(b = {}) {
  const st = await claude.codeStatus();
  if (!st.installed) throw Object.assign(new Error('Claude Code is not installed'), { key: 'codeMissing' });
  const dir = workspace();
  const name = safeName(b.name);
  const cmd = command(name);
  let opened = false;
  if (process.platform === 'win32') {
    opened = await new Promise((r) => exec(`start "Rovex - ${name}" /D "${dir}" cmd /k "${cmd}"`, { windowsHide: false }, (e) => r(!e)));
  } else if (process.platform === 'darwin') {
    const script = `cd ${JSON.stringify(dir)} && ${cmd}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    opened = await new Promise((r) => exec(`osascript -e 'tell application "Terminal" to do script "${script.replace(/'/g, "'\\''")}"' -e 'tell application "Terminal" to activate'`, (e) => r(!e)));
  }
  return { opened, dir, command: cmd, name, version: st.version };
}

async function setup() {
  return { code: await claude.codeStatus(), dir: WORKSPACE, command: command('Claude'), platform: process.platform, host: os.hostname() };
}

module.exports = { init, keyOk, inbox, reply, status, permission, bye, view, send, verdict, clear, subscribe, launch, setup, list };
