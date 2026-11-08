// Popverse Team — Copilot IA.
// Rassemble tout ce que l'équipe sait d'un jeu (lore, tâches, tableaux, progrès, stats) et le donne au modèle,
// qui répond en markdown et peut proposer des actions (créer des tâches, une page de lore, compléter une carte…).
// Fournisseur : Claude si ANTHROPIC_API_KEY est défini dans les secrets Supabase, sinon Groq (GROQ_API_KEY).
// Modèles réglables : ANTHROPIC_MODEL (défaut claude-sonnet-5-5), GROQ_MODEL (défaut openai/gpt-oss-120b).
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const strip = (html: string) => (html || '').replace(/<(br|\/p|\/div|\/h\d|\/li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!user) return json({ error: 'Connecte-toi pour utiliser le Copilot.' }, 401);
    const { data: me } = await sb.from('pt_profiles').select('*').eq('id', user.id).maybeSingle();
    if (!me || !['owner', 'admin', 'member'].includes(me.role)) return json({ error: 'Réservé aux membres de l\'équipe.' }, 403);

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode || 'chat';
    const projectId: string | null = body.project_id || null;
    const context = await buildContext(sb, projectId);

    const people = (await sb.from('pt_profiles').select('id,display_name,title,role')).data || [];
    const system = [
      `Tu es « Copilot », l'assistant IA de Popverse Studio, un studio de jeux Roblox. Tu travailles dans l'app interne Popverse Team.`,
      `Tu parles à ${me.display_name} (${me.title || me.role}). Réponds en français, de façon concrète et structurée (markdown : titres courts, listes).`,
      `Tu connais le jeu par cœur grâce au CONTEXTE ci-dessous (lore, tâches, tableaux, progrès, stats). Appuie-toi dessus, cite les éléments existants, ne contredis pas le lore. Si une info manque, dis-le et propose.`,
      `Tu es expert Roblox : Luau, Roblox Studio, DataStores, RemoteEvents, MarketplaceService, monétisation, rétention, game design de simulators/tycoons/obbys/RPG, optimisation.`,
      `Membres de l'équipe : ${people.map(p => `${p.display_name} (${p.title || p.role}, id ${p.id})`).join('; ')}.`,
      ``,
      `Tu réponds TOUJOURS par un objet JSON valide : {"reply": "<markdown>", "actions": [ ... ]}.`,
      `Actions possibles (seulement si utile, sinon []) :`,
      `- {"type":"create_tasks","tasks":[{"title":"","description":"markdown","priority":"urgent|high|medium|low","labels":["Script|Build|UI|VFX|Animation|Bug|Game design"],"checklist":["étape"],"assignee":"id de membre ou null","due_in_days":nombre ou null}]} — pour découper un travail en tâches.`,
      `- {"type":"create_lore","title":"","category":"histoire|personnages|lieux|objets|mecaniques|factions|autre","icon":"emoji","html":"<p>…</p>"} — pour créer une page de lore.`,
      mode === 'card' ? `- {"type":"update_card","description":"markdown","checklist":["étape"]} — pour compléter la carte demandée (OBLIGATOIRE dans ce mode).` : '',
      mode === 'lore' ? `- {"type":"append_lore","html":"<h2>…</h2><p>…</p>"} — texte à ajouter à la page de lore demandée (OBLIGATOIRE dans ce mode, HTML simple : h2, h3, p, ul, li, b, i, blockquote).` : '',
      `Ne propose des tâches que si on te le demande ou si c'est clairement utile. Les descriptions de tâches doivent être actionnables (fichiers, services Roblox, critères de fin).`,
      ``,
      `=== CONTEXTE ===`,
      context,
    ].filter(Boolean).join('\n');

    const messages: { role: 'user' | 'assistant'; content: string }[] = [];
    if (mode === 'chat') {
      for (const m of (body.history || []).slice(-16)) if (m?.content && (m.role === 'user' || m.role === 'assistant')) messages.push({ role: m.role, content: cut(String(m.content), 6000) });
      messages.push({ role: 'user', content: cut(String(body.message || ''), 8000) });
    } else if (mode === 'card') {
      const c = body.card || {};
      messages.push({ role: 'user', content: `Complète cette tâche : rédige une description claire et actionnable (objectif, étapes techniques Roblox, critères de fin) et une checklist de 3 à 8 étapes.\nTitre : ${c.title}\nDescription actuelle : ${c.description || '(vide)'}\nÉtiquettes : ${(c.labels || []).join(', ')}\nChecklist actuelle : ${(c.checklist || []).map((x: any) => x.text || x).join(' / ')}\n${body.instruction ? 'Consigne : ' + body.instruction : ''}` });
    } else if (mode === 'lore') {
      const p = body.page || {};
      messages.push({ role: 'user', content: `Développe cette page de lore en restant cohérent avec tout le reste du lore.\nTitre : ${p.title}\nCatégorie : ${p.category}\nContenu actuel :\n${cut(p.content_text || '', 6000) || '(vide)'}\n${body.instruction ? 'Consigne : ' + body.instruction : 'Ajoute la suite la plus utile (détails, histoire, liens avec les autres éléments).'}` });
    } else {
      messages.push({ role: 'user', content: cut(String(body.message || ''), 8000) });
    }

    const raw = await complete(system, messages);
    const out = parse(raw);
    return json(out);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});

