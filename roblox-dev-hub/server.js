// Serveur local de Roblox Dev Hub : interface web + API. Lancer avec `node server.js`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const web = require('./web');
const mcp = require('./mcp');
const { Crawler, youtubeSearch } = require('./crawler');
const { Auth, KEY_FILE } = require('./auth');
const os = require('os');

const PORT = Number(process.env.PORT) || 4747;
// HOST=0.0.0.0 rend le site accessible aux autres appareils (mode partagé).
const HOST = process.env.HOST || '127.0.0.1';
const CLOUD_DEFAULT = 'https://raw.githubusercontent.com/djylaneee-ship-it/Portfolio/refs/heads/claude/quirky-wright-c5ff4e/roblox-dev-hub/cloud/library.json';
const PUBLIC = path.join(__dirname, 'public');
const DB_FILE = path.join(db.DATA_DIR, 'library.json');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8', '.luau': 'text/plain; charset=utf-8', '.rbxm': 'application/octet-stream',
  '.rbxl': 'application/octet-stream', '.fbx': 'application/octet-stream', '.obj': 'text/plain', '.blend': 'application/octet-stream',
};

let state = db.load();
state.settings = state.settings || { youtubeApiKey: '' };

const auth = new Auth({ getState: () => state, persist: () => persist() });

const crawler = new Crawler({
  getState: () => state,
  persist: () => persist(),
  upsert: (d) => db.upsert(state, d, { fresh: true }),
  newId: db.newId,
});

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 2 * 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Fichier trop gros')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function json(req) {
  const b = await readBody(req, 5 * 1024 * 1024);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}

// Sert un fichier avec prise en charge des « Range » pour lire les vidéos locales.
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Introuvable' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(file).pipe(res);
    }
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, decodeURIComponent(rel)));
  return p.startsWith(base) ? p : null;
}

let mtime = 0;
function persist() { db.save(state); mtime = fs.statSync(DB_FILE).mtimeMs; }

// Claude (via mcp.js) peut écrire dans la base pendant que l'app tourne : on relit le fichier s'il a changé.
function refresh() {
  if (crawler.status.running) return; // pendant une exploration, la version en mémoire fait foi
  try {
    const m = fs.statSync(DB_FILE).mtimeMs;
    if (m !== mtime) { const settings = state.settings; state = db.load(); state.settings = state.settings || settings; mtime = m; }
  } catch {}
}

