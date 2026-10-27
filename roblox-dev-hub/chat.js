// Chat Claude intégré : Rovex Hub fait lui-même ce que fait Claude Desktop (hôte MCP). Il donne à Claude
// tous ses outils MCP (skills, bibliothèque, textures VFX, images, Roblox Studio `studio_*`), exécute les appels
// et affiche le raisonnement et les actions. Claude Desktop peut donc rester fermé.
// Chaque membre branche sa propre clé Claude (console.anthropic.com) : elle reste chiffrée sur son PC.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');
const mcp = require('./mcp');

const DIR = path.join(db.DATA_DIR, 'chats');
const KEY_FILE = path.join(db.DATA_DIR, 'claude-key.bin');
const SETTINGS_FILE = path.join(db.DATA_DIR, 'chat.json');
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const MAX_STEPS = 60; // appels d'outils à la suite avant de rendre la main
const MAX_RESULT = 120000; // caractères gardés par résultat d'outil

const CHAT_RULES = `

You are Claude, running inside the Rovex Hub desktop app (a Roblox development hub). The user talks to you in the app's chat, not in Claude Desktop. Answer in the user's language, with short, clear explanations: many users are beginners.
Every Rovex Hub tool is available directly. Tools starting with studio_ act on the user's open Roblox Studio (read and edit scripts, run Luau, insert assets, capture the screen): use them when the task is about their game, and say what you changed.
Format answers in Markdown. Put Luau code in \`\`\`lua blocks.`;

// ---------- Clé Claude (chiffrée par Windows / macOS quand c'est possible) ----------
function safe() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
  } catch { return null; }
}
function readKey() {
  try {
    const buf = fs.readFileSync(KEY_FILE);
    const s = safe();
    if (buf[0] === 0x01 && s) return s.decryptString(buf.subarray(1));
    if (buf[0] === 0x00) return buf.subarray(1).toString('utf8');
  } catch {}
  return '';
}
function writeKey(key) {
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  const s = safe();
  const body = s ? Buffer.concat([Buffer.from([1]), s.encryptString(key)]) : Buffer.concat([Buffer.from([0]), Buffer.from(key, 'utf8')]);
  fs.writeFileSync(KEY_FILE, body, { mode: 0o600 });
}
const hint = (k) => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '');

function settings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
  return { model: MODELS.includes(s.model) ? s.model : MODELS[0], effort: EFFORTS.includes(s.effort) ? s.effort : 'medium' };
}
function saveSettings(b = {}) {
  const s = { ...settings(), ...(MODELS.includes(b.model) && { model: b.model }), ...(EFFORTS.includes(b.effort) && { effort: b.effort }) };
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s));
  return s;
}

function status() {
  const k = readKey();
  return { hasKey: Boolean(k), keyHint: hint(k), encrypted: Boolean(safe()), ...settings(), models: MODELS, efforts: EFFORTS };
}

// Erreurs de l'API traduites en clés de l'interface.
function apiError(e) {
  if (e instanceof Anthropic.AuthenticationError) return Object.assign(new Error('Invalid Claude key'), { key: 'chatBadKey' });
  if (e instanceof Anthropic.PermissionDeniedError) return Object.assign(new Error(e.message), { key: 'chatDenied' });
  if (e instanceof Anthropic.RateLimitError) return Object.assign(new Error('Too many requests'), { key: 'chatRate' });
  if (e instanceof Anthropic.APIConnectionError) return Object.assign(new Error('No connection to Claude'), { key: 'chatOffline' });
  if (e instanceof Anthropic.APIError && /credit balance/i.test(e.message)) return Object.assign(new Error(e.message), { key: 'chatCredits' });
  return e;
}

