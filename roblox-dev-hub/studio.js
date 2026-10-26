// Pont Roblox Studio : Rovex Hub se branche comme client sur le serveur MCP de Roblox Studio (celui intégré
// à Studio, ou un autre) et repasse ses outils à Claude, préfixés « studio_ ». Claude peut alors lire les
// scripts et la structure du jeu ouvert dans Studio, lancer du Luau, tester… en plus de la base Rovex.
// La config est le JSON MCP de Roblox Studio collé dans la page « Roblox Studio » de l'app.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

// Réglage gardé dans un petit fichier à part (lu aussi par le serveur MCP lancé par Claude).
const FILE = path.join(DATA_DIR, 'studio.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

const PREFIX = 'studio_';
const PROTOCOL = '2025-06-18';
const CALL_TIMEOUT = 180e3;

// Config par défaut du serveur MCP intégré à Roblox Studio (doc Roblox : create.roblox.com/docs/studio/mcp).
const DEFAULT_CONFIG = process.platform === 'darwin'
  ? { mcpServers: { Roblox_Studio: { command: '/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP', args: [] } } }
  : { mcpServers: { Roblox_Studio: { command: 'cmd.exe', args: ['/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat'] } } };

// Accepte { mcpServers: { Nom: {...} } }, { Nom: {...} } ou directement { command, args }.
function parseConfig(input) {
  let j = input;
  if (typeof input === 'string') {
    try { j = JSON.parse(input); } catch { throw Object.assign(new Error('Invalid JSON'), { key: 'rsBadJson' }); }
  }
  if (!j || typeof j !== 'object') throw Object.assign(new Error('Invalid JSON'), { key: 'rsBadJson' });
  if (j.mcpServers && typeof j.mcpServers === 'object') j = j.mcpServers;
  let name = 'Roblox_Studio';
  let entry = j;
  if (!j.command && !j.url) {
    const keys = Object.keys(j);
    const pick = keys.find((k) => /roblox|studio/i.test(k)) || keys[0];
    if (!pick) throw Object.assign(new Error('No MCP server in this JSON'), { key: 'rsNoServer' });
    name = pick;
    entry = j[pick];
  }
  if (!entry || typeof entry !== 'object') throw Object.assign(new Error('No MCP server in this JSON'), { key: 'rsNoServer' });
  if (entry.url || entry.type === 'http' || entry.type === 'sse') throw Object.assign(new Error('Only command (stdio) servers are supported'), { key: 'rsHttp' });
  if (typeof entry.command !== 'string' || !entry.command.trim()) throw Object.assign(new Error('The server has no "command"'), { key: 'rsNoCommand' });
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  const env = entry.env && typeof entry.env === 'object' ? Object.fromEntries(Object.entries(entry.env).map(([k, v]) => [k, String(v)])) : {};
  return { name: String(name).slice(0, 60), command: entry.command.trim(), args, env };
}

// %LOCALAPPDATA% (Windows) et $HOME / ~ (macOS) remplacés par leur valeur.
function expand(s) {
  const env = process.env;
  const get = (k) => env[k] ?? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase())] ?? '';
  return String(s)
    .replace(/%([A-Za-z0-9_]+)%/g, (m, k) => get(k) || m)
    .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, k) => get(k) || m)
    .replace(/^~(?=$|[\\/])/, () => get('HOME') || get('USERPROFILE') || '~');
}

