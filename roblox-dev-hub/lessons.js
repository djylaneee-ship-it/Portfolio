// Atelier d'apprentissage : des vidéos (timelapses, tutos) et des images que Claude étudie pour en tirer des
// « recettes » pas à pas (3D, VFX, animation, UI, scripting…). Validées, elles lui reviennent avec load_skill et
// l'outil find_lessons. Données locales : data/lessons.json, images clés dans media/lessons/<id>/.
// Un admin peut partager une leçon validée avec tout le monde (contenu partagé « lessons », texte + 4 miniatures).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const FILE = path.join(db.DATA_DIR, 'lessons.json');
const DIR = path.join(db.MEDIA_DIR, 'lessons');
const MAX_FRAMES = 80;
const STATUSES = ['pending', 'draft', 'validated'];

const err = (key, message, code = 400) => Object.assign(new Error(message), { key, code });
const newId = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const clip = (s, n) => String(s || '').trim().slice(0, n);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

let cache = { mtime: -1, data: null };
function read() {
  let mtime = 0;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch {}
  if (cache.data && cache.mtime === mtime) return cache.data;
  let data = { items: [] };
  try { data = { items: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  cache = { mtime, data };
  return data;
}
function write(data) {
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(data));
  fs.renameSync(FILE + '.tmp', FILE);
  cache = { mtime: fs.statSync(FILE).mtimeMs, data };
}

const cats = () => require('./skills').SKILL_CATS;
function find(id) {
  const l = read().items.find((x) => x.id === id);
  if (!l) throw err('notFound', 'Lesson not found', 404);
  return l;
}

// Vue courte (listes) : sans les étapes.
const brief = (l) => ({
  id: l.id, title: l.title, category: l.category, software: l.software, status: l.status, source: l.source,
  frames: (l.frames || []).length, steps: ((l.recipe || {}).steps || []).length, summary: (l.recipe || {}).summary || '',
  tags: (l.recipe || {}).tags || [], cover: ((l.frames || [])[Math.floor(((l.frames || []).length - 1) / 3)] || {}).file || '',
  shared: Boolean(l.shared), updatedAt: l.updatedAt, createdAt: l.createdAt,
});

function list({ category = '', status = '' } = {}) {
  return read().items.filter((l) => (!category || l.category === category) && (!status || l.status === status)).map(brief);
}

function create(b = {}) {
  const category = cats().includes(b.category) ? b.category : 'modeling';
  const l = {
    id: newId(), title: clip(b.title, 120) || 'Leçon', category, software: clip(b.software, 60), status: 'pending', source: {
      kind: b.kind === 'images' ? 'images' : 'video', name: clip(b.name, 160), duration: Number(b.duration) || 0, url: clip(b.url, 400),
    },
    note: clip(b.note, 2000), frames: [], recipe: null, createdAt: now(), updatedAt: now(),
  };
  const data = read();
  data.items.unshift(l);
  write(data);
  return l;
}

// Images clés envoyées par l'interface (JPEG / PNG en data URL, déjà réduites), par petits lots.
function addFrames(id, b = {}) {
  const data = read();
  const l = data.items.find((x) => x.id === id);
  if (!l) throw err('notFound', 'Lesson not found', 404);
  const list = Array.isArray(b.frames) ? b.frames : [];
  fs.mkdirSync(path.join(DIR, id), { recursive: true });
  for (const f of list) {
    if (l.frames.length >= MAX_FRAMES) break;
    const m = String(f.src || '').match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw err('chatFileBad', 'Unsupported file');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw err('tooBig', 'File too large');
    const n = l.frames.length;
    const file = `lessons/${id}/f${String(n).padStart(3, '0')}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`;
    fs.writeFileSync(path.join(db.MEDIA_DIR, file), buf);
    l.frames.push({ file, t: Math.round(Number(f.t) * 10) / 10 || 0, label: clip(f.label, 80) });
  }
  l.updatedAt = now();
  write(data);
  return { id, frames: l.frames.length };
}

// Recette : résumé, étapes (titre, explication, images clés, code), astuces, mots-clés.
function cleanRecipe(r = {}, frames = 0) {
  const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, 60).map((s) => ({
    title: clip(s.title, 160),
    detail: clip(s.detail, 3000),
    frames: (Array.isArray(s.frames) ? s.frames : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < frames).slice(0, 8),
    ...(s.code && { code: clip(s.code, 6000) }),
  })).filter((s) => s.title || s.detail);
  return {
    summary: clip(r.summary, 1500),
    steps,
    tips: (Array.isArray(r.tips) ? r.tips : []).map((x) => clip(x, 500)).filter(Boolean).slice(0, 30),
    tags: (Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(',')).map((x) => clip(x, 40).toLowerCase()).filter(Boolean).slice(0, 20),
  };
}

