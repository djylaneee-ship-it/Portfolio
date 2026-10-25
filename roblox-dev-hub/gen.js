// Génération d'images par IA. Claude ne sait pas dessiner : Rovex le fait pour lui, via la fonction Supabase
// « rovex-gen » qui garde la clé OpenAI de l'admin en secret et applique une limite par ID et par jour.
// Le prompt envoyé reprend le style du skill de la catégorie et les images de référence de la bibliothèque ;
// le résultat est rangé dans la bibliothèque (tag « ai »).
const fs = require('fs');
const path = require('path');
const db = require('./db');
const skills = require('./skills');
const cloud = require('./cloud');

const SIZES = ['1024x1024', '1536x1024', '1024x1536'];

// Ce que l'on veut obtenir, et la catégorie dont on prend le style par défaut.
const IMAGE_KINDS = {
  icon: { cat: 'gui', format: 'A single game icon, centered, filling about 80% of the frame, readable at 64 px, no text, no frame, no background scene.', transparent: true },
  ui: { cat: 'gui', format: 'A game UI element (button, panel or frame), flat front view, clean edges, no text unless asked, usable as a Roblox ImageLabel.', transparent: true },
  thumbnail: { cat: 'gfx', format: 'A Roblox game thumbnail / GFX, dynamic composition, strong lighting, high contrast, 16:9 friendly framing.', transparent: false },
  texture: { cat: 'building', format: 'A seamless tileable texture, flat lighting, viewed straight on, no perspective, no shadows baked in.', transparent: false },
  vfx: { cat: 'vfx', format: 'A VFX sprite / particle texture: bright shape on a transparent background, soft edges, centered, no scene.', transparent: true },
  art: { cat: 'gfx', format: 'Concept art for a Roblox game.', transparent: false },
};

const err = (key, message, vars) => Object.assign(new Error(message), { key, vars, code: 400 });

// ---------- Fonction Supabase « rovex-gen » ----------
const SHARED_URL = () => `${cloud.URL}/functions/v1/rovex-gen`;
let shared = { at: 0, info: null };
async function refreshShared(force = false) {
  if (!cloud.enabled) return null;
  if (!force && Date.now() - shared.at < 10 * 60e3) return shared.info;
  try {
    const r = await fetch(SHARED_URL(), { headers: { apikey: cloud.KEY }, signal: AbortSignal.timeout(8000) });
    shared = { at: Date.now(), info: r.ok ? await r.json() : null };
  } catch {
    shared = { at: Date.now(), info: null };
  }
  return shared.info;
}
const credOf = (state) => (state.auth && state.auth.lastCred && state.auth.lastCred.code) || '';

