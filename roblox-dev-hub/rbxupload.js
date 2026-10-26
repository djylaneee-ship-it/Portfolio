// Envoi d'une image sur Roblox pour l'utiliser en jeu (rbxassetid://…), puis, si demandé, mise en place dans
// la place ouverte (ImageLabel, ImageButton, Decal, Texture, ou un Decal posé sur une Part).
// 1) Outil upload_image du serveur MCP de Roblox Studio, avec un lien local temporaire vers l'image ;
// 2) sinon Open Cloud (clé API Roblox de l'utilisateur, réglée sur la page Roblox Studio).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const studio = require('./studio');
const place = require('./place');

const err = (key, msg) => Object.assign(new Error(msg), { key });
const SHARES = path.join(db.DATA_DIR, 'shares.json');

// Liens /share/<jeton> valables quelques minutes, servis par l'app à cette machine seulement (voir server.js).
function readShares() {
  try { return JSON.parse(fs.readFileSync(SHARES, 'utf8')); } catch { return {}; }
}
function share(file) {
  const all = readShares();
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (v.exp < now) delete all[k];
  const token = crypto.randomBytes(18).toString('hex');
  all[token] = { file: path.basename(file), exp: now + 10 * 60e3 };
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  fs.writeFileSync(SHARES, JSON.stringify(all));
  return `http://127.0.0.1:${process.env.PORT || 4747}/share/${token}/${encodeURIComponent(path.basename(file))}`;
}
function sharedFile(token) {
  const s = readShares()[token];
  if (!s || s.exp < Date.now()) return null;
  return path.join(db.MEDIA_DIR, path.basename(s.file));
}

