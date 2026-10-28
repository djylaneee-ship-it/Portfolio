#!/usr/bin/env node
// Serveur MCP de Rovex Hub : donne à Claude (ou tout client MCP) l'accès à ta bibliothèque.
// Deux modes : stdio (`node mcp.js`) ou HTTP via l'app (http://localhost:4747/mcp, voir server.js).
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const web = require('./web');
const skills = require('./skills');
const gen = require('./gen');
const studio = require('./studio');
const blender = require('./blender');
const rbxupload = require('./rbxupload');
const rbxassets = require('./rbxassets');
const folders = require('./folders');
const directives = require('./directives');
const meshy = require('./meshy');
const lessons = require('./lessons');
const textures = require('./vfx-textures');
const vm = require('vm');

// Les modèles de prompts de la page « Prompts » (public/prompts.js), aussi proposés dans le menu + de Claude.
const TPL = vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'public', 'prompts.js'), 'utf8') + ';({ PROMPT_TEMPLATES, PROMPT_SLOTS, fillPrompt })');
const SLOT_RE = /\[\[([^\]\n]{1,40})\]\]/g;
const tplName = (p) => 'template-' + p.id.replace(/[^\w-]/g, '');
function templates(st) {
  const lang = (st.settings && st.settings.lang) || 'en';
  const builtIn = TPL.PROMPT_TEMPLATES.map((p) => ({ id: p.id, cat: p.cat, title: p.title[lang] || p.title.en, text: p.text[lang] || p.text.en }));
  return { lang, list: [...(st.prompts || []), ...builtIn] };
}

const CAT_IDS = db.CATEGORIES.map((c) => c.id);

// Accès aux données : fichier en mode stdio, mémoire du serveur en mode HTTP (voir useStore).
// En mode stdio, la base est relue seulement si le fichier a changé (elle peut peser des centaines de Mo).
const DB_FILE = path.join(db.DATA_DIR, 'library.json');
let cached = { key: '', st: null };
const fileKey = () => {
  try {
    const s = fs.statSync(DB_FILE);
    let c = '';
    try { c = String(fs.statSync(db.CLOUD_FILE).mtimeMs); } catch {}
    return `${s.mtimeMs}:${s.size}:${c}`;
  } catch { return ''; }
};
let store = {
  load: () => {
    const k = fileKey();
    if (k && k === cached.key && cached.st) return cached.st;
    const st = db.load();
    cached = { key: fileKey(), st };
    return st;
  },
  save: (st) => { db.save(st); cached = { key: fileKey(), st }; },
};
const useStore = (s) => { store = s; };

// Réglages, skills, exemples et modèles de prompts seulement (library.json, petit) : sans charger la grande
// bibliothèque en ligne. En mode HTTP (serveur de l'app), tout est déjà en mémoire.
let ownCache = { key: '', st: null };
function light() {
  if (MODE !== 'stdio') return store.load();
  if (cached.st && cached.key === fileKey()) return cached.st;
  let key = '';
  try { const st = fs.statSync(DB_FILE); key = `${st.mtimeMs}:${st.size}`; } catch {}
  if (ownCache.st && ownCache.key === key) return ownCache.st;
  let st = { resources: [], examples: [], settings: {} };
  try { st = { resources: [], examples: [], settings: {}, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
  ownCache = { key, st };
  return st;
}

// Mode stdio avec l'app ouverte : les appels d'outils et de prompts passent par le serveur de l'app, qui a déjà
// la bibliothèque en mémoire (pas de 2e copie de plusieurs centaines de Mo, pas d'attente au démarrage).
// App fermée (connexion refusée) : on répond ici, comme avant.
async function viaApp(msg) {
  let port = 0;
  try { port = Number(JSON.parse(fs.readFileSync(path.join(db.DATA_DIR, 'agent.json'), 'utf8')).port) || 0; } catch {}
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg), signal: AbortSignal.timeout(30 * 60e3),
    });
    if (res.status === 202) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    const code = (e && e.cause && e.cause.code) || e.code;
    if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH'].includes(code)) return null;
    return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Error: the Rovex Hub app did not answer (' + (e.message || e) + ')' }], isError: true } };
  }
}

