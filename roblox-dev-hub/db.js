// Stockage local en JSON : aucune dépendance, aucun module natif à compiler.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
// L'app de bureau range les données dans %APPDATA%\Rovex Hub (ROVEX_DATA) pour qu'une mise à jour ne les efface pas.
const BASE = process.env.ROVEX_DATA || ROOT;
const DATA_DIR = path.join(BASE, 'data');
const MEDIA_DIR = path.join(BASE, 'media');
const DB_FILE = path.join(DATA_DIR, 'library.json');
// La grande bibliothèque en ligne (source « cloud », des centaines de milliers de ressources) vit dans son propre
// fichier : enregistrer un favori ou un réglage ne réécrit plus tout, et ce fichier s'écrit sans bloquer l'app.
const CLOUD_FILE = path.join(DATA_DIR, 'cloud-library.json');
const SEED_FILE = path.join(ROOT, 'seed.json');

const CATEGORIES = [
  { id: 'scripting', label: 'Scripting', color: '#4f8cff', desc: 'Luau, services, RemoteEvents, DataStores, OOP' },
  { id: 'vfx', label: 'VFX', color: '#ff4fd8', desc: 'Particles, beams, trails, slashes, explosions' },
  { id: 'animation', label: 'Animation', color: '#ffb02e', desc: 'Animation Editor, Moon Animator, R6/R15 rigs' },
  { id: 'cutscenes', label: 'Cutscenes', color: '#ff5d73', desc: 'Cinematics, camera, timelines, anime scenes' },
  { id: 'gui', label: 'GUI / UI', color: '#2ee6a6', desc: 'Interfaces, HUD, shops, UI tweens' },
  { id: 'gfx', label: 'GFX', color: '#a970ff', desc: 'Thumbnails, icons, Blender renders' },
  { id: 'modeling', label: 'Modeling', color: '#ff6b4a', desc: 'Blender, meshes, textures, UVs' },
  { id: 'building', label: 'Building / Maps', color: '#3ad1ff', desc: 'Terrain, lighting, level design' },
  { id: 'audio', label: 'Audio', color: '#f5e642', desc: 'Sounds, music, SoundService' },
  { id: 'design', label: 'Game design', color: '#ff8fa3', desc: 'Game loops, retention, monetization' },
  { id: 'gameplay', label: 'Gameplay & YouTubers', color: '#ff9f43', desc: 'Roblox game channels and videos, news, inspiration' },
  { id: 'tools', label: 'Tools & plugins', color: '#9aa4b8', desc: 'Studio plugins, Rojo, software' },
];

const TYPES = ['video', 'chaine', 'opensource', 'asset', 'doc', 'article', 'outil', 'image', 'fichier', 'recherche'];

function ensureDirs() {
  for (const d of [DATA_DIR, MEDIA_DIR]) fs.mkdirSync(d, { recursive: true });
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    const now = new Date().toISOString();
    const db = {
      version: 1,
      resources: seed.resources.map((r) => normalize({ ...r, createdAt: now })),
      channels: seed.channels.map((c) => ({ id: newId(), ...c, channelId: null, lastFetch: null })),
      examples: (seed.examples || []).map((e) => normalizeExample({ ...e, createdAt: now })),
    };
    save(db);
    return db;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!db.examples) db.examples = seedExamples(); // bases créées avant les exemples
  const cloud = readCloud();
  if (cloud) {
    db.resources = db.resources.filter((r) => r.source !== 'cloud').concat(cloud.items);
    db.cloudSeq = cloud.seq;
  } else if (db.resources.some((r) => r.source === 'cloud')) {
    cloudDirty = true; // ancienne base : les ressources en ligne passeront dans leur fichier au prochain enregistrement
    db.cloudSeq = Number((db.settings || {}).libSeq) || 0;
  }
  return db;
}

// Fichier de la bibliothèque en ligne, gardé en mémoire tant qu'il ne change pas (mcp.js relit souvent la base).
let cloudCache = { mtime: 0, data: null };
let cloudDirty = false;
function readCloud() {
  try {
    const m = fs.statSync(CLOUD_FILE).mtimeMs;
    if (cloudCache.data && cloudCache.mtime === m) return cloudCache.data;
    const data = JSON.parse(fs.readFileSync(CLOUD_FILE, 'utf8'));
    cloudCache = { mtime: m, data };
    return data;
  } catch { return null; }
}
const markCloudDirty = () => { cloudDirty = true; };