const routes = [
  ['GET', /^\/api\/meta$/, () => ({ categories: db.CATEGORIES, types: db.TYPES })],
  ['GET', /^\/api\/info$/, () => ({ mcpPath: path.join(__dirname, 'mcp.js'), node: process.execPath, port: PORT })],
  ['GET', /^\/api\/stats$/, () => db.stats(state)],
  ['GET', /^\/api\/resources$/, (req, m, url) => {
    const p = url.searchParams;
    const all = db.search(state, {
      q: p.get('q') || '', category: p.get('category') || '', type: p.get('type') || '',
      level: p.get('level') || '', favorite: p.get('favorite') === '1',
    });
    const offset = Number(p.get('offset')) || 0;
    const limit = Math.min(Number(p.get('limit')) || 60, 500);
    return { total: all.length, items: all.slice(offset, offset + limit) };
  }],
  ['POST', /^\/api\/resources$/, async (req) => {
    const r = db.upsert(state, { ...(await json(req)), source: 'manuel' });
    persist();
    return r.resource;
  }],
  ['PUT', /^\/api\/resources\/(\w+)$/, async (req, m) => {
    const r = state.resources.find((x) => x.id === m[1]);
    if (!r) throw Object.assign(new Error('Introuvable'), { code: 404 });
    Object.assign(r, db.normalize({ ...r, ...(await json(req)), id: r.id, createdAt: r.createdAt }));
    persist();
    return r;
  }],
  ['DELETE', /^\/api\/resources\/(\w+)$/, (req, m) => {
    const i = state.resources.findIndex((x) => x.id === m[1]);
    if (i < 0) throw Object.assign(new Error('Introuvable'), { code: 404 });
    const [r] = state.resources.splice(i, 1);
    if (r.file) fs.rm(path.join(db.MEDIA_DIR, r.file), () => {});
    persist();
    return { ok: true };
  }],
  ['POST', /^\/api\/import$/, async (req) => {
    const body = await json(req);
    const info = await web.importUrl(body.url);
    const r = db.upsert(state, { ...info, ...Object.fromEntries(Object.entries(body).filter(([k, v]) => k !== 'url' && v)) });
    persist();
    return r.resource;
  }],
  ['POST', /^\/api\/preview$/, async (req) => web.importUrl((await json(req)).url)],
  ['POST', /^\/api\/upload$/, async (req, m, url) => {
    const p = url.searchParams;
    const original = path.basename(p.get('name') || 'fichier');
    const ext = path.extname(original).toLowerCase();
    const file = `${Date.now()}-${original.replace(/[^\w.-]+/g, '_')}`;
    fs.writeFileSync(path.join(db.MEDIA_DIR, file), await readBody(req));
    const isImg = /\.(png|jpe?g|gif|webp|svg)$/.test(ext);
    const isVid = /\.(mp4|webm|mov)$/.test(ext);
    const r = db.upsert(state, {
      title: p.get('title') || original.replace(/\.[^.]+$/, ''),
      type: isImg ? 'image' : isVid ? 'video' : 'fichier',
      category: p.get('category') || (isImg ? 'gfx' : web.guessCategory(original)),
      tags: p.get('tags') || '',
      file, thumbnail: isImg ? `/media/${file}` : '', source: 'local',
    });
    persist();
    return r.resource;
  }],
  ['GET', /^\/api\/channels$/, (req, m, url) => {
    const p = url.searchParams;
    const q = (p.get('q') || '').toLowerCase();
    const all = state.channels.filter((c) => !q || `${c.name} ${c.handle}`.toLowerCase().includes(q));
    const offset = Number(p.get('offset')) || 0;
    return { total: all.length, followed: state.channels.length, items: all.slice(offset, offset + (Number(p.get('limit')) || 120)) };
  }],
  ['POST', /^\/api\/channels$/, async (req) => {
    const body = await json(req);
    const handle = String(body.handle || '').trim();
    if (!handle) throw new Error('Indique un @pseudo ou une URL de chaîne');
    const info = await web.resolveChannel(handle);
    if (state.channels.some((c) => c.channelId === info.channelId)) throw new Error('Chaîne déjà suivie');
    const ch = { id: db.newId(), handle, name: info.name, avatar: info.avatar, channelId: info.channelId, category: body.category || '', lastFetch: null };
    state.channels.push(ch);
    db.upsert(state, { title: info.name, url: info.url, type: 'chaine', author: info.name, thumbnail: info.avatar, category: body.category || 'scripting', source: 'veille' });
    persist();
    return ch;
  }],
  ['DELETE', /^\/api\/channels\/(\w+)$/, (req, m) => {
    state.channels = state.channels.filter((c) => c.id !== m[1]);
    persist();
    return { ok: true };
  }],
  ['POST', /^\/api\/channels\/sync$/, () => crawler.start({ mode: 'sync' })],
  ['GET', /^\/api\/crawl$/, () => crawler.status],
  ['POST', /^\/api\/crawl$/, async (req) => crawler.start({ ...(await json(req)), apiKey: state.settings.youtubeApiKey, githubToken: state.settings.githubToken })],
  ['POST', /^\/api\/crawl\/stop$/, () => { crawler.stop(); return crawler.status; }],
  ['GET', /^\/api\/youtube$/, (req, m, url) => youtubeSearch(url.searchParams.get('q') || 'roblox studio', 2, state.settings.youtubeApiKey)],
  ['GET', /^\/api\/settings$/, () => ({ youtubeApiKey: state.settings.youtubeApiKey ? '••••' + state.settings.youtubeApiKey.slice(-4) : '', hasKey: Boolean(state.settings.youtubeApiKey), hasGithub: Boolean(state.settings.githubToken), autoSyncHours: state.settings.autoSyncHours || 0, lastAutoSync: state.settings.lastAutoSync || null, cloudUrl: state.settings.cloudUrl ?? CLOUD_DEFAULT, lastCloudSync: state.settings.lastCloudSync || null, lastCloudAdded: state.settings.lastCloudAdded ?? null, cloudUpdatedAt: state.settings.cloudUpdatedAt || null })],
  ['PUT', /^\/api\/settings$/, async (req) => {
    const b = await json(req);
    if (typeof b.youtubeApiKey === 'string') state.settings.youtubeApiKey = b.youtubeApiKey.trim();
    if (typeof b.githubToken === 'string') state.settings.githubToken = b.githubToken.trim();
    if (typeof b.cloudUrl === 'string') state.settings.cloudUrl = b.cloudUrl.trim();
    if (b.autoSyncHours !== undefined) state.settings.autoSyncHours = Math.max(0, Number(b.autoSyncHours) || 0);
    persist();
    return { ok: true };
  }],
  ['GET', /^\/api\/export$/, () => ({ ...state, auth: undefined })],
  ['POST', /^\/api\/cloud\/sync$/, () => cloudSync()],
  ['GET', /^\/api\/admin\/codes$/, () => auth.list()],
  ['POST', /^\/api\/admin\/codes$/, async (req) => auth.create(await json(req))],
  ['PUT', /^\/api\/admin\/codes\/(\w+)$/, async (req, m) => auth.update(m[1], await json(req))],
  ['DELETE', /^\/api\/admin\/codes\/(\w+)$/, (req, m) => { auth.remove(m[1]); return { ok: true }; }],
  ['GET', /^\/api\/admin\/info$/, () => ({
    host: HOST, port: PORT, shared: HOST !== '127.0.0.1',
    addresses: Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`),
    keyFile: KEY_FILE,
  })],
  ['POST', /^\/api\/admin\/reset-key$/, () => ({ key: auth.resetMasterKey() })],
];

// Routes accessibles à un ID d'accès simple (lecture seule). Tout le reste est réservé à l'admin.
const USER_ROUTES = [/^\/api\/meta$/, /^\/api\/stats$/, /^\/api\/resources$/, /^\/api\/channels$/, /^\/api\/youtube$/, /^\/api\/crawl$/];

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const clientIp = (req) => req.socket.remoteAddress || '';
const isLoopback = (req) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(clientIp(req)) && !req.headers['x-forwarded-for'];

function setSession(res, token, expiresAt) {
  const maxAge = token ? Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)) : 0;
  res.setHeader('Set-Cookie', `rdh_session=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

async function authRoutes(req, res, url) {
  if (url.pathname === '/api/login' && req.method === 'POST') {
    try {
      const s = auth.login((await json(req)).code, clientIp(req));
      setSession(res, s.token, s.expiresAt);
      return send(res, 200, { role: s.role, label: s.label, expiresAt: s.expiresAt });
    } catch (e) { return send(res, e.code || 400, { error: e.message }); }
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    auth.logout(cookies(req).rdh_session);
    setSession(res, '');
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/session') {
    const s = auth.check(cookies(req).rdh_session);
    return send(res, 200, s ? { loggedIn: true, role: s.role, label: s.label, expiresAt: s.expiresAt } : { loggedIn: false });
  }
  return false;
}

// Récupère les trouvailles de l'algo cloud (GitHub Actions) et les ajoute à la base.
let cloudBusy = false;
async function cloudSync() {
  const src = state.settings.cloudUrl ?? CLOUD_DEFAULT;
  if (!src) throw new Error('Aucune source cloud configurée');
  if (cloudBusy) throw new Error('Synchronisation déjà en cours');
  if (crawler.status.running) throw new Error('Attends la fin de l\'exploration en cours');
  cloudBusy = true;
  try {
    const token = state.settings.githubToken;
    const res = await fetch(src, { headers: { 'User-Agent': 'roblox-dev-hub', ...(token && { Authorization: `token ${token}` }) }, signal: AbortSignal.timeout(120000) });
    if (res.status === 404) throw new Error('Fichier cloud introuvable : l\'algo n\'a pas encore tourné, ou le dépôt est privé (ajoute un jeton GitHub)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cloud = await res.json();
    const urls = new Set(state.resources.map((r) => r.url).filter(Boolean));
    let added = 0;
    for (const r of cloud.resources || []) {
      if (!r.url || urls.has(r.url)) continue;
      urls.add(r.url);
      state.resources.push(db.normalize({ ...r, id: undefined, source: 'cloud', favorite: false }));
      added++;
    }
    const ids = new Set(state.channels.map((c) => c.channelId).filter(Boolean));
    let chans = 0;
    for (const c of cloud.channels || []) {
      if (!c.channelId || ids.has(c.channelId)) continue;
      ids.add(c.channelId);
      state.channels.push({ ...c, id: db.newId() });
      chans++;
    }
    Object.assign(state.settings, { lastCloudSync: new Date().toISOString(), lastCloudAdded: added, cloudUpdatedAt: cloud.updatedAt || null });
    persist();
    return { added, channels: chans, total: (cloud.resources || []).length, cloudUpdatedAt: cloud.updatedAt };
  } finally {
    cloudBusy = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Protection : on refuse les requêtes d'écriture venant d'un autre site.
  if (req.method !== 'GET' && req.headers.origin) {
    let host = '';
    try { host = new URL(req.headers.origin).host; } catch {}
    if (host !== req.headers.host) return send(res, 403, { error: 'Origine refusée' });
  }
  if (url.pathname === '/mcp') {
    // Endpoint MCP « Streamable HTTP » (réponses JSON simples, pas de flux SSE).
    // Libre depuis ce PC ; depuis ailleurs, il faut « Authorization: Bearer <ID ou clé admin> ».
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const local = isLoopback(req) && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
    if (!local && !auth.checkCode(bearer)) return send(res, 401, { error: 'ID d\'accès requis' });
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
    let msg;
    try { msg = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8')); }
    catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const out = Array.isArray(msg) ? (await Promise.all(msg.map(mcp.handle))).filter(Boolean) : await mcp.handle(msg);
    if (!out || (Array.isArray(out) && !out.length)) { res.writeHead(202); return res.end(); }
    return send(res, 200, out);
  }
  if (url.pathname.startsWith('/api/')) {
    refresh();
    if (await authRoutes(req, res, url) !== false) return;
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const session = auth.check(cookies(req).rdh_session) || auth.checkCode(bearer);
    if (!session) return send(res, 401, { error: 'Connecte-toi avec ton ID d\'accès' });
    if (session.role !== 'admin' && !(req.method === 'GET' && USER_ROUTES.some((re) => re.test(url.pathname)))) {
      return send(res, 403, { error: 'Réservé à l\'admin' });
    }
    for (const [method, re, fn] of routes) {
      const m = url.pathname.match(re);
      if (m && method === req.method) {
        try { return send(res, 200, await fn(req, m, url)); }
        catch (e) { return send(res, e.code || 400, { error: e.message }); }
      }
    }
    return send(res, 404, { error: 'Route inconnue' });
  }
  if (url.pathname.startsWith('/media/')) {
    if (!auth.check(cookies(req).rdh_session)) return send(res, 401, { error: 'Connexion requise' });
    const f = safeJoin(db.MEDIA_DIR, url.pathname.slice(7));
    return f ? serveFile(req, res, f) : send(res, 403, { error: 'Interdit' });
  }
  const f = safeJoin(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  return f ? serveFile(req, res, f) : send(res, 403, { error: 'Interdit' });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  Roblox Dev Hub tourne déjà  →  http://localhost:${PORT}\n`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Roblox Dev Hub prêt  →  http://localhost:${PORT}`);
  if (HOST !== '127.0.0.1') {
    for (const i of Object.values(os.networkInterfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) console.log(`  Mode partagé         →  http://${i.address}:${PORT}`);
  }
  console.log(`\n  Clé admin (permanente) : ${auth.masterKey()}`);
  console.log(`  (aussi enregistrée dans ${KEY_FILE})\n  Ctrl+C pour arrêter\n`);
});


// Mise à jour automatique : récupère les nouvelles vidéos des chaînes suivies à intervalle régulier.
setInterval(() => {
  const h = state.settings.autoSyncHours;
  if (!h || crawler.status.running || !state.channels.length) return;
  const last = state.settings.lastAutoSync ? Date.parse(state.settings.lastAutoSync) : 0;
  if (Date.now() - last < h * 3600e3) return;
  state.settings.lastAutoSync = new Date().toISOString();
  crawler.start({ mode: 'sync' });
}, 60e3);

// Source cloud : récupère les trouvailles de l'algo GitHub toutes les 30 minutes.
setInterval(() => { if (state.settings.cloudUrl !== '') cloudSync().catch(() => {}); }, 30 * 60e3);
setTimeout(() => { if (state.settings.cloudUrl !== '') cloudSync().catch(() => {}); }, 10e3);
setInterval(() => auth.sweep(), 3600e3);