// Clients MCP vus récemment (Claude Desktop, Claude Code…), pour savoir s'ils sont vraiment branchés.
// Fichier à part pour ne pas réécrire toute la base à chaque battement.
const CLIENTS_FILE = path.join(db.DATA_DIR, 'clients.json');
let MODE = 'http';
let CLIENT = null;
function readClients() {
  try { return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8')); } catch { return {}; }
}
function seen() {
  if (!CLIENT) return;
  const all = readClients();
  const key = `${CLIENT.name}|${MODE}`;
  const now = new Date().toISOString();
  all[key] = { ...all[key], ...CLIENT, mode: MODE, lastSeen: now, firstSeen: (all[key] && all[key].firstSeen) || now };
  try { fs.mkdirSync(db.DATA_DIR, { recursive: true }); fs.writeFileSync(CLIENTS_FILE, JSON.stringify(all, null, 2)); } catch {}
}
// Un client stdio envoie un battement par minute tant qu'il tourne ; un client HTTP compte 15 min après son dernier appel.
function clients() {
  return Object.values(readClients()).map((c) => ({ ...c, alive: Date.now() - Date.parse(c.lastSeen) < (c.mode === 'stdio' ? 3 : 15) * 60e3 }));
}

// Toujours ajouté aux consignes : passer par le skill de la catégorie avant toute tâche Roblox.
const SKILL_RULE = `

Skills: for every Roblox task, first identify the domains it needs (scripting, vfx, animation, cutscenes, gui, gfx, modeling, building, audio, design, tools) and call load_skill once with only those categories and the task keywords (an attack = scripting + animation + vfx; a boss intro = cutscenes + animation + vfx, + audio if needed; a menu = gui + scripting). Read all of it before working: the core rules (rovex-core) apply to every task. Project art direction: VFX are built from custom-textured ParticleEmitters, never the Fire, Smoke or Sparkles classes. Their textures MUST come from the Rovex VFX textures (find_vfx_textures): no other texture ID is allowed, never from memory, never invented; if nothing fits after several searches, tell the user instead of using another texture. The ready-made VFX templates of ReplicatedStorage.RovexAssets.VFX (see rovex_assets) are also allowed, with their own textures.

Roblox Studio: when tools starting with studio_ are available, Rovex is connected to the place open in Roblox Studio. Before writing code for the user's game, use them to read the real scripts, the Explorer structure and the data, and follow the existing architecture. Only change the place (edit scripts, run code that modifies it, insert models) when the user asked for it, and say what you changed. To put an image in the game (icon, UI, decal), make or pick it (generate_image), then call upload_image_to_roblox with a target path: Rovex uploads it to Roblox and sets it in Studio.
Learned lessons: the user teaches you methods with videos and images (Rovex learning workshop). Before a 3D model, VFX, animation, UI or system, call find_lessons with what you are about to make (load_skill also lists them) and follow the closest validated recipe with lesson_get. When asked to study a lesson: lesson_frames until you have seen every frame, then lesson_save.
Meshy AI: when the meshy_* tools are available (the user saved their own Meshy key), you can start a complex or organic model (creature, character, detailed prop) from a Meshy base shape: meshy_text_to_3d or meshy_image_to_3d (shape only unless a texture is asked), it lands in Blender, then rework it there (proportions, low poly cleanup with rx.decimate / rx.remesh or meshy_remesh, flat colors with rx.paint, rig, animate). Meshy spends the user's credits: one generation per request, never batches the user did not ask for.
Build textures: for any surface texture on a build or map (ground, grass, sand, wood, planks, fence, cobblestone, rock walls…), call find_build_textures: it shows the user's build textures with their rbxassetid; use those, never invented IDs.
Rovex assets: every place connected to Rovex gets ReplicatedStorage.RovexAssets (Environment = stylized trees, plants, rocks, clouds, water; VFX/Combat and VFX/Fire = 130+ ready VFX templates; UI/StudUI = a stud-style HUD and windows). Call rovex_assets (with keywords) to see what is there and reuse these assets (Clone them) before building from scratch.

User directives: a message or prompt can contain "!reference: library/<folder>/" (the user's reference folder: call rovex_folder with that path first and follow those references), "!skill: <names>" (load exactly these skills with load_skill, no others) and "!software: <names>" (work only in these software, e.g. Roblox Studio = studio_* tools, Blender = blender_* tools) and "!texture: <ids or names>" (use exactly these Rovex textures, VFX or build; find their details with find_vfx_textures / find_build_textures). They are mandatory and override your own choices.

Images: you cannot draw yourself, but Rovex can. When the user asks for an icon, an image, a UI element, a thumbnail, a texture or a VFX sprite, load the skill of the category, then call generate_image. Describe only the subject: Rovex applies the skill's style and the user's reference images, and saves the PNG in the library. Give the user the file path, and remind them to upload it to Roblox (Creator Hub or Asset Manager) to get its rbxassetid.`;

// Consigne qui branche une conversation de Claude Desktop sur le Chat Claude de Rovex (écouter → travailler → répondre).
const CHAT_PROMPT = `Connect to the Claude chat of the Rovex Hub app and stay connected.
Loop: call chat_listen. When it returns messages, look at the reference images and video key frames the user attached (they show the result wanted), do what the user asks with the Rovex and Roblox Studio tools (load_skill first for Roblox work; chat_status with one short sentence for each long step), then answer with chat_reply in the user's language, short and clear. Then call chat_listen again. When it returns no message, call chat_listen again immediately, without writing anything.
The user reads only the Rovex chat, never this conversation: do not write text here, only call the tools. Stop only if the user writes "stop" in Rovex.`;

const DEFAULT_INSTRUCTIONS = `Before writing any Luau, search Rovex Hub.
1. Start with the validated examples for the category (list_examples / get_example).
2. Follow their structure: ModuleScripts, RemoteEvents validated on the server, never trust the client.
3. Cite the video or doc you used.
4. If no example fits, say so and offer to add one.`;

const TOOLS = [
  {
    name: 'search_resources',
    description: 'Search the Rovex Hub library (videos, docs, open source repos, free models, tools, images, files) about Roblox development: scripting, VFX, animation, GUI, GFX, etc. Use it before answering a Roblox question to rely on the user\'s resources.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords (e.g. "slash vfx", "datastore", "tween ui")' },
        category: { type: 'string', enum: CAT_IDS },
        type: { type: 'string', enum: db.TYPES },
        favorites_only: { type: 'boolean' },
        limit: { type: 'number', description: 'Max results (default 15)' },
      },
    },
  },
  {
    name: 'load_skill',
    description: 'START HERE for any Roblox task. Loads the Rovex core rules plus the skill of each category the task needs (scripting, vfx, animation, cutscenes, gui, gfx, modeling, building, audio, design, tools): instructions to follow, every validated example with full code, the best docs/videos (with the user\'s notes) and open source modules. Pass only the useful categories (e.g. ["scripting", "animation", "vfx"] for an attack) before writing anything.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: { type: 'array', items: { type: 'string', enum: skills.SKILL_CATS }, description: 'The domains the task needs (1 to 4)' },
        category: { type: 'string', enum: skills.SKILL_CATS, description: 'Single domain (same as categories with one item)' },
        query: { type: 'string', description: 'Task keywords to focus the resources (optional)' },
      },
    },
  },
  {
    name: 'list_skills',
    description: 'Lists the Rovex skills (one per Roblox category) with how much knowledge each contains.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_image',
    description: 'Generate images for a Roblox game (icons, UI elements, thumbnails/GFX, textures, VFX sprites, concept art) with Rovex\'s image AI. Rovex adds the art style of the category skill and the user\'s reference images from the library, saves the PNG in the library and returns its file path and a preview. Load the skill of the category first. Describe only the subject in prompt (e.g. "a golden crown with red gems"); Rovex adds the style.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw (subject, colors, details).' },
        kind: { type: 'string', enum: ['icon', 'ui', 'thumbnail', 'texture', 'vfx', 'art'], description: 'Default: icon.' },
        category: { type: 'string', enum: CAT_IDS.filter((c) => c !== 'gameplay'), description: 'Skill whose style to apply. Default depends on kind (icon/ui → gui, thumbnail → gfx…).' },
        count: { type: 'number', description: 'Number of variants, 1 to 4. Default 1.' },
        transparent: { type: 'boolean', description: 'Transparent background. Default: true for icon, ui and vfx.' },
        size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] },
        reference_ids: { type: 'array', items: { type: 'string' }, description: 'Library image ids to use as style references. Default: the user\'s images of the category.' },
        title: { type: 'string', description: 'Name to save it under in the library.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'dev_app_info',
    description: 'Developer mode: how Rovex Hub itself is built (architecture, files, how to run, test and release it, GitHub repository) and its current customization. Read it before changing the Rovex Hub app.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'dev_set_custom',
    description: 'Developer mode: change the look of the Rovex Hub app live. Any field is optional: theme (violet, ocean, sunset, emerald, crimson, gold, candy, midnight, mono), accent/accent2/accent3/bgColor (#hex, "" = theme color), bg { type: aurora|gradient|image|video|none, src: https URL of an image, GIF or MP4/WEBM, fit: cover|contain, dim 0-0.9, blur 0-30 }, glass (panel opacity 0.2-1), font (inter, poppins, nunito, grotesk, fredoka, mono, system), scale (0.85-1.25), radius (4-30), animations (bool), css (extra CSS for the whole app, replaces the previous one). The app updates within a few seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        theme: { type: 'string' }, accent: { type: 'string' }, accent2: { type: 'string' }, accent3: { type: 'string' }, bgColor: { type: 'string' },
        bg: { type: 'object' }, glass: { type: 'number' }, font: { type: 'string' }, scale: { type: 'number' }, radius: { type: 'number' },
        animations: { type: 'boolean' }, css: { type: 'string' },
      },
    },
  },
  {
    name: 'find_vfx_textures',
    description: 'Find Roblox texture IDs for VFX in the user\'s texture library (1000+ textures: particle flipbooks for fire, smoke, slash, burst, lightning, crack, water, ice, wind decals, glows, stars, gradients, fog…). Returns rbxassetid, name, group, kind (particle, flipbook, decal, texture), the flipbook grid (2x2, 4x4, 8x8) with the matching FlipbookLayout/FlipbookMode/framerate, and tips. MANDATORY for every ParticleEmitter, Beam or Trail texture: textures must come from here, no other texture ID is allowed and none may be invented. Call it with no query to list the groups.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match, e.g. "toon fire", "slash", "smoke realistic", "lightning", "ripple", "glow", "star".' },
        group: { type: 'string', description: 'Limit to one group (id or label from the groups list).' },
        flipbook: { type: 'string', enum: ['2x2', '4x4', '8x8'], description: 'Only flipbooks with this grid.' },
        kind: { type: 'string', enum: ['particle', 'flipbook', 'decal', 'texture'] },
        limit: { type: 'number', description: 'Max results (default 40, max 200).' },
      },
    },
  },
  {
    name: 'find_build_textures',
    description: 'Surface textures for builds and maps from the user\'s Rovex library (ground: sand, grass; wood: wood, planks, fence; stone: cobblestone, cobblestone wall, rock…). Returns each rbxassetid with its name and group, how to apply it on parts, and SHOWS the textures as images so you can pick the right one. Use these IDs for every build texture (Texture / Decal on parts, MaterialVariant ColorMap) instead of inventing or remembering IDs. No query = all of them.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match, e.g. "wood", "stone wall", "grass".' },
        images: { type: 'boolean', description: 'Show the texture images (default true).' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'upload_image_to_roblox',
    description: 'Upload an image to Roblox so it can be used in the game (returns rbxassetid://…), and optionally put it in the place open in Roblox Studio: sets ImageLabel/ImageButton.Image or Decal.Texture, or adds a Decal on a Part. Works with an image from generate_image (its library id or file path), any library image, or an http(s) URL. Uses the connected Roblox Studio, or the user\'s Roblox Open Cloud key.',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Library image id, file path returned by generate_image, or http(s) URL.' },
        target: { type: 'string', description: 'Optional: dot path in the place to put the image on, e.g. game.StarterGui.Shop.Frame.Icon or game.Workspace.Sign.' },
        face: { type: 'string', enum: ['Front', 'Back', 'Top', 'Bottom', 'Left', 'Right'], description: 'Face for a Decal added on a Part. Default Front.' },
      },
      required: ['image'],
    },
  },
  {
    name: 'chat_listen',
    description: 'Rovex chat (the user talks to you inside the Rovex Hub app): wait for the next messages the user writes in the Claude chat of Rovex. Returns them, with the reference images and video key frames the user attached (study them: they show what the user wants), or an empty list after the wait: then call chat_listen again right away. Use this loop only when the user asked you to connect to the Rovex chat.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'chat_attachment',
    description: 'Rovex chat: see one reference image (or one key frame of a reference video) the user attached in the Rovex chat, by its id from chat_listen. chat_listen already shows the first ones; use this for the ones it lists as not shown.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Attachment id from chat_listen (e.g. 3fa1c2d4e5b6a798.jpg)' } }, required: ['id'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'chat_reply',
    description: 'Rovex chat: send your answer to the user in the Claude chat of Rovex (Markdown, Luau in ```lua blocks). The user only reads the Rovex chat, not this conversation.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Your message' } }, required: ['text'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'chat_status',
    description: 'Rovex chat: show what you are doing right now (one short sentence) in the Rovex chat, during a long task.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meshy_text_to_3d',
    description: 'Meshy AI (the user\'s own Meshy account and credits): generate a 3D model from a text description, as a BASE SHAPE to rework in Blender. By default only the shape (no texture, cheaper and faster); texture=true adds a texture pass. Waits up to ~100 s, downloads the GLB, imports it into the open Blender scene and shows a thumbnail; if it is not ready yet, call meshy_task with the returned task_id. Then look at it with blender_view and clean it with rx (apply_transform, decimate or remesh, shade, paint). Each call spends Meshy credits: only generate what the user asked for.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to model, in English, concrete: shape, proportions, style (e.g. "low poly cartoon fox sitting, big tail, stylized").' },
        model_type: { type: 'string', enum: ['standard', 'lowpoly'], description: 'lowpoly = clean low-poly mesh (good for Roblox); standard = detailed.' },
        topology: { type: 'string', enum: ['quad', 'triangle'], description: 'Standard model only: remesh to quads or triangles.' },
        target_polycount: { type: 'number', description: 'Standard model only: wanted polygon count (100-300000).' },
        symmetry: { type: 'string', enum: ['auto', 'on', 'off'] },
        texture: { type: 'boolean', description: 'Also texture the model (second, longer Meshy task). Default false.' },
        texture_prompt: { type: 'string', description: 'Texture description when texture=true.' },
        import_to_blender: { type: 'boolean', description: 'Import the GLB into Blender when it is connected (default true).' },
      },
      required: ['prompt'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'meshy_image_to_3d',
    description: 'Meshy AI: make a 3D base shape from a reference image (a file path on this PC, e.g. from rovex_folder or a chat attachment, or an https link). Same flow as meshy_text_to_3d: GLB downloaded, imported into Blender, thumbnail shown; use meshy_task if it is not ready yet. Spends the user\'s Meshy credits.',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'PNG/JPG file path on this PC, or an https URL.' },
        name: { type: 'string', description: 'Short name for the model.' },
        model_type: { type: 'string', enum: ['standard', 'lowpoly'] },
        topology: { type: 'string', enum: ['quad', 'triangle'] },
        target_polycount: { type: 'number' },
        symmetry: { type: 'string', enum: ['auto', 'on', 'off'] },
        texture: { type: 'boolean', description: 'Texture it from the image (default false: shape only).' },
        import_to_blender: { type: 'boolean' },
      },
      required: ['image'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'meshy_remesh',
    description: 'Meshy AI: rebuild a model made earlier (its task_id) with a clean topology and a target polygon count (quad by default, origin at the bottom), then download it and import it into Blender. Useful to get a light Roblox-ready base. Spends Meshy credits.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        target_polycount: { type: 'number', description: 'Default 5000.' },
        topology: { type: 'string', enum: ['quad', 'triangle'] },
        height: { type: 'number', description: 'Optional height of the model in meters.' },
        import_to_blender: { type: 'boolean' },
      },
      required: ['task_id'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'meshy_task',
    description: 'Meshy AI: check a generation started earlier (task_id from another meshy_* tool). Waits up to ~100 s; when it is done, downloads the GLB, imports it into Blender and shows the thumbnail.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, import_to_blender: { type: 'boolean' } }, required: ['task_id'] },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  {
    name: 'meshy_balance',
    description: 'Meshy AI: the credits left on the user\'s Meshy account.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'find_lessons',
    description: 'Rovex learning workshop: the user\'s validated lessons, step-by-step recipes Claude wrote from speed-modeling timelapses, VFX, animation, UI or scripting videos (how a pro does it: order of steps, techniques, Blender rx / Luau code). Search them before a 3D model, VFX, animation, UI… and follow the closest recipe. Returns titles, summaries and step titles; open one with lesson_get.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What you are about to make, e.g. "low poly sword", "fire slash vfx", "idle animation".' }, category: { type: 'string', enum: skills.SKILL_CATS } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'lesson_get',
    description: 'Rovex learning workshop: one lesson in full (summary, every step with its explanation and code, tips) and, with frames=true, the key frames its steps point to, to see what each step looks like.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, frames: { type: 'boolean', description: 'Also show the key frames of the steps (default true).' } }, required: ['id'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'lessons_todo',
    description: 'Rovex learning workshop: lessons the user added (videos or images) that are waiting to be studied, with their number of key frames.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'lesson_frames',
    description: 'Rovex learning workshop: look at the key frames of a lesson (in order, with their time in the video), about 10 per call: call again with the returned "next" until you have seen them all. Then write the recipe with lesson_save.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, from: { type: 'number', description: 'First frame index (default 0).' } }, required: ['id'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'lesson_save',
    description: 'Rovex learning workshop: save the recipe you wrote for a lesson after studying all its frames. It is a reusable method, not a description of the video: an overall summary (what is made and the approach), then ordered steps (title, precise explanation of what to do and why: tools, modifiers, settings, proportions, timing; the frame numbers that show it; and when useful the code to do it: Blender rx toolkit for modeling, Luau for Roblox), tips (the pro tricks you noticed) and tags. The user then checks and validates it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        summary: { type: 'string' },
        steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, frames: { type: 'array', items: { type: 'number' } }, code: { type: 'string' } }, required: ['title', 'detail'] } },
        tips: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'summary', 'steps'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'rovex_folder',
    description: 'Open one of the user\'s Rovex folders of references (library folders the user made: imported images, videos as key frames, VFX textures, saved tutorials and resources). Use it when a prompt contains "!reference: library/<path>/" (call it FIRST with that path) or when the user mentions their references. Returns the items (with file paths on this PC, VFX texture IDs, resource links) and shows the images. No path: lists every folder.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Folder path, e.g. "library/Swords/Fire/" (case and accents ignored). Empty = list the folders.' } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'rovex_assets',
    description: 'List the Rovex asset packs imported into the open Roblox Studio place, in ReplicatedStorage.RovexAssets: Environment (stylized trees, plants, rocks, clouds, rays, water), VFX/Combat and VFX/Fire (ready VFX templates with their particle emitters, beams and trails), UI/StudUI (stud-style HUD, overlays and windows). Returns each item path (relative to RovexAssets), class and what it contains. Use it before building a model, effect or UI from scratch.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keywords, e.g. "fire", "Combat", "palm", "HUD".' },
        limit: { type: 'number', description: 'Max items (default 120).' },
      },
    },
  },
  {
    name: 'search_opensource',
    description: 'Search free & open source Roblox code: GitHub repos (sorted by stars), DevForum community resources, free Creator Store models and plugins. Use it when the user wants a ready-made system or module.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        source: { type: 'string', enum: ['github', 'devforum', 'creator-store'] },
        category: { type: 'string', enum: CAT_IDS },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_examples',
    description: 'List the learning examples (a request, the right code, and why it is right). Validated examples are references to follow before writing code.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, category: { type: 'string', enum: CAT_IDS }, include_drafts: { type: 'boolean' } },
    },
  },
  {
    name: 'get_example',
    description: 'Get one learning example with its full code, explanation and sources.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'get_resource',
    description: 'Full details of a resource (including personal notes) by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_categories',
    description: 'List categories and how many resources each contains.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_resource',
    description: 'Add a resource (link, tutorial, tip) to the library.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, url: { type: 'string' },
        category: { type: 'string', enum: CAT_IDS }, type: { type: 'string', enum: db.TYPES },
        tags: { type: 'array', items: { type: 'string' } }, description: { type: 'string' },
        notes: { type: 'string', description: 'Notes, code snippets, summary' },
        level: { type: 'string', enum: ['debutant', 'intermediaire', 'avance'] },
      },
      required: ['title', 'category'],
    },
  },
  {
    name: 'import_url',
    description: 'Import a URL (YouTube video, channel, web page, doc): title, author and thumbnail are fetched automatically.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' }, category: { type: 'string', enum: CAT_IDS }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['url'],
    },
  },
  {
    name: 'update_notes',
    description: 'Replace a resource\'s notes (tutorial summary, key code, etc.).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, notes: { type: 'string' } }, required: ['id', 'notes'] },
  },
  {
    name: 'explore_internet',
    description: 'Start the automatic internet exploration (YouTube, Roblox DevForum, Reddit, GitHub, Creator Store): videos, Roblox channels, open source and free systems. Requires the app to be open. Runs in the background: follow it with explore_status.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['explore', 'channels', 'opensource', 'sync'], description: 'explore = videos/tutorials/images, channels = find and link Roblox channels, opensource = GitHub repos, DevForum resources, free models and plugins, sync = new videos from linked channels' },
        intensity: { type: 'string', enum: ['rapide', 'normal', 'massif'] },
        categories: { type: 'array', items: { type: 'string', enum: CAT_IDS } },
      },
    },
  },
  {
    name: 'explore_status',
    description: 'Progress of the running exploration (or the last one).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_channels',
    description: 'List linked YouTube channels (optional name filter).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } } },
  },
  {
    name: 'sync_channels',
    description: 'Fetch the latest videos from linked YouTube channels and add them to the library.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// Appelle l'API de l'app (l'exploration tourne dans le serveur de l'app).
async function app(pathname, body) {
  const { Auth } = require('./auth');
  const headers = { Authorization: 'Bearer ' + new Auth({ getState: () => ({}), persist() {} }).masterKey() };
  try {
    const res = await fetch('http://localhost:4747' + pathname, body ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { headers });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Error');
    return j;
  } catch (e) {
    if (e.cause && e.cause.code === 'ECONNREFUSED') throw new Error('Open the Rovex Hub app (desktop shortcut), then try again.');
    throw e;
  }
}

function brief(r) {
  return {
    id: r.id, title: r.title, url: r.url || (r.file ? `http://localhost:4747/media/${r.file}` : ''),
    type: r.type, category: r.category, tags: r.tags, author: r.author || undefined,
    level: r.level || undefined, description: r.description ? r.description.slice(0, 200) : undefined,
    favorite: r.favorite || undefined,
  };
}

function matchExamples(state, { query = '', category = '', drafts = false } = {}) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return (state.examples || []).filter((e) => (drafts || e.status === 'validated')
    && (!category || e.category === category)
    && terms.every((t) => `${e.title} ${e.prompt} ${e.category} ${e.code}`.toLowerCase().includes(t)));
}
const briefExample = (e) => ({ id: e.id, title: e.title, category: e.category, status: e.status, request: e.prompt, file: e.filename });

