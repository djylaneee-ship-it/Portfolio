// Popverse Team — lien avec les jeux Roblox.
// Actions (POST JSON { action, ... }) :
//   resolve  { place_id }          → universe_id, nom, description, icône (membres connectés)
//   refresh  { project_id? }       → prend un instantané des stats publiques (joueurs, visites, favoris, votes)
//                                    pour un projet ou tous ; membres connectés ou en-tête x-pt-cron = PT_CRON_SECRET
//   site     { url }               → lit le site du studio et liste les jeux Roblox trouvés (membres connectés)
//   ingest   { key, job_id, … }    → envoyé PAR LE JEU (script Luau) : serveur en direct + évènements. Pas de compte :
//                                    la clé d'envoi du projet (pt_projects.ingest_key) sert de mot de passe.
// Déployer avec « Verify JWT » désactivé : la fonction vérifie elle-même qui l'appelle.
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pt-cron',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const UA = { 'User-Agent': 'PopverseTeam/1.0 (+stats)', Accept: 'application/json' };

async function getJson(url: string) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Roblox ${r.status} sur ${new URL(url).host}`);
  return r.json();
}

async function isMember(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return false;
  const { data } = await admin.from('pt_profiles').select('role').eq('id', user.id).maybeSingle();
  return !!data && ['owner', 'admin', 'member'].includes(data.role);
}

async function universeOf(placeId: number): Promise<number> {
  const j = await getJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  if (!j.universeId) throw new Error('Jeu introuvable sur Roblox (place ' + placeId + ').');
  return j.universeId;
}

async function gameInfo(universeIds: number[]) {
  if (!universeIds.length) return new Map();
  const ids = universeIds.join(',');
  const [games, votes, icons] = await Promise.all([
    getJson(`https://games.roblox.com/v1/games?universeIds=${ids}`),
    getJson(`https://games.roblox.com/v1/games/votes?universeIds=${ids}`).catch(() => ({ data: [] })),
    getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids}&size=512x512&format=Png&isCircular=false`).catch(() => ({ data: [] })),
  ]);
  const out = new Map<number, any>();
  for (const g of games.data || []) out.set(g.id, { ...g });
  for (const v of votes.data || []) Object.assign(out.get(v.id) || {}, { upVotes: v.upVotes, downVotes: v.downVotes });
  for (const i of icons.data || []) Object.assign(out.get(i.targetId) || {}, { icon: i.imageUrl });
  return out;
}

async function refresh(projectId?: string) {
  let q = admin.from('pt_projects').select('id,roblox_place_id,roblox_universe_id').not('roblox_place_id', 'is', null).eq('archived', false);
  if (projectId) q = q.eq('id', projectId);
  const { data: projects, error } = await q;
  if (error) throw error;
  // Complète les universe_id manquants.
  for (const p of projects || []) {
    if (!p.roblox_universe_id) {
      try { p.roblox_universe_id = await universeOf(p.roblox_place_id); await admin.from('pt_projects').update({ roblox_universe_id: p.roblox_universe_id }).eq('id', p.id); } catch (e) { console.warn(e); }
    }
  }
  const list = (projects || []).filter(p => p.roblox_universe_id);
  if (!list.length) return [];
  // Pas plus d'un instantané par minute et par jeu.
  const since = new Date(Date.now() - 55_000).toISOString();
  const { data: recent } = await admin.from('pt_game_stats').select('project_id').in('project_id', list.map(p => p.id)).gte('at', since);
  const fresh = new Set((recent || []).map(r => r.project_id));
  const todo = list.filter(p => !fresh.has(p.id));
  if (todo.length) {
    const info = await gameInfo(todo.map(p => p.roblox_universe_id));
    const rows = todo.map(p => {
      const g = info.get(p.roblox_universe_id);
      return g && { project_id: p.id, playing: g.playing ?? 0, visits: g.visits ?? 0, favorites: g.favoritedCount ?? 0, likes: g.upVotes ?? null, dislikes: g.downVotes ?? null, max_players: g.maxPlayers ?? null };
    }).filter(Boolean);
    if (rows.length) await admin.from('pt_game_stats').insert(rows);
  }
  // Ménage : les serveurs muets depuis 10 min ne sont plus en ligne.
  await admin.from('pt_game_servers').delete().lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString());
  return todo.map(p => p.id);
}

async function readSite(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 PopverseTeam', Accept: 'text/html' } });
  if (!r.ok) throw new Error(`Le site répond ${r.status}`);
  const html = await r.text();
  const ids = [...new Set([...html.matchAll(/roblox\.com\/(?:[a-z]{2}\/)?games\/(\d{4,})/gi)].map(m => Number(m[1])))].slice(0, 30);
  const games: any[] = [];
  const uni = new Map<number, number>();
  for (const id of ids) { try { uni.set(id, await universeOf(id)); } catch { /* lien mort */ } }
  const info = await gameInfo([...uni.values()]);
  for (const id of ids) {
    const u = uni.get(id);
    const g = u ? info.get(u) : null;
    games.push({ place_id: id, universe_id: u || null, name: g?.name || null, description: g?.description || '', icon: g?.icon || null, playing: g?.playing ?? null, visits: g?.visits ?? null, url: `https://www.roblox.com/games/${id}` });
  }
  return games;
}

