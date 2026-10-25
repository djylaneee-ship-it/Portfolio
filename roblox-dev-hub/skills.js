// Skills Rovex : un skill Claude par catégorie. Quand Claude attaque une tâche (ex. un script),
// il charge le skill de la catégorie (consignes + tout ce que la base contient : exemples validés,
// docs, vidéos, open source, notes) avant d'écrire quoi que ce soit.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { CATEGORIES, search } = require('./db');

const SKILL_CATS = CATEGORIES.map((c) => c.id).filter((id) => id !== 'gameplay');

const DEFAULTS = {
  scripting: `You are writing Roblox Luau code.
- Server is the authority: validate every RemoteEvent/RemoteFunction argument on the server (type, range, cooldown, ownership). Never trust the client.
- Put reusable logic in ModuleScripts (ReplicatedStorage for shared, ServerScriptService/ServerStorage for server-only). Scripts stay thin.
- Use game:GetService(), typed Luau (--!strict where possible), task.spawn/task.delay/task.wait (never wait/spawn/delay).
- Wrap DataStore calls in pcall, prefer UpdateAsync, never overwrite data that failed to load, save on PlayerRemoving and BindToClose.
- Disconnect connections you create; clean up per-player state on PlayerRemoving.
- Prefer events over polling loops; when looping use RunService.Heartbeat with dt.
- Name things clearly, keep functions short, and explain where each script goes in the Explorer.`,
  vfx: `You are making Roblox visual effects.
- Build effects from Attachments + ParticleEmitter, Beam and Trail; use ParticleEmitter:Emit(n) for bursts, Enabled for streams.
- Keep effects in ReplicatedStorage templates and clone them; clean up with Debris:AddItem or by destroying after the effect.
- Play cosmetic effects on the clients (FireAllClients) so the server never lags; the server only decides that the effect happens.
- Tween Size/Transparency/CFrame with TweenService for motion; use LightEmission/LightInfluence for glow; keep particle counts reasonable for mobile.
- Describe the textures needed (flipbook, slash, spark) and the exact property values used.`,
  animation: `You are animating Roblox characters.
- Load animations through Animator:LoadAnimation (Humanoid:LoadAnimation is deprecated); rigs without Humanoid need AnimationController + Animator.
- Set AnimationPriority correctly (Idle < Movement < Action) and Looped where needed; stop tracks you no longer use.
- Play character animations from the client that owns the character so they replicate; use GetMarkerReachedSignal for hit frames and sounds.
- Respect R6 vs R15 joint names; mention when an animation must be uploaded and owned by the experience owner/group.
- For Moon Animator / Blender workflows, give clear export/import steps.`,
  gui: `You are building Roblox user interfaces.
- Use Scale (not Offset) for responsive layouts, plus UIAspectRatioConstraint, UIListLayout/UIGridLayout, UIPadding, UICorner, UIStroke, UIGradient.
- UI logic runs in LocalScripts under StarterGui or StarterPlayerScripts; purchases and rewards are validated on the server.
- Animate with TweenService (UIScale for pop-in, Position for slides); handle quick re-clicks without breaking state.
- Use GuiButton.Activated (works on mouse, touch and gamepad); test on phone screen sizes and respect the top bar safe area.
- Keep a clear hierarchy (ScreenGui > Frames > components) and explain the Explorer structure.`,
  gfx: `You are making Roblox GFX (thumbnails, icons, renders).
- Respect sizes: game icon 512x512, thumbnails 1920x1080 (16:9); keep text big and readable when scaled down.
- Explain the Blender workflow: import the character/map, lighting (three-point or HDRI), camera, Cycles/Eevee settings, compositing.
- Strong focal point, contrast and color story; the first second decides the click.
- Remind that images must follow Roblox moderation rules.`,
  modeling: `You are modeling 3D assets for Roblox.
- Keep triangle counts reasonable (MeshPart limit 20k tris, aim much lower for props), clean topology, applied transforms and correct scale (1 stud ≈ 0.28 m).
- UV unwrap cleanly; use SurfaceAppearance for PBR (ColorMap, NormalMap OpenGL, Roughness, Metalness).
- Export FBX/OBJ with the correct orientation; set CollisionFidelity and RenderFidelity appropriately in Studio.
- For low poly styles, use flat shading and palettes; group and name parts so they are easy to script.`,
  building: `You are building Roblox maps and environments.
- Plan the layout first (spawn, paths, landmarks, sight lines); keep scale consistent with characters.
- Use Terrain for natural areas, MeshParts/Parts for structures; anchor static parts, turn off CanCollide/CastShadow/CanTouch on decorative parts.
- Lighting: choose Technology (Future for quality), Atmosphere, ColorCorrection, Bloom; consistent mood.
- Optimize: StreamingEnabled for big maps, reuse meshes, limit dynamic lights and unions; group with Models and clear names.`,
  audio: `You are adding sound to a Roblox experience.
- Parent positional sounds to the part/attachment that emits them; UI and music sounds in SoundService or the client.
- Use SoundGroups for volume categories (music, SFX, UI) and let players change volumes.
- Play gameplay sounds on the clients when possible; preload important sounds with ContentProvider:PreloadAsync.
- Only use audio the experience is allowed to use.`,
  design: `You are designing a Roblox game.
- Define the core loop (what the player does every 30 seconds, every session, every week) before features.
- First-time user experience: fun within the first minute, clear goal, no wall of text.
- Retention: progression, daily rewards, social features, updates; measure with Analytics/funnels.
- Monetization must feel fair: game passes for permanent perks, developer products for consumables, no pay-to-win frustration.
- Give concrete numbers (prices, timings, drop rates) and explain the reasoning.`,
  tools: `You are helping with Roblox development tools and workflow.
- Recommend proven tools (Rojo + VS Code, Wally, StyLua, Selene, Moon Animator, Archimedes, etc.) and explain setup steps.
- For plugins, use the plugin API correctly (toolbar buttons, DockWidgetPluginGui, ChangeHistoryService for undo).
- Prefer version control (Git) and reproducible project structure.`,
};

