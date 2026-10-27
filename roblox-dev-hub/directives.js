// Directives écrites dans un prompt (Prompt Booster, Chat Claude, ou collé dans Claude Desktop) :
//   !reference: library/Épées/Feu/   → les fichiers de ce dossier servent de références
//   !skill: vfx, animation            → charger exactement ces skills
//   !software: Roblox Studio, Blender → travailler seulement dans ces logiciels
//   !texture: 10024120805 (Wood Planks), ToonFire → utiliser ces textures (VFX ou build), par ID ou par nom
// parse() les lit, resolve() les vérifie (dossier existant, skill connu), forClaude() / forBooster() les redonnent
// en consignes claires, ensure() les remet dans le prompt amélioré si Groq les a perdues.
const db = require('./db');
const skills = require('./skills');
const folders = require('./folders');
const textures = require('./vfx-textures');

const RE = /!\s*(r[ée]f[ée]rences?|refs?|skills?|softwares?|logiciels?|soft|app|textures?|tex)\s*:\s*([^!\n]*)/gi;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

// Noms de skills acceptés (id, nom affiché, mots courants en français).
const SKILL_ALIASES = {
  core: 'rovex-core', rovexcore: 'rovex-core', base: 'rovex-core', socle: 'rovex-core',
  script: 'scripting', scripts: 'scripting', code: 'scripting', luau: 'scripting', lua: 'scripting',
  effet: 'vfx', effets: 'vfx', effects: 'vfx', particles: 'vfx', particules: 'vfx',
  anim: 'animation', animations: 'animation',
  cutscene: 'cutscenes', cinematique: 'cutscenes', cinematiques: 'cutscenes', cinematic: 'cutscenes',
  ui: 'gui', interface: 'gui', guiui: 'gui', hud: 'gui',
  graphisme: 'gfx', thumbnail: 'gfx', icones: 'gfx', icons: 'gfx',
  model: 'modeling', modelling: 'modeling', modelisation: 'modeling', mesh: 'modeling', '3d': 'modeling',
  build: 'building', builds: 'building', map: 'building', maps: 'building', buildingmaps: 'building', construction: 'building',
  son: 'audio', sons: 'audio', sound: 'audio', musique: 'audio', music: 'audio',
  gamedesign: 'design',
  tool: 'tools', outils: 'tools', toolsplugins: 'tools', plugins: 'tools',
};
const SOFTWARE = [
  { name: 'Roblox Studio', keys: ['robloxstudio', 'studio', 'roblox', 'rbxstudio'], tools: 'the studio_* tools (read and edit the open place), execute_luau, upload_image_to_roblox' },
  { name: 'Blender', keys: ['blender', 'blend'], tools: 'the blender_* tools (blender_execute_python with the rx toolkit, blender_view) and r6_* for R6 animations' },
];

