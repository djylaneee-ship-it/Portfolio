// Skills Rovex : un skill Claude par catégorie. Quand Claude attaque une tâche (ex. un script),
// il charge le skill de la catégorie (consignes + tout ce que la base contient : exemples validés,
// docs, vidéos, open source, notes) avant d'écrire quoi que ce soit.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { CATEGORIES, search } = require('./db');

const SKILL_CATS = CATEGORIES.map((c) => c.id).filter((id) => id !== 'gameplay');

// Textes des skills (socle commun + un par catégorie) : voir skill-texts.js.
const TEXTS = require('./skill-texts');
const { DEFAULTS, DESCRIPTIONS } = TEXTS;
const CORE_ID = 'core';
DEFAULTS[CORE_ID] = TEXTS.CORE;
DESCRIPTIONS[CORE_ID] = 'Socle commun de tous les skills Rovex : utiliser les références et outils de Rovex Hub, règles de production et de livraison.';

// Style appliqué aux images et aux sons générés par IA pour cette catégorie (modifiable dans Skills).
const ART = {
  scripting: 'Clean Roblox-style illustration, bold shapes, saturated colors, soft studio lighting.',
  vfx: 'Stylized game VFX: glowing core, bright saturated colors fading to transparent edges, anime / simulator energy, high contrast.',
  animation: 'Expressive Roblox character pose, clear silhouette, dynamic motion, bright colors.',
  cutscenes: 'Cinematic anime-style Roblox shot: dynamic camera angle, strong pose, rim light, bold contrast, particle energy, speed and depth.',
  gui: 'Roblox simulator UI style: thick dark outline, bright saturated colors, soft glossy highlights and a light top gradient, slight 3D bevel, cartoony and readable at small size.',
  gfx: 'Polished Roblox GFX render: vibrant colors, cinematic rim lighting, soft depth of field, Blender-render look, characters with Roblox proportions.',
  modeling: 'Low poly stylized asset, clean flat shading with subtle gradients, Roblox-friendly proportions, bright palette.',
  building: 'Stylized Roblox environment art, bright and clean, soft global illumination, readable shapes, stud-like details where it fits.',
  design: 'Clear game design diagram or mockup, simple flat shapes, readable labels.',
  tools: 'Clean flat app icon style, simple shapes, Roblox Studio color palette.',
};

// Les consignes modifiées avant la version actuelle des skills sont remplacées par les nouveaux textes
// (le style d'image modifié est gardé).
function getSkill(state, cat) {
  const saved = ((state.skills || {})[cat]) || {};
  const instructions = (saved.v || 1) >= TEXTS.versionOf(cat) ? saved.instructions : '';
  return {
    id: cat,
    name: `rovex-${cat}`,
    description: DESCRIPTIONS[cat] || '',
    enabled: cat === CORE_ID || saved.enabled !== false,
    instructions: instructions || DEFAULTS[cat] || '',
    custom: Boolean(instructions || saved.art),
    art: cat === CORE_ID ? '' : saved.art || ART[cat] || '',
    updatedAt: saved.updatedAt || null,
  };
}

// Tout ce que Rovex sait sur la catégorie : ce que Claude lit avant de travailler.
function context(state, cat, { query = '' } = {}) {
  const examples = (state.examples || []).filter((e) => e.category === cat && e.status === 'validated');
  const learn = search(state, { q: query, category: cat, exclude: ['opensource', 'asset', 'chaine', 'recherche'] });
  // D'abord ce que l'utilisateur a annoté ou mis en favori, puis les docs, puis le reste.
  const rank = (r) => (r.notes ? 4 : 0) + (r.favorite ? 3 : 0) + (r.type === 'doc' ? 2 : 0) + (r.type === 'video' ? 1 : 0);
  const resources = [...learn].sort((a, b) => rank(b) - rank(a)).slice(0, 25);
  const opensource = search(state, { q: query, category: cat, types: ['opensource', 'asset'], sort: 'stars', limit: 10 });
  return {
    examples: examples.map((e) => ({ id: e.id, title: e.title, request: e.prompt, file: e.filename, code: e.code, why: e.why, sources: e.sources })),
    resources: resources.map((r) => ({ title: r.title, url: r.url, type: r.type, author: r.author || undefined, notes: r.notes || undefined })),
    opensource: opensource.map((r) => ({ title: r.title, url: r.url, stars: r.stars || undefined, description: (r.description || '').split(' · ')[0] || undefined })),
    totals: { examples: examples.length, resources: learn.length, opensource: search(state, { category: cat, types: ['opensource', 'asset'] }).length },
  };
}

