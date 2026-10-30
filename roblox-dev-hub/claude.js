// Détection de Claude Desktop / Claude Code et branchement automatique de Rovex Hub.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const NAME = 'rovex-hub';
const MCP_PATH = path.join(__dirname, 'mcp.js');

// Emplacements possibles du fichier de config de Claude Desktop.
function configPaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const out = [];
    if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json'));
    // Version Microsoft Store : config virtualisée dans le dossier du paquet.
    const pkgs = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Packages');
    try {
      for (const d of fs.readdirSync(pkgs)) {
        if (/claude/i.test(d)) out.push(path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
      }
    } catch {}
    return out;
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
  return [path.join(home, '.config', 'Claude', 'claude_desktop_config.json')];
}

function desktopInstalled() {
  if (configPaths().some((p) => fs.existsSync(path.dirname(p)))) return true;
  if (process.platform === 'win32') return Boolean(process.env.LOCALAPPDATA && fs.existsSync(path.join(process.env.LOCALAPPDATA, 'AnthropicClaude')));
  if (process.platform === 'darwin') return fs.existsSync('/Applications/Claude.app');
  return false;
}

function readConfig(file) {
  if (!fs.existsSync(file)) return {};
  const txt = fs.readFileSync(file, 'utf8').trim();
  return txt ? JSON.parse(txt) : {};
}

// Dans l'app de bureau, Claude lance Rovex Hub.exe en mode Node (pas de fenêtre) sur mcp.js.
const entry = () => (process.versions.electron
  ? { command: process.execPath, args: [MCP_PATH], env: { ELECTRON_RUN_AS_NODE: '1', ROVEX_DATA: process.env.ROVEX_DATA || '' } }
  : { command: process.execPath, args: [MCP_PATH] });

function desktopStatus() {
  const configs = configPaths().map((file) => {
    let linked = false;
    let outdated = false;
    let error = '';
    try {
      const cur = (readConfig(file).mcpServers || {})[NAME];
      linked = Boolean(cur);
      outdated = linked && JSON.stringify(cur) !== JSON.stringify(entry());
    } catch (e) { error = e.message; }
    return { file, exists: fs.existsSync(file), dir: fs.existsSync(path.dirname(file)), linked, outdated, error };
  });
  return { installed: desktopInstalled(), linked: configs.some((c) => c.linked), outdated: configs.some((c) => c.outdated), configs };
}

// Ajoute Rovex Hub aux serveurs MCP de Claude Desktop, sans toucher aux autres serveurs.
function linkDesktop() {
  const st = desktopStatus();
  if (!st.installed) throw Object.assign(new Error('Claude Desktop not found'), { key: 'desktopMissing' });
  let targets = st.configs.filter((c) => c.dir);
  if (!targets.length) targets = [st.configs[0]];
  let done = 0;
  for (const c of targets) {
    let cfg;
    try { cfg = readConfig(c.file); } catch { continue; } // config illisible : on ne l'écrase pas
    if (c.exists && !fs.existsSync(c.file + '.rovex-backup')) fs.copyFileSync(c.file, c.file + '.rovex-backup');
    cfg.mcpServers = { ...(cfg.mcpServers || {}), [NAME]: entry() };
    fs.mkdirSync(path.dirname(c.file), { recursive: true });
    fs.writeFileSync(c.file, JSON.stringify(cfg, null, 2));
    done++;
  }
  if (!done) throw Object.assign(new Error('Claude Desktop config unreadable'), { key: 'desktopConfig' });
  return desktopStatus();
}

function unlinkDesktop() {
  for (const c of desktopStatus().configs) {
    if (!c.linked) continue;
    const cfg = readConfig(c.file);
    delete cfg.mcpServers[NAME];
    fs.writeFileSync(c.file, JSON.stringify(cfg, null, 2));
  }
  return desktopStatus();
}

// ---------- Claude Code (terminal, extension VS Code, onglet Code de Claude Desktop) ----------
// Même branchement que Claude Desktop (Rovex Hub.exe en mode Node sur mcp.js) : marche même app fermée,
// et les outils passent par l'app quand elle est ouverte. Ses serveurs MCP « user » sont dans ~/.claude.json.
const CODE_FILE = path.join(os.homedir(), '.claude.json');
const CODE_DIR = path.join(os.homedir(), '.claude');
const codeEntry = () => ({ type: 'stdio', env: {}, ...entry() });

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') }));
  });
}