class Bridge {
  constructor() {
    this.cfg = null;
    this.proc = null;
    this.state = 'off'; // off | starting | ready | error
    this.error = '';
    this.tools = [];
    this.server = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buf = '';
    this.stderr = '';
    this.retry = 0;
    this.timer = null;
    this.listeners = new Set();
    this.readyWaiters = [];
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this.status()); } catch {} } }

  status() {
    return {
      state: this.state, error: this.error, name: this.cfg ? this.cfg.name : '',
      server: this.server, tools: this.tools.map((t) => ({ name: t.name, description: t.description || '' })),
    };
  }

  // (Re)lance le pont avec une config ; null l'arrête.
  configure(cfg) {
    // Même config : on laisse tourner (en erreur, les nouveaux essais sont déjà programmés).
    if (JSON.stringify(cfg) === JSON.stringify(this.cfg) && this.state !== 'off') return;
    this.stop();
    this.cfg = cfg;
    this.retry = 0;
    if (cfg) this.start();
  }

  // Reconnexion immédiate (bouton « Reconnecter »).
  restart() {
    const cfg = this.cfg;
    this.stop();
    this.cfg = cfg;
    this.retry = 0;
    if (cfg) this.start();
  }

  start() {
    clearTimeout(this.timer);
    if (!this.cfg) return;
    this.state = 'starting';
    this.error = '';
    this.stderr = '';
    this.buf = '';
    this.emit();
    let proc;
    try {
      proc = spawn(expand(this.cfg.command), this.cfg.args.map(expand), {
        env: { ...process.env, ...this.cfg.env, ELECTRON_RUN_AS_NODE: undefined },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      return this.fail(e.message);
    }
    this.proc = proc;
    proc.on('error', (e) => { if (this.proc === proc) this.proc = null; else return; this.fail(e.code === 'ENOENT' ? `Command not found: ${this.cfg.command}` : e.message); });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      const tail = this.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
      this.fail(`Roblox Studio MCP stopped (code ${code})${tail ? ': ' + tail : ''}`);
    });
    proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    proc.stdout.on('data', (d) => this.read(d));
    proc.stdin.on('error', () => {});
    this.handshake(proc);
  }

  async handshake(proc) {
    try {
      const init = await this.request('initialize', {
        protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'rovex-hub', version: '2' },
      }, 30e3);
      if (this.proc !== proc) return;
      this.server = init && init.serverInfo ? { name: init.serverInfo.name, version: init.serverInfo.version } : null;
      this.notify('notifications/initialized', {});
      await this.refreshTools();
      if (this.proc !== proc) return;
      this.state = 'ready';
      this.retry = 0;
      this.emit();
      for (const w of this.readyWaiters.splice(0)) w(true);
    } catch (e) {
      if (this.proc === proc) { this.kill(); this.fail(e.message); }
    }
  }

  async refreshTools() {
    const all = [];
    let cursor;
    for (let i = 0; i < 10; i++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {}, 30e3);
      all.push(...((r && r.tools) || []));
      cursor = r && r.nextCursor;
      if (!cursor) break;
    }
    this.tools = all;
  }

  fail(msg) {
    this.state = 'error';
    this.error = String(msg || 'error').slice(0, 400);
    this.tools = [];
    for (const [, p] of this.pending) p.reject(new Error(this.error));
    this.pending.clear();
    this.emit();
    for (const w of this.readyWaiters.splice(0)) w(false);
    // Nouvel essai de plus en plus espacé (Studio fermé, MCP pas encore activé…).
    if (this.cfg) {
      const wait = Math.min(60e3, 5e3 * 2 ** this.retry++);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.start(), wait);
      if (this.timer.unref) this.timer.unref();
    }
  }

  kill() {
    const p = this.proc;
    this.proc = null;
    if (p) { try { p.stdin.end(); } catch {} try { p.kill(); } catch {} }
  }

  stop() {
    clearTimeout(this.timer);
    this.kill();
    for (const [, p] of this.pending) p.reject(new Error('Roblox Studio bridge stopped'));
    this.pending.clear();
    this.state = 'off';
    this.error = '';
    this.tools = [];
    this.server = null;
    this.emit();
  }

  read(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      this.message(msg);
    }
    if (this.buf.length > 50e6) this.buf = '';
  }

  message(msg) {
    // Réponse à une de nos requêtes.
    if (msg.id !== undefined && msg.id !== null && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
      else p.resolve(msg.result);
      return;
    }
    // Requête du serveur vers nous (ping, roots…) : on répond simplement.
    if (msg.method && msg.id !== undefined) {
      const result = msg.method === 'ping' ? {} : msg.method === 'roots/list' ? { roots: [] } : null;
      this.write(result ? { jsonrpc: '2.0', id: msg.id, result } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not supported' } });
      return;
    }
    if (msg.method === 'notifications/tools/list_changed') {
      this.refreshTools().then(() => this.emit()).catch(() => {});
    }
  }

  write(obj) {
    if (!this.proc) return false;
    try { this.proc.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
  }

  request(method, params, timeout = CALL_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`Roblox Studio did not answer (${method})`)); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      if (!this.write({ jsonrpc: '2.0', id, method, params })) {
        clearTimeout(t);
        this.pending.delete(id);
        reject(new Error('Roblox Studio is not connected'));
      }
    });
  }

  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }

  // Attend que le pont soit prêt (ou en erreur), au plus `ms` millisecondes.
  waitReady(ms) {
    if (this.state === 'ready') return Promise.resolve(true);
    if (this.state === 'off') return Promise.resolve(false);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      this.readyWaiters.push((ok) => { clearTimeout(t); resolve(ok); });
    });
  }

  // Outils de Studio tels que Claude les voit (préfixés).
  exposedTools() {
    if (this.state !== 'ready') return [];
    return this.tools.map((t) => ({
      name: (PREFIX + t.name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
      title: t.title ? `Roblox Studio · ${t.title}` : undefined,
      description: `[Roblox Studio, place ouverte] ${t.description || t.name}`,
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      _studio: t.name,
    }));
  }

  owns(name) { return this.exposedTools().some((t) => t.name === name); }

  async call(name, args) {
    const tool = this.exposedTools().find((t) => t.name === name);
    if (!tool) throw new Error('Roblox Studio is not connected');
    return this.request('tools/call', { name: tool._studio, arguments: args || {} });
  }
}

const bridge = new Bridge();

// Lit la config enregistrée et (re)lance le pont si besoin.
function sync() {
  const s = readSettings();
  if (!s.enabled || !s.config) return bridge.configure(null);
  let cfg;
  try { cfg = parseConfig(s.config); } catch (e) { bridge.configure(null); bridge.state = 'error'; bridge.error = e.message; return; }
  bridge.configure(cfg);
}

module.exports = { bridge, sync, readSettings, writeSettings, parseConfig, expand, DEFAULT_CONFIG, PREFIX };
