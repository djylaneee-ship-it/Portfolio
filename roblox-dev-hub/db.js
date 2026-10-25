// Stockage local en JSON : aucune dépendance, aucun module natif à compiler.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(ROOT, 'media');
const DB_FILE = path.join(DATA_DIR, 'library.json');
const SEED_FILE = path.join(ROOT, 'seed.json');

const CATEGORIES = [
  { id: 'scripting', label: 'Scripting', color: '#4f8cff', desc: 'Luau, services, RemoteEvents, DataStores, POO' },
  { id: 'vfx', label: 'VFX', color: '#ff4fd8', desc: 'Particules, beams, trails, slashs, explosions' },
  { id: 'animation', label: 'Animation', color: '#ffb02e', desc: 'Animation Editor, Moon Animator, rigs R6/R15' },
  { id: 'gui', label: 'GUI / UI', color: '#2ee6a6', desc: 'Interfaces, HUD, boutiques, tweens d\'UI' },
  { id: 'gfx', label: 'GFX', color: '#a970ff', desc: 'Miniatures, icônes, rendus Blender' },
  { id: 'modeling', label: 'Modélisation', color: '#ff6b4a', desc: 'Blender, meshes, textures, UV' },
  { id: 'building', label: 'Build / Maps', color: '#3ad1ff', desc: 'Terrain, éclairage, level design' },
  { id: 'audio', label: 'Audio', color: '#f5e642', desc: 'Sons, musiques, SoundService' },
  { id: 'design', label: 'Game design', color: '#ff8fa3', desc: 'Boucles de jeu, rétention, monétisation' },
  { id: 'tools', label: 'Outils & plugins', color: '#9aa4b8', desc: 'Plugins Studio, Rojo, logiciels' },
];

const TYPES = ['video', 'chaine', 'doc', 'article', 'outil', 'image', 'fichier', 'recherche'];

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
    };
    save(db);
    return db;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function save(db) {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
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

// Recherche plein texte avec score : titre > tags > auteur > description > notes.
function search(db, { q = '', category = '', type = '', favorite = false, level = '', limit = 0 } = {}) {
  const terms = strip(q).split(/\s+/).filter(Boolean);
  let out = [];
  for (const r of db.resources) {
    if (category && r.category !== category) continue;
    if (type && r.type !== type) continue;
    if (level && r.level !== level) continue;
    if (favorite && !r.favorite) continue;
    let score = 0;
    if (terms.length) {
      const title = strip(r.title);
      const tags = strip(r.tags.join(' '));
      const rest = strip(`${r.author} ${r.description} ${r.notes} ${r.category} ${r.type}`);
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
  out.sort((a, b) => b.score - a.score || (b.r.favorite - a.r.favorite) || b.r.createdAt.localeCompare(a.r.createdAt));
  out = out.map((x) => x.r);
  return limit ? out.slice(0, limit) : out;
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
function upsert(db, data) {
  const existing = data.url && db.resources.find((r) => r.url && r.url === data.url);
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
  load, save, normalize, search, stats, upsert, newId, youtubeId, youtubeThumb,
};
