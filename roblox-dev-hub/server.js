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
const studio = require('./studio');
const place = require('./place');
const rbxupload = require('./rbxupload');
const textures = require('./vfx-textures');
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
// Le chat Claude intégré (2.13.0) a été retiré : on efface la clé Claude qu'il avait pu garder sur ce PC.
try { fs.unlinkSync(path.join(db.DATA_DIR, 'claude-key.bin')); } catch {}
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
  ['GET', /^\/api\/settings$/, () => ({ youtubeApiKey: state.settings.youtubeApiKey ? '••••' + state.settings.youtubeApiKey.slice(-4) : '', hasKey: Boolean(state.settings.youtubeApiKey), hasGithub: Boolean(state.settings.githubToken), autoSyncHours: state.settings.autoSyncHours || 0, lastAutoSync: state.settings.lastAutoSync || null, cloudUrl: state.settings.cloudUrl ?? CLOUD_DEFAULT, lastCloudSync: state.settings.lastCloudSync || null, lastCloudAdded: state.settings.lastCloudAdded ?? null, cloudUpdatedAt: state.settings.cloudUpdatedAt || null, lastLibSync: state.settings.lastLibSync || null, lastLibAdded: state.settings.lastLibAdded ?? null })],
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
  ['GET', /^\/api\/gen$/, async () => {
    await gen.refreshShared();
    return { ...gen.status(state), quota: await gen.quota(state), kinds: Object.keys(gen.IMAGE_KINDS), items: gen.items(state) };
  }],
  // Limite d'images par jour et par ID (admins).
  ['PUT', /^\/api\/gen\/limits$/, async (req, m, url, session) => {
    if (session.role !== 'admin') throw Object.assign(new Error('Admin only'), { code: 403, key: 'adminOnly' });
    const b = await json(req);
    const n = (v) => (v === undefined || v === '' ? null : Number(v));
    cloud.must(await cloud.rpc('rovex_gen_set_limits', { p_key: session.cred, p_images: n(b.images), p_sounds: null, p_texts: n(b.texts) }));
    return { ok: true };
  }],
  // Prompt Booster : l'IA (Groq) réécrit une demande en prompt détaillé pour Claude + Rovex.
  ['GET', /^\/api\/gen\/boost$/, async () => {
    await gen.refreshShared();
    const q = await gen.quota(state);
    return { ...gen.status(state).text, quota: q && q.text, history: state.boosts || [] };
  }],
  ['POST', /^\/api\/gen\/enhance$/, async (req) => {
    const out = await gen.enhancePrompt(state, await json(req));
    persist();
    return out;
  }],
  ['POST', /^\/api\/gen\/image$/, async (req) => {
    const out = await gen.generateImage(state, await json(req));
    delete out.images;
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
  ['POST', /^\/api\/cloud\/sync$/, async () => {
    const lib = await librarySync().catch(() => ({ added: 0 }));
    const old = await cloudSync().catch(() => ({ added: 0, channels: 0 }));
    return { ...old, added: (lib.added || 0) + (old.added || 0) };
  }],
  // Skills : un par catégorie.
  ['GET', /^\/api\/skills$/, () => ({
    codeInstalled: skills.codeInstalled(), codeDir: skills.CODE_SKILLS,
    core: skills.getSkill(state, skills.CORE_ID),
    skills: skills.SKILL_CATS.map((c) => ({ ...skills.getSkill(state, c), totals: skills.context(state, c).totals })),
  })],
  ['GET', /^\/api\/skills\/(\w+)$/, (req, m) => {
    if (m[1] === skills.CORE_ID) return { ...skills.getSkill(state, m[1]), defaultInstructions: skills.DEFAULTS[m[1]], defaultArt: '' };
    if (!skills.SKILL_CATS.includes(m[1])) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
    return { ...skills.getSkill(state, m[1]), defaultInstructions: skills.DEFAULTS[m[1]], defaultArt: skills.ART[m[1]] || '', context: skills.context(state, m[1]), skillMd: skills.skillMd(state, m[1]) };
  }],
  ['PUT', /^\/api\/skills\/(\w+)$/, async (req, m, url, session) => {
    if (!skills.SKILL_CATS.includes(m[1]) && m[1] !== skills.CORE_ID) throw Object.assign(new Error('Not found'), { code: 404, key: 'notFound' });
    const b = await json(req);
    state.skills = state.skills || {};
    const cur = state.skills[m[1]] || {};
    // Consignes écrites pour une ancienne version des skills : remplacées par les nouveaux textes.
    if ((cur.v || 1) < skills.VERSION) delete cur.instructions;
    cur.v = skills.VERSION;
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
    const log = mcp.activity().log || [];
    const last = log[0] ? Date.parse(log[0].t) : 0;
    const clients = mcp.clients();
    const base = {
      connected: clients.some((c) => c.alive) || Date.now() - last < 15 * 60e3, clients, lastCall: log[0] ? log[0].t : null, log: log.slice(0, 30),
      url: `http://localhost:${PORT}/mcp`, mcpPath: path.join(__dirname, 'mcp.js'), desktopEntry: claude.entry(),
    };
    if (session.role !== 'admin') return base;
    const off = state.settings.mcpTools || {};
    return {
      ...base,
      tools: mcp.TOOLS.map((x) => ({ name: x.name, description: x.description, enabled: off[x.name] !== false })),
      instructions: state.settings.mcpInstructions || mcp.DEFAULT_INSTRUCTIONS,
      defaultInstructions: mcp.DEFAULT_INSTRUCTIONS,
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
    const lv = level.compute({ ...state, mcpStats: mcp.activity().stats });
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
  // Envoie un texte à Claude : nouvelle conversation pré-remplie (Claude Desktop, Claude Code ou claude.ai).
  ['POST', /^\/api\/claude\/send$/, async (req) => {
    const b = await json(req);
    const target = ['desktop', 'code', 'web'].includes(b.target) ? b.target : 'desktop';
    const max = target === 'code' ? 5000 : 14000; // au-delà, Claude coupe le texte pré-rempli
    const text = String(b.text || '').trim();
    if (!text) throw Object.assign(new Error('Nothing to send'), { key: 'genPrompt' });
    const q = encodeURIComponent(text.slice(0, max));
    const link = target === 'code' ? `claude-cli://open?q=${q}` : target === 'web' ? `https://claude.ai/new?q=${q}` : `claude://claude.ai/new?q=${q}`;
    let opened = false;
    let plain = false;
    if (process.versions.electron) {
      const { shell } = require('electron');
      try { await shell.openExternal(link); opened = true; } catch {
        // Lien refusé (trop long pour Windows) : on ouvre Claude sans texte, le prompt est dans le presse-papiers.
        const bare = target === 'code' ? 'claude-cli://open' : target === 'web' ? 'https://claude.ai/new' : 'claude://claude.ai/new';
        try { await shell.openExternal(bare); opened = true; plain = true; } catch {}
      }
    }
    return { opened, plain, link, truncated: text.length > max };
  }],
  ['POST', /^\/api\/claude\/code$/, () => claude.linkCode(`http://localhost:${PORT}/mcp`)],
  // Pont Roblox Studio : le JSON MCP de Studio, l'état de la connexion et les outils repassés à Claude.
  ['GET', /^\/api\/robloxstudio$/, () => robloxStudioInfo()],
  ['PUT', /^\/api\/robloxstudio$/, async (req) => {
    const b = await json(req);
    const cur = studio.readSettings();
    const next = { ...cur };
    if (typeof b.config === 'string') {
      studio.parseConfig(b.config); // refuse un JSON invalide avant d'enregistrer
      next.config = b.config.trim();
    }
    if (typeof b.enabled === 'boolean') next.enabled = b.enabled;
    // Envoi d'images par Open Cloud (facultatif) : clé API Roblox et créateur (utilisateur ou groupe).
    if (typeof b.openCloudKey === 'string') next.openCloudKey = b.openCloudKey.trim() || undefined;
    if (b.creatorType === 'user' || b.creatorType === 'group') next.creatorType = b.creatorType;
    if (b.creatorId !== undefined) next.creatorId = String(b.creatorId).replace(/\D/g, '') || undefined;
    if (next.enabled && !next.config) next.config = JSON.stringify(studio.DEFAULT_CONFIG, null, 2);
    next.updatedAt = new Date().toISOString();
    studio.writeSettings(next);
    studio.sync();
    await studio.bridge.waitReady(10e3);
    return robloxStudioInfo();
  }],
  ['POST', /^\/api\/robloxstudio\/restart$/, async () => {
    studio.sync();
    studio.bridge.restart();
    await studio.bridge.waitReady(10e3);
    return robloxStudioInfo();
  }],
  // Personnalisation de l'app (gardée sur ce PC) : thème, fond d'écran, police, CSS libre.
  ['GET', /^\/api\/custom$/, () => ({ custom: state.settings.custom || null, devMode: Boolean(state.settings.devMode) })],
  ['PUT', /^\/api\/custom$/, async (req) => {
    const b = await json(req);
    if (b.custom && typeof b.custom === 'object') {
      const c = JSON.parse(JSON.stringify(b.custom));
      c.css = String(c.css || '').slice(0, 100000);
      // L'ancien fond importé est supprimé quand on en choisit un autre.
      const old = state.settings.custom && state.settings.custom.bg && state.settings.custom.bg.src;
      if (old && old.startsWith('/media/bg-') && (!c.bg || c.bg.src !== old)) { try { fs.rmSync(path.join(db.MEDIA_DIR, path.basename(old)), { force: true }); } catch {} }
      state.settings.custom = c;
    }
    if (b.reset) state.settings.custom = null;
    persist();
    return { custom: state.settings.custom || null };
  }],
  // Fond d'écran importé (image, GIF ou vidéo), servi depuis les médias de l'app.
  ['POST', /^\/api\/custom\/background$/, async (req) => {
    // Type d'après le fichier envoyé, sinon d'après son extension (Windows ne donne pas toujours le type).
    const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'mp4' };
    const name = decodeURIComponent(String(req.headers['x-file-name'] || ''));
    const byName = (name.match(/\.(png|jpe?g|gif|webp|mp4|m4v|webm|mov)$/i) || [])[1];
    const ext = TYPES[String(req.headers['content-type'] || '').split(';')[0]] || (byName && byName.toLowerCase().replace('jpeg', 'jpg').replace('m4v', 'mp4'));
    if (!ext) throw Object.assign(new Error('Use a PNG, JPG, GIF, WEBP, MP4, MOV or WEBM file'), { key: 'bgType' });
    const max = 1024 * 1024 * 1024;
    if (Number(req.headers['content-length']) > max) throw Object.assign(new Error('File too large (1 GB max)'), { key: 'bgTooBig' });
    const file = `bg-${Date.now()}.${ext}`;
    fs.mkdirSync(db.MEDIA_DIR, { recursive: true });
    // Écrit au fil de l'eau (une vidéo peut être lourde), sans tout garder en mémoire.
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(path.join(db.MEDIA_DIR, file));
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size > max) { req.destroy(); out.destroy(); reject(Object.assign(new Error('File too large (1 GB max)'), { key: 'bgTooBig' })); } });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    }).catch((e) => { try { fs.rmSync(path.join(db.MEDIA_DIR, file), { force: true }); } catch {} throw e; });
    return { src: `/media/${file}`, type: ['mp4', 'webm', 'mov'].includes(ext) ? 'video' : 'image' };
  }],
  // Mode développeur (admins) : outils dev_* pour Claude et page Développeur.
  ['PUT', /^\/api\/devmode$/, async (req) => { state.settings.devMode = Boolean((await json(req)).on); persist(); return { devMode: state.settings.devMode }; }],
  // Textures VFX : la liste (de base + ajoutées par l'admin) et leurs miniatures Roblox.
  ['GET', /^\/api\/textures$/, () => {
    const list = textures.all(state);
    const cache = readThumbs();
    return { groups: textures.groups(list), items: list.map((t) => ({ ...t, thumb: (cache[t.id] || {}).url || '' })) };
  }],
  ['POST', /^\/api\/textures\/thumbs$/, async (req) => textureThumbs(((await json(req)).ids || []).map(String).slice(0, 400))],
  ['POST', /^\/api\/textures\/import$/, async (req, m, url, session) => {
    const b = await json(req);
    const section = String(b.section || 'Ajoutées').slice(0, 60);
    const found = textures.parse(String(b.text || ''), { source: 'custom', section });
    if (!found.length) throw Object.assign(new Error('No texture ID found'), { key: 'txNone' });
    const cur = (state.textures && state.textures.items) || [];
    const known = new Set([...textures.BUILTIN, ...cur].map((t) => t.id));
    const fresh = found.filter((t) => !known.has(t.id));
    state.textures = { items: cur.concat(fresh), updatedAt: new Date().toISOString() };
    persist();
    sharedPush(session);
    return { added: fresh.length, total: textures.all(state).length };
  }],
  // La place ouverte dans Studio : scripts (lire / modifier) et réglages du jeu (valeurs du code).
  ['GET', /^\/api\/place\/studios$/, async (req, m, url) => ({ ready: studio.bridge.state === 'ready', studios: await place.studios(url.searchParams.get('force') === '1') })],
  ['GET', /^\/api\/place\/scripts$/, (req, m, url) => place.scripts(url.searchParams.get('s') || '')],
  ['POST', /^\/api\/place\/read$/, async (req) => { const b = await json(req); return place.readScript(b.s || '', b.path); }],
  ['POST', /^\/api\/place\/write$/, async (req) => { const b = await json(req); return place.writeScript(b.s || '', b.path, b.source); }],
  ['GET', /^\/api\/place\/values$/, (req, m, url) => place.values(url.searchParams.get('s') || '', url.searchParams.get('force') === '1')],
  ['POST', /^\/api\/place\/value$/, async (req) => { const b = await json(req); return place.setValue(b.s || '', b); }],
  ['POST', /^\/api\/mcp\/test$/, async (req) => {
    const q = String((await json(req)).query || '').slice(0, 200);
    return mcp.call('search_resources', { query: q, limit: 8 });
  }],
  ['GET', /^\/api\/admin\/codes$/, (req, m, url, session) => auth.list(session)],
  ['POST', /^\/api\/admin\/codes$/, async (req, m, url, session) => auth.create(await json(req), session)],
  ['PUT', /^\/api\/admin\/codes\/(\w+)$/, async (req, m, url, session) => auth.update(m[1], await json(req), session)],
  ['POST', /^\/api\/admin\/codes\/(\w+)\/kick$/, (req, m, url, session) => auth.kick(m[1], session)],
  ['DELETE', /^\/api\/admin\/codes\/(\w+)$/, async (req, m, url, session) => { await auth.remove(m[1], session); return { ok: true }; }],
  ['GET', /^\/api\/admin\/info$/, (req, m, url, session) => ({
    host: HOST, port: PORT, shared: HOST !== '127.0.0.1', online: auth.online, offline: Boolean(session.offline), master: Boolean(session.master),
    addresses: Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`),
    keyFile: KEY_FILE, download: DOWNLOAD_URL, lastShared: state.settings.lastSharedSync || null,
  })],
  ['POST', /^\/api\/admin\/reset-key$/, async (req, m, url, session) => ({ key: await auth.resetMasterKey(session) })],
];

// Routes accessibles à un ID d'accès simple (lecture seule). Tout le reste est réservé à l'admin.
// Ce que les membres peuvent faire en plus de lire : brancher Claude sur leur PC, tester la recherche,
// mettre à jour l'app, utiliser la génération IA.
const MEMBER_ACTIONS = [/^\/api\/custom(\/background)?$/, /^\/api\/textures\/thumbs$/, /^\/api\/place\/(read|write|value)$/, /^\/api\/robloxstudio(\/restart)?$/, /^\/api\/claude\/(desktop|code|send)$/, /^\/api\/mcp\/test$/, /^\/api\/update\/(check|install)$/, /^\/api\/gen(\/.*)?$/];
const USER_ROUTES = [/^\/api\/custom$/, /^\/api\/textures$/, /^\/api\/place\/(studios|scripts|values)$/, /^\/api\/robloxstudio$/, /^\/api\/claude$/, /^\/api\/version$/, /^\/api\/prompts$/, /^\/api\/skills$/, /^\/api\/skills\/\w+$/, /^\/api\/level$/, /^\/api\/meta$/, /^\/api\/stats$/, /^\/api\/resources$/, /^\/api\/channels$/, /^\/api\/youtube$/, /^\/api\/crawl$/, /^\/api\/examples$/, /^\/api\/mcp$/];

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
      librarySync().catch(() => {});
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
    const kick = !s && auth.kickReason(cookies(req).rdh_session);
    return send(res, 200, s ? { loggedIn: true, role: s.role, label: s.label, expiresAt: s.expiresAt, permanent: Boolean(s.permanent || !s.codeId), master: Boolean(s.master), offline: Boolean(s.offline) } : { loggedIn: false, kicked: kick || undefined });
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
    if (!session) {
      // Session fermée parce que l'ID s'est connecté sur un autre appareil : on le dit à l'écran de connexion.
      const kick = auth.kickReason(cookies(req).rdh_session);
      if (kick) return send(res, 401, { error: 'This ID is now used on another device', key: 'otherDevice', vars: { device: kick.device || '?' } });
      return send(res, 401, { error: 'Sign in with your access ID', key: 'loginRequired' });
    }
    const memberAction = MEMBER_ACTIONS.some((re) => re.test(url.pathname));
    if (session.role !== 'admin' && !memberAction && !(req.method === 'GET' && USER_ROUTES.some((re) => re.test(url.pathname)))) {
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
  // Lien temporaire vers une image, pour que Roblox Studio (sur ce PC) puisse l'envoyer sur Roblox.
  if (url.pathname.startsWith('/share/')) {
    const f = isLoopback(req) && rbxupload.sharedFile(url.pathname.split('/')[2] || '');
    return f && fs.existsSync(f) ? serveFile(req, res, f) : send(res, 404, { error: 'Not found', key: 'notFound' });
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
// Bibliothèque en ligne : les nouveautés trouvées par l'exploration (toutes les 5 minutes, par paquets).
let libBusy = false;
async function librarySync() {
  const c = auth.online && state.auth && state.auth.lastCred;
  if (!c || libBusy) return { added: 0 };
  libBusy = true;
  try {
    let since = Number(state.settings.libSeq || 0);
    const urls = new Set(state.resources.map((r) => r.url).filter(Boolean));
    let added = 0;
    for (let i = 0; i < 500; i++) {
      const out = cloud.must(await cloud.rpc('rovex_lib_since', { p_code: c.code, p_since: since, p_limit: 2000 }, 60000));
      const items = out.items || [];
      for (const r of items) {
        since = Math.max(since, Number(r.seq) || 0);
        if (!r.url || urls.has(r.url) || quality.isBanned(r)) continue;
        urls.add(r.url);
        const { seq, ...rest } = r;
        state.resources.push(db.normalize({ ...rest, id: undefined, source: 'cloud', favorite: false }));
        added++;
      }
      state.settings.libSeq = since;
      if (items.length < 2000) break;
      if (i % 20 === 19) persist(); // gros premier téléchargement : on enregistre en route
    }
    Object.assign(state.settings, { lastLibSync: new Date().toISOString(), lastLibAdded: added, libLast: since });
    persist();
    return { added, last: since };
  } finally {
    libBusy = false;
  }
}
setInterval(() => librarySync().catch(() => {}), 5 * 60e3);
setTimeout(() => librarySync().catch(() => {}), 15e3);

async function sharedPull() {
  const c = auth.online && state.auth && state.auth.lastCred;
  if (!c) return false;
  const changed = await cloud.pull(state, c.code);
  state.settings.lastSharedSync = new Date().toISOString();
  persist();
  if (changed) syncCodeSkills();
  return changed;
}
function robloxStudioInfo() {
  const s = studio.readSettings();
  return {
    enabled: Boolean(s.enabled),
    config: s.config || JSON.stringify(studio.DEFAULT_CONFIG, null, 2),
    defaultConfig: JSON.stringify(studio.DEFAULT_CONFIG, null, 2),
    status: studio.bridge.status(),
    prefix: studio.PREFIX,
    hasOpenCloud: Boolean(s.openCloudKey),
    creatorType: s.creatorType || 'user',
    creatorId: s.creatorId || '',
  };
}
try { studio.sync(); } catch {}
process.on('exit', () => studio.bridge.kill());

// Miniatures des textures (API publique de Roblox), gardées 7 jours dans data/texture-thumbs.json.
const THUMBS_FILE = path.join(db.DATA_DIR, 'texture-thumbs.json');
const readThumbs = () => { try { return JSON.parse(fs.readFileSync(THUMBS_FILE, 'utf8')); } catch { return {}; } };
async function textureThumbs(ids) {
  const cache = readThumbs();
  const week = 7 * 86400e3;
  const missing = [...new Set(ids)].filter((id) => /^\d+$/.test(id) && !(cache[id] && cache[id].url && Date.now() - cache[id].at < week));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const r = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${chunk.join(',')}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`, { signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      for (const d of j.data || []) cache[String(d.targetId)] = { url: d.state === 'Completed' ? d.imageUrl : '', state: d.state, at: Date.now() };
    } catch {}
  }
  if (missing.length) { try { fs.writeFileSync(THUMBS_FILE, JSON.stringify(cache)); } catch {} }
  return Object.fromEntries(ids.map((id) => [id, (cache[id] || {}).url || '']));
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