// L'image demandée : id d'une ressource de la bibliothèque, nom de fichier, chemin, ou adresse http(s).
function resolveImage(state, image) {
  const v = String(image || '').trim();
  if (!v) throw err('rsNoImage', 'Give the image to upload (library id, file path or URL)');
  if (/^https?:\/\//i.test(v)) return { url: v, name: path.basename(new URL(v).pathname) || 'image' };
  const res = (state.resources || []).find((r) => r.id === v || r.file === v);
  const file = res && res.file ? path.join(db.MEDIA_DIR, res.file) : path.isAbsolute(v) ? v : path.join(db.MEDIA_DIR, path.basename(v));
  if (!fs.existsSync(file)) throw err('rsNoImage', 'Image not found: ' + v);
  if (!/\.(png|jpe?g|bmp|tga)$/i.test(file)) throw err('rsNoImage', 'Roblox accepts PNG, JPG, BMP or TGA images');
  return { file, name: (res && res.title) || path.basename(file).replace(/\.\w+$/, '') };
}

// Copie dans le dossier des médias si l'image est ailleurs (le lien local ne sert que ce dossier).
function inMedia(file) {
  if (path.dirname(path.resolve(file)) === path.resolve(db.MEDIA_DIR)) return file;
  const dest = path.join(db.MEDIA_DIR, `share-${Date.now()}-${path.basename(file)}`);
  fs.mkdirSync(db.MEDIA_DIR, { recursive: true });
  fs.copyFileSync(file, dest);
  return dest;
}

// --- Par Roblox Studio (outil upload_image) ---
async function viaStudio(img) {
  const tool = place.toolOf(/^upload_image$/);
  if (!tool) return null;
  const url = img.url || share(inMedia(img.file));
  const p = (tool.inputSchema && tool.inputSchema.properties) || {};
  const args = {};
  for (const [k, def] of Object.entries(p)) {
    if (/studio_?id/i.test(k)) continue;
    if (def.type === 'array') {
      const it = def.items || {};
      if (it.type === 'object') {
        const ip = it.properties || {};
        const o = {};
        for (const ik of Object.keys(ip)) {
          if (/url|uri|path|source/i.test(ik)) o[ik] = url;
          else if (/name|title/i.test(ik)) o[ik] = img.name;
        }
        args[k] = [o];
      } else args[k] = [url];
    } else if (def.type === 'string' && /url|uri|path|image/i.test(k) && !args[k]) args[k] = url;
    else if (def.type === 'string' && /name|title/i.test(k)) args[k] = img.name;
  }
  const idKey = Object.keys(p).find((k) => /studio_?id/i.test(k));
  if (idKey) args[idKey] = ((await place.studios()) [0] || {}).id || '';
  const { text } = await place.callTool(tool, args);
  const id = (text.match(/\b(\d{6,})\b/) || [])[1];
  if (!id) throw err('rsUpload', 'Roblox Studio did not return an asset id: ' + text.slice(0, 200));
  return { assetId: id, via: 'roblox-studio' };
}

// --- Par Open Cloud (clé API de l'utilisateur) ---
async function viaOpenCloud(img) {
  const s = studio.readSettings();
  if (!s.openCloudKey || !s.creatorId) return null;
  const buf = img.file ? fs.readFileSync(img.file) : Buffer.from(await (await fetch(img.url)).arrayBuffer());
  const ext = (img.file || img.url).match(/\.(png|jpe?g|bmp|tga)(?:$|\?)/i);
  const mime = !ext ? 'image/png' : /jpe?g/i.test(ext[1]) ? 'image/jpeg' : /bmp/i.test(ext[1]) ? 'image/bmp' : /tga/i.test(ext[1]) ? 'image/tga' : 'image/png';
  const creator = s.creatorType === 'group' ? { groupId: String(s.creatorId) } : { userId: String(s.creatorId) };
  const form = new FormData();
  form.append('request', JSON.stringify({ assetType: 'Decal', displayName: img.name.slice(0, 50), description: 'Uploaded by Rovex Hub', creationContext: { creator } }));
  form.append('fileContent', new Blob([buf], { type: mime }), path.basename(img.file || 'image.png'));
  const r = await fetch('https://apis.roblox.com/assets/v1/assets', { method: 'POST', headers: { 'x-api-key': s.openCloudKey }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err('rsUpload', `Roblox Open Cloud: ${j.message || j.error || 'HTTP ' + r.status}`);
  let op = j;
  const opId = String(op.path || op.operationId || '').split('/').pop();
  for (let i = 0; i < 30 && !op.done && opId; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const pr = await fetch(`https://apis.roblox.com/assets/v1/operations/${opId}`, { headers: { 'x-api-key': s.openCloudKey } });
    op = await pr.json().catch(() => ({}));
  }
  const id = op.response && op.response.assetId;
  if (!id) throw err('rsUpload', 'Roblox Open Cloud: the upload is still processing, try again in a minute');
  return { assetId: String(id), via: 'open-cloud', decal: true };
}

// Un Decal envoyé par Open Cloud a son propre id d'image : on le retrouve dans Studio quand c'est possible.
async function decalImageId(decalId) {
  try {
    const r = await place.luau(null, `
local ok, m = pcall(function() return game:GetService("InsertService"):LoadAsset(tonumber(input.id)) end)
local tex = nil
if ok and m then
  local d = m:FindFirstChildWhichIsA("Decal", true)
  if d then tex = d.Texture end
  m:Destroy()
end
result = { texture = tex }
`, { id: decalId });
    const id = String(r.texture || '').match(/(\d{5,})/);
    return id ? id[1] : null;
  } catch { return null; }
}

// Pose l'image dans la place : propriété Image / Texture, ou un Decal sur une Part.
async function apply(assetId, target, face) {
  return place.luau(null, `
local cur = game
for part in string.gmatch(input.target, "[^%.]+") do
  if not (cur == game and part == "game") then
    cur = cur:FindFirstChild(part)
    if not cur then error("ROVEX_NOT_FOUND " .. part) end
  end
end
local id = "rbxassetid://" .. input.id
local CHS = game:GetService("ChangeHistoryService")
local rec = nil
pcall(function() rec = CHS:TryBeginRecording("Rovex Hub image") end)
local what
if cur:IsA("ImageLabel") or cur:IsA("ImageButton") then cur.Image = id what = "Image"
elseif cur:IsA("Decal") then cur.Texture = id what = "Texture"
elseif cur:IsA("BasePart") then
  local d = Instance.new("Decal")
  d.Texture = id
  if input.face ~= "" then pcall(function() d.Face = Enum.NormalId[input.face] end) end
  d.Parent = cur
  what = "new Decal"
else error("Cannot put an image on a " .. cur.ClassName) end
if rec then pcall(function() CHS:FinishRecording(rec, Enum.FinishRecordingOperation.Commit) end) end
result = { target = cur:GetFullName(), set = what, image = id }
`, { id: assetId, target, face: face || '' });
}

async function upload(state, a = {}) {
  const img = resolveImage(state, a.image);
  let out = null;
  let firstErr = null;
  if (studio.bridge.state === 'ready') {
    try { out = await viaStudio(img); } catch (e) { firstErr = e; }
  }
  if (!out) {
    try { out = await viaOpenCloud(img); } catch (e) { firstErr = firstErr || e; }
  }
  if (!out) throw firstErr || err('rsNoUpload', 'Connect Roblox Studio in Rovex Hub (page Roblox Studio), or add a Roblox Open Cloud key there, to upload images');
  let imageId = out.assetId;
  if (out.decal) imageId = (await decalImageId(out.assetId)) || out.assetId;
  const res = { assetId: out.assetId, imageId, rbxassetid: `rbxassetid://${imageId}`, via: out.via, name: img.name };
  if (a.target) {
    try { res.applied = await apply(imageId, String(a.target), a.face); } catch (e) { res.applyError = e.message; }
  }
  res.note = 'New images can take a minute to pass Roblox moderation before they show in game.';
  return res;
}

module.exports = { upload, sharedFile, resolveImage };
