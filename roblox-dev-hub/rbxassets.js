// Packs d'assets Rovex (dossier roblox-assets/) importés dans chaque place ouverte dans Roblox Studio :
// ReplicatedStorage.RovexAssets, rangé par thème, pour que Claude réutilise ces modèles, VFX et interfaces.
// Les MeshParts / SurfaceAppearance ne se recréent pas par script : on copie les .rbxm dans le dossier
// « content » de Studio et Studio les charge lui-même (game:GetObjects("rbxasset://rovex/…")).
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');
const place = require('./place');
const studio = require('./studio');

const DIR = path.join(__dirname, 'roblox-assets');
const SUMMARY_FILE = path.join(db.DATA_DIR, 'rovex-assets.json');
const VERSION = 1; // à monter quand les packs changent : les places sont alors réimportées
const PACKS = [
  { name: 'StylizedAssets', file: 'StylizedAssets.rbxm', path: ['Environment'], drop: [] },
  { name: 'CombatVFX', file: 'CombatVFX.rbxm', path: ['VFX', 'Combat'], prefix: 'Combat', drop: ['Platform'] },
  { name: 'FireVFX', file: 'FireVFX.rbxm', path: ['VFX', 'Fire'], prefix: 'Fire', drop: ['Platform'] },
  { name: 'StudUI', file: 'StudUI.rbxm', path: ['UI', 'StudUI'], drop: [] },
];

// Dossiers « content » de Roblox Studio sur ce PC (une version installée = un dossier).
function contentDirs() {
  if (process.env.ROVEX_STUDIO_CONTENT) return [process.env.ROVEX_STUDIO_CONTENT]; // tests
  const out = [];
  if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA, process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
      .filter(Boolean).map((r) => path.join(r, 'Roblox', 'Versions'));
    for (const root of roots) {
      let vers = [];
      try { vers = fs.readdirSync(root); } catch {}
      for (const v of vers) {
        const dir = path.join(root, v);
        if (fs.existsSync(path.join(dir, 'RobloxStudioBeta.exe')) && fs.existsSync(path.join(dir, 'content'))) out.push(path.join(dir, 'content'));
      }
    }
  } else if (process.platform === 'darwin') {
    const c = '/Applications/RobloxStudio.app/Contents/Resources/content';
    if (fs.existsSync(c)) out.push(c);
  }
  return out;
}

// Copie les packs dans content/rovex/ de chaque version de Studio (seulement s'ils manquent ou ont changé).
function ensureContent() {
  const dirs = contentDirs();
  if (!dirs.length) throw Object.assign(new Error('Roblox Studio content folder not found on this PC'), { key: 'rsNoContent' });
  let copied = 0;
  for (const c of dirs) {
    const dest = path.join(c, 'rovex');
    try {
      fs.mkdirSync(dest, { recursive: true });
      for (const p of PACKS) {
        const src = path.join(DIR, p.file);
        const to = path.join(dest, p.file);
        let same = false;
        try { same = fs.statSync(to).size === fs.statSync(src).size; } catch {}
        if (!same) { fs.copyFileSync(src, to); copied++; }
      }
    } catch {}
  }
  return { dirs: dirs.length, copied };
}