async function buildContext(sb: any, projectId: string | null): Promise<string> {
  const parts: string[] = [];
  const { data: projects } = await sb.from('pt_projects').select('id,name,description,genre,status,roblox_url').eq('archived', false);
  parts.push('Jeux du studio : ' + (projects || []).map((p: any) => `${p.name} [${p.status}${p.genre ? ', ' + p.genre : ''}]${p.description ? ' — ' + cut(p.description, 160) : ''}`).join(' | '));
  if (!projectId) return parts.join('\n');

  const p = (projects || []).find((x: any) => x.id === projectId) || (await sb.from('pt_projects').select('*').eq('id', projectId).maybeSingle()).data;
  if (!p) return parts.join('\n');
  const [lists, cards, lore, posts, boards, stats, people] = await Promise.all([
    sb.from('pt_lists').select('id,name,is_done').eq('project_id', projectId).order('position'),
    sb.from('pt_cards').select('title,description,list_id,priority,labels,assignees,due_at,done,checklist').eq('project_id', projectId).eq('archived', false).limit(250),
    sb.from('pt_lore').select('title,category,content,tags').eq('project_id', projectId).order('position'),
    sb.from('pt_posts').select('kind,title,body,created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(12),
    sb.from('pt_boards').select('id,name').eq('project_id', projectId),
    sb.from('pt_game_stats').select('playing,visits,favorites,likes,dislikes,at').eq('project_id', projectId).order('at', { ascending: false }).limit(1),
    sb.from('pt_profiles').select('id,display_name'),
  ]);
  const names = new Map((people.data || []).map((x: any) => [x.id, x.display_name]));
  parts.push(`\n## JEU ACTUEL : ${p.name}\nStatut : ${p.status}. Genre : ${p.genre || '?'}. ${p.description || ''} ${p.roblox_url ? 'Lien : ' + p.roblox_url : ''}`);

  let loreText = '';
  for (const l of lore.data || []) loreText += `\n### [${l.category}] ${l.title}${l.tags?.length ? ' (' + l.tags.join(', ') + ')' : ''}\n${strip(l.content)}\n`;
  parts.push('\n## LORE' + (loreText ? cut(loreText, 40000) : '\n(aucun lore écrit pour l\'instant)'));

  const listName = new Map((lists.data || []).map((l: any) => [l.id, l.name]));
  const done = new Set((lists.data || []).filter((l: any) => l.is_done).map((l: any) => l.id));
  let taskText = '';
  for (const c of cards.data || []) {
    const ck = Array.isArray(c.checklist) && c.checklist.length ? ` [checklist ${c.checklist.filter((x: any) => x.done).length}/${c.checklist.length}]` : '';
    taskText += `\n- (${listName.get(c.list_id) || '?'}${c.done || done.has(c.list_id) ? ', fini' : ''}) ${c.title}${c.priority ? ' !' + c.priority : ''}${c.labels?.length ? ' #' + c.labels.join(' #') : ''}${c.assignees?.length ? ' @' + c.assignees.map((a: string) => names.get(a) || '?').join(' @') : ''}${c.due_at ? ' échéance ' + c.due_at.slice(0, 10) : ''}${ck}${c.description ? ' — ' + cut(c.description.replace(/\s+/g, ' '), 200) : ''}`;
  }
  parts.push(`\n## TÂCHES (colonnes : ${(lists.data || []).map((l: any) => l.name).join(' → ')})` + (taskText ? cut(taskText, 20000) : '\n(aucune tâche)'));

  if ((boards.data || []).length) {
    const ids = boards.data.map((b: any) => b.id);
    const { data: items } = await sb.from('pt_board_items').select('board_id,kind,data').in('board_id', ids).limit(600);
    const bname = new Map(boards.data.map((b: any) => [b.id, b.name]));
    let bt = '';
    for (const it of items || []) {
      const d = it.data || {};
      const t = strip(d.html || d.text || d.title || d.label || d.url || (Array.isArray(d.items) ? d.items.map((x: any) => x.text).join(', ') : '') || (Array.isArray(d.rows) ? d.rows.map((r: any) => r.join(' | ')).join(' / ') : ''));
      if (t) bt += `\n- [${bname.get(it.board_id)} · ${it.kind}] ${cut(t.replace(/\s+/g, ' '), 300)}`;
    }
    if (bt) parts.push('\n## TABLEAUX VISUELS (notes, idées, structure)' + cut(bt, 12000));
  }
  if ((posts.data || []).length) parts.push('\n## DERNIERS PROGRÈS' + posts.data.map((x: any) => `\n- ${x.created_at.slice(0, 10)} [${x.kind}] ${x.title ? x.title + ' : ' : ''}${cut((x.body || '').replace(/\s+/g, ' '), 300)}`).join(''));
  const s = stats.data?.[0];
  if (s) parts.push(`\n## STATS ROBLOX (${s.at.slice(0, 16)})\nJoueurs en jeu : ${s.playing}, visites : ${s.visits}, favoris : ${s.favorites}, votes : ${s.likes} 👍 / ${s.dislikes} 👎`);
  return parts.join('\n');
}

async function complete(system: string, messages: { role: string; content: string }[]): Promise<string> {
  const anthropic = Deno.env.get('ANTHROPIC_API_KEY');
  if (anthropic) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropic, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5', max_tokens: 4096, system: system + '\n\nRéponds uniquement avec le JSON, sans texte autour.', messages }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Claude : ' + (j?.error?.message || r.status));
    return (j.content || []).map((c: any) => c.text || '').join('');
  }
  const groq = Deno.env.get('GROQ_API_KEY');
  if (!groq) throw new Error('Aucune clé IA : ajoute GROQ_API_KEY (gratuit sur console.groq.com) ou ANTHROPIC_API_KEY dans Supabase > Edge Functions > Secrets.');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groq}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b',
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_completion_tokens: 6000,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Groq : ' + (j?.error?.message || r.status));
  return j.choices?.[0]?.message?.content || '';
}

function parse(raw: string): { reply: string; actions: unknown[] } {
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  let o = tryParse(raw);
  if (!o) { const m = raw.match(/\{[\s\S]*\}/); if (m) o = tryParse(m[0]); }
  if (!o || typeof o !== 'object') return { reply: raw || 'Pas de réponse.', actions: [] };
  return { reply: String(o.reply ?? ''), actions: Array.isArray(o.actions) ? o.actions : [] };
}