// Vérifie la clé (requête gratuite : la fiche du modèle) puis l'enregistre.
async function setKey(key) {
  key = String(key || '').trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw Object.assign(new Error('This is not a Claude API key'), { key: 'chatKeyFormat' });
  try { await new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20e3 }).models.retrieve(MODELS[0]); }
  catch (e) { throw apiError(e); }
  writeKey(key);
  return status();
}
function removeKey() { try { fs.unlinkSync(KEY_FILE); } catch {} return status(); }

// ---------- Conversations (une par fichier) ----------
const file = (id) => path.join(DIR, `${String(id).replace(/[^\w-]/g, '')}.json`);
function load(id) {
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; }
}
function save(c) {
  fs.mkdirSync(DIR, { recursive: true });
  c.updated = new Date().toISOString();
  fs.writeFileSync(file(c.id) + '.tmp', JSON.stringify(c));
  fs.renameSync(file(c.id) + '.tmp', file(c.id));
}
function list() {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch {}
  return names.map((f) => {
    const c = load(f.slice(0, -5));
    return c && { id: c.id, title: c.title, updated: c.updated, model: c.model, running: Boolean(runs.get(c.id) && !runs.get(c.id).done) };
  }).filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}
function remove(id) {
  stop(id);
  try { fs.unlinkSync(file(id)); } catch {}
  return { ok: true };
}
function rename(id, title) {
  const c = load(id);
  if (!c) throw Object.assign(new Error('Conversation not found'), { key: 'notFound', code: 404 });
  c.title = String(title || '').trim().slice(0, 80) || c.title;
  save(c);
  return { ok: true };
}

// ---------- Outils : ceux du serveur MCP de Rovex, tels que Claude Desktop les voit ----------
async function rpc(method, params) {
  const r = await mcp.handle({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params });
  if (r.error) throw new Error(r.error.message);
  return r.result;
}
async function tools() {
  const { tools: list } = await rpc('tools/list', {});
  return list.filter((x) => /^[a-zA-Z0-9_-]{1,128}$/.test(x.name)).map((x) => ({
    name: x.name,
    description: String(x.description || '').slice(0, 4000),
    input_schema: x.inputSchema && x.inputSchema.type === 'object' ? x.inputSchema : { type: 'object', properties: {} },
    eager_input_streaming: true, // les gros scripts arrivent au fil de l'eau
  }));
}

// Contrôle simple de l'entrée d'un outil (champs requis et types de base) avant de l'exécuter.
function invalid(input, schema) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  for (const k of schema.required || []) if (input[k] === undefined) return `missing "${k}"`;
  const T = { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', object: 'object', array: 'object' };
  for (const [k, p] of Object.entries(schema.properties || {})) {
    if (input[k] === undefined || !p || !T[p.type]) continue;
    if (typeof input[k] !== T[p.type] || (p.type === 'array' && !Array.isArray(input[k]))) return `"${k}" must be ${p.type}`;
  }
  return '';
}

// Résultat MCP → contenu d'un tool_result (texte et images).
function toResult(out) {
  const content = [];
  let room = MAX_RESULT;
  for (const b of (out && out.content) || []) {
    if (b.type === 'text') {
      const txt = String(b.text || '');
      content.push({ type: 'text', text: txt.length > room ? txt.slice(0, room) + '\n…(truncated)' : txt });
      room = Math.max(1000, room - txt.length);
    } else if (b.type === 'image' && b.data && /^image\/(png|jpeg|gif|webp)$/.test(b.mimeType)) {
      content.push({ type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } });
    }
  }
  return content.length ? content : [{ type: 'text', text: '(empty result)' }];
}
const preview = (content) => content.map((b) => (b.type === 'text' ? b.text : '[image]')).join('\n').slice(0, 4000);

// ---------- Exécution : la boucle Claude ↔ outils, diffusée à l'interface ----------
// Une exécution par conversation. Les événements sont gardés pour qu'on puisse quitter la page et revenir.
const runs = new Map();

function emit(run, ev) {
  run.events.push(ev);
  for (const fn of run.listeners) fn(ev, run.events.length);
}

