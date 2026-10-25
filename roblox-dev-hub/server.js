// Serveur local de Roblox Dev Hub : interface web + API. Lancer avec `node server.js`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const web = require('./web');
const mcp = require('./mcp');

const PORT = Number(process.env.PORT) || 4747;
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
  try {
    const m = fs.statSync(DB_FILE).mtimeMs;
    if (m !== mtime) { const settings = state.settings; state = db.load(); state.settings = state.settings || settings; mtime = m; }
  } catch {}
}

async function syncChannel(ch) {
  if (!ch.channelId) {
    const info = await web.resolveChannel(ch.handle);
    Object.assign(ch, { channelId: info.channelId, name: ch.name || info.name, avatar: info.avatar });
  }
  const vids = await web.channelVideos(ch.channelId);
  let added = 0;
  for (const v of vids) {
    if (state.resources.some((r) => r.url === v.url)) continue;
    db.upsert(state, {
      ...v, type: 'video', source: 'veille',
      category: ch.category || web.guessCategory(v.title),
      tags: [ch.name || ch.handle].filter(Boolean),
    });
    added++;
  }
  ch.lastFetch = new Date().toISOString();
  return { added, videos: vids.length };
}

const routes = [
  ['GET', /^\/api\/meta$/, () => ({ categories: db.CATEGORIES, types: db.TYPES })],
  ['GET', /^\/api\/info$/, () => ({ mcpPath: path.join(__dirname, 'mcp.js'), node: process.execPath, port: PORT })],
  ['GET', /^\/api\/stats$/, () => db.stats(state)],
  ['GET', /^\/api\/resources$/, (req, m, url) => {
    const p = url.searchParams;
    return db.search(state, {
      q: p.get('q') || '', category: p.get('category') || '', type: p.get('type') || '',
      level: p.get('level') || '', favorite: p.get('favorite') === '1',
    });
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
  ['GET', /^\/api\/channels$/, () => state.channels],
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
  ['POST', /^\/api\/channels\/sync$/, async () => {
    const report = [];
    for (const ch of state.channels) {
      try { report.push({ name: ch.name || ch.handle, ...(await syncChannel(ch)) }); }
      catch (e) { report.push({ name: ch.name || ch.handle, error: e.message }); }
    }
    persist();
    return report;
  }],
  ['GET', /^\/api\/youtube$/, (req, m, url) => web.youtubeSearch(url.searchParams.get('q') || 'roblox studio', state.settings.youtubeApiKey)],
  ['GET', /^\/api\/settings$/, () => ({ youtubeApiKey: state.settings.youtubeApiKey ? '••••' + state.settings.youtubeApiKey.slice(-4) : '', hasKey: Boolean(state.settings.youtubeApiKey) })],
  ['PUT', /^\/api\/settings$/, async (req) => {
    const b = await json(req);
    if (typeof b.youtubeApiKey === 'string') state.settings.youtubeApiKey = b.youtubeApiKey.trim();
    persist();
    return { ok: true };
  }],
  ['GET', /^\/api\/export$/, () => state],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Protection : on refuse les requêtes d'écriture venant d'un autre site.
  if (req.method !== 'GET' && req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) {
    return send(res, 403, { error: 'Origine refusée' });
  }
  if (url.pathname === '/mcp') {
    // Endpoint MCP « Streamable HTTP » (réponses JSON simples, pas de flux SSE).
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'Hôte refusé' });
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Roblox Dev Hub prêt  →  http://localhost:${PORT}\n  (Ctrl+C pour arrêter)\n`);
});