// Style appliqué aux images et aux sons générés par IA pour cette catégorie (modifiable dans Skills).
const ART = {
  scripting: 'Clean Roblox-style illustration, bold shapes, saturated colors, soft studio lighting.',
  vfx: 'Stylized game VFX: glowing core, bright saturated colors fading to transparent edges, anime / simulator energy, high contrast.',
  animation: 'Expressive Roblox character pose, clear silhouette, dynamic motion, bright colors.',
  gui: 'Roblox simulator UI style: thick dark outline, bright saturated colors, soft glossy highlights and a light top gradient, slight 3D bevel, cartoony and readable at small size.',
  gfx: 'Polished Roblox GFX render: vibrant colors, cinematic rim lighting, soft depth of field, Blender-render look, characters with Roblox proportions.',
  modeling: 'Low poly stylized asset, clean flat shading with subtle gradients, Roblox-friendly proportions, bright palette.',
  building: 'Stylized Roblox environment art, bright and clean, soft global illumination, readable shapes, stud-like details where it fits.',
  audio: 'Clean, punchy game sound, no background noise, short tail, mixed for a Roblox game.',
  design: 'Clear game design diagram or mockup, simple flat shapes, readable labels.',
  tools: 'Clean flat app icon style, simple shapes, Roblox Studio color palette.',
};

function getSkill(state, cat) {
  const saved = ((state.skills || {})[cat]) || {};
  return {
    id: cat,
    name: `rovex-${cat}`,
    enabled: saved.enabled !== false,
    instructions: saved.instructions || DEFAULTS[cat] || '',
    custom: Boolean(saved.instructions || saved.art),
    art: saved.art || ART[cat] || '',
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

function load(state, cat, opts) {
  const s = getSkill(state, cat);
  if (!s.enabled) throw new Error(`Skill ${s.name} is disabled in Rovex Hub`);
  const c = context(state, cat, opts);
  return {
    skill: s.name, category: cat,
    instructions: s.instructions,
    howToUse: 'Follow the instructions. Reuse the structure of the validated examples first, cite the resources you rely on, and propose an open source module when one fits instead of rewriting it.',
    assets: { style: s.art, how: cat === 'audio' ? 'Need a sound? Call generate_sound: Rovex applies this style and saves the MP3 in the library.' : 'Need an image (icon, UI, thumbnail, texture, VFX sprite)? Call generate_image with this category: Rovex applies this style and the user\'s reference images, then saves the PNG in the library.' },
    ...c,
  };
}

// --- Export au format Claude Skills (dossier avec SKILL.md) ---
const LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

function skillMd(state, cat) {
  const s = getSkill(state, cat);
  const c = LABELS[cat];
  return `---
name: ${s.name}
description: Roblox ${c.label} (${c.desc}). Use for any Roblox ${c.label.toLowerCase()} task: loads the user's validated examples, docs, videos and open source references from Rovex Hub before working.
---

# Rovex Hub — ${c.label}

Before starting a Roblox ${c.label.toLowerCase()} task:

1. If the **rovex-hub** MCP server is connected, call \`load_skill\` with \`category: "${cat}"\` (add \`query\` with the task keywords). Read everything it returns: validated examples, resources with the user's notes, open source modules.
2. Otherwise, read \`examples.md\` in this skill folder (a snapshot of the validated examples).
3. Reuse the structure of the validated examples, cite the resources you used, and suggest an existing open source module when it fits.

## Instructions

${s.instructions}

## Asset generation

When the task needs an image or a sound, call \`${cat === 'audio' ? 'generate_sound' : 'generate_image'}\` (category \`${cat}\`). Rovex adds this style and the user's reference images:

${s.art}
`;
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

module.exports = { SKILL_CATS, DEFAULTS, ART, getSkill, context, load, skillMd, skillZip, installForClaudeCode, codeInstalled, CODE_SKILLS };
