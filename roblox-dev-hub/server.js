// Serveur local de Rovex Hub : interface web + API. Lancer avec `node server.js`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const web = require('./web');
const mcp = require('./mcp');
const { Crawler, youtubeSearch } = require('./crawler');
const { Auth, KEY_FILE } = require('./auth');
const os = require('os');
const claude = require('./claude');
const level = require('./level');
const quality = require('./quality');
const skills = require('./skills');
const cloud = require('./cloud');
const gen = require('./gen');
const APP_VERSION = require('./package.json').version;

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

// Nettoyage unique des bases créées avant le filtre qualité.
if (!state.settings.cleanedV1) {
  const r = quality.purge(state);
  state.settings.cleanedV1 = true;
  db.save(state);
  if (r.resources || r.channels) console.log(`  Quality filter: removed ${r.resources} off-topic items and ${r.channels} gameplay channels.`);
}
// En mode HTTP, le serveur MCP travaille sur la même base en mémoire que l'app.
mcp.useStore({ load: () => state, save: () => persist() });

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
      if (size > limit) { reject(Object.assign(new Error('File too large'), { key: 'tooBig' })); req.destroy(); return; }
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
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found', key: 'notFound' });
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
  ['GET', /^\/api\/stats$/, () => ({ ...db.stats(state), opensource: state.resources.filter((r) => r.type === 'opensource' || r.type === 'asset').length,
    // Compteurs de la bibliothèque d'apprentissage (sans l'open source, qui a sa page).
    learnByCategory: state.resources.reduce((acc, r) => { if (r.type !== 'opensource' && r.type !== 'asset') acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {}), examples: (state.examples || []).filter((e) => e.status === 'validated').length })],
  ['GET', /^\/api\/resources$/, (req, m, url) => {
    const p = url.searchParams;
    const list = (k) => (p.get(k) || '').split(',').filter(Boolean);
    const all = db.search(state, {
      q: p.get('q') || '', category: p.get('category') || '', type: p.get('type') || '',
      types: list('types'), exclude: list('exclude'), tag: p.get('tag') || '', sort: p.get('sort') || '',
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
    if (!r) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
    Object.assign(r, db.normalize({ ...r, ...(await json(req)), id: r.id, createdAt: r.createdAt }));
    persist();
    return r;
  }],
  ['DELETE', /^\/api\/resources\/(\w+)$/, (req, m) => {
    const i = state.resources.findIndex((x) => x.id === m[1]);
    if (i < 0) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
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
    if (!handle) throw Object.assign(new Error('Enter a @handle or channel URL'), { key: 'channelMissing' });
    const info = await web.resolveChannel(handle);
    if (state.channels.some((c) => c.channelId === info.channelId)) throw Object.assign(new Error('Channel already linked'), { key: 'channelExists' });
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
    if (['en', 'fr', 'es', 'pt'].includes(b.lang)) state.settings.lang = b.lang;
    if (b.autoSyncHours !== undefined) state.settings.autoSyncHours = Math.max(0, Number(b.autoSyncHours) || 0);
    persist();
    return { ok: true };
  }],
  // Studio IA : images et sons générés avec les clés API de l'utilisateur (ouvert aux membres).
  ['GET', /^\/api\/gen$/, () => ({ ...gen.status(state), kinds: Object.keys(gen.IMAGE_KINDS), items: gen.items(state) })],
  ['PUT', /^\/api\/gen\/settings$/, async (req) => {
    const b = await json(req);
    const g = gen.settings(state);
    for (const k of ['openaiKey', 'geminiKey', 'elevenKey']) if (typeof b[k] === 'string') g[k] = b[k].trim();
    for (const k of ['openaiModel', 'geminiModel', 'elevenVoice']) if (typeof b[k] === 'string') g[k] = b[k].trim().slice(0, 80);
    if (['openai', 'gemini'].includes(b.imageProvider)) g.imageProvider = b.imageProvider;
    persist();
    return gen.status(state);
  }],
  ['POST', /^\/api\/gen\/image$/, async (req) => {
    const out = await gen.generateImage(state, await json(req));
    delete out.images;
    persist();
    return out;
  }],
  ['POST', /^\/api\/gen\/sound$/, async (req) => {
    const out = await gen.generateSound(state, await json(req));
    persist();
    return out;
  }],
  ['DELETE', /^\/api\/gen\/(\w+)$/, (req, m) => {
    const r = state.resources.find((x) => x.id === m[1] && x.source === 'ai');
    if (!r) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
    try { if (r.file) fs.rmSync(path.join(db.MEDIA_DIR, r.file), { force: true }); } catch {}
    state.resources = state.resources.filter((x) => x !== r);
    persist();
    return { ok: true };
  }],
  // Version de l'app et mises à jour (app de bureau).
  ['GET', /^\/api\/version$/, () => ({ version: APP_VERSION, desktop: Boolean(process.versions.electron), online: auth.online, update: global.rovexUpdate || null })],
  ['POST', /^\/api\/update\/check$/, () => { if (global.rovexCheckUpdates) global.rovexCheckUpdates(); return { ok: Boolean(global.rovexCheckUpdates) }; }],
  ['POST', /^\/api\/update\/install$/, () => { if (global.rovexInstallUpdate) global.rovexInstallUpdate(); return { ok: true }; }],
  ['GET', /^\/api\/export$/, () => ({ ...state, auth: undefined })],
  ['POST', /^\/api\/cloud\/sync$/, () => cloudSync()],
  // Skills : un par catégorie.
  ['GET', /^\/api\/skills$/, () => ({
    codeInstalled: skills.codeInstalled(), codeDir: skills.CODE_SKILLS,
    skills: skills.SKILL_CATS.map((c) => ({ ...skills.getSkill(state, c), totals: skills.context(state, c).totals })),
  })],
  ['GET', /^\/api\/skills\/(\w+)$/, (req, m) => {
    if (!skills.SKILL_CATS.includes(m[1])) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
    return { ...skills.getSkill(state, m[1]), defaultInstructions: skills.DEFAULTS[m[1]], defaultArt: skills.ART[m[1]] || '', context: skills.context(state, m[1]), skillMd: skills.skillMd(state, m[1]) };
  }],
  ['PUT', /^\/api\/skills\/(\w+)$/, async (req, m, url, session) => {
    if (!skills.SKILL_CATS.includes(m[1])) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
    const b = await json(req);
    state.skills = state.skills || {};
    const cur = state.skills[m[1]] || {};
    if (b.reset) delete cur.instructions;
    if (typeof b.instructions === 'string') cur.instructions = b.instructions.trim() === skills.DEFAULTS[m[1]].trim() ? undefined : b.instructions;
    if (typeof b.enabled === 'boolean') cur.enabled = b.enabled;
    if (typeof b.art === 'string') cur.art = b.art.trim() === (skills.ART[m[1]] || '').trim() ? undefined : b.art;
    cur.updatedAt = new Date().toISOString();
    state.skills[m[1]] = cur;
    persist();
    syncCodeSkills();
    sharedPush(session);
    return skills.getSkill(state, m[1]);
  }],
  ['POST', /^\/api\/skills\/install-code$/, () => skills.installForClaudeCode(state)],
  ['POST', /^\/api\/clean$/, () => { const r = quality.purge(state); persist(); return r; }],
  // Exemples d'apprentissage : les membres voient les exemples validés, l'admin voit tout.
  ['GET', /^\/api\/examples$/, (req, m, url, session) => (state.examples || []).filter((e) => session.role === 'admin' || e.status === 'validated')],
  ['POST', /^\/api\/examples$/, async (req, m, url, session) => {
    const e = db.normalizeExample(await json(req));
    state.examples = state.examples || [];
    state.examples.unshift(e);
    persist();
    syncCodeSkills();
    sharedPush(session);
    return e;
  }],
  ['PUT', /^\/api\/examples\/(\w+)$/, async (req, m, url, session) => {
    const i = (state.examples || []).findIndex((x) => x.id === m[1]);
    if (i < 0) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
    state.examples[i] = db.normalizeExample({ ...state.examples[i], ...(await json(req)), id: m[1], createdAt: state.examples[i].createdAt });
    persist();
    syncCodeSkills();
    sharedPush(session);
    return state.examples[i];
  }],
  ['DELETE', /^\/api\/examples\/(\w+)$/, (req, m, url, session) => {
    state.examples = (state.examples || []).filter((x) => x.id !== m[1]);
    tombstone('examples', m[1]);
    persist();
    syncCodeSkills();
    sharedPush(session);
    return { ok: true };
  }],
  // Modèles de prompts perso (les modèles de base sont dans public/prompts.js).
  ['GET', /^\/api\/prompts$/, () => state.prompts || []],
  ['POST', /^\/api\/prompts$/, async (req, m, url, session) => {
    const b = await json(req);
    const title = String(b.title || '').trim().slice(0, 120);
    const text = String(b.text || '').trim().slice(0, 8000);
    if (!title || !text) throw Object.assign(new Error('Title and text required'), { code: 400, key: 'required' });
    const cat = db.CATEGORIES.some((c) => c.id === b.cat) ? b.cat : '';
    const p = { id: db.newId(), title, text, cat, kind: 'custom', createdAt: new Date().toISOString() };
    state.prompts = [p, ...(state.prompts || [])];
    persist();
    sharedPush(session);
    return p;
  }],
  ['DELETE', /^\/api\/prompts\/(\w+)$/, (req, m, url, session) => {
    state.prompts = (state.prompts || []).filter((x) => x.id !== m[1]);
    tombstone('prompts', m[1]);
    persist();
    sharedPush(session);
    return { ok: true };
  }],
  // Connexion Claude : état, outils activés, consignes, journal et test.
  ['GET', /^\/api\/mcp$/, (req, m, url, session) => {
    const log = state.mcpLog || [];
    const last = log[0] ? Date.parse(log[0].t) : 0;
    const clients = mcp.clients();
    const base = { connected: clients.some((c) => c.alive) || Date.now() - last < 15 * 60e3, clients, lastCall: log[0] ? log[0].t : null, log: log.slice(0, 30), url: `http://localhost:${PORT}/mcp` };
    if (session.role !== 'admin') return base;
    const off = state.settings.mcpTools || {};
    return {
      ...base,
      tools: mcp.TOOLS.map((x) => ({ name: x.name, description: x.description, enabled: off[x.name] !== false })),
      instructions: state.settings.mcpInstructions || mcp.DEFAULT_INSTRUCTIONS,
      defaultInstructions: mcp.DEFAULT_INSTRUCTIONS,
      mcpPath: path.join(__dirname, 'mcp.js'),
    };
  }],
  ['PUT', /^\/api\/mcp$/, async (req) => {
    const b = await json(req);
    if (b.tools && typeof b.tools === 'object') state.settings.mcpTools = { ...(state.settings.mcpTools || {}), ...b.tools };
    if (typeof b.instructions === 'string') state.settings.mcpInstructions = b.instructions.trim() === mcp.DEFAULT_INSTRUCTIONS.trim() ? '' : b.instructions;
    persist();
    return { ok: true };
  }],
  // Niveau de Claude (visible par tous les connectés).
  ['GET', /^\/api\/level$/, () => {
    const lv = level.compute(state);
    if (level.snapshot(state, lv)) persist();
    return { ...lv, history: state.levelHistory || [] };
  }],
  // Claude Desktop / Claude Code : détection et branchement.
  ['GET', /^\/api\/claude$/, async () => {
    const cl = mcp.clients();
    const pick = (re) => cl.filter((c) => re.test(c.name)).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0] || null;
    return {
      desktop: { ...claude.desktopStatus(), client: pick(/claude-ai|claude desktop|^claude$/i) },
      code: { ...(await claude.codeStatus()), client: pick(/claude-code|claude code/i) },
      auto: state.settings.autoConnectClaude !== false,
    };
  }],
  ['POST', /^\/api\/claude\/desktop$/, () => { state.settings.autoConnectClaude = true; persist(); return claude.linkDesktop(); }],
  ['DELETE', /^\/api\/claude\/desktop$/, () => { state.settings.autoConnectClaude = false; persist(); return claude.unlinkDesktop(); }],
  ['POST', /^\/api\/claude\/code$/, () => claude.linkCode(`http://localhost:${PORT}/mcp`)],
  ['POST', /^\/api\/mcp\/test$/, async (req) => {
    const q = String((await json(req)).query || '').slice(0, 200);
    return mcp.call('search_resources', { query: q, limit: 8 });
  }],
  ['GET', /^\/api\/admin\/codes$/, (req, m, url, session) => auth.list(session)],
  ['POST', /^\/api\/admin\/codes$/, async (req, m, url, session) => auth.create(await json(req), session)],
  ['PUT', /^\/api\/admin\/codes\/(\w+)$/, async (req, m, url, session) => auth.update(m[1], await json(req), session)],
  ['DELETE', /^\/api\/admin\/codes\/(\w+)$/, async (req, m, url, session) => { await auth.remove(m[1], session); return { ok: true }; }],
  ['GET', /^\/api\/admin\/info$/, (req, m, url, session) => ({
    host: HOST, port: PORT, shared: HOST !== '127.0.0.1', online: auth.online, offline: Boolean(session.offline), master: Boolean(session.master),
    addresses: Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`),
    keyFile: KEY_FILE, download: DOWNLOAD_URL, lastShared: state.settings.lastSharedSync || null,
  })],
  ['POST', /^\/api\/admin\/reset-key$/, async (req, m, url, session) => ({ key: await auth.resetMasterKey(session) })],
];

// Routes accessibles à un ID d'accès simple (lecture seule). Tout le reste est réservé à l'admin.
const USER_ROUTES = [/^\/api\/version$/, /^\/api\/prompts$/, /^\/api\/skills$/, /^\/api\/skills\/\w+$/, /^\/api\/level$/, /^\/api\/meta$/, /^\/api\/stats$/, /^\/api\/resources$/, /^\/api\/channels$/, /^\/api\/youtube$/, /^\/api\/crawl$/, /^\/api\/examples$/, /^\/api\/mcp$/];

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
      const s = await auth.login((await json(req)).code, clientIp(req));
      setSession(res, s.token, s.expiresAt);
      sharedPull().catch(() => {});
      return send(res, 200, { role: s.role, label: s.label, expiresAt: s.expiresAt });
    } catch (e) { return send(res, e.code || 400, { error: e.message, key: e.key }); }
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    auth.logout(cookies(req).rdh_session);
    setSession(res, '');
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/session') {
    const s = auth.check(cookies(req).rdh_session);
    return send(res, 200, s ? { loggedIn: true, role: s.role, label: s.label, expiresAt: s.expiresAt, permanent: Boolean(s.permanent || !s.codeId), master: Boolean(s.master), offline: Boolean(s.offline) } : { loggedIn: false });
  }
  return false;
}

// Récupère les trouvailles de l'algo cloud (GitHub Actions) et les ajoute à la base.
let cloudBusy = false;
async function cloudSync() {
  const src = state.settings.cloudUrl ?? CLOUD_DEFAULT;
  if (!src) throw Object.assign(new Error('No cloud source configured'), { key: 'cloudNone' });
  if (cloudBusy) throw Object.assign(new Error('Sync already running'), { key: 'cloudBusy' });
  if (crawler.status.running) throw Object.assign(new Error('Wait for the running exploration to finish'), { key: 'cloudCrawling' });
  cloudBusy = true;
  try {
    const token = state.settings.githubToken;
    const res = await fetch(src, { headers: { 'User-Agent': 'roblox-dev-hub', ...(token && { Authorization: `token ${token}` }) }, signal: AbortSignal.timeout(120000) });
    if (res.status === 404) throw Object.assign(new Error('Cloud file not found'), { key: 'cloudMissing' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cloud = await res.json();
    const urls = new Set(state.resources.map((r) => r.url).filter(Boolean));
    let added = 0;
    for (const r of cloud.resources || []) {
      if (!r.url || urls.has(r.url)) continue;
      const social = r.type === 'video' || (r.tags || []).some((x) => x === 'youtube' || x === 'reddit');
      if (social ? !quality.check(r).ok : quality.isBanned(r)) continue;
      urls.add(r.url);
      state.resources.push(db.normalize({ ...r, id: undefined, source: 'cloud', favorite: false }));
      added++;
    }
    const ids = new Set(state.channels.map((c) => c.channelId).filter(Boolean));
    let chans = 0;
    for (const c of cloud.channels || []) {
      if (!c.channelId || ids.has(c.channelId) || c.category === 'gameplay') continue;
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
    if (host !== req.headers.host) return send(res, 403, { error: 'Origin refused', key: 'forbidden' });
  }
  if (url.pathname === '/mcp') {
    // Endpoint MCP « Streamable HTTP » (réponses JSON simples, pas de flux SSE).
    // Libre depuis ce PC ; depuis ailleurs, il faut « Authorization: Bearer <ID ou clé admin> ».
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const local = isLoopback(req) && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
    if (!local && !auth.checkCode(bearer)) return send(res, 401, { error: 'Access ID required', key: 'loginRequired' });
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
    if (session && url.pathname === '/api/admin/reset-key' && session.codeId) return send(res, 403, { error: 'Only the main admin key can do this', key: 'masterOnly' });
    if (!session) return send(res, 401, { error: 'Sign in with your access ID', key: 'loginRequired' });
    const genRoute = url.pathname === '/api/gen' || url.pathname.startsWith('/api/gen/');
    if (session.role !== 'admin' && !genRoute && !(req.method === 'GET' && USER_ROUTES.some((re) => re.test(url.pathname)))) {
      return send(res, 403, { error: 'Admin only', key: 'adminOnly' });
    }
    const zipM = url.pathname.match(/^\/api\/skills\/(\w+)\/zip$/);
    if (zipM && session.role === 'admin' && skills.SKILL_CATS.includes(zipM[1])) {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="rovex-${zipM[1]}.zip"` });
      return res.end(skills.skillZip(state, zipM[1]));
    }
    for (const [method, re, fn] of routes) {
      const m = url.pathname.match(re);
      if (m && method === req.method) {
        try { return send(res, 200, await fn(req, m, url, session)); }
        catch (e) { return send(res, e.code || 400, { error: e.message, key: e.key, vars: e.vars }); }
      }
    }
    return send(res, 404, { error: 'Unknown route', key: 'notFound' });
  }
  if (url.pathname.startsWith('/media/')) {
    if (!auth.check(cookies(req).rdh_session)) return send(res, 401, { error: 'Sign-in required', key: 'loginRequired' });
    const f = safeJoin(db.MEDIA_DIR, url.pathname.slice(7));
    return f ? serveFile(req, res, f) : send(res, 403, { error: 'Forbidden', key: 'forbidden' });
  }
  const f = safeJoin(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  return f ? serveFile(req, res, f) : send(res, 403, { error: 'Forbidden', key: 'forbidden' });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && !process.versions.electron) {
    console.log(`\n  Rovex Hub is already running  →  http://localhost:${PORT}\n`);
    process.exit(0);
  }
  if (process.versions.electron) return readyFail(e);
  throw e;
});

