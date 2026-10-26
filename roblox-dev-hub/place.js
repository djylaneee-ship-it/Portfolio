// La place ouverte dans Roblox Studio, vue depuis Rovex : liste des Studio connectés, scripts du jeu (lire et
// modifier, ça change directement dans Studio) et « réglages du jeu » : les valeurs simples écrites dans le
// code (local swordDamage = 5, Config = { Speed = 16 }…) modifiables sans fouiller dans les scripts.
// Tout passe par les outils du serveur MCP de Studio (list_roblox_studios, execute_luau) via le pont studio.js.
const { bridge } = require('./studio');

const err = (key, msg, vars) => Object.assign(new Error(msg), { key, vars });

// --- Appel d'un outil de Studio en remplissant ses paramètres d'après son schéma ---
function toolOf(re) {
  return bridge.state === 'ready' ? bridge.tools.find((t) => re.test(t.name)) : null;
}

function props(tool) {
  return (tool.inputSchema && tool.inputSchema.properties) || {};
}

async function callTool(tool, args) {
  const out = await bridge.request('tools/call', { name: tool.name, arguments: args }, 180e3);
  const text = ((out && out.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  if (out && out.isError) throw err('rsTool', text.slice(0, 400) || 'Roblox Studio error');
  return { out, text };
}

// --- Studio ouverts ---
let studiosCache = { at: 0, list: [] };

// Lit la réponse de list_roblox_studios (JSON ou texte) en [{ id, name, placeId }].
function parseStudios(text) {
  const found = [];
  const visit = (v) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    const id = v.studio_id ?? v.studioId ?? v.id ?? v.instance_id ?? v.instanceId;
    const name = v.name ?? v.place_name ?? v.placeName ?? v.title;
    if (id !== undefined && name !== undefined) {
      found.push({ id: String(id), name: String(name), placeId: v.place_id ?? v.placeId ?? null });
      return;
    }
    Object.values(v).forEach(visit);
  };
  try { visit(JSON.parse(text)); } catch {
    // Texte libre : une ligne par Studio, avec un identifiant et un nom.
    for (const line of text.split('\n')) {
      const id = (line.match(/(?:studio[_ ]?id|id)\s*[:=]\s*["']?([\w-]+)/i) || [])[1];
      const name = (line.match(/name\s*[:=]\s*["']?([^"',]+)/i) || [])[1];
      if (id) found.push({ id, name: (name || id).trim(), placeId: (line.match(/place[_ ]?id\s*[:=]\s*(\d+)/i) || [])[1] || null });
    }
  }
  return found;
}

async function studios(force) {
  if (bridge.state !== 'ready') return [];
  if (!force && Date.now() - studiosCache.at < 10e3) return studiosCache.list;
  let list = [];
  const lister = toolOf(/^list_roblox_studios$/);
  if (lister) {
    try { list = parseStudios((await callTool(lister, {})).text); } catch {}
  }
  // Serveur sans liste (ancien serveur, un seul Studio) : on demande le nom de la place à Studio.
  if (!list.length && toolOf(/^(execute_luau|run_code)$/)) {
    try {
      const r = await luau(null, 'result = { name = game.Name, placeId = game.PlaceId }');
      list = [{ id: '', name: r.name || 'Place', placeId: r.placeId || null }];
    } catch {}
  }
  studiosCache = { at: Date.now(), list };
  return list;
}

// --- Luau dans Studio (mode Edit) ---
// Les données entrent et sortent en hexadécimal pour ne jamais casser sur des guillemets ou des accents.
const LUAU_HEAD = `
local HttpService = game:GetService("HttpService")
local SES = game:GetService("ScriptEditorService")
local function unhex(h) return (h:gsub("..", function(x) return string.char(tonumber(x, 16)) end)) end
local function hex(s) return (s:gsub(".", function(c) return string.format("%02x", string.byte(c)) end)) end
local input = HttpService:JSONDecode(unhex("__INPUT__"))
local function seg(inst)
  local out = {}
  local cur = inst
  while cur and cur ~= game do
    local parent = cur.Parent
    local idx = 1
    if parent then
      for _, c in ipairs(parent:GetChildren()) do
        if c == cur then break end
        if c.Name == cur.Name then idx += 1 end
      end
    end
    table.insert(out, 1, { cur.Name, idx })
    cur = parent
  end
  return out
end
local function resolve(segs)
  local cur = game
  for _, s in ipairs(segs) do
    local found, n = nil, 0
    for _, c in ipairs(cur:GetChildren()) do
      if c.Name == s[1] then
        n += 1
        if n == s[2] then found = c break end
      end
    end
    if not found then error("ROVEX_NOT_FOUND " .. tostring(s[1])) end
    cur = found
  end
  return cur
end
local function getSource(s)
  local ok, src = pcall(function() return SES:GetEditorSource(s) end)
  if ok and type(src) == "string" then return src end
  return s.Source
end
local result = nil
`;
// Le résultat revient par la valeur de retour d'execute_luau (rien n'est affiché dans la sortie de Studio).
const LUAU_TAIL = `
return "<<ROVEX:" .. hex(HttpService:JSONEncode(result)) .. ":ROVEX>>"
`;

async function luau(studioId, body, input = {}) {
  const tool = toolOf(/^(execute_luau|run_code)$/);
  if (!tool) throw err('rsNoLuau', 'This Roblox Studio server cannot run Luau');
  const hexIn = Buffer.from(JSON.stringify(input), 'utf8').toString('hex');
  const code = LUAU_HEAD.replace('__INPUT__', hexIn) + body + LUAU_TAIL;
  const p = props(tool);
  const req = (tool.inputSchema && tool.inputSchema.required) || [];
  const args = {};
  const codeKey = ['code', 'luau', 'source', 'script', 'command'].find((k) => k in p)
    || Object.keys(p).find((k) => p[k].type === 'string' && !/studio|datamodel/i.test(k)) || 'code';
  args[codeKey] = code;
  const dmKey = Object.keys(p).find((k) => /datamodel/i.test(k));
  if (dmKey) args[dmKey] = (p[dmKey].enum || []).find((v) => /^edit$/i.test(v)) || 'Edit';
  const idKey = Object.keys(p).find((k) => /studio_?id/i.test(k));
  if (idKey && (studioId || req.includes(idKey))) args[idKey] = studioId || ((await studios())[0] || {}).id || '';
  const { text } = await callTool(tool, args);
  const m = text.match(/<<ROVEX:([0-9a-f]*):ROVEX>>/);
  if (!m && /<<ROVEX:[0-9a-f]+$/.test(text.trim())) throw err('rsTooBig', 'Roblox Studio cut the answer: too big');
  if (!m) {
    if (/ROVEX_NOT_FOUND/.test(text)) throw err('rsGone', 'This script no longer exists in Studio');
    throw err('rsTool', (text || 'No answer from Roblox Studio').slice(0, 400));
  }
  return JSON.parse(Buffer.from(m[1], 'hex').toString('utf8'));
}

// --- Scripts ---
const LIST_BODY = `
local list = {}
for _, svc in ipairs(game:GetChildren()) do
  local okSvc, all = pcall(function() return svc:GetDescendants() end)
  if okSvc then
    for _, d in ipairs(all) do
      if d:IsA("LuaSourceContainer") then
        local ok, src = pcall(getSource, d)
        if ok and type(src) == "string" then
          table.insert(list, { path = seg(d), full = d:GetFullName(), class = d.ClassName, size = #src })
        end
      end
    end
  end
end
result = { name = game.Name, placeId = game.PlaceId, scripts = list }
`;

const READ_MANY_BODY = `
local out = {}
for i, p in ipairs(input.paths) do
  local ok, s = pcall(resolve, p)
  if ok then
    local ok2, src = pcall(getSource, s)
    out[i] = ok2 and src or ""
  else
    out[i] = ""
  end
end
result = { sources = out }
`;

// Lots de sources de ~150 Ko pour ne pas dépasser la taille de réponse de Studio.
const BATCH = 150e3;

async function scripts(studioId, withSource = false) {
  const r = await luau(studioId, LIST_BODY, {});
  const list = (r.scripts || []).sort((a, b) => a.full.localeCompare(b.full));
  if (withSource) {
    let batch = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const got = await luau(studioId, READ_MANY_BODY, { paths: batch.map((x) => x.path) });
      batch.forEach((x, i) => { x.source = (got.sources || [])[i] || ''; });
      batch = [];
      size = 0;
    };
    for (const x of list) {
      if (x.size > 2e6) continue; // énorme script généré : ignoré pour les réglages
      if (size + x.size > BATCH) await flush();
      batch.push(x);
      size += x.size;
    }
    await flush();
  }
  return { name: r.name, placeId: r.placeId, scripts: list };
}

async function readScript(studioId, segs) {
  return luau(studioId, `
local s = resolve(input.path)
result = { source = getSource(s), class = s.ClassName, full = s:GetFullName() }
`, { path: segs });
}

async function writeScript(studioId, segs, source) {
  if (typeof source !== 'string') throw err('rsTool', 'No source');
  return luau(studioId, `
local s = resolve(input.path)
local CHS = game:GetService("ChangeHistoryService")
local rec = nil
pcall(function() rec = CHS:TryBeginRecording("Rovex Hub") end)
local ok = pcall(function() SES:UpdateSourceAsync(s, function() return input.source end) end)
if not ok then s.Source = input.source end
if rec then pcall(function() CHS:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end) end
result = { ok = true, full = s:GetFullName(), size = #getSource(s) }
`, { path: segs, source });
}

// --- Réglages du jeu : valeurs simples écrites dans le code ---
const NUM = '-?(?:0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?|\\.\\d+)';
const STR = `"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'`;
const VALUE = `(${NUM}|${STR}|true|false)`;
const LOCAL_RE = new RegExp(`^local\\s+([A-Za-z_]\\w*)\\s*(?::\\s*[\\w.<>{}|?]+\\s*)?=\\s*${VALUE}\\s*[,;]?\\s*(--.*)?$`);
const FIELD_RE = new RegExp(`^(\\s*)([A-Za-z_]\\w*|\\[\\s*(?:"[^"]+"|'[^']+')\\s*\\])\\s*=\\s*${VALUE}\\s*([,;]?)\\s*(--.*)?$`);
const TABLE_OPEN_RE = /^\s*(?:local\s+)?([A-Za-z_][\w.]*|\[\s*(?:"[^"]+"|'[^']+')\s*\])\s*(?::\s*[\w.<>|?]+\s*)?=\s*\{\s*(--.*)?$/;
const RETURN_TABLE_RE = /^\s*return\s*\{\s*(--.*)?$/;

const kindOf = (v) => (v === 'true' || v === 'false' ? 'bool' : /^["']/.test(v) ? 'string' : 'number');
const cleanKey = (k) => k.replace(/^\[\s*["']|["']\s*\]$/g, '');
const unquote = (v) => v.slice(1, -1).replace(/\\(["'\\])/g, '$1').replace(/\\n/g, '\n');

// Retire les chaînes et commentaires d'une ligne pour compter les accolades sans se tromper.
function codeOnly(line) {
  return line.replace(/--.*$/, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

function parseValues(source) {
  const out = [];
  const lines = source.split('\n');
  const stack = []; // tables ouvertes : { name, depth }
  let depth = 0;
  let inLongComment = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (inLongComment) { if (line.includes(']]')) inLongComment = false; return; }
    if (/^\s*--\[=*\[/.test(line) && !/\]=*\]/.test(line.replace(/^\s*--\[=*\[/, ''))) { inLongComment = true; return; }
    const parent = stack.length ? stack[stack.length - 1] : null;
    let m;
    if (depth === 0 && (m = line.match(LOCAL_RE))) {
      out.push({ line: i + 1, name: m[1], group: '', value: m[2], kind: kindOf(m[2]), comment: (m[3] || '').replace(/^--\s?/, ''), text: line });
    } else if (parent && depth === parent.depth && (m = line.match(FIELD_RE))) {
      out.push({ line: i + 1, name: cleanKey(m[2]), group: stack.map((s) => s.name).join(' › '), value: m[3], kind: kindOf(m[3]), comment: (m[5] || '').replace(/^--\s?/, ''), text: line });
    }
    const opens = (codeOnly(line).match(/\{/g) || []).length;
    const closes = (codeOnly(line).match(/\}/g) || []).length;
    // Une table de réglages : ouverte au premier niveau du script, ou dans une table déjà suivie.
    const tm = line.match(TABLE_OPEN_RE) || (depth === 0 && line.match(RETURN_TABLE_RE) ? [line, 'return'] : null);
    if (tm && opens === 1 && closes === 0 && (depth === 0 || (parent && depth === parent.depth))) {
      depth += 1;
      stack.push({ name: tm[1] === 'return' ? 'Module' : cleanKey(tm[1]), depth });
      return;
    }
    depth = Math.max(0, depth + opens - closes);
    while (stack.length && depth < stack[stack.length - 1].depth) stack.pop();
  });
  return out.map((v) => ({ ...v, value: v.kind === 'string' ? unquote(v.value) : v.kind === 'bool' ? v.value === 'true' : Number(v.value) }));
}

// Nouvelle valeur écrite à la place de l'ancienne, sur la même ligne (le reste de la ligne est gardé).
function literal(kind, value) {
  if (kind === 'bool') return value === true || value === 'true' ? 'true' : 'false';
  if (kind === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw err('rsBadValue', 'Not a number');
    return String(n);
  }
  return JSON.stringify(String(value)).replace(/\\u([0-9a-f]{4})/g, (m, h) => `\\u{${h}}`);
}

function replaceValue(lineText, kind, value) {
  const lit = literal(kind, value);
  let m = lineText.match(LOCAL_RE);
  if (m) return lineText.replace(new RegExp(`(=\\s*)${VALUE}`), (all, eq) => eq + lit);
  m = lineText.match(FIELD_RE);
  if (m) return lineText.replace(new RegExp(`(=\\s*)${VALUE}`), (all, eq) => eq + lit);
  throw err('rsChanged', 'This line changed in Studio');
}

let valuesCache = new Map();
async function values(studioId, force) {
  const key = studioId || '';
  const c = valuesCache.get(key);
  if (!force && c && Date.now() - c.at < 15e3) return c.data;
  const all = await scripts(studioId, true);
  const groups = [];
  for (const s of all.scripts) {
    if (!s.source) continue;
    const vals = parseValues(s.source);
    if (vals.length) groups.push({ path: s.path, full: s.full, class: s.class, values: vals });
  }
  // Les scripts de réglages (Config, Settings…) d'abord.
  const score = (g) => (/config|setting|constant|stat|balance|data|value/i.test(g.full) ? 0 : 1);
  groups.sort((a, b) => score(a) - score(b) || a.full.localeCompare(b.full));
  const data = { name: all.name, placeId: all.placeId, groups };
  valuesCache.set(key, { at: Date.now(), data });
  return data;
}

async function setValue(studioId, { path, line, text, kind, value }) {
  const cur = await readScript(studioId, path);
  const lines = cur.source.split('\n');
  const i = Number(line) - 1;
  if (!(i >= 0 && i < lines.length) || lines[i].replace(/\r$/, '') !== String(text).replace(/\r$/, '')) throw err('rsChanged', 'This line changed in Studio: reload');
  const cr = lines[i].endsWith('\r') ? '\r' : '';
  lines[i] = replaceValue(lines[i].replace(/\r$/, ''), kind, value) + cr;
  await writeScript(studioId, path, lines.join('\n'));
  valuesCache.clear();
  return { ok: true, text: lines[i].replace(/\r$/, '') };
}

module.exports = { studios, scripts, readScript, writeScript, values, setValue, parseValues, parseStudios, replaceValue, luau, callTool, toolOf };
