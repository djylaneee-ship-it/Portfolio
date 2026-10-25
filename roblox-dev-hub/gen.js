// Génération d'images et de sons par IA. Claude ne sait pas dessiner ni faire de son : Rovex le fait pour
// lui avec la clé API de l'utilisateur. Le prompt envoyé reprend le style du skill de la catégorie et les
// images de référence de la bibliothèque ; le résultat est rangé dans la bibliothèque (tag « ai »).
const fs = require('fs');
const path = require('path');
const db = require('./db');
const skills = require('./skills');

const IMAGE_PROVIDERS = ['openai', 'gemini'];
const DEFAULT_MODELS = { openai: 'gpt-image-1', gemini: 'gemini-2.5-flash-image' };
const SIZES = ['1024x1024', '1536x1024', '1024x1536'];

// Ce que l'on veut obtenir, et la catégorie dont on prend le style par défaut.
const IMAGE_KINDS = {
  icon: { cat: 'gui', format: 'A single game icon, centered, filling about 80% of the frame, readable at 64 px, no text, no frame, no background scene.', transparent: true },
  ui: { cat: 'gui', format: 'A game UI element (button, panel or frame), flat front view, clean edges, no text unless asked, usable as a Roblox ImageLabel.', transparent: true },
  thumbnail: { cat: 'gfx', format: 'A Roblox game thumbnail / GFX, dynamic composition, strong lighting, high contrast, 16:9 friendly framing.', transparent: false },
  texture: { cat: 'building', format: 'A seamless tileable texture, flat lighting, viewed straight on, no perspective, no shadows baked in.', transparent: false },
  vfx: { cat: 'vfx', format: 'A VFX sprite / particle texture: bright shape on a transparent background, soft edges, centered, no scene.', transparent: true },
  art: { cat: 'gfx', format: 'Concept art for a Roblox game.', transparent: false },
};
const SOUND_KINDS = ['sfx', 'music', 'voice'];

const err = (key, message, vars) => Object.assign(new Error(message), { key, vars, code: 400 });

function settings(state) {
  state.settings = state.settings || {};
  return (state.settings.gen = state.settings.gen || {});
}

function status(state) {
  const g = settings(state);
  const provider = IMAGE_PROVIDERS.includes(g.imageProvider) ? g.imageProvider : (g.openaiKey ? 'openai' : g.geminiKey ? 'gemini' : 'openai');
  return {
    image: { provider, ready: Boolean(provider === 'openai' ? g.openaiKey : g.geminiKey), model: g[provider + 'Model'] || DEFAULT_MODELS[provider] },
    sound: { provider: 'elevenlabs', ready: Boolean(g.elevenKey) },
    keys: { openai: Boolean(g.openaiKey), gemini: Boolean(g.geminiKey), elevenlabs: Boolean(g.elevenKey) },
    models: { openai: g.openaiModel || '', gemini: g.geminiModel || '' },
    defaults: DEFAULT_MODELS,
  };
}

// Images de référence : celles que l'utilisateur a choisies, sinon ses images (favoris d'abord) de la catégorie.
function references(state, { category, ids = [] }) {
  const local = (r) => r.type === 'image' && r.file && fs.existsSync(path.join(db.MEDIA_DIR, r.file));
  let refs = ids.length ? state.resources.filter((r) => ids.includes(r.id) && local(r)) : [];
  if (!refs.length && !ids.length) {
    refs = state.resources
      .filter((r) => local(r) && r.category === category && !(r.tags || []).includes('ai'))
      .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
      .slice(0, 3);
  }
  return refs.slice(0, 4).map((r) => {
    const ext = path.extname(r.file).slice(1).toLowerCase();
    return { id: r.id, title: r.title, notes: r.notes || '', mime: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png', data: fs.readFileSync(path.join(db.MEDIA_DIR, r.file)) };
  }).filter((r) => r.mime !== 'image/svg+xml');
}

function imagePrompt(state, { prompt, kind, category, transparent, refs, provider }) {
  const k = IMAGE_KINDS[kind] || IMAGE_KINDS.icon;
  const art = skills.getSkill(state, category).art;
  const parts = [String(prompt).trim(), '', `Style (Rovex ${category} skill): ${art}`, `Format: ${k.format}`];
  // Gemini ne sait pas faire de fond transparent : fond blanc uni, facile à détourer.
  if (transparent) parts.push(provider === 'gemini' ? 'Background: plain solid white, nothing else, so the subject can be cut out easily.' : 'Background: fully transparent (PNG with alpha).');
  if (refs.length) parts.push(`Match the art style of the ${refs.length} reference image(s) provided (${refs.map((r) => r.title + (r.notes ? ` — ${r.notes}` : '')).join('; ')}), but draw a new subject.`);
  return parts.join('\n');
}

async function readError(res, provider) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    msg = (j.error && (j.error.message || j.error.status)) || j.detail?.message || (typeof j.detail === 'string' ? j.detail : '') || msg;
  } catch {}
  return err('genFailed', `${provider}: ${String(msg).slice(0, 300)}`, { provider, msg: String(msg).slice(0, 300) });
}