// Pièces jointes du chat : décrites dans le texte (id, nom, instants des images clés d'une vidéo) et envoyées
// en images jusqu'à ~700 Ko ; Claude demande le reste avec chat_attachment.
function chatRefs(items) {
  const images = [];
  const more = [];
  let budget = 700 * 1024;
  const messages = items.map((i) => {
    const files = i.files || [];
    if (!files.length) return i.text;
    const lines = files.map((f, n) => {
      const ids = f.frames.map((fr) => {
        const id = path.basename(fr);
        let buf = null;
        try { buf = fs.readFileSync(path.join(db.MEDIA_DIR, fr)); } catch {}
        if (buf && buf.length <= budget) { images.push(buf); budget -= buf.length; } else if (buf) more.push(id);
        return id;
      });
      if (f.kind === 'video') {
        const at = (f.times || []).map((x) => x + ' s').join(', ');
        return `${n + 1}. video "${f.name}" (${f.duration || '?'} s), ${ids.length} key frames${at ? ' at ' + at : ''}: ${ids.join(', ')}`;
      }
      return `${n + 1}. image "${f.name}": ${ids[0]}`;
    });
    return `${i.text || '(no text: look at the attached references)'}\n\n[Reference files attached by the user]\n${lines.join('\n')}`;
  }).map((text) => {
    // Directives (!reference, !skill, !software) : déjà vérifiées et traduites en consignes pour Claude.
    const dir = directives.parse(text);
    const extra = dir.any ? directives.forClaude(dir, directives.resolve(dir, store.load())) : '';
    return extra ? `${text}\n\n${extra}` : text;
  });
  return { messages, images, more };
}

