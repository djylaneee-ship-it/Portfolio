#!/usr/bin/env node
// Serveur MCP (stdio) : donne à Claude l'accès à ta bibliothèque Roblox Dev Hub.
// Ajout dans Claude Code :  claude mcp add roblox-dev-hub -- node "<chemin>/mcp.js"
const readline = require('readline');
const db = require('./db');
const web = require('./web');

const CAT_IDS = db.CATEGORIES.map((c) => c.id);

const TOOLS = [
  {
    name: 'search_resources',
    description: 'Cherche dans la bibliothèque Roblox Dev Hub (vidéos, docs, outils, images, fichiers) sur le dev Roblox : scripting, VFX, animation, GUI, GFX, etc. À utiliser avant de répondre à une question Roblox pour s\'appuyer sur les ressources de l\'utilisateur.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Mots-clés (ex. "slash vfx", "datastore", "tween ui")' },
        category: { type: 'string', enum: CAT_IDS },
        type: { type: 'string', enum: db.TYPES },
        favorites_only: { type: 'boolean' },
        limit: { type: 'number', description: 'Nombre max de résultats (défaut 15)' },
      },
    },
  },
  {
    name: 'get_resource',
    description: 'Détail complet d\'une ressource (notes personnelles incluses) par son id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_categories',
    description: 'Liste les catégories et le nombre de ressources dans chacune.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_resource',
    description: 'Ajoute une ressource (lien, tuto, astuce) à la bibliothèque.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' }, url: { type: 'string' },
        category: { type: 'string', enum: CAT_IDS }, type: { type: 'string', enum: db.TYPES },
        tags: { type: 'array', items: { type: 'string' } }, description: { type: 'string' },
        notes: { type: 'string', description: 'Notes, extraits de code, résumé' },
        level: { type: 'string', enum: ['debutant', 'intermediaire', 'avance'] },
      },
      required: ['title', 'category'],
    },
  },
  {
    name: 'import_url',
    description: 'Importe une URL (vidéo YouTube, chaîne, page web, doc) : titre, auteur et miniature sont récupérés automatiquement.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' }, category: { type: 'string', enum: CAT_IDS }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['url'],
    },
  },
  {
    name: 'update_notes',
    description: 'Remplace les notes d\'une ressource (résumé de tuto, code clé, etc.).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, notes: { type: 'string' } }, required: ['id', 'notes'] },
  },
  {
    name: 'sync_channels',
    description: 'Récupère les dernières vidéos des chaînes YouTube suivies et les ajoute à la bibliothèque.',
    inputSchema: { type: 'object', properties: {} },
  },
];

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
      if (!r) throw new Error('Ressource introuvable');
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
      if (!r) throw new Error('Ressource introuvable');
      r.notes = String(a.notes);
      db.save(state);
      return { ok: true };
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
      throw new Error('Outil inconnu : ' + name);
  }
}

function reply(id, result, error) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = error; else msg.result = result;
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return reply(null, null, { code: -32700, message: 'Parse error' }); }
  const { id, method, params = {} } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'roblox-dev-hub', version: '1.0.0' },
        instructions: 'Bibliothèque personnelle de ressources de dev Roblox. Cherche ici (search_resources) avant de répondre à une question Roblox, et cite les liens trouvés.',
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      try {
        const out = await call(params.name, params.arguments);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: 'Erreur : ' + e.message }], isError: true });
      }
    }
    return reply(id, null, { code: -32601, message: 'Méthode inconnue : ' + method });
  } catch (e) {
    return reply(id, null, { code: -32603, message: e.message });
  }
});
