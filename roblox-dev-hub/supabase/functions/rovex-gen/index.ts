// Rovex Hub : génération d'images (OpenAI), de texte (Groq, ou Gemini en secours, pour améliorer les prompts) et de sons
// (ElevenLabs) pour tous les membres, avec les clés de l'admin gardées en secrets Supabase. L'app envoie
// l'ID d'accès du membre ; on vérifie l'ID et sa limite du jour avant d'appeler le service, puis on décompte.
// Secrets : GROQ_API_KEY (prompts améliorés ; GEMINI_API_KEY en secours), ELEVENLABS_API_KEY (sons, facultatif).
// Images GRATUITES : Cloudflare Workers AI (FLUX) si CF_ACCOUNT_ID + CF_API_TOKEN, sinon Pollinations (sans clé ;
// POLLINATIONS_KEY facultatif, gratuit, enlève la limite). OpenAI (payant) seulement avec IMAGE_PROVIDER=openai.
// GROQ_MODEL facultatif pour choisir le modèle Groq.
import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64';

const OPENAI = Deno.env.get('OPENAI_API_KEY') ?? '';
const ELEVEN = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const GEMINI = Deno.env.get('GEMINI_API_KEY') ?? '';
const GROQ = Deno.env.get('GROQ_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest';
const GROQ_MODEL = Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-120b';
const TEXT_MODEL = GROQ ? GROQ_MODEL : GEMINI_MODEL;
const DB = Deno.env.get('SUPABASE_URL') ?? '';
const DB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const IMAGE_MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-1';
const CF_ACCOUNT = Deno.env.get('CF_ACCOUNT_ID') ?? '';
const CF_TOKEN = Deno.env.get('CF_API_TOKEN') ?? '';
const CF_MODEL = Deno.env.get('CF_IMAGE_MODEL') ?? '@cf/black-forest-labs/flux-1-schnell';
const POLL_KEY = Deno.env.get('POLLINATIONS_KEY') ?? '';
const POLL_MODEL = Deno.env.get('POLLINATIONS_MODEL') ?? '';
// Qui fait les images : OpenAI seulement si on le demande (payant), sinon Cloudflare (gratuit, avec compte), sinon Pollinations.
const PROVIDER = Deno.env.get('IMAGE_PROVIDER') === 'openai' && OPENAI ? 'openai' : CF_ACCOUNT && CF_TOKEN ? 'cloudflare' : 'pollinations';
const PROVIDER_MODEL = PROVIDER === 'openai' ? IMAGE_MODEL : PROVIDER === 'cloudflare' ? CF_MODEL.split('/').pop() : `pollinations${POLL_MODEL ? '/' + POLL_MODEL : ''}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${DB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: DB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`database HTTP ${r.status}`);
  return r.json();
}

async function providerError(res: Response, name: string) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    // Cloudflare : { errors: [{ code, message }] } (ex. 7003 = Account ID invalide, 10000 = jeton refusé).
    const cf = Array.isArray(j?.errors) && j.errors[0] ? `${j.errors[0].message ?? ''} (code ${j.errors[0].code ?? '?'})` : null;
    msg = j?.error?.message ?? cf ?? j?.detail?.message ?? (typeof j?.detail === 'string' ? j.detail : msg);
  } catch { /* corps vide */ }
  return json({ error: `${name}: ${String(msg).slice(0, 300)}`, key: 'genFailed', vars: { provider: name, msg: String(msg).slice(0, 300) } }, 502);
}

type Ref = { b64: string; mime: string; name: string };

// Images gratuites : une image par appel, fond uni (l'app détoure les icônes elle-même).
async function cloudflareImage(prompt: string, seed: number) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${CF_MODEL}`, {
    method: 'POST', headers: { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 8, seed }),
  });
  if (!res.ok) return { error: await providerError(res, 'Cloudflare') };
  const j = await res.json();
  const img = j?.result?.image;
  return img ? { image: String(img) } : { error: json({ error: 'Cloudflare returned no image', key: 'genEmpty' }, 502) };
}