// Prépare les textes de recherche en arrière-plan (par paquets) : la première recherche est déjà rapide.
function warm(db) {
  const list = db.resources;
  let i = 0;
  const step = () => {
    const end = Math.min(list.length, i + 4000);
    for (; i < end; i++) hay(list[i]);
    if (i < list.length) setTimeout(step, 5);
  };
  setTimeout(step, 3000);
}

// Écriture par morceaux, en rendant la main entre chaque : l'app reste fluide pendant l'enregistrement.
let cloudWriting = null;
let cloudAgain = null;
function writeCloud(db) {
  if (cloudWriting) { cloudAgain = db; return cloudWriting; }
  cloudWriting = (async () => {
    let cur = db;
    while (cur) {
      cloudAgain = null;
      cloudDirty = false;
      const items = cur.resources.filter((r) => r.source === 'cloud');
      const seq = Number(cur.cloudSeq) || 0;
      const tmp = CLOUD_FILE + '.tmp';
      const fh = await fs.promises.open(tmp, 'w');
      try {
        await fh.write(`{"seq":${seq},"items":[`);
        for (let i = 0; i < items.length; i += 3000) {
          await fh.write((i ? ',' : '') + items.slice(i, i + 3000).map((r) => JSON.stringify(r)).join(','));
        }
        await fh.write(']}');
      } finally { await fh.close(); }
      await fs.promises.rename(tmp, CLOUD_FILE);
      cloudCache = { mtime: fs.statSync(CLOUD_FILE).mtimeMs, data: { seq, items } };
      cur = cloudAgain;
    }
  })().catch(() => { cloudDirty = true; }).finally(() => { cloudWriting = null; });
  return cloudWriting;
}

function seedExamples() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const now = new Date().toISOString();
  return (seed.examples || []).map((e) => normalizeExample({ ...e, createdAt: now }));
}

const EX_STATUS = ['draft', 'review', 'validated'];
function normalizeExample(e) {
  const why = Array.isArray(e.why) ? e.why : String(e.why || '').split('\n');
  return {
    id: e.id || newId(),
    title: String(e.title || 'Untitled').trim().slice(0, 140),
    category: CATEGORIES.some((c) => c.id === e.category) ? e.category : 'scripting',
    status: EX_STATUS.includes(e.status) ? e.status : 'draft',
    prompt: String(e.prompt || '').trim(),
    filename: String(e.filename || 'Script.lua').trim().slice(0, 80),
    language: e.language || 'Luau',
    code: String(e.code || ''),
    why: why.map((w) => String(w).trim()).filter(Boolean),
    sources: String(e.sources || '').trim(),
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Compteur de modifications : les résultats en cache (recherches, statistiques) se recalculent après chaque enregistrement.
let rev = 0;
const revKey = (db) => `${rev}:${db.resources.length}`;

function save(db) {
  rev++;
  ensureDirs();
  const { resources, cloudSeq, ...rest } = db;
  const own = resources.filter((r) => r.source !== 'cloud');
  // Première séparation (ancienne base) : écrite tout de suite, pour ne rien perdre si l'app se ferme.
  if (cloudDirty && !fs.existsSync(CLOUD_FILE)) {
    const items = resources.filter((r) => r.source === 'cloud');
    fs.writeFileSync(CLOUD_FILE + '.tmp', JSON.stringify({ seq: Number(cloudSeq) || 0, items }));
    fs.renameSync(CLOUD_FILE + '.tmp', CLOUD_FILE);
    cloudCache = { mtime: fs.statSync(CLOUD_FILE).mtimeMs, data: { seq: Number(cloudSeq) || 0, items } };
    cloudDirty = false;
  }
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...rest, resources: own }));
  fs.renameSync(tmp, DB_FILE);
  if (cloudDirty) writeCloud(db);
}

function normalize(r) {
  const tags = Array.isArray(r.tags)
    ? r.tags
    : String(r.tags || '').split(',');
  return {
    id: r.id || newId(),
    title: String(r.title || 'Sans titre').trim(),
    url: r.url ? String(r.url).trim() : '',
    type: TYPES.includes(r.type) ? r.type : 'article',
    category: CATEGORIES.some((c) => c.id === r.category) ? r.category : 'tools',
    tags: [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))],
    description: String(r.description || '').trim(),
    author: String(r.author || '').trim(),
    thumbnail: r.thumbnail || youtubeThumb(r.url) || '',
    file: r.file || '',
    level: ['debutant', 'intermediaire', 'avance'].includes(r.level) ? r.level : '',
    favorite: Boolean(r.favorite),
    // Étoiles GitHub (open source) : champ dédié, ou relu dans la description « ★ 123 ».
    stars: Number(r.stars) || Number((String(r.description || '').match(/★\s*(\d+)/) || [])[1]) || 0,
    notes: String(r.notes || ''),
    source: r.source || 'manuel',
    createdAt: r.createdAt || new Date().toISOString(),
  };
}

