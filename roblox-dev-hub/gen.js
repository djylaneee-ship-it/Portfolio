// Génération d'images par IA. Claude ne sait pas dessiner : Rovex le fait pour lui, via la fonction Supabase
// « rovex-gen » (générateur gratuit : Cloudflare FLUX ou Pollinations) qui applique une limite par ID et par jour.
// Le prompt envoyé reprend le style du skill de la catégorie et les images de référence de la bibliothèque ;
// le résultat est rangé dans la bibliothèque (tag « ai »).
const fs = require('fs');
const path = require('path');
const db = require('./db');
const skills = require('./skills');
const cloud = require('./cloud');
const blender = require('./blender');
const directives = require('./directives');

const SIZES = ['1024x1024', '1536x1024', '1024x1536'];

// Ce que l'on veut obtenir, et la catégorie dont on prend le style par défaut.
const IMAGE_KINDS = {
  icon: { cat: 'gui', format: 'A single Roblox simulator game icon, centered, filling about 80% of the frame, readable at 64 px: chunky bold shapes, a very thick dark navy outline around the whole silhouette, vibrant saturated gradient fills, cel-shaded highlights and shadows, slight 3D bevel, glossy. No text, no frame, no background scene.', transparent: true },
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
  try { return await cloud.rpc('rovex_gen_status', { p_code: code }); } catch { return null; }
}

function status(state) {
  const sh = shared.info || {};
  return {
    ready: Boolean(sh.image && credOf(state)), available: Boolean(sh.image), model: sh.model || '',
    text: { ready: Boolean(sh.text && credOf(state)), available: Boolean(sh.text), model: sh.textModel || '' },
  };
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
  // Fond uni blanc : les générateurs gratuits ne font pas la transparence, Rovex détoure ensuite.
  if (transparent) parts.push('Background: the subject isolated on a plain flat pure white background, nothing else around it, no shadow on the ground.');
  if (refs.length) parts.push(`Match the art style of the ${refs.length} reference image(s) provided (${refs.map((r) => r.title + (r.notes ? ` — ${r.notes}` : '')).join('; ')}), but draw a new subject.`);
  return parts.join('\n');
}