async function callShared(body) {
  let res;
  try {
    res = await fetch(SHARED_URL(), {
      method: 'POST', headers: { apikey: cloud.KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(280e3),
    });
  } catch {
    throw err('cloudDown', 'Cannot reach the Rovex server');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(err(j.key || 'genFailed', j.error || `HTTP ${res.status}`, j.vars || { msg: j.error || `HTTP ${res.status}` }), { code: res.status === 429 ? 429 : 400 });
  return j;
}

// Ce qu'il reste aujourd'hui à cet ID.
async function quota(state) {
  const code = credOf(state);
  if (!code || !cloud.enabled) return null;
  try { return (await cloud.rpc('rovex_gen_status', { p_code: code })).image || null; } catch { return null; }
}

function status(state) {
  const sh = shared.info || {};
  return { ready: Boolean(sh.image && credOf(state)), available: Boolean(sh.image), model: sh.model || '' };
}

// Réduit une image de référence avant de l'envoyer (dans l'app de bureau uniquement).
function shrink(buf) {
  try {
    const { nativeImage } = require('electron');
    if (!nativeImage) return buf;
    const img = nativeImage.createFromBuffer(buf);
    return img.getSize().width > 768 ? img.resize({ width: 768 }).toPNG() : buf;
  } catch {
    return buf;
  }
}

// Images de référence : celles que l'utilisateur a choisies, sinon ses images (favoris d'abord) de la catégorie.
function references(state, { category, ids = [] }) {
  const local = (r) => r.type === 'image' && r.file && /\.(png|jpe?g|webp)$/i.test(r.file) && fs.existsSync(path.join(db.MEDIA_DIR, r.file));
  let refs = ids.length ? state.resources.filter((r) => ids.includes(r.id) && local(r)) : [];
  if (!refs.length && !ids.length) {
    refs = state.resources
      .filter((r) => local(r) && r.category === category && !(r.tags || []).includes('ai'))
      .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
      .slice(0, 2);
  }
  return refs.slice(0, 2).map((r) => {
    const raw = fs.readFileSync(path.join(db.MEDIA_DIR, r.file));
    const data = shrink(raw);
    const ext = data !== raw ? 'png' : path.extname(r.file).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return { id: r.id, title: r.title, notes: r.notes || '', data, mime: 'image/' + ext, ext: ext === 'jpeg' ? 'jpg' : ext };
  }).filter((r) => r.data.length < 1.5 * 1024 * 1024);
}

function imagePrompt(state, { prompt, kind, category, transparent, refs }) {
  const k = IMAGE_KINDS[kind] || IMAGE_KINDS.icon;
  const art = skills.getSkill(state, category).art;
  const parts = [String(prompt).trim(), '', `Style (Rovex ${category} skill): ${art}`, `Format: ${k.format}`];
  if (transparent) parts.push('Background: fully transparent (PNG with alpha).');
  if (refs.length) parts.push(`Match the art style of the ${refs.length} reference image(s) provided (${refs.map((r) => r.title + (r.notes ? ` — ${r.notes}` : '')).join('; ')}), but draw a new subject.`);
  return parts.join('\n');
}

function save(state, buf, meta) {
  fs.mkdirSync(db.MEDIA_DIR, { recursive: true });
  const slug = String(meta.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'asset';
  const file = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${slug}.png`;
  fs.writeFileSync(path.join(db.MEDIA_DIR, file), buf);
  const { resource } = db.upsert(state, {
    title: meta.title, type: 'image', category: meta.category,
    tags: ['ai', meta.kind], file, thumbnail: `/media/${file}`,
    description: meta.prompt, source: 'ai',
  }, { fresh: true });
  return { id: resource.id, title: resource.title, file, path: path.join(db.MEDIA_DIR, file), url: `/media/${file}` };
}

const titleOf = (prompt) => {
  const t = String(prompt).replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
};

async function generateImage(state, a = {}) {
  const prompt = String(a.prompt || '').trim();
  if (!prompt) throw err('genPrompt', 'Describe what to generate');
  const kind = IMAGE_KINDS[a.kind] ? a.kind : 'icon';
  const category = skills.SKILL_CATS.includes(a.category) ? a.category : IMAGE_KINDS[kind].cat;
  const transparent = a.transparent === undefined ? IMAGE_KINDS[kind].transparent : Boolean(a.transparent);
  const n = Math.max(1, Math.min(4, Number(a.count) || 1));
  const size = SIZES.includes(a.size) ? a.size : kind === 'thumbnail' ? '1536x1024' : '1024x1024';
  if (!credOf(state)) throw err('loginRequired', 'Sign in with your access ID');
  // Fonction pas encore vue : on redemande tout de suite (elle a pu être installée entre-temps).
  if (!((await refreshShared()) && shared.info.image) && !((await refreshShared(true)) && shared.info.image)) {
    throw err('genShared', 'Image generation is not set up yet');
  }
  const refs = a.use_references === false ? [] : references(state, { category, ids: Array.isArray(a.reference_ids) ? a.reference_ids : [] });
  const finalPrompt = imagePrompt(state, { prompt, kind, category, transparent, refs });
  const j = await callShared({
    type: 'image', code: credOf(state), prompt: finalPrompt, n, size, transparent,
    refs: refs.map((r) => ({ b64: r.data.toString('base64'), mime: r.mime, name: r.title.replace(/[^\w.-]+/g, '_') + '.' + r.ext })),
  });
  const images = (j.images || []).map((b) => Buffer.from(b, 'base64'));
  if (!images.length) throw err('genEmpty', 'No image returned');
  const title = a.title ? String(a.title).slice(0, 80) : titleOf(prompt);
  const items = images.map((buf, i) => save(state, buf, { title: images.length > 1 ? `${title} (${i + 1})` : title, category, kind, prompt }));
  return {
    kind: 'image', category, model: j.model, size, transparent, quota: j.quota,
    prompt: finalPrompt, references: refs.map((r) => r.title), items,
    images, // tampons bruts, retirés avant la réponse MCP (aperçu pour Claude)
  };
}

// Les créations IA, les plus récentes d'abord.
function items(state, limit = 60) {
  return state.resources.filter((r) => r.source === 'ai' && r.type === 'image').slice(0, limit);
}

module.exports = { status, refreshShared, quota, generateImage, items, IMAGE_KINDS, SIZES };
