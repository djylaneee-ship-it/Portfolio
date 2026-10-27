// Meshy AI : génération de modèles 3D (texte → 3D, image → 3D, remaillage) avec la clé API de chaque utilisateur,
// gardée seulement sur son PC (data/meshy.json). Claude s'en sert pour des formes de base qu'il importe dans
// Blender puis retravaille (outils meshy_* de mcp.js). Les modèles sont rangés dans <données>/meshy/.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const BASE = process.env.ROVEX_MESHY_URL || 'https://api.meshy.ai';
const SETTINGS = path.join(db.DATA_DIR, 'meshy.json');
const TASKS = path.join(db.DATA_DIR, 'meshy-tasks.json');
const OUT_DIR = path.join(path.dirname(db.DATA_DIR), 'meshy');
const ENDPOINT = { text: '/openapi/v2/text-to-3d', refine: '/openapi/v2/text-to-3d', image: '/openapi/v1/image-to-3d', remesh: '/openapi/v1/remesh' };
const WAIT_MS = 100e3; // un appel d'outil attend au plus ~100 s, puis Claude reprend avec meshy_task

const err = (key, message, code = 400) => Object.assign(new Error(message), { key, code });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };

function settings() { return { key: '', ...readJson(SETTINGS, {}) }; }
const enabled = () => Boolean(settings().key);
function setKey(key) {
  const k = String(key || '').trim();
  if (k && !/^msy[_-][\w-]{8,}$/.test(k)) throw err('meshyKeyBad', 'This does not look like a Meshy API key (it starts with msy_)');
  writeJson(SETTINGS, { key: k });
  return status(false);
}