// L'app de bureau attend que le serveur écoute avant d'ouvrir sa fenêtre.
let readyOk, readyFail;
module.exports.ready = new Promise((res, rej) => { readyOk = res; readyFail = rej; });
module.exports.ready.catch(() => {});
module.exports.PORT = PORT;

server.listen(PORT, HOST, () => {
  console.log(`\n  Rovex Hub ready  →  http://localhost:${PORT}`);
  if (HOST !== '127.0.0.1') {
    for (const i of Object.values(os.networkInterfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) console.log(`  Shared mode          →  http://${i.address}:${PORT}`);
  }
  console.log(`\n  Admin key (permanent) / Clé admin : ${auth.masterKey()}`);
  console.log(`  (saved in ${KEY_FILE})\n  Ctrl+C to stop\n`);
  readyOk(PORT);
  autoConnectClaude();
  sharedPull().catch(() => {});
});

// ---------- Contenu partagé en ligne : exemples, skills et prompts des admins ----------
// Les membres reçoivent ce que les admins publient ; les deux admins restent synchronisés.
const DOWNLOAD_URL = 'https://github.com/djylaneee-ship-it/Portfolio/releases/latest';
function tombstone(kind, id) {
  state.sharedDeleted = state.sharedDeleted || { examples: {}, prompts: {} };
  state.sharedDeleted[kind] = state.sharedDeleted[kind] || {};
  state.sharedDeleted[kind][id] = Date.now();
}
async function sharedPull() {
  const c = auth.online && state.auth && state.auth.lastCred;
  if (!c) return false;
  const changed = await cloud.pull(state, c.code);
  state.settings.lastSharedSync = new Date().toISOString();
  persist();
  if (changed) syncCodeSkills();
  return changed;
}
let pushTimer = null;
function sharedPush(session) {
  if (!auth.online || !session || session.role !== 'admin' || !session.cred) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    cloud.push(state, session.cred).then(() => { state.settings.lastSharedSync = new Date().toISOString(); persist(); }).catch(() => {});
  }, 3000);
}
setInterval(() => sharedPull().catch(() => {}), 15 * 60e3);

