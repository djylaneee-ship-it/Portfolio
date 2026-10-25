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

const entry = () => ({ command: process.execPath, args: [MCP_PATH] });

function desktopStatus() {
  const configs = configPaths().map((file) => {
    let linked = false;
    let error = '';
    try { linked = Boolean((readConfig(file).mcpServers || {})[NAME]); } catch (e) { error = e.message; }
    return { file, exists: fs.existsSync(file), dir: fs.existsSync(path.dirname(file)), linked, error };
  });
  return { installed: desktopInstalled(), linked: configs.some((c) => c.linked), configs };
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

// Claude Code : on passe par sa propre commande, qui gère son fichier de config.
function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 20000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') }));
  });
}

async function codeStatus() {
  const v = await run('claude --version');
  if (!v.ok) return { installed: false, linked: false };
  const g = await run(`claude mcp get ${NAME}`);
  return { installed: true, version: v.out.trim().split('\n')[0], linked: g.ok };
}

async function linkCode(url) {
  const st = await codeStatus();
  if (!st.installed) throw Object.assign(new Error('Claude Code not found'), { key: 'codeMissing' });
  if (!st.linked) {
    const r = await run(`claude mcp add --scope user --transport http ${NAME} ${url}`);
    if (!r.ok) throw new Error(r.out.trim().slice(0, 300) || 'claude mcp add failed');
  }
  return codeStatus();
}

module.exports = { desktopStatus, linkDesktop, unlinkDesktop, codeStatus, linkCode };