async function openaiImages({ key, model, prompt, refs, size, transparent, n }) {
  let res;
  if (refs.length) {
    // Avec des références : endpoint « edits », qui accepte plusieurs images en entrée.
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('n', String(n));
    if (transparent) form.append('background', 'transparent');
    for (const r of refs) form.append('image[]', new Blob([r.data], { type: r.mime }), r.title.replace(/[^\w.-]+/g, '_') + '.' + r.mime.split('/')[1]);
    res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(240e3) });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, n, background: transparent ? 'transparent' : 'auto', output_format: 'png' }),
      signal: AbortSignal.timeout(240e3),
    });
  }
  if (!res.ok) throw await readError(res, 'OpenAI');
  const j = await res.json();
  return (j.data || []).filter((d) => d.b64_json).map((d) => Buffer.from(d.b64_json, 'base64'));
}

async function geminiImages({ key, model, prompt, refs, n }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const parts = [{ text: prompt }, ...refs.map((r) => ({ inline_data: { mime_type: r.mime, data: r.data.toString('base64') } }))];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
      signal: AbortSignal.timeout(180e3),
    });
    if (!res.ok) throw await readError(res, 'Gemini');
    const j = await res.json();
    for (const p of ((j.candidates || [])[0] || {}).content?.parts || []) {
      const d = p.inlineData || p.inline_data;
      if (d && d.data) out.push(Buffer.from(d.data, 'base64'));
    }
  }
  return out;
}