async function pollinationsImage(prompt: string, seed: number, size: string) {
  const [w, h] = size.split('x').map(Number);
  const q = new URLSearchParams({ width: String(w), height: String(h), seed: String(seed), nologo: 'true', private: 'true', enhance: 'false', ...(POLL_MODEL ? { model: POLL_MODEL } : {}) });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?${q}`;
  let res: Response | null = null;
  // Sans clé : service gratuit souvent saturé (« Classic API at its limit »). On attend et on réessaie.
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: POLL_KEY ? { Authorization: `Bearer ${POLL_KEY}` } : {} });
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) return { image: encodeBase64(new Uint8Array(await res.arrayBuffer())) };
    if (![429, 500, 502, 503].includes(res.status)) break;
    await res.body?.cancel();
    await sleep(8000 * (attempt + 1));
  }
  return { error: await providerError(res!, 'Pollinations') };
}

async function freeImages(b: Record<string, unknown>) {
  const n = Math.max(1, Math.min(4, Number(b.n) || 1));
  const size = ['1024x1024', '1536x1024', '1024x1536'].includes(String(b.size)) ? String(b.size) : '1024x1024';
  const images: string[] = [];
  for (let i = 0; i < n; i++) {
    const seed = Math.floor(Math.random() * 1e9);
    const out = PROVIDER === 'cloudflare' ? await cloudflareImage(String(b.prompt), seed) : await pollinationsImage(String(b.prompt), seed, size);
    if ('error' in out) { if (images.length) break; return out; }
    images.push(out.image);
  }
  return { images, model: PROVIDER_MODEL, transparent: false };
}

async function image(b: Record<string, unknown>) {
  if (PROVIDER !== 'openai') return freeImages(b);
  const n = Math.max(1, Math.min(4, Number(b.n) || 1));
  const size = ['1024x1024', '1536x1024', '1024x1536'].includes(String(b.size)) ? String(b.size) : '1024x1024';
  const refs = (Array.isArray(b.refs) ? b.refs : []).slice(0, 3) as Ref[];
  let res: Response;
  if (refs.length) {
    const form = new FormData();
    form.append('model', IMAGE_MODEL);
    form.append('prompt', String(b.prompt));
    form.append('size', size);
    form.append('n', String(n));
    if (b.transparent) form.append('background', 'transparent');
    for (const r of refs) form.append('image[]', new Blob([decodeBase64(r.b64)], { type: r.mime }), r.name || 'reference.png');
    res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI}` }, body: form });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt: String(b.prompt), size, n, background: b.transparent ? 'transparent' : 'auto', output_format: 'png' }),
    });
  }
  if (!res.ok) return { error: await providerError(res, 'OpenAI') };
  const j = await res.json();
  return { images: (j.data ?? []).map((d: { b64_json?: string }) => d.b64_json).filter(Boolean), model: IMAGE_MODEL, transparent: Boolean(b.transparent) };
}

// Texte : l'app envoie les consignes (system) et la demande. Groq d'abord (gratuit et rapide), Gemini si
// aucune clé Groq n'est configurée. Si un modèle est surchargé ou limité, on réessaie puis on passe au suivant.
const GROQ_MODELS = [...new Set([GROQ_MODEL, 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'groq/compound'])];
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'])];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function groqText(b: Record<string, unknown>) {
  let last: Response | null = null;
  for (const model of GROQ_MODELS) {
    // Les modèles gpt-oss raisonnent avant de répondre : effort réduit pour aller vite et rester sous les limites gratuites.
    const extra = model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {};
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: String(b.system || '').slice(0, 30000) },
            { role: 'user', content: String(b.prompt).slice(0, 8000) },
          ],
          temperature: 0.5,
          max_completion_tokens: 3000,
          ...(attempt === 0 ? extra : {}),
        }),
      });
      if (res.ok) {
        const j = await res.json();
        const out = String(j.choices?.[0]?.message?.content ?? '').trim();
        if (out) return { text: out, model };
        break; // réponse vide : modèle suivant
      }
      last = res;
      if (res.status === 400 && attempt === 0 && Object.keys(extra).length) continue; // option refusée : on réessaie sans
      if ([400, 404, 413].includes(res.status)) break; // modèle inconnu, refusé ou demande trop grande : modèle suivant
      if (![429, 500, 502, 503].includes(res.status)) return { error: await providerError(res, 'Groq') };
      await sleep(1500 * (attempt + 1)); // limite ou surcharge : on attend un peu et on réessaie
    }
  }
  return { error: last ? await providerError(last, 'Groq') : json({ error: 'Groq returned nothing', key: 'genEmpty' }, 502) };
}