// Dossier de références pour Claude : la liste, et les images (aperçus des fichiers) jusqu'à ~700 Ko.
function folderView(p) {
  if (!String(p || '').trim()) {
    const all = folders.list();
    return { folders: all.map((f) => ({ path: f.path, items: f.count })), how: all.length ? 'Call rovex_folder with one of these paths.' : 'The user has no folder yet (Rovex > Library > My folders).' };
  }
  const d = folders.describe(p);
  if (!d) throw new Error(`Folder "${p}" not found. Folders: ${folders.list().map((f) => f.path).join(', ') || 'none'}`);
  const images = [];
  let budget = 700 * 1024;
  const take = (rel) => {
    let buf = null;
    try { buf = fs.readFileSync(path.join(db.MEDIA_DIR, rel)); } catch {}
    const known = buf && ((buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50));
    if (known && buf.length <= budget) { images.push(buf); budget -= buf.length; return true; }
    return false;
  };
  const items = d.items.map((i) => {
    const base = { folder: i.path, name: i.name, ...(i.note && { note: i.note }) };
    if (i.kind === 'texture') return { ...base, kind: 'vfx_texture', id: `rbxassetid://${i.ref}`, ...(i.flipbook && { flipbook: i.flipbook }) };
    if (i.kind === 'resource') return { ...base, kind: i.type || 'resource', category: i.category, url: i.url, description: i.description };
    const shown = (i.previews || []).filter(take).length || (i.media === 'image' && take(i.file) ? 1 : 0);
    return {
      ...base, kind: i.media, file: path.join(db.MEDIA_DIR, i.file), size: i.size,
      ...(i.media === 'video' && { duration: i.duration, keyFrames: (i.times || []).map((x) => x + ' s') }),
      shownBelow: shown,
    };
  });
  return {
    path: d.path, subfolders: d.subfolders, count: items.length, items,
    ...(images.length && { note: `The ${images.length} image(s) below are these references in order (video files appear as key frames): study them, they show what the user wants.` }),
    images,
  };
}