const IMPORT_BODY = `
local RS = game:GetService("ReplicatedStorage")
local CHS = game:GetService("ChangeHistoryService")
local old = RS:FindFirstChild("RovexAssets")
if old and old:GetAttribute("RovexAssetsVersion") == input.version and not input.force then
  result = { skipped = true }
else
  local root = Instance.new("Folder")
  root.Name = "RovexAssets"
  local report = {}
  local okCount = 0
  -- Nom d'un dossier « Folder » d'après ses enfants (ex. JS-Plants.001… → JS-Plants), sinon Group N.
  local groupN = 0
  local function stem(n) return (n:gsub("[%s%._%-]*%d+$", "")) end
  local function nameFolders(parent)
    for _, f in ipairs(parent:GetDescendants()) do
      if f:IsA("Folder") and f.Name == "Folder" then
        local kids = f:GetChildren()
        if #kids == 0 then
          f:Destroy()
        else
          local counts, best, bestN = {}, nil, 0
          for _, k in ipairs(kids) do
            local s = stem(k.Name)
            counts[s] = (counts[s] or 0) + 1
            if counts[s] > bestN then best, bestN = s, counts[s] end
          end
          if best and best ~= "" and bestN >= #kids * 0.6 then f.Name = best else groupN += 1 f.Name = "Group " .. groupN end
        end
      end
    end
  end
  for _, p in ipairs(input.packs) do
    local ok, objs = pcall(function() return game:GetObjects(p.url) end)
    if not ok or type(objs) ~= "table" or #objs == 0 then
      table.insert(report, { pack = p.name, error = tostring(objs) })
    else
      local target = root
      for _, n in ipairs(p.path) do
        local f = target:FindFirstChild(n)
        if not f then f = Instance.new("Folder") f.Name = n f.Parent = target end
        target = f
      end
      local drop = {}
      for _, n in ipairs(p.drop) do drop[n] = true end
      local count, vfx, trail = 0, 0, 0
      for _, o in ipairs(objs) do
        -- le dossier racine du pack est retiré : son contenu va directement dans le bon dossier
        local items = o:IsA("Folder") and o:GetChildren() or { o }
        for _, c in ipairs(items) do
          if drop[c.Name] then
            c:Destroy()
          else
            if p.prefix ~= "" and c.Name == "VFXTemplate" then vfx += 1 c.Name = string.format("%s_%03d", p.prefix, vfx) end
            if c.Name == "Trails" then
              for _, t in ipairs(c:GetChildren()) do
                if t.Name == "TrailTemplate" then trail += 1 t.Name = string.format("Trail_%02d", trail) end
              end
            end
            c.Parent = target
            count += 1
          end
        end
        if o:IsA("Folder") then o:Destroy() end
      end
      nameFolders(target)
      -- Ce sont des modèles : leurs scripts sont coupés (Claude les réactive quand il s'en sert).
      for _, d in ipairs(target:GetDescendants()) do
        if d:IsA("BaseScript") and d.Enabled then d:SetAttribute("RovexWasEnabled", true) d.Enabled = false end
      end
      okCount += 1
      table.insert(report, { pack = p.name, items = count })
    end
  end
  if okCount == 0 then
    root:Destroy()
    result = { error = "load", report = report }
  else
    if old then old:Destroy() end
    root:SetAttribute("RovexAssetsVersion", input.version)
    root:SetAttribute("RovexInfo", "Rovex Hub asset packs: templates to clone. Scripts are disabled (attribute RovexWasEnabled).")
    root.Parent = RS
    pcall(function() CHS:SetWaypoint("Rovex assets") end)
    -- Résumé pour Claude : chaque élément avec ce qu'il contient.
    local summary = {}
    local function describe(inst)
      local c = { pe = 0, beam = 0, trail = 0, mesh = 0, part = 0, gui = 0, script = 0, light = 0 }
      for _, d in ipairs(inst:GetDescendants()) do
        if d:IsA("ParticleEmitter") then c.pe += 1
        elseif d:IsA("Beam") then c.beam += 1
        elseif d:IsA("Trail") then c.trail += 1
        elseif d:IsA("MeshPart") then c.mesh += 1
        elseif d:IsA("BasePart") then c.part += 1
        elseif d:IsA("GuiObject") then c.gui += 1
        elseif d:IsA("BaseScript") then c.script += 1
        elseif d:IsA("Light") then c.light += 1 end
      end
      return c
    end
    for _, d in ipairs(root:GetDescendants()) do
      local depth = 0
      local cur = d.Parent
      while cur and cur ~= root do depth += 1 cur = cur.Parent end
      if depth <= 2 and not d:IsA("Attachment") and not d:IsA("ParticleEmitter") and not d:IsA("SurfaceAppearance") then
        local parentIsGroup = d.Parent == root or d.Parent:IsA("Folder")
        if parentIsGroup then
          local rel = d:GetFullName():gsub("^ReplicatedStorage%.RovexAssets%.", "")
          table.insert(summary, { path = rel, class = d.ClassName, children = #d:GetChildren(), contents = describe(d) })
        end
      end
      if #summary >= 450 then break end
    end
    result = { imported = true, report = report, summary = summary }
  end
end
`;