function start({ chatId, text, images = [] }) {
  const key = readKey();
  if (!key) throw Object.assign(new Error('Add your Claude key first'), { key: 'chatNoKey' });
  text = String(text || '').trim();
  if (!text && !images.length) throw Object.assign(new Error('Empty message'), { key: 'chatEmpty' });
  const busy = (id) => runs.has(id) && !runs.get(id).done;
  if (chatId && busy(chatId)) throw Object.assign(new Error('Claude is still working'), { key: 'chatBusy' });
  const s = settings();
  let c = chatId && load(chatId);
  if (chatId && !c) throw Object.assign(new Error('Conversation not found'), { key: 'notFound', code: 404 });
  if (!c) c = { id: crypto.randomUUID(), title: (text || 'Image').replace(/\s+/g, ' ').slice(0, 60), created: new Date().toISOString(), model: s.model, messages: [] };
  // Le modèle reste celui de la conversation (son raisonnement n'est valable qu'avec lui).
  const content = [
    ...images.slice(0, 5).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } })),
    ...(text ? [{ type: 'text', text }] : []),
  ];
  // Tour précédent interrompu (arrêt, refus) : le message rejoint le dernier message de l'utilisateur.
  const last = c.messages[c.messages.length - 1];
  if (last && last.role === 'user') last.content = [...(Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content) }]), ...content];
  else c.messages.push({ role: 'user', content });
  save(c);
  const run = { id: c.id, events: [], listeners: new Set(), done: false, abort: new AbortController() };
  runs.set(c.id, run);
  loop(run, c, key, s.effort)
    .catch((e) => {
      if (run.abort.signal.aborted) return emit(run, { type: 'stopped' });
      const err = apiError(e);
      emit(run, { type: 'error', key: err.key || '', message: String(err.message || err).slice(0, 500) });
    })
    .finally(() => {
      run.done = true;
      emit(run, { type: 'done' });
      setTimeout(() => { if (runs.get(c.id) === run) runs.delete(c.id); }, 30e3);
    });
  return { chatId: c.id, title: c.title };
}

