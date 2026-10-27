// Pont vers Blender : l'add-on « Claude Blender MCP » (dossier blender/) écoute sur 127.0.0.1:9876 et reçoit des
// commandes JSON, une par ligne ({id, command, params} → {id, status, result|error}). Rovex parle directement à
// ce port (pas besoin de Python) et donne ses outils à Claude : modélisation, Edit Mode, sculpt, rig et animation par
// bpy + la boîte à outils rx de l'add-on (blender_execute_python), vue multi-angles (blender_view), captures et tous
// les outils d'animation R6 (r6_*). Source de l'add-on : blender/addon (zip refait par blender/build_addon.py).
// Désactivé tant que l'utilisateur ne l'active pas.
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const SETTINGS_FILE = path.join(db.DATA_DIR, 'blender.json');
const EXPORT_DIR = path.join(path.dirname(db.DATA_DIR), 'blender-exports');
const ADDON_VERSION = '0.2.1';
const ADDON_ZIP = path.join(__dirname, 'blender', `claude_blender_mcp-${ADDON_VERSION}.zip`);
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'blender', 'tools.json'), 'utf8'));
const NAMES = new Set(SPEC.tools.map((t) => t.name));
const LONG = new Set(['r6_preview', 'r6_export', 'blender_view']);
const IMAGES = new Set(['blender_viewport_screenshot', 'blender_view', 'r6_preview']);
// Vieil add-on (0.1.x) : pas de rx ni de vue multi-angles.
const OLD_ADDON = `\nThe Blender add-on is outdated: ask the user to install claude_blender_mcp-${ADDON_VERSION}.zip (Rovex > Blender > step 1: Edit > Preferences > Get Extensions > Install from Disk), then retry.`;
const newer = (a, b) => { const x = String(a || '0').split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== y[i]) return (x[i] || 0) > y[i]; } return true; };

function readSettings() {
  try { return { enabled: false, port: 9876, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { return { enabled: false, port: 9876 }; }
}
function writeSettings(b = {}) {
  const cur = readSettings();
  const next = {
    enabled: b.enabled === undefined ? cur.enabled : Boolean(b.enabled),
    port: Number.isInteger(Number(b.port)) && Number(b.port) > 0 && Number(b.port) < 65536 ? Number(b.port) : cur.port,
  };
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next));
  return next;
}
const enabled = () => readSettings().enabled;
const owns = (name) => enabled() && NAMES.has(name);

function tools() {
  if (!enabled()) return [];
  return SPEC.tools.map((t) => (t.name === 'blender_execute_python'
    ? { ...t, description: `${t.description}\nExport folder (rx.export_fbx default): ${EXPORT_DIR}` }
    : t));
}

const unreachable = (port) => `Blender n'est pas joignable sur 127.0.0.1:${port}. Ouvre Blender avec l'add-on « Claude Blender MCP » activé, puis vue 3D > touche N > onglet Claude > Start Server.\n`
  + `EN: Blender is not reachable on 127.0.0.1:${port}. Open Blender with the Claude Blender MCP add-on enabled and start its server (3D View > N panel > Claude tab > Start Server).`;

// Une connexion par commande, réponse = une ligne JSON.
function send(command, params = {}, timeout = 120e3) {
  const { port } = readSettings();
  const clean = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined));
  const id = crypto.randomBytes(6).toString('hex');
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let buf = '';
    let connected = false;
    const fail = (e) => { sock.destroy(); reject(e); };
    const timer = setTimeout(() => fail(new Error(connected
      ? `Blender n'a pas répondu en ${Math.round(timeout / 1000)} s à « ${command} » (occupé ou fenêtre ouverte ?). / Blender did not answer in time.`
      : unreachable(port))), connected ? timeout : 5000);
    sock.setEncoding('utf8');
    sock.on('connect', () => {
      connected = true;
      clearTimeout(timer);
      sock.setTimeout(timeout, () => fail(new Error(`Blender n'a pas répondu en ${Math.round(timeout / 1000)} s à « ${command} ». / Blender did not answer in time.`)));
      sock.write(JSON.stringify({ id, command, params: clean }) + '\n');
    });
    sock.on('data', (d) => {
      buf += d;
      if (buf.length > 64 * 1024 * 1024) return fail(new Error('Blender reply larger than 64 MB'));
      const i = buf.indexOf('\n');
      if (i < 0) return;
      sock.end();
      let reply;
      try { reply = JSON.parse(buf.slice(0, i)); } catch (e) { return reject(new Error('Invalid reply from Blender: ' + e.message)); }
      if (reply.status === 'ok') return resolve(reply.result);
      const tb = String(reply.traceback || '').trim();
      reject(new Error(`Blender error in '${command}': ${reply.error || 'unknown error'}${tb ? '\n--- Blender traceback (tail) ---\n' + tb.slice(-2000) : ''}`));
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(new Error(connected ? `Blender closed the connection: ${e.message}` : unreachable(port))); });
    sock.on('end', () => { clearTimeout(timer); if (buf.indexOf('\n') < 0) reject(new Error(`Blender closed the connection without answering '${command}'.`)); });
  });
}