// La commande claude : dans le PATH, sinon aux endroits où ses installateurs la mettent.
function codeExePaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      path.join(home, '.local', 'bin', 'claude.exe'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'claude.cmd'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
    ].filter(Boolean);
  }
  return [path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'];
}
let cli = { at: 0, cmd: null, version: '' };
async function codeCli() {
  if (Date.now() - cli.at < 60e3) return cli;
  let found = { cmd: null, version: '' };
  for (const cmd of ['claude', ...codeExePaths().filter((p) => fs.existsSync(p)).map((p) => `"${p}"`)]) {
    const v = await run(`${cmd} --version`);
    if (v.ok) { found = { cmd, version: v.out.trim().split('\n')[0] }; break; }
  }
  cli = { at: Date.now(), ...found };
  return cli;
}

// Commande à coller soi-même (Invite de commandes), si le bouton ne peut pas le faire.
function codeCommand(cmd = 'claude') {
  const e = codeEntry();
  const q = (x) => `"${x}"`;
  const envs = Object.entries(e.env).map(([k, v]) => `--env ${q(`${k}=${v}`)}`).join(' ');
  // --env avant --transport : juste avant le nom, la commande le prendrait pour une variable de plus.
  return `${cmd} mcp add --scope user ${envs ? envs + ' ' : ''}--transport stdio ${NAME} -- ${[e.command, ...e.args].map(q).join(' ')}`;
}

async function codeStatus() {
  const c = await codeCli();
  let cur = null;
  let error = '';
  try { cur = (readConfig(CODE_FILE).mcpServers || {})[NAME] || null; } catch (e) { error = e.message; }
  const want = codeEntry();
  const same = cur && cur.command === want.command && JSON.stringify(cur.args || []) === JSON.stringify(want.args) && JSON.stringify(cur.env || {}) === JSON.stringify(want.env);
  return {
    installed: Boolean(c.cmd) || fs.existsSync(CODE_DIR) || fs.existsSync(CODE_FILE),
    cli: Boolean(c.cmd), version: c.version, linked: Boolean(cur), outdated: Boolean(cur) && !same,
    file: CODE_FILE, command: codeCommand(), error,
  };
}

// Ajoute (ou répare) Rovex Hub : par la commande claude si elle est là, sinon directement dans ~/.claude.json.
async function linkCode() {
  const st = await codeStatus();
  if (!st.installed) throw Object.assign(new Error('Claude Code not found'), { key: 'codeMissing' });
  const c = await codeCli();
  if (c.cmd) {
    await run(`${c.cmd} mcp remove --scope user ${NAME}`);
    const r = await run(codeCommand(c.cmd));
    const after = await codeStatus();
    if (after.linked && !after.outdated) return after;
    if (!r.ok && !fs.existsSync(CODE_FILE)) throw new Error(r.out.trim().slice(0, 300) || 'claude mcp add failed');
  }
  let cfg = {};
  if (fs.existsSync(CODE_FILE)) {
    try { cfg = readConfig(CODE_FILE); } catch { throw Object.assign(new Error('Claude Code config unreadable'), { key: 'codeConfig' }); }
    if (!fs.existsSync(CODE_FILE + '.rovex-backup')) fs.copyFileSync(CODE_FILE, CODE_FILE + '.rovex-backup');
  }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [NAME]: codeEntry() };
  fs.writeFileSync(CODE_FILE + '.tmp', JSON.stringify(cfg, null, 2));
  fs.renameSync(CODE_FILE + '.tmp', CODE_FILE);
  return codeStatus();
}

async function unlinkCode() {
  const c = await codeCli();
  if (c.cmd) await run(`${c.cmd} mcp remove --scope user ${NAME}`);
  try {
    const cfg = readConfig(CODE_FILE);
    if (cfg.mcpServers && cfg.mcpServers[NAME]) {
      delete cfg.mcpServers[NAME];
      fs.writeFileSync(CODE_FILE + '.tmp', JSON.stringify(cfg, null, 2));
      fs.renameSync(CODE_FILE + '.tmp', CODE_FILE);
    }
  } catch {}
  return codeStatus();
}

module.exports = { desktopStatus, linkDesktop, unlinkDesktop, codeStatus, linkCode, unlinkCode, entry, codeEntry, CODE_FILE };