// Atelier d'apprentissage : images clés d'une leçon (≈10 par appel, ~900 Ko max) et leçon complète.
const readMedia = (rel) => { try { return fs.readFileSync(path.join(db.MEDIA_DIR, rel)); } catch { return null; } };
function lessonFrames(id, from) {
  const l = lessons.find(String(id || ''));
  const images = [];
  const shown = [];
  let budget = 900 * 1024;
  for (let i = Math.max(0, from); i < l.frames.length && images.length < 12; i++) {
    const buf = readMedia(l.frames[i].file);
    if (!buf) continue;
    if (buf.length > budget && images.length) break;
    images.push(buf);
    budget -= buf.length;
    shown.push({ frame: i, at: l.frames[i].t ? `${l.frames[i].t} s` : undefined });
  }
  const last = shown.length ? shown[shown.length - 1].frame : from - 1;
  return {
    lesson: { id: l.id, title: l.title, category: l.category, software: l.software, source: l.source, note: l.note || undefined, totalFrames: l.frames.length },
    shown, ...(last + 1 < l.frames.length ? { next: last + 1 } : { done: 'All frames seen: write the recipe with lesson_save.' }),
    note: `The ${images.length} image(s) below are frames ${shown.map((x) => x.frame).join(', ')} in order.`,
    images,
  };
}
function lessonView(id, withFrames) {
  const l = lessons.find(String(id || ''));
  if (!l.recipe) return { id: l.id, title: l.title, status: l.status, note: 'Not studied yet.' };
  const images = [];
  const used = [];
  let budget = 800 * 1024;
  if (withFrames) {
    const wanted = [...new Set(l.recipe.steps.map((st) => (st.frames || [])[0]).filter((n) => n !== undefined))];
    if (!wanted.length && l.frames.length) wanted.push(...l.frames.map((_, i) => i).filter((i) => i % Math.ceil(l.frames.length / 4) === 0));
    for (const n of wanted) {
      const buf = l.frames[n] && readMedia(l.frames[n].file);
      if (buf && buf.length <= budget) { images.push(buf); budget -= buf.length; used.push(n); }
    }
  }
  return { id: l.id, title: l.title, category: l.category, software: l.software, status: l.status, recipe: l.recipe,
    ...(used.length && { note: `The ${used.length} image(s) below are frames ${used.join(', ')} (the first frame of the steps).` }), images };
}

