#!/usr/bin/env node
// Serveur MCP de Roblox Dev Hub : donne à n'importe quel client MCP l'accès à ta bibliothèque.
// Deux modes : stdio (`node mcp.js`) ou HTTP via l'app (http://localhost:4747/mcp, voir server.js).
const readline = require('readline');
const db = require('./db');
const web = require('./web');

const CAT_IDS = db.CATEGORIES.map((c) => c.id);

const TOOLS = [
  {
    name: 'search_resources',
    description: 'Search the Roblox Dev Hub library (videos, docs, open source repos, free models, tools, images, files) about Roblox development: scripting, VFX, animation, GUI, GFX, etc. Use it before answering a Roblox question to rely on the user\'s resources.',
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
    if (e.cause && e.cause.code === 'ECONNREFUSED') throw new Error('Open the Roblox Dev Hub app (desktop shortcut), then try again.');
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

async function call(name, a = {}) {
  const state = db.load();
  switch (name) {
    case 'search_resources': {
      const res = db.search(state, { q: a.query || '', category: a.category || '', type: a.type || '', favorite: Boolean(a.favorites_only), limit: a.limit || 15 });
      return { count: res.length, results: res.map(brief) };
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
      db.save(state);
      return { created, resource: brief(resource) };
    }
    case 'import_url': {
      const info = await web.importUrl(a.url);
      const { resource, created } = db.upsert(state, { ...info, ...(a.category && { category: a.category }), ...(a.tags && { tags: a.tags }), source: 'claude' });
      db.save(state);
      return { created, resource: brief(resource) };
    }
    case 'update_notes': {
      const r = state.resources.find((x) => x.id === a.id);
      if (!r) throw new Error('Resource not found');
      r.notes = String(a.notes);
      db.save(state);
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
      db.save(state);
      return report;
    }
    default:
      throw new Error('Unknown tool: ' + name);
  }
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
      return ok({
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'roblox-dev-hub', version: '1.0.0' },
        instructions: 'Personal library of Roblox development resources. Search it (search_resources) before answering a Roblox question, and cite the links you find.',
      });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: TOOLS });
    if (method === 'tools/call') {
      try {
        const out = await call(params.name, params.arguments);
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
      }
    }
    return fail(-32601, 'Unknown method: ' + method);
  } catch (e) {
    return fail(-32603, e.message);
  }
}

module.exports = { handle };

// Mode stdio : `node mcp.js` (le client MCP lance ce fichier lui-même).
if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin });
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
