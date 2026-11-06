// Serveur HTTP local (127.0.0.1) : interface (public/), API /api/*,
// flux temps réel /api/events (Server-Sent Events) pour le tableau des Shorts.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const library = require('./src/library');
const pipeline = require('./src/pipeline');
const scheduler = require('./src/scheduler');
const youtube = require('./src/upload/youtube');
const stats = require('./src/stats');
const { listVoices } = require('./src/pipeline/voice');

const PORT = Number(process.env.PORT) || 4800;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.png': 'image/png' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readJson(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
// Petite page lisible pour les étapes de connexion qui s'ouvrent dans le navigateur.
function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f17;color:#e6ebf5;font:16px/1.5 Segoe UI,system-ui,sans-serif">
<div style="max-width:520px;padding:32px;background:#121826;border:1px solid #222c40;border-radius:14px">
<h2 style="margin-top:0;color:#4fd1ff">${title}</h2><p>${body}</p></div></body>`;
}

function serveFile(res, file) {
  if (!fs.existsSync(file)) return send(res, 404, { error: 'introuvable' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const sse = new Set();
pipeline.onChange((jobs) => {
  const msg = `data: ${JSON.stringify({ jobs })}\n\n`;
  for (const res of sse) res.write(msg);
});

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const s = () => config.load();

  if (route === 'GET /api/state') {
    return send(res, 200, {
      settings: config.publicView(), jobs: pipeline.list(), gameplay: await library.scan(), schedule: scheduler.status(),
    });
  }
  if (route === 'GET /api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ jobs: pipeline.list() })}\n\n`);
    sse.add(res);
    return req.on('close', () => sse.delete(res));
  }
  if (route === 'POST /api/settings') {
    const patch = await readJson(req);
    // Les champs masqués (••••) renvoyés par l'interface ne remplacent pas la vraie valeur.
    const clean = JSON.parse(JSON.stringify(patch, (k, v) => (typeof v === 'string' && v.startsWith('••••') ? undefined : v)));
    config.save(clean);
    scheduler.tick();
    return send(res, 200, { settings: config.publicView() });
  }
  if (route === 'POST /api/gameplay/upload') {
    const ext = path.extname(url.searchParams.get('name') || '.mp4').toLowerCase();
    if (!/^\.(mp4|mov|mkv|webm)$/.test(ext)) return send(res, 400, { error: 'format vidéo non pris en charge' });
    const name = `gameplay_${Date.now()}${ext}`;
    const out = fs.createWriteStream(path.join(config.DIRS.gameplay, name));
    req.pipe(out);
    return out.on('finish', async () => send(res, 200, { name, gameplay: await library.scan() }));
  }
  if (route === 'POST /api/generate') {
    const { count = 1 } = await readJson(req);
    return send(res, 200, { created: pipeline.enqueue(Math.min(20, Math.max(1, count))) });
  }
  const jobAction = /^POST \/api\/jobs\/(\w+)\/(pause|resume|stop|remove|upload)$/.exec(route);
  if (jobAction) {
    const [, id, action] = jobAction;
    const job = pipeline.get(id);
    if (!job) return send(res, 404, { error: 'Short introuvable' });
    if (action === 'remove') return send(res, pipeline.remove(id) ? 200 : 409, { ok: true });
    if (action === 'upload') {
      if (job.status !== 'ready') return send(res, 409, { error: 'Short pas prêt' });
      const id2 = await youtube.upload(PORT, job, null);
      pipeline.update(job, { status: 'published', youtubeId: id2, url: `https://youtube.com/shorts/${id2}`, publishAt: new Date().toISOString() });
      return send(res, 200, job);
    }
    pipeline[action](id);
    return send(res, 200, { ok: true });
  }
  if (route === 'GET /api/update') return send(res, 200, global.rssUpdate || { state: 'dev' });
  if (route === 'POST /api/update/check') { global.rssCheckUpdates?.(true); return send(res, 200, { ok: true }); }
  if (route === 'POST /api/update/install') { global.rssInstallUpdate?.(); return send(res, 200, { ok: true }); }
  if (route === 'GET /api/voices') return send(res, 200, await listVoices(s()));
  if (route === 'GET /api/youtube/connect') {
    try {
      res.writeHead(302, { Location: youtube.authUrl(PORT) });
      return res.end();
    } catch (e) {
      return send(res, 400, page('Connexion YouTube impossible', `${e.message}.<br>Dans l'app : Réglages → YouTube, colle ton Client ID et ton Client secret (le guide est juste au-dessus), puis reclique sur « Connecter YouTube ».`), 'text/html; charset=utf-8');
    }
  }
  if (route === 'GET /api/youtube/callback') {
    if (url.searchParams.get('error')) {
      return send(res, 400, page('Connexion annulée', `Google a répondu : ${url.searchParams.get('error')}. Reclique sur « Connecter YouTube » dans l'app.`), 'text/html; charset=utf-8');
    }
    try {
      await youtube.handleCallback(PORT, url.searchParams.get('code'));
    } catch (e) {
      return send(res, 400, page('Connexion YouTube impossible', e.message), 'text/html; charset=utf-8');
    }
    return send(res, 200, page('YouTube connecté ✅', 'Tu peux fermer cette page et revenir dans Roblox Shorts Studio.'), 'text/html; charset=utf-8');
  }
  if (route === 'GET /api/stats') {
    const st = s();
    if (!st.youtube.refreshToken) return send(res, 409, { error: 'YouTube n\'est pas connecté (Réglages → YouTube)' });
    if (url.searchParams.get('fresh')) stats.clear();
    const days = [7, 28, 90, 365].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 28;
    const data = await stats.overview(PORT, days);
    // Vidéos faites par l'app : on les repère pour les marquer dans le tableau.
    const mine = new Set(pipeline.list().map((j) => j.youtubeId).filter(Boolean));
    data.videos = data.videos.map((v) => ({ ...v, fromApp: mine.has(v.id) }));
    data.analyticsScope = (st.youtube.scopes || '').includes(youtube.ANALYTICS_SCOPE);
    return send(res, 200, data);
  }
  const statVideo = /^GET \/api\/stats\/video\/([\w-]+)$/.exec(route);
  if (statVideo) {
    const days = [7, 28, 90, 365].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 28;
    return send(res, 200, await stats.video(PORT, statVideo[1], days));
  }
  if (route === 'GET /api/youtube/channel') return send(res, 200, { channel: await youtube.channel(PORT) });
  return send(res, 404, { error: 'route inconnue' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/output/')) return serveFile(res, path.join(config.DIRS.output, path.basename(url.pathname)));
    if (url.pathname === '/icon.png') return serveFile(res, path.join(__dirname, 'icon.png'));
    const file = path.join(PUBLIC, path.normalize(url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'interdit' });
    return serveFile(res, file);
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

// `ready` se résout quand le serveur écoute ; il est rejeté si le port est déjà pris.
const ready = new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Roblox Shorts Studio : http://localhost:${PORT}`);
    pipeline.pump();
    scheduler.start(PORT);
    resolve(PORT);
  });
});
if (require.main === module) ready.catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { PORT, ready };