async function geminiText(b: Record<string, unknown>) {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: String(b.system || '').slice(0, 60000) }] },
    contents: [{ role: 'user', parts: [{ text: String(b.prompt).slice(0, 8000) }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 8192 },
  });
  let last: Response | null = null;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': GEMINI, 'Content-Type': 'application/json' }, body,
      });
      if (res.ok) {
        const j = await res.json();
        const out = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
        if (out) return { text: out, model };
        break; // réponse vide : modèle suivant
      }
      last = res;
      if (res.status === 404 || res.status === 400) break; // modèle inconnu ou refusé : modèle suivant
      if (![429, 500, 503].includes(res.status)) return { error: await providerError(res, 'Gemini') };
      await sleep(1500 * (attempt + 1)); // surcharge : on attend un peu et on réessaie
    }
  }
  return { error: last ? await providerError(last, 'Gemini') : json({ error: 'Gemini returned nothing', key: 'genEmpty' }, 502) };
}

const text = (b: Record<string, unknown>) => (GROQ ? groqText(b) : geminiText(b));

async function sound(b: Record<string, unknown>) {
  const headers = { 'xi-api-key': ELEVEN, 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
  const kind = String(b.kind || 'sfx');
  let res: Response;
  if (kind === 'music') {
    const ms = Math.round(Math.max(10, Math.min(300, Number(b.seconds) || 30)) * 1000);
    res = await fetch('https://api.elevenlabs.io/v1/music', { method: 'POST', headers, body: JSON.stringify({ prompt: String(b.prompt), music_length_ms: ms }) });
  } else if (kind === 'voice') {
    const voice = String(b.voice_id || 'JBFqnCBsd6RMkjVDRZzb').replace(/[^\w-]/g, '');
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, { method: 'POST', headers, body: JSON.stringify({ text: String(b.prompt), model_id: 'eleven_multilingual_v2' }) });
  } else {
    const seconds = Number(b.seconds) ? Math.max(0.5, Math.min(22, Number(b.seconds))) : undefined;
    res = await fetch('https://api.elevenlabs.io/v1/sound-generation', { method: 'POST', headers, body: JSON.stringify({ text: String(b.prompt), ...(seconds && { duration_seconds: seconds }), prompt_influence: 0.45 }) });
  }
  if (!res.ok) return { error: await providerError(res, 'ElevenLabs') };
  return { audio: encodeBase64(new Uint8Array(await res.arrayBuffer())) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  // L'app demande ce qui est disponible.
  if (req.method === 'GET') return json({ image: true, imageProvider: PROVIDER, refs: PROVIDER === 'openai', sound: Boolean(ELEVEN), text: Boolean(GROQ || GEMINI), model: PROVIDER_MODEL, textModel: TEXT_MODEL });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const b = await req.json();
    const what = b.type === 'sound' ? 'sound' : b.type === 'text' ? 'text' : 'image';
    if (what === 'sound' && !ELEVEN) return json({ error: 'Shared sound generation is not set up', key: 'genShared' }, 503);
    if (what === 'text' && !GROQ && !GEMINI) return json({ error: 'Prompt improvement is not set up', key: 'genShared' }, 503);
    if (!String(b.prompt || '').trim()) return json({ error: 'Describe what to generate', key: 'genPrompt' }, 400);
    const n = what === 'image' ? Math.max(1, Math.min(4, Number(b.n) || 1)) : 1;
    const allow = await rpc('rovex_gen_allow', { p_code: String(b.code || ''), p_kind: what, p_n: n, p_commit: false });
    if (!allow.ok) return json({ error: allow.err, key: allow.err, vars: { limit: allow.limit, used: allow.used } }, allow.err === 'genQuota' ? 429 : 401);
    const out = what === 'image' ? await image(b) : what === 'text' ? await text(b) : await sound(b);
    if ('error' in out && out.error) return out.error;
    const made = what === 'image' ? (out as { images: string[] }).images.length : 1;
    const used = await rpc('rovex_gen_allow', { p_code: String(b.code), p_kind: what, p_n: made, p_commit: true });
    return json({ ...out, quota: { limit: used.limit, used: used.used, unlimited: used.unlimited } });
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 300) }, 500);
  }
});