// Les skills installés dans Claude Code sont réécrits quand un skill ou un exemple change.
function syncCodeSkills() {
  try { if (skills.codeInstalled()) skills.installForClaudeCode(state); } catch {}
}

// Au démarrage : si Claude Desktop est installé, on y branche Rovex Hub automatiquement
// (sauf si l'admin l'a débranché). Claude Code est branché aussi s'il est présent.
async function autoConnectClaude() {
  if (state.settings.autoConnectClaude === false || process.env.ROVEX_NO_AUTOCONNECT) return;
  try {
    const st = claude.desktopStatus();
    if (st.installed && (!st.linked || st.outdated)) {
      claude.linkDesktop();
      console.log('  Claude Desktop detected: Rovex Hub added. Restart Claude Desktop to use it.');
    } else if (st.linked) {
      console.log('  Claude Desktop: Rovex Hub connected.');
    }
  } catch (e) { console.log('  Claude Desktop: ' + e.message); }
  try {
    const code = await claude.codeStatus();
    if (code.installed && !code.linked) {
      await claude.linkCode(`http://localhost:${PORT}/mcp`);
      console.log('  Claude Code detected: Rovex Hub added.');
    }
    if (code.installed) {
      skills.installForClaudeCode(state);
      console.log('  Claude Code: Rovex skills installed in ' + skills.CODE_SKILLS);
    }
  } catch {}
}


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