function update(id, b = {}) {
  const data = read();
  const l = data.items.find((x) => x.id === id);
  if (!l) throw err('notFound', 'Lesson not found', 404);
  if (b.title !== undefined) l.title = clip(b.title, 120) || l.title;
  if (b.category !== undefined && cats().includes(b.category)) l.category = b.category;
  if (b.software !== undefined) l.software = clip(b.software, 60);
  if (b.note !== undefined) l.note = clip(b.note, 2000);
  if (b.recipe !== undefined) {
    l.recipe = cleanRecipe(b.recipe, l.frames.length);
    if (l.status === 'pending') l.status = 'draft';
  }
  if (b.status !== undefined && STATUSES.includes(b.status)) l.status = b.status;
  l.updatedAt = now();
  write(data);
  return l;
}

function remove(id) {
  const data = read();
  if (!data.items.some((x) => x.id === id)) throw err('notFound', 'Lesson not found', 404);
  data.items = data.items.filter((x) => x.id !== id);
  write(data);
  fs.rm(path.join(DIR, id), { recursive: true, force: true }, () => {});
  return { ok: true };
}

// Recherche pour Claude : titre, résumé, mots-clés, étapes ; les validées d'abord.
function search({ query = '', category = '', all = false, limit = 8 } = {}) {
  const words = norm(query).split(/[\s,]+/).filter((w) => w.length > 1);
  const cat = Array.isArray(category) ? category : category ? [category] : [];
  return read().items
    .filter((l) => (all || l.status === 'validated') && l.recipe && (!cat.length || cat.includes(l.category)))
    .map((l) => {
      const hay = norm(`${l.title} ${l.software} ${l.recipe.summary} ${l.recipe.tags.join(' ')} ${l.recipe.steps.map((s) => s.title).join(' ')}`);
      const score = words.reduce((s, w) => s + (norm(l.title).includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0) + (l.status === 'validated' ? 0.5 : 0);
      return { l, score };
    })
    .filter((x) => !words.length || x.score >= 1)
    .sort((a, b) => b.score - a.score || (a.l.updatedAt < b.l.updatedAt ? 1 : -1))
    .slice(0, limit)
    .map(({ l }) => ({ id: l.id, title: l.title, category: l.category, software: l.software, status: l.status, summary: l.recipe.summary,
      steps: l.recipe.steps.map((s, i) => `${i + 1}. ${s.title}`), tags: l.recipe.tags }));
}

// ---------- Partage (admins) : texte de la recette + 4 miniatures ----------
// picks : numéros des images clés envoyées en miniatures (les étapes sont renumérotées sur ces miniatures).
function shareData(id, thumbs, picks = []) {
  const l = find(id);
  if (l.status !== 'validated' || !l.recipe) throw err('lessonNotValidated', 'Validate the lesson before sharing it');
  const kept = (thumbs || []).slice(0, 4);
  const map = (picks || []).slice(0, kept.length).map(Number);
  const recipe = { ...l.recipe, steps: l.recipe.steps.map((st) => ({ ...st, frames: (st.frames || []).map((n) => map.indexOf(n)).filter((n) => n >= 0) })) };
  return { id: l.id, title: l.title, category: l.category, software: l.software, source: { ...l.source }, recipe, thumbs: kept, updatedAt: now() };
}

function markShared(id, on = true) {
  const data = read();
  const l = data.items.find((x) => x.id === id);
  if (l) { l.shared = on; write(data); }
}

// Leçons partagées par un admin : ajoutées (ou mises à jour) ici, en lecture pour les membres.
function mergeShared(remote = {}) {
  const items = Array.isArray(remote.items) ? remote.items : [];
  const data = read();
  let changed = false;
  for (const r of items) {
    if (!r || !r.id || !r.recipe) continue;
    const cur = data.items.find((x) => x.id === r.id);
    if (cur && (cur.source || {}).kind !== 'shared' && !cur.fromShare) continue; // c'est la leçon d'origine (l'admin)
    if (cur && cur.updatedAt >= r.updatedAt) continue;
    fs.mkdirSync(path.join(DIR, r.id), { recursive: true });
    const frames = (r.thumbs || []).map((src, n) => {
      const m = String(src).match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return null;
      const file = `lessons/${r.id}/s${n}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`;
      fs.writeFileSync(path.join(db.MEDIA_DIR, file), Buffer.from(m[2], 'base64'));
      return { file, t: 0, label: '' };
    }).filter(Boolean);
    const l = { id: r.id, title: r.title, category: r.category, software: r.software || '', status: 'validated', source: { ...(r.source || {}), kind: 'shared' },
      fromShare: true, frames, recipe: cleanRecipe(r.recipe, frames.length), createdAt: (cur && cur.createdAt) || now(), updatedAt: r.updatedAt || now() };
    if (cur) Object.assign(cur, l); else data.items.push(l);
    changed = true;
  }
  const ids = new Set(items.map((x) => x && x.id));
  const before = data.items.length;
  data.items = data.items.filter((x) => !x.fromShare || ids.has(x.id)); // retirée par l'admin
  if (changed || before !== data.items.length) write(data);
  return changed || before !== data.items.length;
}

module.exports = { FILE, DIR, read, list, find, create, addFrames, update, remove, search, brief, shareData, markShared, mergeShared, cleanRecipe, MAX_FRAMES };
