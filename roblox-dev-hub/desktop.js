// Pont entre le serveur et la fenêtre de l'app de bureau.
// Le serveur (la grande bibliothèque en mémoire, les recherches, les synchros) tourne dans son propre processus
// (Rovex Hub.exe en mode Node, lancé par electron.js) : la fenêtre ne se fige plus pendant un gros calcul.
// Ce qui demande Electron (ouvrir un lien, montrer un fichier, images natives, mises à jour) est demandé au
// processus de la fenêtre par messages. Sans fenêtre (node server.js), tout se fait sur place ou rien.
const CHILD = process.env.ROVEX_CHILD === '1' && typeof process.send === 'function';

let electron = null;
function el() {
  if (electron === null) { try { electron = require('electron'); if (!electron || !electron.shell) electron = false; } catch { electron = false; } }
  return electron;
}

// Ce que le processus de la fenêtre sait faire (exécuté là-bas).
const OPS = {
  openExternal: async ({ url }) => { await el().shell.openExternal(url); return true; },
  showItem: ({ file }) => { el().shell.showItemInFolder(file); return true; },
  // Image → pixels BGRA (pour le détourage), et l'inverse.
  decode: ({ buf }) => {
    const img = el().nativeImage.createFromBuffer(Buffer.from(buf));
    const { width, height } = img.getSize();
    return width && height ? { width, height, px: img.toBitmap() } : null;
  },
  encode: ({ px, width, height }) => el().nativeImage.createFromBitmap(Buffer.from(px), { width, height }).toPNG(),
  shrink: ({ buf, width }) => {
    const img = el().nativeImage.createFromBuffer(Buffer.from(buf));
    return img.getSize().width > width ? img.resize({ width }).toPNG() : null;
  },
  checkUpdates: () => { if (global.rovexCheckUpdates) global.rovexCheckUpdates(); return Boolean(global.rovexCheckUpdates); },
  installUpdate: () => { if (global.rovexInstallUpdate) global.rovexInstallUpdate(); return true; },
};

// ---------- Côté serveur ----------
let seq = 0;
const waiting = new Map();
if (CHILD) {
  process.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'update') global.rovexUpdate = m.update;
    if (m.type === 'reply' && waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m.value);
    }
  });
  // La fenêtre a disparu (app fermée, plantée) : le serveur s'arrête aussi.
  process.on('disconnect', () => process.exit(0));
}

// Demande une action d'Electron. Renvoie null si l'app de bureau n'est pas là.
function call(op, args = {}, timeout = 20000) {
  if (CHILD) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('The app window did not answer')); }, timeout);
      waiting.set(id, { resolve, reject, timer });
      process.send({ type: 'call', id, op, args });
    });
  }
  if (!el()) return Promise.resolve(null);
  return Promise.resolve().then(() => OPS[op](args));
}
const available = () => CHILD || Boolean(el());

// Prévient la fenêtre que le serveur écoute (ou n'a pas pu démarrer).
function ready(port) { if (CHILD) process.send({ type: 'ready', port }); }
function failed(e) { if (CHILD) process.send({ type: 'failed', code: e.code || '', message: e.message || String(e) }); }

// ---------- Côté fenêtre (electron.js) ----------
// Lance le serveur dans son processus et répond à ses demandes. onExit : le serveur s'est arrêté tout seul.
function startServer({ script, env, onExit, quiet = false }) {
  const { fork } = require('child_process');
  const child = fork(script, [], {
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1', ROVEX_CHILD: '1' },
    serialization: 'advanced', windowsHide: true, stdio: ['ignore', quiet ? 'ignore' : 'inherit', quiet ? 'ignore' : 'inherit', 'ipc'], // app installée : pas de console
  });
  let started = false;
  const ready = new Promise((resolve, reject) => {
    child.on('message', async (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') { started = true; resolve(m.port); }
      if (m.type === 'failed') reject(Object.assign(new Error(m.message), { code: m.code }));
      if (m.type === 'call') {
        let value = null;
        let error = '';
        try { value = await (OPS[m.op] ? OPS[m.op](m.args || {}) : null); } catch (e) { error = e.message || String(e); }
        if (child.connected) child.send({ type: 'reply', id: m.id, value, error });
      }
    });
    child.on('exit', (code) => {
      if (!started) reject(new Error(`The Rovex Hub server stopped (code ${code})`));
      else if (onExit) onExit(code);
    });
  });
  const sendUpdate = (update) => { if (child.connected) child.send({ type: 'update', update }); };
  return { child, ready, sendUpdate };
}

module.exports = { CHILD, call, available, ready, failed, startServer, OPS };