async function api(p, { method = 'GET', body } = {}) {
  const { key } = settings();
  if (!key) throw err('meshyNoKey', 'Add your Meshy API key in Rovex (Blender page) first');
  let res;
  try {
    res = await fetch(BASE + p, {
      method, headers: { Authorization: `Bearer ${key}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60e3),
    });
  } catch { throw err('meshyDown', 'Cannot reach Meshy (api.meshy.ai)'); }
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = j.message || j.error || text.slice(0, 300) || res.statusText;
    if (res.status === 401) throw err('meshyKey', `Meshy refused the API key: ${msg}`, 401);
    if (res.status === 402) throw err('meshyCredits', `Not enough Meshy credits: ${msg}`, 402);
    if (res.status === 429) throw err('meshyBusy', `Meshy limit reached (too many tasks at once): ${msg}`, 429);
    throw err('meshyError', `Meshy error ${res.status}: ${msg}`, res.status >= 500 ? 502 : 400);
  }
  return j;
}

// Historique local des tâches (pour meshy_task et la page Blender).
const tasks = () => readJson(TASKS, []);
function remember(t) {
  const list = tasks().filter((x) => x.id !== t.id);
  list.unshift({ ...(tasks().find((x) => x.id === t.id) || {}), ...t, at: (tasks().find((x) => x.id === t.id) || {}).at || new Date().toISOString() });
  writeJson(TASKS, list.slice(0, 60));
}

const slug = (s) => String(s || 'model').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'model';

// Image locale (chemin) → data URI ; une URL https passe telle quelle.
function imageInput(img) {
  const s = String(img || '').trim();
  if (/^https:\/\//.test(s) || /^data:image\/(png|jpeg|jpg);base64,/.test(s)) return s;
  if (!s || !fs.existsSync(s)) throw err('meshyImage', 'Give an image file path on this PC (png or jpg) or an https link');
  const ext = path.extname(s).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) throw err('meshyImage', 'Meshy takes PNG or JPG images');
  const buf = fs.readFileSync(s);
  if (buf.length > 20 * 1024 * 1024) throw err('meshyImage', 'Image too large (20 MB max)');
  return `data:image/${ext === '.png' ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
}

function common(a) {
  const out = {};
  if (a.model_type === 'lowpoly') out.model_type = 'lowpoly';
  else {
    if (a.topology) out.topology = a.topology === 'quad' ? 'quad' : 'triangle';
    if (a.target_polycount) out.target_polycount = Math.max(100, Math.min(300000, Math.round(Number(a.target_polycount)) || 30000));
    if (a.topology || a.target_polycount) out.should_remesh = true;
  }
  if (a.symmetry) out.symmetry_mode = ['off', 'auto', 'on'].includes(a.symmetry) ? a.symmetry : 'auto';
  return out;
}

async function textTo3d(a) {
  const prompt = String(a.prompt || '').trim().slice(0, 600);
  if (!prompt) throw err('meshyPrompt', 'Describe the model to make');
  const r = await api(ENDPOINT.text, { method: 'POST', body: { mode: 'preview', prompt, ...common(a) } });
  remember({ id: r.result, kind: 'text', name: prompt, status: 'PENDING', texture: Boolean(a.texture), texture_prompt: a.texture_prompt || '' });
  return follow(r.result, 'text', a);
}

async function imageTo3d(a) {
  const body = { image_url: imageInput(a.image), should_texture: Boolean(a.texture), ...common(a) };
  if (a.texture) body.enable_pbr = Boolean(a.pbr);
  if (a.texture_prompt) body.texture_prompt = String(a.texture_prompt).slice(0, 600);
  const r = await api(ENDPOINT.image, { method: 'POST', body });
  remember({ id: r.result, kind: 'image', name: a.name || path.basename(String(a.image || 'image')).replace(/\.\w+$/, '') || 'image', status: 'PENDING' });
  return follow(r.result, 'image', a);
}

async function remesh(a) {
  const src = tasks().find((x) => x.id === a.task_id);
  const body = { input_task_id: a.task_id, target_formats: ['glb', 'fbx'], topology: a.topology === 'triangle' ? 'triangle' : 'quad',
    target_polycount: Math.max(100, Math.min(300000, Math.round(Number(a.target_polycount)) || 5000)), origin_at: 'bottom' };
  if (a.height) body.resize_height = Number(a.height);
  const r = await api(ENDPOINT.remesh, { method: 'POST', body });
  remember({ id: r.result, kind: 'remesh', name: `${(src && src.name) || 'model'} (remesh ${body.target_polycount})`, status: 'PENDING' });
  return follow(r.result, 'remesh', a);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Attend la fin d'une tâche (≈100 s max par appel), puis télécharge le GLB, la miniature, et importe dans Blender.
async function follow(id, kind, a = {}) {
  const t0 = Date.now();
  let t;
  for (;;) {
    t = await api(`${ENDPOINT[kind]}/${id}`);
    if (['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED'].includes(t.status)) break;
    if (Date.now() - t0 > (a.wait_ms || WAIT_MS)) {
      remember({ id, kind, status: t.status, progress: t.progress });
      return { task_id: id, kind, status: t.status, progress: t.progress, next: `Still working (${t.progress || 0}%). Call meshy_task with task_id "${id}" in a moment to get the model.` };
    }
    await sleep(kind === 'remesh' ? 3000 : 5000);
  }
  if (t.status !== 'SUCCEEDED') {
    remember({ id, kind, status: t.status });
    throw err('meshyFailed', `Meshy task ${t.status.toLowerCase()}: ${(t.task_error && t.task_error.message) || 'no details'}`);
  }
  const mine = tasks().find((x) => x.id === id) || {};
  // Texte → 3D : la première étape est la forme seule ; la texture est une 2e tâche (refine) si on l'a demandée.
  if (kind === 'text' && mine.texture && !mine.refineId) {
    const r = await api(ENDPOINT.refine, { method: 'POST', body: { mode: 'refine', preview_task_id: id, enable_pbr: Boolean(a.pbr), ...(mine.texture_prompt && { texture_prompt: mine.texture_prompt }) } });
    remember({ id, status: 'SUCCEEDED', refineId: r.result });
    remember({ id: r.result, kind: 'refine', name: `${mine.name} (texture)`, status: 'PENDING' });
    return follow(r.result, 'refine', { ...a, wait_ms: Math.max(20e3, (a.wait_ms || WAIT_MS) - (Date.now() - t0)) });
  }
  return finish(id, kind, t, a);
}

async function download(url, file) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120e3) });
  if (!r.ok) throw err('meshyDownload', `Download failed (${r.status})`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

async function finish(id, kind, t, a) {
  const mine = tasks().find((x) => x.id === id) || {};
  const urls = t.model_urls || {};
  const glbUrl = urls.glb || urls.GLB;
  if (!glbUrl) throw err('meshyFailed', 'Meshy finished but gave no GLB file');
  const base = `${slug(mine.name)}_${String(id).slice(0, 8)}`;
  const glb = await download(glbUrl, path.join(OUT_DIR, `${base}.glb`));
  let fbx = '';
  if (urls.fbx) { try { fbx = await download(urls.fbx, path.join(OUT_DIR, `${base}.fbx`)); } catch {} }
  let thumb = null;
  let thumbFile = '';
  if (t.thumbnail_url) {
    try {
      const r = await fetch(t.thumbnail_url, { signal: AbortSignal.timeout(30e3) });
      if (r.ok) { thumb = Buffer.from(await r.arrayBuffer()); thumbFile = path.join(OUT_DIR, `${base}.png`); fs.writeFileSync(thumbFile, thumb); }
    } catch {}
  }
  remember({ id, kind, status: 'SUCCEEDED', glb, fbx, thumb: thumbFile });
  const out = { task_id: id, kind, status: 'SUCCEEDED', name: mine.name, glb, ...(fbx && { fbx }) };
  if (a.import_to_blender !== false && blenderOn()) {
    try { out.blender = await importGlb(glb, a.object_name || slug(mine.name)); }
    catch (e) { out.blender_error = e.message.split('\n')[0]; }
  }
  out.next = out.blender
    ? 'Imported in Blender: look at it with blender_view, then clean it up with blender_execute_python (rx.apply_transform, rx.decimate / rx.remesh, rx.shade, rx.paint, rx.stats) and adapt it to the request.'
    : 'Import it in Blender with blender_execute_python: bpy.ops.import_scene.gltf(filepath=r"<glb>"), or remesh it first with meshy_remesh.';
  if (thumb) out.images = [thumb];
  return out;
}

const blenderOn = () => { try { return require('./blender').enabled(); } catch { return false; } };

// Import du GLB dans la scène ouverte de Blender : objets renommés, sommets ressoudés.
async function importGlb(file, name) {
  const code = `before = set(D.objects.keys())
bpy.ops.import_scene.gltf(filepath=${JSON.stringify(file)})
new = [o for o in D.objects if o.name not in before]
meshes = [o for o in new if o.type == 'MESH']
for i, o in enumerate(meshes):
    o.name = ${JSON.stringify(name)} if len(meshes) == 1 else ${JSON.stringify(name)} + "_" + str(i + 1)
    with rx.edit(o) as bm:
        rx.merge(bm, 0.0001)  # le GLB coupe les sommets aux coutures : on les ressoude pour pouvoir le retravailler
result = {"objects": [o.name for o in new], "meshes": {o.name: rx.stats(o) for o in meshes}}`;
  const r = await require('./blender').run(code, 180e3);
  return r && r.result;
}

// Une tâche lancée plus tôt : son état, ou le modèle s'il est prêt.
async function task(a) {
  const mine = tasks().find((x) => x.id === a.task_id);
  const kind = a.kind || (mine && mine.kind);
  if (!kind || !ENDPOINT[kind]) throw err('meshyTask', 'Unknown task: give its kind (text, image, remesh, refine)');
  if (mine && mine.refineId) return task({ ...a, task_id: mine.refineId, kind: 'refine' });
  return follow(a.task_id, kind, a);
}

async function balance() {
  const r = await api('/openapi/v1/balance');
  return { balance: r.balance };
}

async function status(check = true) {
  const s = settings();
  const out = { hasKey: Boolean(s.key), keyHint: s.key ? `${s.key.slice(0, 6)}…${s.key.slice(-4)}` : '', outDir: OUT_DIR,
    tasks: tasks().slice(0, 12).map(({ id, kind, name, status: st, at, glb, thumb }) => ({ id, kind, name, status: st, at, glb, hasThumb: Boolean(thumb) })) };
  if (check && s.key) {
    try { out.balance = (await balance()).balance; } catch (e) { out.error = e.message; }
  }
  return out;
}

const thumbOf = (id) => { const t = tasks().find((x) => x.id === id); return t && t.thumb && fs.existsSync(t.thumb) ? t.thumb : null; };

module.exports = { enabled, setKey, status, textTo3d, imageTo3d, remesh, task, balance, thumbOf, OUT_DIR };