// Import dans une place (studioId) : rien à faire si elle a déjà la bonne version (sauf force).
async function importInto(studioId, { force = false } = {}) {
  const content = ensureContent();
  const input = {
    version: VERSION, force,
    packs: PACKS.map((p) => ({ name: p.name, url: `rbxasset://rovex/${p.file}`, path: p.path, prefix: p.prefix || '', drop: p.drop })),
  };
  const r = await place.luau(studioId, IMPORT_BODY, input);
  if (r && r.summary) {
    try { fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ at: new Date().toISOString(), version: VERSION, summary: r.summary })); } catch {}
  }
  if (r && r.error) {
    const why = (r.report || []).map((x) => `${x.pack}: ${x.error}`).join(' | ');
    throw Object.assign(new Error('Roblox Studio could not load the packs: ' + why), { key: 'rsAssetsLoad', vars: { msg: why.slice(0, 300) } });
  }
  return { ...r, content };
}

// ---------- Import automatique : chaque place ouverte, une fois par session de Rovex ----------
const done = new Map(); // studioId → { at, ok, error, skipped }
let busy = false;
let settingsFile = path.join(db.DATA_DIR, 'rovex-assets-settings.json');
function auto() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).auto !== false; } catch { return true; }
}
function setAuto(on) {
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ auto: Boolean(on) }));
  return status();
}
async function tick() {
  if (busy || !auto() || studio.bridge.state !== 'ready') return;
  busy = true;
  try {
    const list = await place.studios();
    for (const s of list) {
      if (done.has(s.id)) continue;
      try {
        const r = await importInto(s.id);
        done.set(s.id, { at: new Date().toISOString(), ok: true, skipped: Boolean(r.skipped), name: s.name });
      } catch (e) {
        done.set(s.id, { at: new Date().toISOString(), ok: false, error: e.message, name: s.name });
      }
    }
  } catch {} finally { busy = false; }
}
function start() {
  setTimeout(tick, 8000);
  setInterval(tick, 20e3).unref();
}

function summary() {
  try { return JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8')); } catch { return null; }
}
function status() {
  const s = summary();
  return {
    auto: auto(), version: VERSION, packs: PACKS.map((p) => ({ name: p.name, path: ['ReplicatedStorage', 'RovexAssets', ...p.path].join('.') })),
    places: [...done.entries()].map(([id, v]) => ({ id, ...v })), contentDirs: contentDirs().length, items: s ? s.summary.length : 0, lastImport: s && s.at,
  };
}

// Pour l'outil MCP rovex_assets : ce qu'il y a dans ReplicatedStorage.RovexAssets (filtrable).
function list(query = '', limit = 120) {
  const s = summary();
  if (!s) return { imported: false, note: 'The Rovex asset packs were not imported yet: open the place in Roblox Studio with Rovex Hub connected (Roblox Studio page), they are imported into ReplicatedStorage.RovexAssets automatically.' };
  const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const items = s.summary.filter((x) => q.every((t) => `${x.path} ${x.class}`.toLowerCase().includes(t)));
  return {
    imported: true, root: 'game.ReplicatedStorage.RovexAssets (item paths are relative to it)', count: items.length,
    how: 'These are templates: Clone() them into Workspace / the character / StarterGui. VFX: clone the template part or move its Attachments/ParticleEmitters, then :Emit(n) or enable them. Scripts inside are disabled (attribute RovexWasEnabled = they were enabled): re-enable them after moving. Inspect details with the Roblox Studio tools.',
    items: items.slice(0, Math.max(1, Math.min(400, Number(limit) || 120))),
  };
}

module.exports = { importInto, start, status, setAuto, list, PACKS, VERSION, contentDirs };