function save(state, buf, ext, meta) {
  fs.mkdirSync(db.MEDIA_DIR, { recursive: true });
  const slug = String(meta.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'asset';
  const file = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${slug}.${ext}`;
  fs.writeFileSync(path.join(db.MEDIA_DIR, file), buf);
  const isImg = ext === 'png' || ext === 'jpg';
  const { resource } = db.upsert(state, {
    title: meta.title, type: isImg ? 'image' : 'fichier', category: meta.category,
    tags: ['ai', meta.kind, meta.provider], file, thumbnail: isImg ? `/media/${file}` : '',
    description: meta.prompt, source: 'ai',
  }, { fresh: true });
  return { id: resource.id, title: resource.title, file, path: path.join(db.MEDIA_DIR, file), url: `/media/${file}` };
}

const titleOf = (prompt) => {
  const t = String(prompt).replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
};

async function generateImage(state, a = {}) {
  const prompt = String(a.prompt || '').trim();
  if (!prompt) throw err('genPrompt', 'Describe what to generate');
  const kind = IMAGE_KINDS[a.kind] ? a.kind : 'icon';
  const category = skills.SKILL_CATS.includes(a.category) ? a.category : IMAGE_KINDS[kind].cat;
  const transparent = a.transparent === undefined ? IMAGE_KINDS[kind].transparent : Boolean(a.transparent);
  const n = Math.max(1, Math.min(4, Number(a.count) || 1));
  const size = SIZES.includes(a.size) ? a.size : kind === 'thumbnail' ? '1536x1024' : '1024x1024';
  const g = settings(state);
  const st = status(state);
  const provider = IMAGE_PROVIDERS.includes(a.provider) ? a.provider : st.image.provider;
  const key = provider === 'openai' ? g.openaiKey : g.geminiKey;
  const label = provider === 'openai' ? 'OpenAI' : 'Google Gemini';
  if (!key) throw err('genNoKey', `Add your ${label} API key in Rovex Hub → AI Studio`, { provider: label });
  const model = g[provider + 'Model'] || DEFAULT_MODELS[provider];
  const refs = a.use_references === false ? [] : references(state, { category, ids: Array.isArray(a.reference_ids) ? a.reference_ids : [] });
  const finalPrompt = imagePrompt(state, { prompt, kind, category, transparent, refs, provider });
  const images = provider === 'openai'
    ? await openaiImages({ key, model, prompt: finalPrompt, refs, size, transparent, n })
    : await geminiImages({ key, model, prompt: finalPrompt, refs, n });
  if (!images.length) throw err('genEmpty', `${provider}: no image returned`);
  const title = a.title ? String(a.title).slice(0, 80) : titleOf(prompt);
  const items = images.map((buf, i) => save(state, buf, 'png', { title: images.length > 1 ? `${title} (${i + 1})` : title, category, kind, provider, prompt }));
  return {
    kind: 'image', category, provider, model, size, transparent,
    prompt: finalPrompt, references: refs.map((r) => r.title), items,
    images, // tampons bruts, retirés avant la réponse MCP (aperçu pour Claude)
  };
}

async function generateSound(state, a = {}) {
  const prompt = String(a.prompt || a.text || '').trim();
  if (!prompt) throw err('genPrompt', 'Describe what to generate');
  const kind = SOUND_KINDS.includes(a.kind) ? a.kind : 'sfx';
  const g = settings(state);
  if (!g.elevenKey) throw err('genNoKey', 'Add your ElevenLabs API key in Rovex Hub → AI Studio', { provider: 'ElevenLabs' });
  const headers = { 'xi-api-key': g.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
  const art = skills.getSkill(state, 'audio').art;
  let res;
  if (kind === 'sfx') {
    const seconds = Number(a.seconds) ? Math.max(0.5, Math.min(22, Number(a.seconds))) : undefined;
    res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST', headers,
      body: JSON.stringify({ text: `${prompt}. ${art}`, ...(seconds && { duration_seconds: seconds }), prompt_influence: 0.45 }),
      signal: AbortSignal.timeout(120e3),
    });
  } else if (kind === 'music') {
    const ms = Math.round(Math.max(10, Math.min(300, Number(a.seconds) || 30)) * 1000);
    res = await fetch('https://api.elevenlabs.io/v1/music', {
      method: 'POST', headers,
      body: JSON.stringify({ prompt: `${prompt}. Video game background music for a Roblox game, loopable.`, music_length_ms: ms }),
      signal: AbortSignal.timeout(300e3),
    });
  } else {
    const voice = String(a.voice_id || g.elevenVoice || 'JBFqnCBsd6RMkjVDRZzb').replace(/[^\w-]/g, '');
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: 'POST', headers,
      body: JSON.stringify({ text: prompt, model_id: 'eleven_multilingual_v2' }),
      signal: AbortSignal.timeout(120e3),
    });
  }
  if (!res.ok) throw await readError(res, 'ElevenLabs');
  const buf = Buffer.from(await res.arrayBuffer());
  const title = a.title ? String(a.title).slice(0, 80) : titleOf(prompt);
  const item = save(state, buf, 'mp3', { title, category: 'audio', kind, provider: 'elevenlabs', prompt });
  return { kind, category: 'audio', provider: 'elevenlabs', prompt, items: [item], note: 'MP3 file. Upload it to Roblox (Creator Hub or Studio Asset Manager) to get its rbxassetid.' };
}

// Les créations IA, les plus récentes d'abord.
function items(state, limit = 60) {
  return state.resources.filter((r) => r.source === 'ai').slice(0, limit);
}

module.exports = { status, settings, generateImage, generateSound, items, IMAGE_KINDS, SOUND_KINDS, DEFAULT_MODELS, SIZES };