function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

function youtubeThumb(url) {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

function strip(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Textes de recherche (minuscules, sans accents) calculés une fois par ressource, refaits si elle change.
const HAY = new WeakMap();
function hay(r) {
  const h = HAY.get(r);
  if (h && h.t === r.title && h.d === r.description && h.n === r.notes && h.g === r.tags && h.c === r.category) return h;
  const v = {
    t: r.title, d: r.description, n: r.notes, g: r.tags, c: r.category,
    title: strip(r.title), tags: strip((r.tags || []).join(' ')),
    rest: strip(`${r.author} ${r.description} ${r.notes} ${r.category} ${r.type}`),
  };
  HAY.set(r, v);
  return v;
}

// Recherche plein texte avec score : titre > tags > auteur > description > notes.
// `types` : liste de types acceptés ; `exclude` : types à écarter ; `tag` : tag requis ;
// `sort: 'stars'` trie l'open source par étoiles GitHub.
function searchAll(db, { q = '', category = '', type = '', types = [], exclude = [], tag = '', sort = '', favorite = false, level = '', limit = 0 } = {}) {
  const terms = strip(q).split(/\s+/).filter(Boolean);
  let out = [];
  for (const r of db.resources) {
    if (category && r.category !== category) continue;
    if (type && r.type !== type) continue;
    if (types.length && !types.includes(r.type)) continue;
    if (exclude.length && exclude.includes(r.type)) continue;
    if (tag && !(r.tags || []).includes(tag)) continue;
    if (level && r.level !== level) continue;
    if (favorite && !r.favorite) continue;
    let score = 0;
    if (terms.length) {
      const { title, tags, rest } = hay(r);
      let all = true;
      for (const t of terms) {
        let s = 0;
        if (title.includes(t)) s += 5;
        if (tags.includes(t)) s += 3;
        if (rest.includes(t)) s += 1;
        if (!s) { all = false; break; }
        score += s;
      }
      if (!all) continue;
    }
    out.push({ r, score });
  }
  if (sort === 'stars') out.sort((a, b) => b.score - a.score || (b.r.stars || 0) - (a.r.stars || 0));
  // Dates ISO : comparaison directe des textes (bien plus rapide que localeCompare sur des centaines de milliers).
  else out.sort((a, b) => b.score - a.score || (b.r.favorite - a.r.favorite) || (a.r.createdAt < b.r.createdAt ? 1 : a.r.createdAt > b.r.createdAt ? -1 : 0));
  out = out.map((x) => x.r);
  return limit ? out.slice(0, limit) : out;
}

// Les dernières recherches restent en cache (pages suivantes, retour sur une page) tant que rien n'a changé.
const memo = { db: null, key: '', list: new Map() };
function search(db, opts = {}) {
  if (memo.db !== db || memo.key !== revKey(db)) Object.assign(memo, { db, key: revKey(db), list: new Map() });
  const key = JSON.stringify({ ...opts, limit: 0 });
  let out = memo.list.get(key);
  if (!out) {
    out = searchAll(db, { ...opts, limit: 0 });
    memo.list.set(key, out);
    if (memo.list.size > 12) memo.list.delete(memo.list.keys().next().value);
  }
  return out.slice(0, opts.limit || out.length);
}

function stats(db) {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  const byType = {};
  for (const r of db.resources) {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    byType[r.type] = (byType[r.type] || 0) + 1;
  }
  return {
    total: db.resources.length,
    favorites: db.resources.filter((r) => r.favorite).length,
    channels: db.channels.length,
    byCategory,
    byType,
  };
}

// Ajoute ou met à jour sans créer de doublon d'URL.
// `fresh: true` : l'appelant a déjà vérifié que l'URL est nouvelle (évite un parcours complet).
function upsert(db, data, { fresh = false } = {}) {
  const existing = !fresh && data.url && db.resources.find((r) => r.url && r.url === data.url);
  if (existing) {
    Object.assign(existing, normalize({ ...existing, ...data, id: existing.id, createdAt: existing.createdAt }));
    return { resource: existing, created: false };
  }
  const r = normalize(data);
  db.resources.unshift(r);
  return { resource: r, created: true };
}

module.exports = {
  CATEGORIES, TYPES, DATA_DIR, MEDIA_DIR,
  load, save, normalize, normalizeExample, search, stats, revKey, upsert, newId, youtubeId, youtubeThumb, markCloudDirty, CLOUD_FILE, warm,
};