// Chat Claude de Rovex depuis Claude Desktop : on passe par le serveur local de l'app (clé de data/agent.json).
async function agentApi(pathname, { method = 'GET', body, timeout = 15e3 } = {}) {
  let link = null;
  try { link = JSON.parse(fs.readFileSync(path.join(db.DATA_DIR, 'agent.json'), 'utf8')); } catch {}
  if (!link || !link.port) throw new Error('Open the Rovex Hub app first: the chat lives in the app.');
  const res = await fetch(`http://127.0.0.1:${link.port}${pathname}`, {
    method, headers: { 'X-Rovex-Agent-Key': link.key, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Rovex HTTP ${res.status}`);
  return j;
}

async function call(name, a = {}) {
  const state = store.load();
  switch (name) {
    case 'search_resources': {
      const res = db.search(state, { q: a.query || '', category: a.category || '', type: a.type || '', favorite: Boolean(a.favorites_only), limit: a.limit || 15 });
      const examples = matchExamples(state, { query: a.query, category: a.category }).slice(0, 5).map(briefExample);
      return { count: res.length, examples, results: res.map(brief) };
    }
    case 'dev_app_info': {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
      let guide = '';
      try { guide = fs.readFileSync(path.join(__dirname, 'CLAUDE.md'), 'utf8'); } catch {}
      return {
        app: 'Rovex Hub', version: pkg.version, repository: 'https://github.com/djylaneee-ship-it/Portfolio (folder roblox-dev-hub)',
        liveChanges: 'Look and feel: dev_set_custom (theme, colors, animated background, font, CSS). Everything else (pages, features, MCP tools) is source code: clone the repository, follow the guide, open a pull request; merging a version bump publishes the update to every user.',
        customization: (state.settings || {}).custom || null,
        guide,
      };
    }
    case 'dev_set_custom': {
      state.settings = state.settings || {};
      const cur = state.settings.custom || {};
      const next = { ...cur };
      for (const k of ['theme', 'accent', 'accent2', 'accent3', 'bgColor', 'glass', 'font', 'scale', 'radius', 'animations', 'css']) if (a[k] !== undefined) next[k] = a[k];
      if (a.bg && typeof a.bg === 'object') next.bg = { ...(cur.bg || {}), ...a.bg };
      if (typeof next.css === 'string') next.css = next.css.slice(0, 100000);
      state.settings.custom = next;
      store.save(state);
      return { ok: true, custom: next, note: 'Applied: the open Rovex Hub window updates within a few seconds.' };
    }
    case 'find_build_textures': {
      const list = textures.all(state).filter((t) => t.kind === 'build');
      const found = a.query ? textures.search(list, { query: a.query, limit: 60 }) : textures.search(list, { limit: 200 });
      const out = {
        count: found.length,
        textures: found.map(({ id, rbxassetid, name, variant, group }) => ({ id, rbxassetid, name: [name, variant].filter(Boolean).join(' '), group: group.replace(/^Build · /, '') })),
        howToUse: 'On a Part: add a Texture instance per visible face (Texture.Texture = rbxassetid, Face = Top/Front..., StudsPerTileU/V around 4-8 so it tiles at the right scale, Color3 to tint). For a whole material: a MaterialVariant in MaterialService with ColorMap = rbxassetid and StudsPerTile, then Part.MaterialVariant. Decal stretches the image once on a face (signs, single pictures), not for tiling.',
      };
      if (!found.length) out.note = 'No build texture matches: call again without a query to see all of them.';
      if (a.images === false || !found.length) return out;
      // Images des textures, pour que Claude les voie (miniatures Roblox 250 px, ~1,2 Mo max).
      const urls = await textures.thumbs(found.map((t) => t.id), '250x250').catch(() => ({}));
      const images = [];
      let budget = 1200 * 1024;
      for (const t of out.textures) {
        if (!urls[t.id]) { t.image = 'not available'; continue; }
        try {
          const r = await fetch(urls[t.id], { signal: AbortSignal.timeout(10000) });
          const buf = Buffer.from(await r.arrayBuffer());
          if (r.ok && buf.length <= budget) { images.push(buf); budget -= buf.length; t.image = `#${images.length}`; } else t.image = 'not shown (size)';
        } catch { t.image = 'not available'; }
      }
      if (images.length) out.images_note = `The ${images.length} image(s) below are these textures, in the order of their "image" number.`;
      out.images = images;
      return out;
    }
    case 'find_vfx_textures': {
      const list = textures.all(state).filter((t) => t.kind !== 'build' || a.kind === 'build');
      const groups = textures.groups(list).map((g) => ({ id: g.id, label: g.label, kind: g.kind, count: g.count }));
      if (!a.query && !a.group && !a.flipbook && !a.kind) return { total: list.length, groups, how: 'Call again with a query (e.g. "toon fire") or a group id to get texture IDs.' };
      const results = textures.search(list, a);
      return { count: results.length, results, note: 'Flipbook textures need ParticleEmitter.FlipbookLayout set to their grid; for a one-shot burst use FlipbookMode OneShot and a framerate of frames / Lifetime. Ask the user to check the look in Studio.' };
    }
    case 'rovex_assets':
      return rbxassets.list(a.query, a.limit);
    case 'rovex_folder':
      return folderView(a.path);
    case 'find_lessons':
      return { lessons: lessons.search({ query: a.query || '', category: a.category || '', limit: 10 }), how: 'Open the closest one with lesson_get and follow its steps.' };
    case 'lesson_get':
      return lessonView(a.id, a.frames !== false);
    case 'lessons_todo': {
      const todo = lessons.list().filter((l) => l.status === 'pending' && l.frames);
      return { lessons: todo.map((l) => ({ id: l.id, title: l.title, category: l.category, software: l.software, frames: l.frames })), how: todo.length ? 'Study one with lesson_frames, then lesson_save.' : 'Nothing waiting.' };
    }
    case 'lesson_frames':
      return lessonFrames(a.id, Number(a.from) || 0);
    case 'lesson_save':
      lessons.update(String(a.id || ''), { recipe: { summary: a.summary, steps: a.steps, tips: a.tips, tags: a.tags } });
      return { saved: true, note: 'Saved as a draft: the user checks and validates it in Rovex (Learning page).' };
    case 'meshy_text_to_3d': return meshy.textTo3d(a);
    case 'meshy_image_to_3d': return meshy.imageTo3d(a);
    case 'meshy_remesh': return meshy.remesh(a);
    case 'meshy_task': return meshy.task(a);
    case 'meshy_balance': return meshy.balance();
    case 'upload_image_to_roblox':
      return rbxupload.upload(state, a);
    case 'chat_listen': {
      const r = await agentApi('/agent/inbox?wait=40', { timeout: 55e3 });
      const items = r.items || [];
      // Réponse courte quand rien n'arrive : la conversation de Claude grossit le moins possible.
      if (!items.length) return { messages: [], next: 'call chat_listen again' };
      const { messages, images, more } = chatRefs(items);
      return {
        messages,
        ...(images.length && { attachments: `The ${images.length} image(s) below are the user's references, in the order listed in the messages: study them before working.` }),
        ...(more.length && { moreAttachments: `Not shown to keep this answer small: ${more.join(', ')}. Call chat_attachment with each id to see them.` }),
        next: 'Do the work (chat_status for long steps), answer with chat_reply, then call chat_listen again.',
        images,
      };
    }
    case 'chat_attachment': {
      const file = path.join(db.MEDIA_DIR, 'chat', path.basename(String(a.id || '')));
      if (!a.id || !fs.existsSync(file)) throw new Error('Attachment not found');
      return { id: a.id, images: [fs.readFileSync(file)] };
    }
    case 'chat_reply':
      await agentApi('/agent/reply', { method: 'POST', body: { text: String(a.text || '') } });
      return { sent: true, next: 'call chat_listen again' };
    case 'chat_status':
      await agentApi('/agent/status', { method: 'POST', body: { text: String(a.text || '') } });
      return { shown: true };
    case 'generate_image': {
      const out = await gen.generateImage(state, a);
      store.save(state);
      return out;
    }
    case 'load_skill': {
      const cats = [...(Array.isArray(a.categories) ? a.categories : []), ...(a.category ? [a.category] : [])].filter((c) => skills.SKILL_CATS.includes(c)).slice(0, 4);
      if (!cats.length) throw new Error('Give one or more categories: ' + skills.SKILL_CATS.join(', '));
      const out = skills.loadMany(state, cats, { query: a.query || '' });
      const learned = lessons.search({ query: a.query || '', category: cats, limit: 6 });
      if (learned.length) out.lessons = { note: 'Recipes learned from the user\'s videos for these domains: open the closest with lesson_get and follow its steps.', items: learned };
      return out;
    }
    case 'list_skills':
      return skills.SKILL_CATS.map((c) => {
        const sk = skills.getSkill(state, c);
        const ctx = skills.context(state, c);
        return { name: sk.name, category: c, enabled: sk.enabled, ...ctx.totals };
      });
    case 'search_opensource': {
      const res = db.search(state, { q: a.query || '', category: a.category || '', types: ['opensource', 'asset'], tag: a.source || '', sort: 'stars', limit: a.limit || 15 });
      return { count: res.length, results: res.map((r) => ({ ...brief(r), stars: r.stars || undefined })) };
    }
    case 'list_examples': {
      const list = matchExamples(state, { query: a.query, category: a.category, drafts: a.include_drafts });
      return { count: list.length, examples: list.map(briefExample) };
    }
    case 'get_example': {
      const e = (state.examples || []).find((x) => x.id === a.id);
      if (!e) throw new Error('Example not found');
      return e;
    }
    case 'get_resource': {
      const r = state.resources.find((x) => x.id === a.id);
      if (!r) throw new Error('Resource not found');
      return r;
    }
    case 'list_categories': {
      const s = db.stats(state);
      return db.CATEGORIES.map((c) => ({ id: c.id, label: c.label, description: c.desc, count: s.byCategory[c.id] }));
    }
    case 'add_resource': {
      const { resource, created } = db.upsert(state, { ...a, source: 'claude' });
      store.save(state);
      return { created, resource: brief(resource) };
    }
    case 'import_url': {
      const info = await web.importUrl(a.url);
      const { resource, created } = db.upsert(state, { ...info, ...(a.category && { category: a.category }), ...(a.tags && { tags: a.tags }), source: 'claude' });
      store.save(state);
      return { created, resource: brief(resource) };
    }
    case 'update_notes': {
      const r = state.resources.find((x) => x.id === a.id);
      if (!r) throw new Error('Resource not found');
      r.notes = String(a.notes);
      store.save(state);
      return { ok: true };
    }
    case 'explore_internet':
      return app('/api/crawl', { mode: a.mode || 'explore', intensity: a.intensity || 'normal', categories: a.categories, syncAfter: true });
    case 'explore_status': {
      const st = await app('/api/crawl');
      return { ...st, log: (st.log || []).slice(0, 15) };
    }
    case 'list_channels': {
      const q = String(a.query || '').toLowerCase();
      const list = state.channels.filter((c) => !q || `${c.name} ${c.handle}`.toLowerCase().includes(q));
      return { total: list.length, channels: list.slice(0, a.limit || 50).map((c) => ({ name: c.name, url: `https://www.youtube.com/channel/${c.channelId}`, category: c.category, subscribers: c.subscribers || undefined })) };
    }
    case 'sync_channels': {
      const report = [];
      for (const ch of state.channels) {
        try {
          if (!ch.channelId) Object.assign(ch, await web.resolveChannel(ch.handle));
          let added = 0;
          for (const v of await web.channelVideos(ch.channelId)) {
            if (state.resources.some((r) => r.url === v.url)) continue;
            db.upsert(state, { ...v, type: 'video', source: 'veille', category: ch.category || web.guessCategory(v.title), tags: [ch.name || ch.handle] });
            added++;
          }
          ch.lastFetch = new Date().toISOString();
          report.push({ channel: ch.name || ch.handle, added });
        } catch (e) {
          report.push({ channel: ch.name || ch.handle, error: e.message });
        }
      }
      store.save(state);
      return report;
    }
    default:
      throw new Error('Unknown tool: ' + name);
  }
}