// Totaux de toutes les catégories en un seul passage (page Skills) : gardés tant que la bibliothèque ne change pas.
let totalsCache = { key: '', out: null };
const LEARN_OUT = new Set(['opensource', 'asset', 'chaine', 'recherche']);
function totalsAll(state) {
  const key = `${state.resources.length}:${state.cloudSeq || 0}:${(state.examples || []).length}:${(state.examples || []).filter((e) => e.status === 'validated').length}`;
  if (totalsCache.key === key) return totalsCache.out;
  const out = Object.fromEntries(SKILL_CATS.map((c) => [c, { examples: 0, resources: 0, opensource: 0 }]));
  for (const r of state.resources) {
    const o = out[r.category];
    if (!o) continue;
    if (r.type === 'opensource' || r.type === 'asset') o.opensource++;
    if (!LEARN_OUT.has(r.type)) o.resources++;
  }
  for (const e of state.examples || []) if (e.status === 'validated' && out[e.category]) out[e.category].examples++;
  totalsCache = { key, out };
  return out;
}

// Pour les VFX : un résumé de la bibliothèque de textures (les IDs se récupèrent avec find_vfx_textures).
// Règle fixe (même si l'admin a modifié le texte du skill) : textures uniquement depuis Rovex.
function vfxTextures(state) {
  const tx = require('./vfx-textures');
  const list = tx.all(state);
  return {
    mandatory: 'MANDATORY: every ParticleEmitter / Beam / Trail texture must come from the Rovex VFX textures (find_vfx_textures). No other texture ID is allowed (not from memory, not Roblox defaults, never invented). State the chosen ID, name and group for each layer. If nothing fits after several searches, tell the user and suggest adding one in the VFX textures page; never swap in another texture silently.',
    total: list.length, groups: tx.groups(list).map((g) => `${g.label} (${g.kind}, ${g.count})`),
    how: 'Call find_vfx_textures with words like "toon fire", "slash", "smoke" to get the texture IDs and their flipbook settings.',
  };
}

const HOW_TO_USE = 'Follow the core rules (rovex-core) and the instructions of each skill. Reuse the structure of the validated examples first, cite the resources you rely on, and propose an open source module when one fits instead of rewriting it.';

function skillPart(state, cat, opts) {
  const s = getSkill(state, cat);
  if (!s.enabled) throw new Error(`Skill ${s.name} is disabled in Rovex Hub`);
  return {
    skill: s.name, category: cat, description: s.description,
    instructions: s.instructions,
    textures: cat === 'vfx' || cat === 'cutscenes' ? vfxTextures(state) : undefined,
    assets: cat === 'audio' ? undefined : { style: s.art, how: 'Need an image (icon, UI, thumbnail, texture, VFX sprite)? Call generate_image with this category: Rovex applies this style and the user\'s reference images, then saves the PNG in the library.' },
    ...context(state, cat, opts),
  };
}

// Un skill, avec le socle commun.
function load(state, cat, opts) {
  return { core: getSkill(state, CORE_ID).instructions, howToUse: HOW_TO_USE, ...skillPart(state, cat, opts) };
}

