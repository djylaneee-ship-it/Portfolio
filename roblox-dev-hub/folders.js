// Dossiers de l'utilisateur dans la bibliothèque : on y range des ressources de la bibliothèque, des textures VFX et
// des fichiers importés (images, vidéos, autres). Données locales : data/folders.json, fichiers dans media/folders/.
// Lu aussi par mcp.js (autre processus) : relu sur le disque quand le fichier change.
// Chemin d'un dossier : « library/Épées/Feu/ » (noms des dossiers depuis la racine, majuscules et accents ignorés).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const FILE = path.join(db.DATA_DIR, 'folders.json');
const DIR = path.join(db.MEDIA_DIR, 'folders');
const MAX_PREVIEWS = 8;

const err = (key, message, code = 400) => Object.assign(new Error(message), { key, code });
const id = () => crypto.randomBytes(6).toString('hex');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

let cache = { mtime: -1, data: null };
function read() {
  let mtime = 0;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch {}
  if (cache.data && cache.mtime === mtime) return cache.data;
  let data = { folders: [], items: [] };
  try { data = { folders: [], items: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  cache = { mtime, data };
  return data;
}
function write(data) {
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(data));
  fs.renameSync(FILE + '.tmp', FILE);
  cache = { mtime: fs.statSync(FILE).mtimeMs, data };
}

// « library/A/B/ » pour un dossier.
function pathOf(data, f) {
  const names = [];
  for (let cur = f, n = 0; cur && n < 50; cur = data.folders.find((x) => x.id === cur.parent), n++) names.unshift(cur.name);
  return `library/${names.join('/')}/`;
}

// Retrouve un dossier depuis un chemin écrit par l'utilisateur (« library/épées », « Library.Refs/ », « refs »).
function find(p) {
  const data = read();
  const parts = String(p || '').trim()
    .replace(/^["'`]+|["'`.,;]+$/g, '')
    .replace(/^(library|librairy|librarie|librairie|bibliotheque|bibliothèque|lib)\s*[/.\\]\s*/i, '')
    .split(/[/\\]/).map(norm).filter(Boolean);
  if (!parts.length) return null;
  let parent = null;
  let found = null;
  for (const name of parts) {
    found = data.folders.find((f) => (f.parent || null) === parent && norm(f.name) === name);
    if (!found) return null;
    parent = found.id;
  }
  return found;
}

function descendants(data, fid) {
  const out = [fid];
  for (let i = 0; i < out.length; i++) for (const f of data.folders) if (f.parent === out[i]) out.push(f.id);
  return out;
}

function list() {
  const data = read();
  return data.folders.map((f) => ({ ...f, path: pathOf(data, f), count: data.items.filter((i) => i.folder === f.id).length }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function items(folderId) {
  const data = read();
  if (!data.folders.some((f) => f.id === folderId)) throw err('folderMissing', 'Folder not found', 404);
  return data.items.filter((i) => i.folder === folderId);
}

function cleanName(name) {
  const n = String(name || '').replace(/[/\\]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n) throw err('folderName', 'Give the folder a name');
  return n;
}

function create({ name, parent } = {}) {
  const data = read();
  const n = cleanName(name);
  const par = parent ? data.folders.find((f) => f.id === parent) : null;
  if (parent && !par) throw err('folderMissing', 'Folder not found', 404);
  if (data.folders.some((f) => (f.parent || null) === (par ? par.id : null) && norm(f.name) === norm(n))) throw err('folderExists', 'A folder with this name already exists here');
  const f = { id: id(), name: n, parent: par ? par.id : null, createdAt: new Date().toISOString() };
  data.folders.push(f);
  write(data);
  return { ...f, path: pathOf(data, f), count: 0 };
}

function update(fid, b = {}) {
  const data = read();
  const f = data.folders.find((x) => x.id === fid);
  if (!f) throw err('folderMissing', 'Folder not found', 404);
  const name = b.name !== undefined ? cleanName(b.name) : f.name;
  let parent = f.parent || null;
  if (b.parent !== undefined) {
    parent = b.parent || null;
    if (parent && (!data.folders.some((x) => x.id === parent) || descendants(data, fid).includes(parent))) throw err('folderMove', 'Cannot move a folder inside itself');
  }
  if (data.folders.some((x) => x.id !== fid && (x.parent || null) === parent && norm(x.name) === norm(name))) throw err('folderExists', 'A folder with this name already exists here');
  Object.assign(f, { name, parent });
  write(data);
  return { ...f, path: pathOf(data, f) };
}

function removeFiles(it) {
  for (const p of [it.file, ...(it.previews || [])].filter(Boolean)) {
    try { fs.rmSync(path.join(db.MEDIA_DIR, p), { force: true }); } catch {}
  }
}

function remove(fid) {
  const data = read();
  if (!data.folders.some((f) => f.id === fid)) throw err('folderMissing', 'Folder not found', 404);
  const gone = new Set(descendants(data, fid));
  for (const it of data.items) if (gone.has(it.folder)) removeFiles(it);
  data.items = data.items.filter((it) => !gone.has(it.folder));
  data.folders = data.folders.filter((f) => !gone.has(f.id));
  write(data);
  return { ok: true, removed: gone.size };
}

// Ressource de la bibliothèque ou texture VFX : on garde l'essentiel pour Claude (même si l'original disparaît).
function addRef(fid, b = {}, state) {
  const data = read();
  if (!data.folders.some((f) => f.id === fid)) throw err('folderMissing', 'Folder not found', 404);
  const kind = b.kind === 'texture' ? 'texture' : 'resource';
  const ref = String(b.ref || '').trim();
  if (!ref) throw err('folderRef', 'Nothing to add');
  if (data.items.some((i) => i.folder === fid && i.kind === kind && i.ref === ref)) throw err('folderDup', 'Already in this folder');
  let it;
  if (kind === 'resource') {
    const r = state && state.resources.find((x) => x.id === ref);
    if (!r) throw err('notFound', 'Resource not found', 404);
    it = { kind, ref, name: r.title, url: r.url || (r.file ? '/media/' + r.file : ''), description: String(r.description || '').slice(0, 400), type: r.type, category: r.category, thumbnail: r.thumbnail || '', file: '' };
  } else {
    if (!/^\d{3,20}$/.test(ref)) throw err('folderRef', 'Invalid texture ID');
    it = { kind, ref, name: String(b.name || '').slice(0, 120), flipbook: String(b.flipbook || ''), group: String(b.group || '').slice(0, 80), thumbnail: String(b.thumbnail || '').slice(0, 500) };
  }
  Object.assign(it, { id: id(), folder: fid, createdAt: new Date().toISOString() });
  data.items.push(it);
  write(data);
  return it;
}

// Fichier importé : gardé tel quel (pour l'utiliser ensuite), avec des aperçus légers faits par l'interface.
function addFile(fid, name, buf) {
  const data = read();
  if (!data.folders.some((f) => f.id === fid)) throw err('folderMissing', 'Folder not found', 404);
  if (!buf || !buf.length) throw err('folderEmptyFile', 'Empty file');
  const original = path.basename(String(name || 'file')).slice(0, 120);
  const ext = (path.extname(original).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0];
  const media = /^\.(png|jpe?g|gif|webp|bmp|tga|svg)$/.test(ext) ? 'image' : /^\.(mp4|webm|mov|m4v|mkv)$/.test(ext) ? 'video' : 'other';
  const iid = id();
  fs.mkdirSync(DIR, { recursive: true });
  const file = `folders/${iid}${ext}`;
  fs.writeFileSync(path.join(db.MEDIA_DIR, file), buf);
  const it = { id: iid, folder: fid, kind: 'file', name: original, file, media, size: buf.length, previews: [], createdAt: new Date().toISOString() };
  data.items.push(it);
  write(data);
  return it;
}

function setPreviews(iid, b = {}) {
  const data = read();
  const it = data.items.find((i) => i.id === iid);
  if (!it || it.kind !== 'file') throw err('notFound', 'File not found', 404);
  removeFiles({ previews: it.previews });
  fs.mkdirSync(DIR, { recursive: true });
  it.previews = (Array.isArray(b.frames) ? b.frames : []).slice(0, MAX_PREVIEWS).map((src, n) => {
    const m = String(src).match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw err('chatFileBad', 'Unsupported file');
    const out = Buffer.from(m[2], 'base64');
    if (out.length > 3 * 1024 * 1024) throw err('tooBig', 'File too large');
    const p = `folders/${iid}-p${n}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`;
    fs.writeFileSync(path.join(db.MEDIA_DIR, p), out);
    return p;
  });
  if (Array.isArray(b.times)) it.times = b.times.slice(0, it.previews.length).map((x) => Math.round(Number(x) * 10) / 10 || 0);
  if (b.duration) it.duration = Math.round(Number(b.duration) * 10) / 10 || 0;
  if (b.width && b.height) Object.assign(it, { width: Number(b.width) || 0, height: Number(b.height) || 0 });
  write(data);
  return it;
}

function updateItem(iid, b = {}) {
  const data = read();
  const it = data.items.find((i) => i.id === iid);
  if (!it) throw err('notFound', 'Not found', 404);
  if (b.folder !== undefined) {
    if (!data.folders.some((f) => f.id === b.folder)) throw err('folderMissing', 'Folder not found', 404);
    it.folder = b.folder;
  }
  if (b.note !== undefined) it.note = String(b.note).slice(0, 500);
  write(data);
  return it;
}

function removeItem(iid) {
  const data = read();
  const it = data.items.find((i) => i.id === iid);
  if (!it) throw err('notFound', 'Not found', 404);
  if (it.kind === 'file') removeFiles(it);
  data.items = data.items.filter((i) => i !== it);
  write(data);
  return { ok: true };
}

// Contenu d'un dossier (et de ses sous-dossiers) pour Claude.
function describe(p) {
  const data = read();
  const f = find(p);
  if (!f) return null;
  const ids = descendants(data, f.id);
  const subs = data.folders.filter((x) => ids.includes(x.id) && x.id !== f.id).map((x) => pathOf(data, x));
  const its = data.items.filter((i) => ids.includes(i.folder)).map((i) => ({ ...i, path: pathOf(data, data.folders.find((x) => x.id === i.folder)) }));
  return { folder: f, path: pathOf(data, f), subfolders: subs, items: its };
}

module.exports = { FILE, find, list, items, create, update, remove, addRef, addFile, setPreviews, updateItem, removeItem, describe, pathOf };