// Outils activés dans la page « Connexion Claude » (tous par défaut).
function enabledTools() {
  const settings = light().settings || {};
  const off = settings.mcpTools || {};
  // Les outils dev_* n'existent qu'en mode développeur, les meshy_* quand une clé Meshy est enregistrée.
  const hasMeshy = meshy.enabled();
  return TOOLS.filter((x) => off[x.name] !== false && (!x.name.startsWith('dev_') || settings.devMode) && (!x.name.startsWith('meshy_') || hasMeshy));
}

// Journal « Activité de Claude » (les 100 derniers appels) et compteurs du niveau : dans un petit fichier à
// part, pour ne pas réécrire toute la bibliothèque à chaque appel d'outil.
const ACTIVITY_FILE = path.join(db.DATA_DIR, 'activity.json');
function activity() {
  try { return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8')); } catch {}
  // Première fois : reprise de l'ancien journal gardé dans la bibliothèque.
  const st = store.load();
  return { log: st.mcpLog || [], stats: st.mcpStats || { calls: 0, byTool: {}, byCat: {}, examples: 0 } };
}
function logCall(tool, a, out) {
  const act = activity();
  const st = { mcpLog: act.log, mcpStats: act.stats };
  st.mcpLog.unshift({
    t: new Date().toISOString(), tool,
    q: String(a.query || a.title || a.url || a.id || a.mode || '').slice(0, 80),
    category: a.category || (Array.isArray(a.categories) ? a.categories.join(' + ') : '') || (out && out.category) || '',
    count: out && typeof out.count === 'number' ? out.count : undefined,
  });
  st.mcpLog.length = Math.min(st.mcpLog.length, 100);
  // Compteurs cumulés pour le niveau de Claude.
  const ms = (st.mcpStats = st.mcpStats || { calls: 0, byTool: {}, byCat: {}, examples: 0 });
  const cats = [...new Set([a.category, ...(Array.isArray(a.categories) ? a.categories : []), out && out.category].filter((c) => typeof c === 'string' && c))];
  ms.calls++;
  ms.byTool[tool] = (ms.byTool[tool] || 0) + 1;
  for (const cat of cats) ms.byCat[cat] = (ms.byCat[cat] || 0) + 1;
  if (tool === 'get_example') ms.examples++;
  if (out && Array.isArray(out.examples)) ms.examples += out.examples.length;
  if (out && Array.isArray(out.skills)) for (const sk of out.skills) ms.examples += (sk.examples || []).length;
  ms.firstCall = ms.firstCall || new Date().toISOString();
  try {
    fs.mkdirSync(db.DATA_DIR, { recursive: true });
    fs.writeFileSync(ACTIVITY_FILE + '.tmp', JSON.stringify({ log: st.mcpLog, stats: ms }));
    fs.renameSync(ACTIVITY_FILE + '.tmp', ACTIVITY_FILE);
  } catch {}
}

// Traite un message JSON-RPC MCP. Renvoie la réponse, ou null pour une notification.
async function handle(msg) {
  const { id, method, params = {} } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid request');
  if (id === undefined) return null;
  try {
    if (MODE === 'stdio' && (method === 'tools/call' || method === 'prompts/get' || method === 'prompts/list')
      && !(method === 'tools/call' && (blender.owns(params.name) || studio.bridge.owns(params.name)))) {
      const out = await viaApp(msg);
      if (out) { seen(); return out; }
    }
    if (method === 'initialize') {
      CLIENT = { name: String((params.clientInfo && params.clientInfo.name) || 'unknown').slice(0, 60), version: String((params.clientInfo && params.clientInfo.version) || '').slice(0, 30) };
      seen();
      return ok({
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: true }, prompts: {} },
        serverInfo: { name: 'rovex-hub', version: '2.0.0' },
        instructions: ((light().settings || {}).mcpInstructions || DEFAULT_INSTRUCTIONS) + SKILL_RULE + (blender.enabled() ? blender.INSTRUCTIONS : ''),
      });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') {
      // Outils de Roblox Studio (si le pont est configuré) : on laisse quelques secondes à Studio pour répondre.
      if (studio.bridge.state === 'starting') await studio.bridge.waitReady(4000);
      return ok({ tools: [...enabledTools(), ...studio.bridge.exposedTools().map(({ _studio, ...t }) => t), ...blender.tools()] });
    }
    // Chaque skill est aussi un « prompt » MCP, sélectionnable dans Claude Desktop.
    if (method === 'prompts/list') {
      const st = store.load();
      const tpl = templates(st);
      return ok({ prompts: [{ name: 'rovex-chat', title: 'Rovex · Chat Claude', description: 'Connect this conversation to the Claude chat of the Rovex Hub app: you then talk to Claude from Rovex.', arguments: [] }].concat(skills.SKILL_CATS.map((c) => skills.getSkill(st, c)).filter((x) => x.enabled).map((x) => ({
        name: x.name, description: `Rovex skill: ${db.CATEGORIES.find((k) => k.id === x.id).label} — loads the category knowledge, then does your task`,
        arguments: [{ name: 'task', description: 'What you want Claude to do', required: false }],
      })).concat(tpl.list.map((p) => {
        const lang = tpl.lang;
        const slots = [...new Set([...p.text.matchAll(SLOT_RE)].map((m) => m[1]))];
        return {
          name: tplName(p), title: 'Rovex · ' + p.title, description: 'Rovex Hub prompt template: ' + p.title,
          arguments: slots.map((x) => ({ name: x, description: (TPL.PROMPT_SLOTS[x] && (TPL.PROMPT_SLOTS[x][lang] || TPL.PROMPT_SLOTS[x].en)) || x, required: false })),
        };
      }))) });
    }
    if (method === 'prompts/get' && params.name === 'rovex-chat') {
      return ok({ description: 'Rovex chat', messages: [{ role: 'user', content: { type: 'text', text: CHAT_PROMPT } }] });
    }
    if (method === 'prompts/get' && String(params.name || '').startsWith('template-')) {
      const { lang, list } = templates(store.load());
      const p = list.find((x) => tplName(x) === params.name);
      if (!p) return fail(-32602, 'Unknown prompt: ' + params.name);
      const text = TPL.fillPrompt(p.text, params.arguments || {}, { lang, cat: p.cat });
      return ok({ description: p.title, messages: [{ role: 'user', content: { type: 'text', text } }] });
    }
    if (method === 'prompts/get') {
      const cat = String(params.name || '').replace(/^rovex-/, '');
      if (!skills.SKILL_CATS.includes(cat)) return fail(-32602, 'Unknown prompt: ' + params.name);
      const task = (params.arguments && params.arguments.task) || '';
      const data = skills.load(store.load(), cat, { query: task });
      logCall('load_skill', { category: cat, query: task }, { category: cat, examples: data.examples, count: data.totals.resources });
      return ok({
        description: `Rovex skill ${cat}`,
        messages: [{ role: 'user', content: { type: 'text', text: `Use this Rovex Hub skill (Roblox ${cat}). Follow the instructions, reuse the validated examples and cite the resources.\n\n${JSON.stringify(data, null, 2)}${task ? `\n\nTask: ${task}` : ''}` } }],
      });
    }
    // Outils Blender (add-on Claude Blender MCP) : relayés à Blender sur ce PC.
    if (method === 'tools/call' && blender.owns(params.name)) {
      try {
        const out = await blender.call(params.name, params.arguments || {});
        logCall(params.name, params.arguments || {}, { category: params.name.startsWith('r6_') ? 'animation' : 'modeling' });
        seen();
        return ok(out);
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }
    if (method === 'tools/call' && studio.bridge.owns(params.name)) {
      try {
        const out = await studio.bridge.call(params.name, params.arguments);
        logCall(params.name, params.arguments || {}, { category: '' });
        seen();
        return ok(out && Array.isArray(out.content) ? out : { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }
    if (method === 'tools/call') {
      try {
        if (!enabledTools().some((x) => x.name === params.name)) throw new Error('Tool disabled in Rovex Hub: ' + params.name);
        const out = await call(params.name, params.arguments);
        // Images générées : aperçu envoyé à Claude (s'il n'est pas trop lourd), jamais gardé dans le journal.
        const images = (out && out.images) || [];
        if (out && out.images) delete out.images;
        if (!params.name.startsWith('chat_')) logCall(params.name, params.arguments || {}, out);
        seen();
        const previews = images.filter((b) => b.length < 900 * 1024).map((b) => ({ type: 'image', data: b.toString('base64'), mimeType: b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'image/png' }));
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }, ...previews] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }
    return fail(-32601, 'Unknown method: ' + method);
  } catch (e) {
    return fail(-32603, e.message);
  }
}

module.exports = { handle, call, useStore, clients, activity, TOOLS, DEFAULT_INSTRUCTIONS, CHAT_PROMPT };

// Mode stdio : `node mcp.js` (le client MCP lance ce fichier lui-même).
if (require.main === module) {
  MODE = 'stdio';
  setInterval(seen, 60e3);
  // Pont Roblox Studio : lancé avec Claude ; Claude est prévenu quand ses outils apparaissent ou changent.
  let lastTools = '';
  studio.bridge.onChange(() => {
    const names = studio.bridge.exposedTools().map((t) => t.name).join(',');
    if (names === lastTools) return;
    lastTools = names;
    if (CLIENT) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n');
  });
  try { studio.sync(); } catch {}
  // Blender activé ou désactivé dans l'app : la liste des outils change.
  let blenderOn = blender.enabled();
  let meshyOn = meshy.enabled();
  setInterval(() => {
    const on = blender.enabled();
    const m = meshy.enabled();
    if ((on !== blenderOn || m !== meshyOn) && CLIENT) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n');
    blenderOn = on;
    meshyOn = m;
  }, 5000).unref();
  // Réglage modifié dans l'app : on suit sans redémarrer Claude.
  setInterval(() => { try { studio.sync(); } catch {} }, 15e3).unref();
  process.on('exit', () => studio.bridge.kill());
  const rl = readline.createInterface({ input: process.stdin });
  // À la fermeture, on termine les requêtes en cours et on vide la sortie avant de quitter.
  let pending = 0;
  let closed = false;
  const maybeExit = () => { if (closed && !pending) process.stdout.write('', () => process.exit(0)); };
  rl.on('close', () => { closed = true; maybeExit(); });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
    }
    pending++;
    try {
      const out = await handle(msg);
      if (out) process.stdout.write(JSON.stringify(out) + '\n');
    } finally {
      pending--;
      maybeExit();
    }
  });
}
