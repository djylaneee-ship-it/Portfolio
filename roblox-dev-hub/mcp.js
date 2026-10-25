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
let store = { load: db.load, save: db.save };
const useStore = (s) => { store = s; };

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

Skills: for every Roblox task, first identify its category (scripting, vfx, animation, gui, gfx, modeling, building, audio, design, tools) and call load_skill with that category and the task keywords. Read all of it before working.

Assets: you cannot draw or make sounds yourself, but Rovex can. When the user asks for an icon, an image, a UI element, a thumbnail, a texture, a sound effect, music or a voice line, load the skill of the category, then call generate_image or generate_sound. Describe only the subject: Rovex applies the skill's style and the user's reference images, and saves the file in the library. Give the user the file path, and remind them to upload it to Roblox (Creator Hub or Asset Manager) to get its rbxassetid.`;

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
    description: 'START HERE for any Roblox task. Loads the Rovex skill of a category (scripting, vfx, animation, gui, gfx, modeling, building, audio, design, tools): instructions to follow, every validated example with full code, the best docs/videos (with the user\'s notes) and open source modules. Call it with the task category before writing anything.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: skills.SKILL_CATS },
        query: { type: 'string', description: 'Task keywords to focus the resources (optional)' },
      },
      required: ['category'],
    },
  },
  {
    name: 'list_skills',
    description: 'Lists the Rovex skills (one per Roblox category) with how much knowledge each contains.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_image',
    description: 'Generate images for a Roblox game (icons, UI elements, thumbnails/GFX, textures, VFX sprites, concept art) with the user\'s image AI. Rovex adds the art style of the category skill and the user\'s reference images from the library, saves the PNG in the library and returns its file path and a preview. Load the skill of the category first. Describe only the subject in prompt (e.g. "a golden crown with red gems"); Rovex adds the style.',
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
    name: 'generate_sound',
    description: 'Generate a sound for a Roblox game with the user\'s ElevenLabs key: a sound effect (sfx, e.g. "coin pickup", "sword slash"), background music (music) or an NPC voice line (voice, prompt = the text to say). Saves the MP3 in the library and returns its file path.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Sound description, music description, or the line to say for voice.' },
        kind: { type: 'string', enum: ['sfx', 'music', 'voice'], description: 'Default: sfx.' },
        seconds: { type: 'number', description: 'Length: 0.5–22 s for sfx, 10–300 s for music.' },
        voice_id: { type: 'string', description: 'ElevenLabs voice id (voice only).' },
        title: { type: 'string' },
      },
      required: ['prompt'],
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

async function call(name, a = {}) {
  const state = store.load();
  switch (name) {
    case 'search_resources': {
      const res = db.search(state, { q: a.query || '', category: a.category || '', type: a.type || '', favorite: Boolean(a.favorites_only), limit: a.limit || 15 });
      const examples = matchExamples(state, { query: a.query, category: a.category }).slice(0, 5).map(briefExample);
      return { count: res.length, examples, results: res.map(brief) };
    }
    case 'generate_image': {
      const out = await gen.generateImage(state, a);
      store.save(state);
      return out;
    }
    case 'generate_sound': {
      const out = await gen.generateSound(state, a);
      store.save(state);
      return out;
    }
    case 'load_skill':
      return skills.load(state, a.category, { query: a.query || '' });
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
  const off = ((store.load().settings || {}).mcpTools) || {};
  return TOOLS.filter((x) => off[x.name] !== false);
}

// Journal « Activité de Claude » : les 100 derniers appels d'outils.
function logCall(tool, a, out) {
  const st = store.load();
  st.mcpLog = st.mcpLog || [];
  st.mcpLog.unshift({
    t: new Date().toISOString(), tool,
    q: String(a.query || a.title || a.url || a.id || a.mode || '').slice(0, 80),
    category: a.category || (out && out.category) || '',
    count: out && typeof out.count === 'number' ? out.count : undefined,
  });
  st.mcpLog.length = Math.min(st.mcpLog.length, 100);
  // Compteurs cumulés pour le niveau de Claude.
  const ms = (st.mcpStats = st.mcpStats || { calls: 0, byTool: {}, byCat: {}, examples: 0 });
  const cat = a.category || (out && out.category) || '';
  ms.calls++;
  ms.byTool[tool] = (ms.byTool[tool] || 0) + 1;
  if (cat) ms.byCat[cat] = (ms.byCat[cat] || 0) + 1;
  if (tool === 'get_example') ms.examples++;
  if (out && Array.isArray(out.examples)) ms.examples += out.examples.length;
  ms.firstCall = ms.firstCall || new Date().toISOString();
  store.save(st);
}

// Traite un message JSON-RPC MCP. Renvoie la réponse, ou null pour une notification.
async function handle(msg) {
  const { id, method, params = {} } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid request');
  if (id === undefined) return null;
  try {
    if (method === 'initialize') {
      CLIENT = { name: String((params.clientInfo && params.clientInfo.name) || 'unknown').slice(0, 60), version: String((params.clientInfo && params.clientInfo.version) || '').slice(0, 30) };
      seen();
      return ok({
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'rovex-hub', version: '2.0.0' },
        instructions: ((store.load().settings || {}).mcpInstructions || DEFAULT_INSTRUCTIONS) + SKILL_RULE,
      });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: enabledTools() });
    // Chaque skill est aussi un « prompt » MCP, sélectionnable dans Claude Desktop.
    if (method === 'prompts/list') {
      const st = store.load();
      const tpl = templates(st);
      return ok({ prompts: skills.SKILL_CATS.map((c) => skills.getSkill(st, c)).filter((x) => x.enabled).map((x) => ({
        name: x.name, description: `Rovex skill: ${db.CATEGORIES.find((k) => k.id === x.id).label} — loads the category knowledge, then does your task`,
        arguments: [{ name: 'task', description: 'What you want Claude to do', required: false }],
      })).concat(tpl.list.map((p) => {
        const lang = tpl.lang;
        const slots = [...new Set([...p.text.matchAll(SLOT_RE)].map((m) => m[1]))];
        return {
          name: tplName(p), title: 'Rovex · ' + p.title, description: 'Rovex Hub prompt template: ' + p.title,
          arguments: slots.map((x) => ({ name: x, description: (TPL.PROMPT_SLOTS[x] && (TPL.PROMPT_SLOTS[x][lang] || TPL.PROMPT_SLOTS[x].en)) || x, required: false })),
        };
      })) });
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
    if (method === 'tools/call') {
      try {
        if (!enabledTools().some((x) => x.name === params.name)) throw new Error('Tool disabled in Rovex Hub: ' + params.name);
        const out = await call(params.name, params.arguments);
        // Images générées : aperçu envoyé à Claude (s'il n'est pas trop lourd), jamais gardé dans le journal.
        const images = (out && out.images) || [];
        if (out && out.images) delete out.images;
        logCall(params.name, params.arguments || {}, out);
        seen();
        const previews = images.filter((b) => b.length < 900 * 1024).map((b) => ({ type: 'image', data: b.toString('base64'), mimeType: 'image/png' }));
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

module.exports = { handle, call, useStore, clients, TOOLS, DEFAULT_INSTRUCTIONS };

// Mode stdio : `node mcp.js` (le client MCP lance ce fichier lui-même).
if (require.main === module) {
  MODE = 'stdio';
  setInterval(seen, 60e3);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('close', () => process.exit(0));
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
    }
    const out = await handle(msg);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
}