// Les générateurs gratuits ne savent pas faire de fond transparent : on demande un fond blanc uni, puis on
// l'efface (remplissage depuis les bords, bord adouci). Seulement dans l'app de bureau (nativeImage d'Electron).
function cutout(buf) {
  let ni;
  try { ni = require('electron').nativeImage; } catch {}
  if (!ni || typeof ni.createFromBuffer !== 'function') return null;
  const img = ni.createFromBuffer(buf);
  const { width: w, height: h } = img.getSize();
  if (!w || !h) return null;
  const px = Buffer.from(img.toBitmap()); // BGRA
  const at = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
  // Couleur du fond : moyenne des quatre coins.
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(at);
  const bg = [0, 1, 2].map((c) => corners.reduce((a, x) => a + x[c], 0) / 4);
  const dist = (i) => Math.max(Math.abs(px[i * 4] - bg[0]), Math.abs(px[i * 4 + 1] - bg[1]), Math.abs(px[i * 4 + 2] - bg[2]));
  const NEAR = 48;
  const FAR = 200;
  const gone = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (gone[i] || dist(i) > NEAR) continue;
    gone[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  // Bord de l'objet (3 pixels) : un peu transparent s'il ressemble encore au fond, et sans le liseré blanc.
  const ring = new Uint8Array(w * h);
  const near = (i, m, v) => { const x = i % w; return (x > 0 && m[i - 1] === v) || (x < w - 1 && m[i + 1] === v) || (i >= w && m[i - w] === v) || (i < w * (h - 1) && m[i + w] === v); };
  for (let i = 0; i < w * h; i++) if (!gone[i] && near(i, gone, 1)) ring[i] = 1;
  for (let pass = 2; pass <= 3; pass++) for (let i = 0; i < w * h; i++) if (!gone[i] && !ring[i] && near(i, ring, pass - 1)) ring[i] = pass;
  let removed = 0;
  for (let i = 0; i < w * h; i++) {
    if (gone[i]) { px[i * 4 + 3] = 0; removed++; continue; }
    if (!ring[i]) continue;
    const a = Math.min(1, Math.max(0.2, (dist(i) - NEAR) / (FAR - NEAR)));
    if (a >= 1) continue;
    for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.max(0, Math.min(255, Math.round((px[i * 4 + c] - (1 - a) * bg[c]) / a)));
    px[i * 4 + 3] = Math.round(255 * a);
  }
  // Fond pas uni (rien ou presque tout effacé) : on garde l'image telle quelle.
  if (removed < w * h * 0.05 || removed > w * h * 0.97) return null;
  return ni.createFromBitmap(px, { width: w, height: h }).toPNG();
}

const isJpeg = (buf) => buf[0] === 0xff && buf[1] === 0xd8;

function save(state, buf, meta) {
  fs.mkdirSync(db.MEDIA_DIR, { recursive: true });
  const slug = String(meta.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'asset';
  const file = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${slug}.${isJpeg(buf) ? 'jpg' : 'png'}`;
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
  // Images de référence : seulement si le générateur sait les lire (OpenAI) ; sinon leur description suffit.
  const refs = a.use_references === false || !shared.info.refs ? [] : references(state, { category, ids: Array.isArray(a.reference_ids) ? a.reference_ids : [] });
  const finalPrompt = imagePrompt(state, { prompt, kind, category, transparent, refs });
  const j = await callShared({
    type: 'image', code: credOf(state), prompt: finalPrompt, n, size, transparent,
    refs: refs.map((r) => ({ b64: r.data.toString('base64'), mime: r.mime, name: r.title.replace(/[^\w.-]+/g, '_') + '.' + r.ext })),
  });
  let images = (j.images || []).map((b) => Buffer.from(b, 'base64'));
  if (transparent && !j.transparent) images = images.map((b) => cutout(b) || b);
  if (!images.length) throw err('genEmpty', 'No image returned');
  const title = a.title ? String(a.title).slice(0, 80) : titleOf(prompt);
  const items = images.map((buf, i) => save(state, buf, { title: images.length > 1 ? `${title} (${i + 1})` : title, category, kind, prompt }));
  return {
    kind: 'image', category, model: j.model, size, transparent, quota: j.quota,
    prompt: finalPrompt, references: refs.map((r) => r.title), items,
    images, // tampons bruts, retirés avant la réponse MCP (aperçu pour Claude)
  };
}

// ---------- Prompt Booster : l'IA (Groq) réécrit une demande en vrac en prompt détaillé pour Claude + Rovex ----------
const BOOSTER_RULES = `You are Rovex Prompt Architect. You turn a short, rough request from a Roblox game developer into a complete, precise prompt for Claude.

Claude is connected to Rovex Hub, an MCP server holding the user's Roblox development knowledge base. Tools Claude can call:
- load_skill(categories, query): the Rovex core rules + the rules of each category given + every validated code example + the best tutorials/docs + top open source projects. Categories: scripting, vfx, animation, cutscenes, gui, gfx, modeling, building, audio, design, tools. Only the categories the task needs (an attack = scripting + animation + vfx; a boss intro = cutscenes + animation + vfx + audio).
- search_resources(query, category): full-text search in tutorials, docs, videos and DevForum posts.
- list_examples(category) / get_example(id): validated learning examples (request + correct Luau code + why it is correct).
- search_opensource(query, category): GitHub repos, free models and plugins, sorted by stars.
- generate_image(prompt, kind, category): generates icons, UI images, thumbnails, textures and VFX sprites in the user's art style and saves them in the library.
- find_build_textures(query): the user's surface textures for builds and maps (ground, grass, sand, wood, planks, fence, cobblestone, rock) with their rbxassetid and images; mandatory for any build texture.
- rovex_folder(path): the user's own folders of references in Rovex (images, video key frames, VFX textures, saved resources), e.g. rovex_folder("library/Swords/").
- Blender tools (when the user connected Blender): blender_execute_python (builds meshes with bpy / bmesh and exports FBX), blender_viewport_screenshot (to check the model), blender_scene_info, and r6_* tools for R6 animations.

Write the improved prompt so that Claude:
1. Starts with Rovex Hub: calls load_skill once with EVERY category the task touches and only those (name them explicitly with good keywords, e.g. load_skill(["scripting", "gui"], "pet shop datastore")), then search_resources with precise keywords, reads the matching validated examples (mention their titles when they fit), and checks search_opensource before writing a big system from scratch.
2. Knows exactly what to build: restate the goal clearly, infer the missing details sensibly (game genre, PC + mobile, R15, client/server split, data to save…) and list them as assumptions, then describe the features, behaviors, UI and edge cases.
3. Follows the Roblox best practices of those categories (use the category rules given below: server authority and RemoteEvent validation, ModuleScripts, DataStore safety, Scale-based responsive UI, TweenService, task library, cleanup of connections, performance, mobile…). Project art direction: VFX are made of custom-textured ParticleEmitters, never the Fire, Smoke or Sparkles classes, and every texture MUST come from the Rovex VFX textures (find_vfx_textures), no other texture ID. No invented asset IDs: missing assets are listed as placeholders to provide.
4. Calls generate_image for every icon, image or texture the feature needs, describing each one.
5. For ANY 3D modeling request (a model, mesh, weapon, pet, prop, character, building piece, low poly asset…), the prompt MUST contain this rule, stated firmly: "If the Blender tools are available (blender_execute_python), you MUST model it in Blender with them: build the mesh with bpy / bmesh, check it with blender_viewport_screenshot, iterate, then export it as FBX for Roblox. Only if Blender is not connected, build it in Roblox Studio instead and say so."
6. Delivers: every script with its exact type (Script / LocalScript / ModuleScript) and location in the Explorer, the Instances to create with key properties, setup steps in Roblox Studio, how to test it, and a short explanation of the architecture.
7. Cites the Rovex resources and examples it relied on.

Rules for your answer:
- Output ONLY the final prompt, ready to paste. No preamble, no comments, no code blocks of Luau.
- ALWAYS write the prompt in English, whatever the language of the request (translate it). Start with "Using Rovex Hub,". If the request is not in English, end the prompt with one line asking Claude to answer in the user's language, e.g. "Reply to me in French."
- Use short sections with titles and bullet points. Be specific to this request: no generic filler.
- If a focus category is given, center the prompt on it (other categories only if really needed).`;

function boosterContext(state, focus) {
  const counts = {};
  for (const r of state.resources) counts[r.category] = (counts[r.category] || 0) + 1;
  const ex = (state.examples || []).filter((e) => e.status === 'validated');
  const lines = skills.SKILL_CATS.map((c) => {
    const titles = ex.filter((e) => e.category === c).slice(0, 8).map((e) => `"${e.title}"`).join(', ');
    return `- ${c}: ${counts[c] || 0} resources${titles ? `; validated examples: ${titles}` : ''}`;
  });
  // Les skills complets sont longs : le résumé de chacun, et les consignes entières de la catégorie visée.
  const rules = skills.SKILL_CATS.map((c) => `- ${c}: ${skills.getSkill(state, c).description}`).join('\n');
  const full = focus && skills.SKILL_CATS.includes(focus) ? `\n\nFull rules of the focus category (${focus}):\n${skills.getSkill(state, focus).instructions.slice(0, 9000)}` : '';
  const bl = blender.enabled() ? 'Blender: CONNECTED (the Blender tools are available to Claude).' : 'Blender: not connected right now (keep the conditional Blender rule anyway).';
  return `What this user's Rovex Hub contains:\n${lines.join('\n')}\n${bl}\n\nRovex skills (Claude loads them with load_skill):\n${rules}${full}`;
}

async function enhancePrompt(state, a = {}) {
  const request = String(a.text || '').trim();
  if (!request) throw err('genPrompt', 'Describe what you want');
  if (!credOf(state)) throw err('loginRequired', 'Sign in with your access ID');
  if (!((await refreshShared()) && shared.info.text) && !((await refreshShared(true)) && shared.info.text)) {
    throw err('genShared', 'Prompt improvement is not set up yet');
  }
  // Directives de l'utilisateur (!reference, !skill, !software) : Groq doit les respecter et les garder.
  const dir = directives.parse(request);
  const res = directives.resolve(dir, state);
  const forced = res.skills.map((x) => x.id).filter((x) => skills.SKILL_CATS.includes(x));
  const category = skills.SKILL_CATS.includes(a.category) ? a.category : forced.length === 1 ? forced[0] : '';
  const prompt = `${category ? `Focus category: ${category}\n\n` : ''}User request:\n${request.slice(0, 4000)}`;
  const j = await callShared({ type: 'text', code: credOf(state), system: `${BOOSTER_RULES}\n\n${boosterContext(state, category)}${directives.forBooster(dir, res)}`, prompt });
  let text = String(j.text || '').replace(/^```[a-z]*\n?|```$/g, '').trim();
  if (!text) throw err('genEmpty', 'No answer');
  text = directives.ensure(text, dir, res);
  // Historique local des 15 derniers prompts améliorés.
  state.boosts = [{ id: db.newId(), input: request, output: text, category, at: new Date().toISOString() }, ...(state.boosts || [])].slice(0, 15);
  return { text, model: j.model, quota: j.quota };
}

// Les créations IA, les plus récentes d'abord.
function items(state, limit = 60) {
  return state.resources.filter((r) => r.source === 'ai' && r.type === 'image').slice(0, limit);
}

module.exports = { status, refreshShared, quota, generateImage, enhancePrompt, items, cutout, IMAGE_KINDS, SIZES };
