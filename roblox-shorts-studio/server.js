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
  if (route === 'GET /api/voices') return send(res, 200, await listVoices(s()));
  if (route === 'GET /api/youtube/connect') {
    res.writeHead(302, { Location: youtube.authUrl(PORT) });
    return res.end();
  }
  if (route === 'GET /api/youtube/callback') {
    await youtube.handleCallback(PORT, url.searchParams.get('code'));
    return send(res, 200, '<h2>YouTube connecté ✅ Tu peux fermer cette page.</h2>', 'text/html; charset=utf-8');
  }
  if (route === 'GET /api/youtube/channel') return send(res, 200, { channel: await youtube.channel(PORT) });
  return send(res, 404, { error: 'route inconnue' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/output/')) return serveFile(res, path.join(config.DIRS.output, path.basename(url.pathname)));
    const file = path.join(PUBLIC, path.normalize(url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'interdit' });
    return serveFile(res, file);
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Roblox Shorts Studio : http://localhost:${PORT}`);
  pipeline.pump();
  scheduler.start(PORT);
});

module.exports = { PORT };
