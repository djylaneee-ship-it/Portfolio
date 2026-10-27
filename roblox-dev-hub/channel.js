// « Channel » Claude Code de Rovex Hub : Claude Code (avec l'abonnement Claude de l'utilisateur) lance ce petit
// serveur MCP en stdio. Il relaie les messages du Chat Claude de Rovex vers la session (notifications
// claude/channel), renvoie les réponses de Claude dans l'app (outil reply) et transmet les demandes
// d'autorisation pour qu'on les accepte depuis Rovex. Aucune dépendance : JSON-RPC à la main, comme mcp.js.
// Lancement : claude --dangerously-load-development-channels server:rovex-chat (Rovex le fait pour toi).
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(process.env.ROVEX_DATA || __dirname, 'data');
const AGENT_FILE = path.join(DATA_DIR, 'agent.json');
const NAME = String(process.env.ROVEX_AGENT_NAME || 'Claude').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 30) || 'Claude';
const ID = NAME.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') || 'claude'; // même nom = même conversation dans Rovex

const INSTRUCTIONS = `You are connected to the Rovex Hub app (a Roblox development hub) as "${NAME}".
The user talks to you from the Claude chat inside Rovex. Their messages arrive as <channel source="rovex-chat" chat_id="..." sender="...">.
They cannot see this terminal: ALWAYS answer with the reply tool (pass the chat_id from the tag), in the user's language, short and clear (many users are beginners). Use Markdown and put Luau code in \`\`\`lua blocks.
For long tasks, call the status tool with one short sentence each time you start a new step (e.g. "Je charge les skills VFX", "J'écris le script du dash dans Studio"), then reply when done.
For Roblox work, use the rovex-hub tools: load_skill first, the validated examples, find_vfx_textures for every VFX texture, generate_image for icons, and the studio_* tools to read and edit the user's open Roblox Studio place. Say what you changed.`;

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

// Adresse et clé du serveur local de Rovex (écrites par l'app au démarrage).
function link() {
  try {
    const a = JSON.parse(fs.readFileSync(AGENT_FILE, 'utf8'));
    return a.port && a.key ? a : null;
  } catch { return null; }
}
async function app(pathname, { method = 'GET', body, timeout = 15e3 } = {}) {
  const a = link();
  if (!a) throw new Error('Rovex Hub is not running');
  const res = await fetch(`http://127.0.0.1:${a.port}${pathname}`, {
    method,
    headers: { 'X-Rovex-Agent-Key': a.key, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

const TOOLS = [
  {
    name: 'reply',
    description: 'Send your answer to the user in the Rovex Hub chat. The user only sees what you send with this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'The chat_id from the <channel> tag' },
        text: { type: 'string', description: 'The message (Markdown)' },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'status',
    description: 'Show the user what you are doing right now (one short sentence), in the "What Claude is doing" panel of Rovex Hub.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

// Boucle d'écoute : attend les messages de l'app (requête longue), les pousse dans la session Claude Code.
let started = false;
let closing = false;
async function listen() {
  if (started) return;
  started = true;
  while (!closing) {
    try {
      const r = await app(`/agent/inbox?id=${encodeURIComponent(ID)}&name=${encodeURIComponent(NAME)}&cwd=${encodeURIComponent(process.cwd())}&host=${encodeURIComponent(os.hostname())}`, { timeout: 40e3 });
      if (closing) break;
      for (const it of r.items || []) {
        if (it.kind === 'verdict') notify('notifications/claude/channel/permission', { request_id: it.request_id, behavior: it.behavior === 'allow' ? 'allow' : 'deny' });
        else notify('notifications/claude/channel', { content: String(it.text || ''), meta: { chat_id: String(it.chat_id || ID), sender: String(it.sender || 'user') } });
      }
    } catch {
      await new Promise((r) => setTimeout(r, 4000)); // app fermée ou en redémarrage : on réessaie
    }
  }
}

async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (method === 'notifications/initialized') { listen(); return null; }
  // Claude Code demande une autorisation (Bash, Write…) : on la montre dans Rovex.
  if (method === 'notifications/claude/channel/permission_request') {
    app('/agent/permission', { method: 'POST', body: { id: ID, ...params } }).catch(() => {});
    return null;
  }
  if (id === undefined) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') {
    // Pas la révision 2026-07-28 : avec elle, Claude Code n'enregistre pas les channels.
    const asked = String(params.protocolVersion || '2025-06-18');
    return ok({
      protocolVersion: asked >= '2026-07-28' ? '2025-06-18' : asked,
      capabilities: { tools: {}, experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } },
      serverInfo: { name: 'rovex-chat', version: '1.0.0' },
      instructions: INSTRUCTIONS,
    });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    const a = params.arguments || {};
    try {
      if (params.name === 'reply') {
        await app('/agent/reply', { method: 'POST', body: { id: ID, chat_id: String(a.chat_id || ''), text: String(a.text || '') } });
        return ok({ content: [{ type: 'text', text: 'sent' }] });
      }
      if (params.name === 'status') {
        await app('/agent/status', { method: 'POST', body: { id: ID, text: String(a.text || '') } });
        return ok({ content: [{ type: 'text', text: 'shown' }] });
      }
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + params.name } };
    } catch (e) {
      return ok({ content: [{ type: 'text', text: 'Error: ' + e.message + ' (is Rovex Hub open?)' }], isError: true });
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown method: ' + method } };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const out = await handle(msg);
  if (out) send(out);
});
// Claude Code fermé : on prévient l'app puis on s'arrête.
rl.on('close', () => { closing = true; app('/agent/bye', { method: 'POST', body: { id: ID }, timeout: 2000 }).catch(() => {}).finally(() => process.exit(0)); });
