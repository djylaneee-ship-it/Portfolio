// Rovex Hub : génération d'images (OpenAI) et de sons (ElevenLabs) pour tous les membres, avec les clés
// de l'admin gardées en secrets Supabase. L'app envoie l'ID d'accès du membre ; on vérifie l'ID et sa
// limite du jour avant d'appeler le service, puis on décompte ce qui a été généré.
// Secrets à créer : OPENAI_API_KEY (images) et, si tu veux les sons, ELEVENLABS_API_KEY.
import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding@1/base64';

const OPENAI = Deno.env.get('OPENAI_API_KEY') ?? '';
const ELEVEN = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const DB = Deno.env.get('SUPABASE_URL') ?? '';
const DB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const IMAGE_MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-1';

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
    msg = j?.error?.message ?? j?.detail?.message ?? (typeof j?.detail === 'string' ? j.detail : msg);
  } catch { /* corps vide */ }
  return json({ error: `${name}: ${String(msg).slice(0, 300)}`, key: 'genFailed', vars: { provider: name, msg: String(msg).slice(0, 300) } }, 502);
}

type Ref = { b64: string; mime: string; name: string };

async function image(b: Record<string, unknown>) {
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
  return { images: (j.data ?? []).map((d: { b64_json?: string }) => d.b64_json).filter(Boolean), model: IMAGE_MODEL };
}

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
  if (req.method === 'GET') return json({ image: Boolean(OPENAI), sound: Boolean(ELEVEN), model: IMAGE_MODEL });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const b = await req.json();
    const what = b.type === 'sound' ? 'sound' : 'image';
    if (what === 'image' && !OPENAI) return json({ error: 'Shared image generation is not set up', key: 'genShared' }, 503);
    if (what === 'sound' && !ELEVEN) return json({ error: 'Shared sound generation is not set up', key: 'genShared' }, 503);
    if (!String(b.prompt || '').trim()) return json({ error: 'Describe what to generate', key: 'genPrompt' }, 400);
    const n = what === 'image' ? Math.max(1, Math.min(4, Number(b.n) || 1)) : 1;
    const allow = await rpc('rovex_gen_allow', { p_code: String(b.code || ''), p_kind: what, p_n: n, p_commit: false });
    if (!allow.ok) return json({ error: allow.err, key: allow.err, vars: { limit: allow.limit, used: allow.used } }, allow.err === 'genQuota' ? 429 : 401);
    const out = what === 'image' ? await image(b) : await sound(b);
    if ('error' in out && out.error) return out.error;
    const made = what === 'image' ? (out as { images: string[] }).images.length : 1;
    const used = await rpc('rovex_gen_allow', { p_code: String(b.code), p_kind: what, p_n: made, p_commit: true });
    return json({ ...out, quota: { limit: used.limit, used: used.used, unlimited: used.unlimited } });
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 300) }, 500);
  }
});