async function ingest(b: any) {
  if (!b.key || !/^[0-9a-f-]{36}$/i.test(b.key)) return json({ error: 'clé manquante' }, 401);
  const { data: p } = await admin.from('pt_projects').select('id').eq('ingest_key', b.key).maybeSingle();
  if (!p) return json({ error: 'clé inconnue' }, 401);
  const job = String(b.job_id || 'studio').slice(0, 80);
  if (b.closing) await admin.from('pt_game_servers').delete().eq('project_id', p.id).eq('job_id', job);
  else await admin.from('pt_game_servers').upsert({
    project_id: p.id, job_id: job, place_version: b.place_version ?? null, players: Math.max(0, Number(b.players) || 0), max_players: b.max_players ?? null,
    fps: b.fps ?? null, ping: b.ping ?? null, uptime: b.uptime ?? null, data: b.data && typeof b.data === 'object' ? b.data : {}, updated_at: new Date().toISOString(),
  });
  const events = (Array.isArray(b.events) ? b.events : []).slice(0, 200).map((e: any) => ({
    project_id: p.id, kind: String(e.kind || 'event').slice(0, 40), job_id: job, user_id: Number(e.user_id) || null,
    value: Number.isFinite(Number(e.value)) ? Number(e.value) : null, data: e.data && typeof e.data === 'object' ? e.data : {},
  }));
  if (events.length) await admin.from('pt_game_events').insert(events);
  return json({ ok: true });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === 'ingest') return await ingest(b);
    const cron = Deno.env.get('PT_CRON_SECRET');
    const fromCron = !!cron && req.headers.get('x-pt-cron') === cron;
    if (!fromCron && !(await isMember(req))) return json({ error: 'Réservé aux membres de l\'équipe.' }, 401);

    if (b.action === 'resolve') {
      const placeId = Number(b.place_id);
      if (!placeId) return json({ error: 'place_id manquant' }, 400);
      const u = await universeOf(placeId);
      const g = (await gameInfo([u])).get(u) || {};
      return json({ universe_id: u, name: g.name, description: g.description, icon: g.icon, playing: g.playing, visits: g.visits, max_players: g.maxPlayers, created: g.created, updated: g.updated, creator: g.creator });
    }
    if (b.action === 'refresh') return json({ ok: true, refreshed: await refresh(b.project_id) });
    if (b.action === 'site') return json({ games: await readSite(String(b.url || 'https://popversestudio.com')) });
    return json({ error: 'action inconnue' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