function parse(text) {
  const out = { reference: [], skill: [], software: [], texture: [], raw: [] };
  for (const m of String(text || '').matchAll(RE)) {
    const k = norm(m[1]);
    const kind = k.startsWith('r') ? 'reference' : k.startsWith('skill') ? 'skill' : k.startsWith('tex') ? 'texture' : 'software';
    let value = m[2].trim();
    // Chemin suivi de texte sur la même ligne : « library/Épées/ fais une épée » → « library/Épées/ ».
    if (kind === 'reference') value = (value.match(/^(.*?\/)(?=\s|$)/) || [, value])[1];
    value = value.replace(/[.,;]+$/, '').trim();
    if (!value) continue;
    out.raw.push(`!${kind}: ${value}`);
    if (kind === 'reference') out.reference.push(value.replace(/^["'`]|["'`]$/g, ''));
    else out[kind].push(...value.split(kind === 'texture' ? /[,;+]/ : /[,;+&]|\s(?:et|and)\s/i).map((x) => x.trim()).filter(Boolean));
  }
  for (const k of ['reference', 'skill', 'software', 'texture', 'raw']) out[k] = [...new Set(out[k])];
  out.any = out.raw.length > 0;
  return out;
}

function skillId(name) {
  const words = String(name || '').trim().split(/\s+/);
  return skillOne(name) || (words.length > 1 ? skillOne(words[0]) : null);
}
function skillOne(name) {
  const n = norm(name);
  if (!n) return null;
  if (n === 'rovexcore' || SKILL_ALIASES[n] === 'rovex-core') return 'rovex-core';
  const byId = skills.SKILL_CATS.find((c) => norm(c) === n);
  if (byId) return byId;
  const byLabel = db.CATEGORIES.find((c) => skills.SKILL_CATS.includes(c.id) && norm(c.label) === n);
  if (byLabel) return byLabel.id;
  if (SKILL_ALIASES[n]) return SKILL_ALIASES[n];
  return skills.SKILL_CATS.find((c) => n.startsWith(norm(c)) || norm(c).startsWith(n)) || null;
}

function softwareOf(name) {
  const n = norm(name);
  const known = SOFTWARE.find((s) => s.keys.includes(n) || s.keys.some((k) => n.startsWith(k)));
  return known || { name: String(name).trim().split(/\s+/).slice(0, 3).join(' '), tools: '' };
}

// Une texture par ID (« 10024120805 », « rbxassetid://… ») ou par nom (« Wood Planks », « ToonFire 4x4 »).
function textureOf(asked, list) {
  const id = (asked.match(/\d{6,13}/) || [])[0];
  if (id) return list.find((t) => t.id === id) || { id, unknown: true };
  const n = norm(asked);
  const full = (t) => norm(`${t.name} ${t.variant || ''}`);
  const best = textures.search(list, { query: asked, limit: 1 })[0];
  return list.find((t) => full(t) === n) || list.find((t) => norm(t.name) === n) || (best && list.find((t) => t.id === best.id)) || null;
}

// Vérifie chaque directive : dossier trouvé (avec son contenu), skill connu, logiciel reconnu, texture connue.
function resolve(p, state = null) {
  const refs = p.reference.map((r) => {
    let d = folders.describe(r);
    const words = r.split(/\s+/);
    for (let n = words.length - 1; !d && n > 0; n--) d = folders.describe(words.slice(0, n).join(' '));
    return d ? { asked: r, path: d.path, items: d.items, subfolders: d.subfolders } : { asked: r, missing: true };
  });
  const sk = p.skill.map((s) => ({ asked: s, id: skillId(s) }));
  const sw = p.software.map(softwareOf).filter((s, i, a) => a.findIndex((x) => x.name === s.name) === i);
  const all = p.texture.length ? textures.all(state) : [];
  const tx = p.texture.map((asked) => ({ asked, t: textureOf(asked, all) }));
  return { refs, skills: sk, software: sw, textures: tx };
}

function itemLine(i) {
  if (i.kind === 'texture') return `VFX texture rbxassetid://${i.ref}${i.name ? ` "${i.name}"` : ''}${i.flipbook ? ` (flipbook ${i.flipbook})` : ''}`;
  if (i.kind === 'resource') return `${i.type || 'resource'} "${i.name}"${i.url && !i.url.startsWith('/media/') ? ` ${i.url}` : ''}${i.description ? ` — ${i.description.slice(0, 160)}` : ''}`;
  return `${i.media === 'image' ? 'image' : i.media === 'video' ? 'video' : 'file'} "${i.name}"${i.duration ? ` (${i.duration} s)` : ''}`;
}

// Consignes pour Claude (ajoutées aux messages du Chat Claude, et règle générale des instructions MCP).
function forClaude(p, r = resolve(p)) {
  if (!p.any) return '';
  const lines = ['[Rovex directives written by the user — MANDATORY]'];
  for (const ref of r.refs) {
    if (ref.missing) lines.push(`- !reference: ${ref.asked} → this folder does not exist in Rovex: tell the user (call rovex_folder with no path to list the folders).`);
    else lines.push(`- !reference: ${ref.path} → ${ref.items.length} item(s) (${ref.items.slice(0, 12).map(itemLine).join('; ')}${ref.items.length > 12 ? '; …' : ''}). Call rovex_folder("${ref.path}") FIRST, look at every image and video frame, and match them: they show what the user wants. Use the VFX textures and resources listed there before any other.`);
  }
  const ok = r.skills.filter((s) => s.id);
  if (ok.length) lines.push(`- !skill: ${ok.map((s) => s.id).join(', ')} → call load_skill with exactly these categories${ok.some((s) => s.id === 'rovex-core') ? ' (rovex-core is always included)' : ''}, no other skill, and follow them strictly.`);
  for (const s of r.skills.filter((x) => !x.id)) lines.push(`- !skill: ${s.asked} → unknown skill. Known skills: ${skills.SKILL_CATS.join(', ')}. Ask the user or pick the closest one and say which.`);
  const tex = r.textures.filter((x) => x.t && !x.t.unknown);
  if (tex.length) {
    const desc = tex.map(({ t }) => `rbxassetid://${t.id} "${[t.name, t.variant].filter(Boolean).join(' ') || 'unnamed'}" (${t.kind === 'build' ? 'build surface texture' : `VFX ${t.kind}`}${t.flipbook ? `, flipbook ${t.flipbook}: FlipbookLayout Grid${t.flipbook}` : ''})`);
    lines.push(`- !texture: ${desc.join('; ')} → use exactly these textures for the textures of this task (ParticleEmitter / Beam / Trail for VFX, Texture or MaterialVariant on parts for builds), not others.`);
  }
  for (const x of r.textures.filter((y) => y.t && y.t.unknown)) lines.push(`- !texture: ${x.t.id} → not in the Rovex texture library; use it anyway since the user asked for it explicitly.`);
  for (const x of r.textures.filter((y) => !y.t)) lines.push(`- !texture: "${x.asked}" → no Rovex texture with this name: search with find_vfx_textures / find_build_textures, propose the closest ones and say which you used.`);
  if (r.software.length) lines.push(`- !software: ${r.software.map((s) => s.name).join(', ')} → do the work ONLY in ${r.software.map((s) => s.name + (s.tools ? ` (${s.tools})` : '')).join(' and ')}. Do not use other software; if a needed tool is not connected, say so instead of switching.`);
  return lines.join('\n');
}

// Pour Groq (Prompt Booster) : ce qu'il doit garder et transformer en consignes fermes.
function forBooster(p, r = resolve(p)) {
  if (!p.any) return '';
  return `\n\nUSER DIRECTIVES (the user wrote them on purpose: they are mandatory and override your own choices):
${forClaude(p, r)}
How to handle them in the prompt you write:
- End the prompt with a section titled "Rovex directives" containing exactly these lines:
${lines(p, r).join('\n')}
- !skill: in step 1, call load_skill with ONLY these categories (not the ones you would have picked).
- !reference: tell Claude to call rovex_folder on that path before anything else and to follow those references (shapes, colors, style, timing); never invent other references.
- !texture: use exactly those texture IDs where the task needs textures (write the IDs in the prompt), no other texture.
- !software: the whole workflow happens only in those software; do not mention or use others (e.g. no Blender if only Roblox Studio is listed, no Roblox parts modeling if only Blender is listed).`;
}

// Directives remises au propre (chemin trouvé, ids de skills, noms de logiciels) : une ligne par type.
function lines(p, r = resolve(p)) {
  const out = [];
  if (r.refs.length) out.push(...r.refs.map((x) => `!reference: ${x.path || x.asked}`));
  const sk = [...new Set(r.skills.map((x) => x.id || x.asked))];
  if (sk.length) out.push(`!skill: ${sk.join(', ')}`);
  if (r.software.length) out.push(`!software: ${r.software.map((x) => x.name).join(', ')}`);
  if (r.textures.length) out.push(`!texture: ${r.textures.map((x) => (x.t && !x.t.unknown ? `${x.t.id} (${[x.t.name, x.t.variant].filter(Boolean).join(' ') || 'unnamed'})` : x.t ? x.t.id : x.asked)).join(', ')}`);
  return out;
}

// Le prompt amélioré doit garder les directives : on rajoute celles qui manquent à la fin.
function ensure(text, p, r = resolve(p)) {
  if (!p.any) return text;
  const flat = (x) => x.toLowerCase().replace(/\s+/g, '');
  const missing = lines(p, r).filter((d) => !flat(text).includes(flat(d)));
  if (!missing.length) return text;
  return `${text.trim()}\n\nRovex directives:\n${missing.join('\n')}`;
}

module.exports = { parse, resolve, forClaude, forBooster, ensure, lines, skillId, SOFTWARE };