const text = (v) => ({ type: 'text', text: JSON.stringify(v, null, 1) });
// Image renvoyée par l'add-on (fichier PNG sur le disque) : montrée à Claude.
function withImage(result) {
  const p = result && typeof result === 'object' && result.path;
  if (p && fs.existsSync(p)) {
    try { return { content: [{ type: 'image', data: fs.readFileSync(p).toString('base64'), mimeType: 'image/png' }, text(result)] }; } catch {}
  }
  return { content: [text({ warning: 'Image file not found on disk; nothing to display.', result })] };
}

// Outil MCP → commande de l'add-on (mêmes règles que le serveur Python d'origine).
async function call(name, a = {}) {
  if (name === 'r6_list_presets') {
    let result = await send('r6_list_presets', { compact: Boolean(a.names_only) });
    let presets = result && result.presets;
    if (Array.isArray(presets)) {
      if (a.category) presets = presets.filter((p) => String(p.category || '').toLowerCase().includes(String(a.category).toLowerCase()));
      const count = presets.length;
      if (a.names_only) {
        const grouped = {};
        for (const p of presets) (grouped[p.category || '?'] = grouped[p.category || '?'] || []).push(p.name);
        presets = grouped;
      }
      result = { ...result, presets, count };
    }
    return { content: [text(result)] };
  }
  const command = name.startsWith('blender_') ? name.slice(8) : name;
  // Valeurs par défaut du schéma, comme le serveur Python d'origine (qui les envoie toujours).
  const spec = SPEC.tools.find((t) => t.name === name);
  const defaults = Object.fromEntries(Object.entries((spec && spec.inputSchema.properties) || {}).filter(([, p]) => p.default !== undefined).map(([k, p]) => [k, p.default]));
  let params = { ...defaults, ...a };
  let timeout = LONG.has(name) ? 300e3 : 120e3;
  if (name === 'blender_execute_python') {
    timeout = Math.max(1000, (Number(a.timeout_s) || 180) * 1000);
    params = { code: a.code, fresh: Boolean(a.fresh), export_dir: EXPORT_DIR };
  }
  if (name === 'r6_create_animation') params.params = a.params || {};
  if (name === 'r6_export') {
    params.output_dir = a.output_dir || EXPORT_DIR;
    fs.mkdirSync(params.output_dir, { recursive: true });
    params.joints = Array.isArray(a.joints) && a.joints.length ? a.joints : null;
    params.grip = a.grip && a.grip !== 'tool' ? a.grip : null;
  }
  let result;
  try {
    result = await send(command, params, timeout);
  } catch (e) {
    if (/Unknown command '(view|mesh_stats)'|name 'rx' is not defined/.test(e.message)) e.message += OLD_ADDON;
    throw e;
  }
  if (name === 'blender_ping' && result && typeof result === 'object') {
    result.port = result.port || readSettings().port;
    if (!newer(result.addon_version, ADDON_VERSION)) result.warning = OLD_ADDON.trim();
  }
  if (IMAGES.has(name)) return withImage(result);
  return { content: [text(result)] };
}

// Pour la page Blender de l'app : Blender répond-il ?
async function status() {
  const s = readSettings();
  let ping = null;
  let error = '';
  try { ping = await send('ping', {}, 4000); } catch (e) { error = e.message.split('\n')[0]; }
  return { ...s, connected: Boolean(ping), blender: ping && ping.blender, file: ping && ping.file, addon: ping && ping.addon_version, addonOld: Boolean(ping) && !newer(ping.addon_version, ADDON_VERSION), addonVersion: ADDON_VERSION, error, tools: SPEC.tools.length, exportDir: EXPORT_DIR, addonZip: ADDON_ZIP };
}

const INSTRUCTIONS = `\n\nBlender is connected through Rovex with full access: for ANY 3D modeling task (model, mesh, weapon, pet, prop, creature…) you MUST make it in Blender, not from Roblox parts.
Workflow: blender_scene_info -> build step by step with blender_execute_python and the rx toolkit (rx.prim, then Edit Mode with \`with rx.edit(ob) as bm:\` + rx.extrude / rx.inset / rx.bevel / rx.loop_cut, modifiers, rx.sculpt brushes for organic shapes, rx.paint colors) -> after EVERY step look at it with blender_view (front, right, top, persp; wireframe to check topology) and fix -> rx.stats for polycount (keep Roblox models light) -> rx.armature + rx.skin + rx.key / rx.pose to rig and animate -> rx.export_fbx and tell the user the file path (Roblox Studio: 3D Importer). Keep code in small calls: variables persist between calls. Errors come back with the Blender traceback and state: read them and fix the code.
For Roblox R6 animations: ${SPEC.instructions || ''}`;

// Code Python lancé dans Blender par d'autres modules de Rovex (ex. import des modèles Meshy).
const run = (code, timeout = 120e3) => send('execute_python', { code, export_dir: EXPORT_DIR }, timeout);

module.exports = { readSettings, writeSettings, enabled, owns, tools, call, run, status, ADDON_ZIP, ADDON_VERSION, EXPORT_DIR, INSTRUCTIONS, SETTINGS_FILE };