// Plusieurs skills pour une même tâche (ex. scripting + animation + vfx) : le socle n'est envoyé qu'une fois.
function loadMany(state, cats, opts) {
  const list = [...new Set(cats)].filter((c) => SKILL_CATS.includes(c));
  if (list.length === 1) return load(state, list[0], opts);
  return { core: getSkill(state, CORE_ID).instructions, howToUse: HOW_TO_USE, skills: list.map((c) => skillPart(state, c, opts)) };
}

// --- Export au format Claude Skills (dossier avec SKILL.md) ---
const LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

function skillMd(state, cat) {
  const s = getSkill(state, cat);
  const c = LABELS[cat];
  return `---
name: ${s.name}
description: ${s.description} Roblox ${c.label} (${c.desc}). Use for any Roblox ${c.label.toLowerCase()} task: loads the user's validated examples, docs, videos and open source references from Rovex Hub before working.
---

# Rovex Hub — ${c.label}

Before starting a Roblox ${c.label.toLowerCase()} task:

1. If the **rovex-hub** MCP server is connected, call \`load_skill\` with \`category: "${cat}"\` (add \`query\` with the task keywords). Read everything it returns: validated examples, resources with the user's notes, open source modules.
2. Otherwise, read \`examples.md\` in this skill folder (a snapshot of the validated examples).
3. Reuse the structure of the validated examples, cite the resources you used, and suggest an existing open source module when it fits.

## Instructions

${s.instructions}

## Socle Rovex (rovex-core, commun à tous les skills)

${getSkill(state, CORE_ID).instructions}
${cat === 'audio' ? '' : `
## Image generation

When the task needs an image, call \`generate_image\` (category \`${cat}\`). Rovex adds this style and the user's reference images:

${s.art}
`}`;
}

function examplesMd(state, cat) {
  const ex = (state.examples || []).filter((e) => e.category === cat && e.status === 'validated');
  if (!ex.length) return `# Validated examples — ${LABELS[cat].label}\n\nNo validated example yet. Add some in Rovex Hub → Learning examples.\n`;
  return `# Validated examples — ${LABELS[cat].label}\n\n` + ex.map((e) => `## ${e.title}\n\n**Request:** ${e.prompt}\n\n\`\`\`lua\n-- ${e.filename}\n${e.code}\n\`\`\`\n\n**Why it is right:**\n${e.why.map((w) => `- ${w}`).join('\n')}\n${e.sources ? `\n**Sources:** ${e.sources}\n` : ''}`).join('\n---\n\n');
}

// Petit écrivain ZIP (sans compression, sans dépendance) pour télécharger un skill.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(deflated.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, nameBuf, deflated);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(deflated.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

function skillZip(state, cat) {
  const name = getSkill(state, cat).name;
  return zip([[`${name}/SKILL.md`, skillMd(state, cat)], [`${name}/examples.md`, examplesMd(state, cat)]]);
}

// Claude Code lit les skills dans ~/.claude/skills/<nom>/SKILL.md.
const CODE_SKILLS = path.join(os.homedir(), '.claude', 'skills');
function installForClaudeCode(state) {
  const done = [];
  for (const cat of SKILL_CATS) {
    const s = getSkill(state, cat);
    const dir = path.join(CODE_SKILLS, s.name);
    if (!s.enabled) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd(state, cat));
    fs.writeFileSync(path.join(dir, 'examples.md'), examplesMd(state, cat));
    done.push(s.name);
  }
  return { installed: done, dir: CODE_SKILLS };
}

function codeInstalled() {
  return SKILL_CATS.filter((cat) => fs.existsSync(path.join(CODE_SKILLS, `rovex-${cat}`, 'SKILL.md'))).length;
}

module.exports = { totalsAll, SKILL_CATS, CORE_ID, VERSION: TEXTS.VERSION, versionOf: TEXTS.versionOf, DEFAULTS, ART, getSkill, context, load, loadMany, skillMd, skillZip, installForClaudeCode, codeInstalled, CODE_SKILLS };