async function loop(run, c, key, effort) {
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });
  const tl = await tools();
  const schemas = new Map(tl.map((x) => [x.name, x.input_schema]));
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'Rovex Chat', version: '1' } });
  const system = [{ type: 'text', text: String(init.instructions || '') + CHAT_RULES, cache_control: { type: 'ephemeral' } }];
  let jsonRetries = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (run.abort.signal.aborted) return;
    emit(run, { type: 'turn' });
    const stream = client.messages.stream({
      model: c.model,
      max_tokens: 32000,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort },
      system,
      tools: tl,
      messages: c.messages,
      cache_control: { type: 'ephemeral' }, // garde aussi la conversation en cache d'un tour à l'autre
    }, { signal: run.abort.signal });
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start') {
        const b = ev.content_block;
        if (b.type === 'thinking') emit(run, { type: 'thinking_start' });
        else if (b.type === 'text') emit(run, { type: 'text_start' });
        else if (b.type === 'tool_use') emit(run, { type: 'tool_start', id: b.id, name: b.name });
      } else if (ev.type === 'content_block_delta') {
        const d = ev.delta;
        if (d.type === 'thinking_delta') emit(run, { type: 'thinking', text: d.thinking });
        else if (d.type === 'text_delta') emit(run, { type: 'text', text: d.text });
      }
    });
    let message;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (e) {
      // Entrée d'outil illisible (JSON cassé) : on relance ce tour, au plus deux fois. Les erreurs d'API remontent.
      if (e instanceof Anthropic.APIError || run.abort.signal.aborted || jsonRetries++ >= 2) throw e;
      emit(run, { type: 'notice', key: 'chatRetry' });
      continue;
    }
    const u = message.usage || {};
    emit(run, { type: 'usage', input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 });
    if (message.stop_reason === 'refusal') { emit(run, { type: 'notice', key: 'chatRefusal' }); save(c); return; }
    const uses = message.content.filter((b) => b.type === 'tool_use');
    if (message.stop_reason === 'pause_turn') { c.messages.push({ role: 'assistant', content: message.content }); save(c); continue; }
    if (!uses.length) { c.messages.push({ role: 'assistant', content: message.content }); save(c); return; }
    // Entrée d'outil coupée par la limite de longueur : on ne l'exécute pas.
    if (message.stop_reason === 'max_tokens') {
      const texts = message.content.filter((b) => b.type === 'text' && b.text);
      if (texts.length) { c.messages.push({ role: 'assistant', content: texts }); save(c); }
      emit(run, { type: 'notice', key: 'chatTooLong' });
      return;
    }
    c.messages.push({ role: 'assistant', content: message.content });
    const results = [];
    for (const u2 of uses) {
      emit(run, { type: 'tool_call', id: u2.id, name: u2.name, input: JSON.stringify(u2.input).slice(0, 3000) });
      const bad = schemas.has(u2.name) ? invalid(u2.input, schemas.get(u2.name)) : 'unknown tool';
      let content;
      let isError = false;
      if (run.abort.signal.aborted) {
        // Chaque appel d'outil doit avoir sa réponse, même après un arrêt.
        content = [{ type: 'text', text: 'Stopped by the user before this tool ran.' }];
        isError = true;
      } else if (bad) {
        content = [{ type: 'text', text: JSON.stringify({ INVALID_INPUT: bad, input: JSON.stringify(u2.input).slice(0, 2000) }) }];
        isError = true;
      } else {
        const t0 = Date.now();
        const r = await rpc('tools/call', { name: u2.name, arguments: u2.input }).catch((e) => ({ content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }));
        content = toResult(r);
        isError = Boolean(r.isError);
        emit(run, { type: 'tool_time', id: u2.id, ms: Date.now() - t0 });
      }
      emit(run, { type: 'tool_result', id: u2.id, error: isError, text: preview(content) });
      results.push({ type: 'tool_result', tool_use_id: u2.id, content, ...(isError && { is_error: true }) });
    }
    c.messages.push({ role: 'user', content: results });
    save(c);
    if (run.abort.signal.aborted) return;
  }
  emit(run, { type: 'notice', key: 'chatMaxSteps' });
}

function stop(id) {
  const run = runs.get(id);
  if (run && !run.done) run.abort.abort();
  return { ok: true };
}

// Abonnement aux événements d'une exécution (en repartant de l'événement n°from).
function subscribe(id, from, fn) {
  const run = runs.get(id);
  if (!run) return null;
  run.events.slice(from).forEach((ev, i) => fn(ev, from + i + 1));
  if (run.done) return () => {};
  run.listeners.add(fn);
  return () => run.listeners.delete(fn);
}

// La conversation pour l'interface : messages tels qu'enregistrés, sans les images en base64.
function view(id) {
  const c = load(id);
  if (!c) throw Object.assign(new Error('Conversation not found'), { key: 'notFound', code: 404 });
  const messages = c.messages.map((m) => ({
    role: m.role,
    content: (Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]).map((b) => {
      if (b.type === 'image') return { type: 'image' };
      if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking || '' };
      if (b.type === 'redacted_thinking') return { type: 'thinking', thinking: '' };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: JSON.stringify(b.input).slice(0, 3000) };
      if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.tool_use_id, error: Boolean(b.is_error), text: preview(Array.isArray(b.content) ? b.content : [{ type: 'text', text: String(b.content || '') }]) };
      return { type: b.type, text: b.text || '' };
    }),
  }));
  const run = runs.get(id);
  return { id: c.id, title: c.title, model: c.model, created: c.created, updated: c.updated, messages, running: Boolean(run && !run.done) };
}

module.exports = { status, setKey, removeKey, saveSettings, list, view, remove, rename, start, stop, subscribe, MODELS };
