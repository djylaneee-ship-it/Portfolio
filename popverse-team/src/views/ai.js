// Copilot : assistant IA qui connaît le jeu (lore, tâches, tableaux, progrès, stats) et agit dans l'app
// (créer des tâches, des pages de lore). Panneau à droite (Ctrl+J, partout) + onglet plein écran dans un projet.
import { api } from '../api.js';
import { h, clear, icon, md, avatar, toast, fail, $, timeAgo, confirmBox, modal } from '../ui.js';
import { state, project as findProject, logActivity, PRIORITIES } from '../store.js';

let current = null;          // projet affiché (null = tout le studio)
let panel = null;            // instance du panneau latéral

export function setCopilotProject(p) {
  current = p || null;
  if (panel && document.body.classList.contains('copilot-open')) panel.reload();
}

export function toggleCopilot(force) {
  const open = force ?? !document.body.classList.contains('copilot-open');
  document.body.classList.toggle('copilot-open', open);
  const box = $('#copilot');
  if (!box) return;
  if (open) {
    if (!panel) panel = mountCopilot(box, () => current, { side: true });
    else panel.reload();
    setTimeout(() => box.querySelector('textarea')?.focus(), 350);
  }
}

export async function aiPage(box, { project }) {
  box.classList.add('ai-page');
  const inst = mountCopilot(box, () => project, { side: false });
  return () => inst.destroy();
}

const SUGGEST = {
  project: [
    ['🧩', 'Découpe la prochaine grosse feature en tâches'],
    ['📊', 'Fais le point sur l\'avancement du jeu'],
    ['⏰', 'Quelles tâches sont en retard ou bloquées ?'],
    ['🎉', 'Propose 5 idées d\'évènements pour booster les joueurs'],
    ['📜', 'Écris une page de lore pour un nouveau PNJ'],
    ['🐞', 'Liste les risques techniques de ce jeu'],
  ],
  studio: [
    ['🗺️', 'Résume où en sont tous les jeux du studio'],
    ['💡', 'Donne-moi une idée de nouveau jeu Roblox'],
    ['📈', 'Comment améliorer la rétention de nos jeux ?'],
  ],
};

function mountCopilot(box, getProject, { side }) {
  let proj = getProject();
  let messages = [];
  let busy = false;
  const list = h('div.ai-list');
  const input = h('textarea.ai-input', { rows: 1, placeholder: 'Demande au Copilot…' });
  const sendBtn = h('button.ai-send', { title: 'Envoyer', onclick: () => send() }, icon('send'));
  const title = h('div.ai-title');
  const head = h('header.ai-head', title,
    h('div.row',
      h('button.icon-btn', { title: 'Nouvelle conversation', onclick: resetConv }, icon('refresh')),
      side ? h('button.icon-btn', { title: 'Fermer (Ctrl+J)', onclick: () => toggleCopilot(false) }, icon('x')) : null));
  const foot = h('footer.ai-foot', h('div.ai-compose', input, sendBtn), h('small.muted', 'Le Copilot lit le lore, les tâches, les tableaux, les progrès et les stats du projet.'));
  clear(box, h('div.ai' + (side ? '.side' : '.full'), head, list, foot));

  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(180, input.scrollHeight) + 'px'; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });

  function drawTitle() {
    clear(title, h('span.ai-badge', icon('spark')), h('div', h('b', 'Copilot'), h('small.muted', proj ? `connaît ${proj.name}` : 'tout le studio')));
  }

  async function load() {
    proj = getProject();
    drawTitle();
    clear(list, h('div.loading', ''));
    try {
      const rows = await api.select('pt_ai_messages', { eq: { user_id: api.me.id, project_id: proj?.id ?? null }, order: [['created_at', 'desc']], limit: 40 });
      messages = rows.reverse();
    } catch (e) { messages = []; console.warn(e); }
    draw();
  }

  function draw() {
    clear(list);
    if (!messages.length) {
      list.append(h('div.ai-welcome',
        h('div.ai-orb', h('img', { src: 'assets/logo-glow.png', alt: '' })),
        h('h3', proj ? `Je connais ${proj.name} par cœur.` : 'Je connais tous les jeux du studio.'),
        h('p.muted', proj ? 'Demande-moi de créer des tâches, d\'écrire du lore, de faire le point ou de t\'aider sur du Luau.' : 'Ouvre un projet pour que je me concentre sur un jeu, ou pose une question générale.'),
        h('div.ai-suggest', (proj ? SUGGEST.project : SUGGEST.studio).map(([e, t]) => h('button', { onclick: () => { input.value = t; send(); } }, h('span', e), t)))));
    }
    messages.forEach(m => list.append(bubble(m)));
    list.scrollTop = list.scrollHeight;
  }

  function bubble(m) {
    const mine = m.role === 'user';
    const b = h('div.ai-msg' + (mine ? '.me' : '.bot'),
      mine ? avatar(api.me, 30) : h('span.ai-badge.sm', icon('spark')),
      h('div.ai-bubble',
        m.pending ? h('div.typing', h('i'), h('i'), h('i')) : h('div.md', { html: md(m.content) }),
        (m.actions || []).map((a, i) => actionCard(m, a, i)),
        m.created_at && !m.pending ? h('small.ai-time', timeAgo(m.created_at)) : null));
    return b;
  }

  function actionCard(m, a, i) {
    if (a.type === 'create_tasks' && Array.isArray(a.tasks) && a.tasks.length) {
      const picks = new Set(a.tasks.map((_, k) => k));
      const btn = h('button.btn.primary.small', { disabled: !!a.applied, onclick: async () => {
        const target = proj || await pickProject();
        if (!target) return;
        btn.disabled = true;
        try {
          const n = await createTasks(target, a.tasks.filter((_, k) => picks.has(k)));
          await markApplied(m, i);
          toast(`${n} tâche(s) créée(s) dans ${target.name}`, 'ok');
        } catch (e) { fail(e); btn.disabled = false; }
      } }, icon(a.applied ? 'check' : 'plus'), a.applied ? 'Tâches créées' : `Créer ${a.tasks.length} tâche(s)`);
      return h('div.ai-action',
        h('div.ai-action-head', icon('kanban'), h('b', 'Tâches proposées')),
        a.tasks.map((t, k) => h('label.ai-task',
          h('input', { type: 'checkbox', checked: true, disabled: !!a.applied, onchange: e => { e.target.checked ? picks.add(k) : picks.delete(k); } }),
          h('div',
            h('div.row', h('b', t.title), t.priority ? h('span.prio', { style: { '--c': PRIORITIES.find(p => p.value === t.priority)?.color || '#888' } }, PRIORITIES.find(p => p.value === t.priority)?.label || t.priority) : null,
              (t.labels || []).map(l => h('span.tag', l))),
            t.description ? h('div.md.small.clamp', { html: md(t.description) }) : null,
            t.checklist?.length ? h('small.muted', `☑ ${t.checklist.length} étape(s)`) : null))),
        h('div.row.end', btn));
    }
    if (a.type === 'create_lore' && a.title) {
      const btn = h('button.btn.primary.small', { disabled: !!a.applied, onclick: async () => {
        const target = proj || await pickProject();
        if (!target) return;
        btn.disabled = true;
        try {
          const page = await api.insert('pt_lore', { project_id: target.id, title: a.title, category: a.category || 'autre', icon: a.icon || '📜', content: a.html || '', position: Date.now(), updated_by: api.me.id });
          logActivity(target.id, 'lore', `a ajouté la page de lore « ${a.title} » (Copilot)`, `#/p/${target.id}/lore/${page.id}`);
          await markApplied(m, i);
          toast('Page de lore créée', 'ok');
          location.hash = `#/p/${target.id}/lore/${page.id}`;
        } catch (e) { fail(e); btn.disabled = false; }
      } }, icon(a.applied ? 'check' : 'book'), a.applied ? 'Page créée' : 'Créer la page');
      return h('div.ai-action', h('div.ai-action-head', icon('book'), h('b', `Page de lore : ${a.icon || ''} ${a.title}`)), h('div.row.end', btn));
    }
    return null;
  }

  async function markApplied(m, i) {
    m.actions = m.actions.map((a, k) => (k === i ? { ...a, applied: true } : a));
    if (m.id && !m.local) await api.update('pt_ai_messages', m.id, { actions: m.actions }).catch(() => {});
    draw();
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    input.value = ''; input.style.height = 'auto';
    const history = messages.filter(m => !m.pending).slice(-14).map(m => ({ role: m.role, content: m.content }));
    const userMsg = { role: 'user', content: text, created_at: new Date().toISOString(), local: true };
    const pending = { role: 'assistant', content: '', pending: true };
    messages.push(userMsg, pending);
    draw();
    try {
      api.insert('pt_ai_messages', { project_id: proj?.id ?? null, user_id: api.me.id, role: 'user', content: text }).then(r => Object.assign(userMsg, r, { local: false })).catch(() => {});
      const res = await api.fn('pt-ai', { mode: 'chat', project_id: proj?.id ?? null, message: text, history });
      const reply = { role: 'assistant', content: res.reply || '…', actions: res.actions || [], created_at: new Date().toISOString(), local: true };
      messages.splice(messages.indexOf(pending), 1, reply);
      draw();
      api.insert('pt_ai_messages', { project_id: proj?.id ?? null, user_id: api.me.id, role: 'assistant', content: reply.content, actions: reply.actions })
        .then(r => Object.assign(reply, { id: r.id, local: false })).catch(() => {});
    } catch (e) {
      messages.splice(messages.indexOf(pending), 1, { role: 'assistant', content: '⚠️ ' + (e.message || 'Le Copilot ne répond pas.'), actions: [] });
      draw();
    } finally { busy = false; sendBtn.disabled = false; input.focus(); }
  }

  async function resetConv() {
    if (!messages.length) return;
    if (!(await confirmBox('Effacer cette conversation avec le Copilot ?', { ok: 'Effacer' }))) return;
    try {
      await api.removeWhere('pt_ai_messages', { user_id: api.me.id, project_id: proj?.id ?? null });
      messages = []; draw();
    } catch (e) { fail(e); }
  }

  load();
  return { reload: load, destroy() {} };
}

function pickProject() {
  return new Promise(res => {
    const list = state.projects.filter(p => !p.archived);
    if (!list.length) { toast('Crée d\'abord un projet.', 'error'); return res(null); }
    let done = false;
    const m = modal({ title: 'Dans quel projet ?', onClose: () => !done && res(null),
      body: h('div.pick-list', list.map(p => h('button.ql', { onclick: () => { done = true; m.close(); res(p); } }, h('span', p.icon || '🎮'), p.name))) });
  });
}

// Crée des tâches proposées par le Copilot dans la première colonne « à faire » du projet.
export async function createTasks(p, tasks) {
  const lists = await api.select('pt_lists', { eq: { project_id: p.id }, order: 'position' });
  let list = lists.find(l => !l.is_done) || lists[0];
  if (!list) list = await api.insert('pt_lists', { project_id: p.id, name: 'À faire', position: 1000 });
  const existing = await api.select('pt_cards', { eq: { list_id: list.id }, order: [['position', 'desc']], limit: 1 });
  let pos = (existing[0]?.position || 0) + 1000;
  const labels = await api.select('pt_labels', { eq: { project_id: p.id } });
  const known = new Map(labels.map(l => [l.name.toLowerCase(), l.name]));
  const people = new Set((await api.select('pt_profiles', { columns: 'id' })).map(x => x.id));
  const rows = tasks.map(t => ({
    project_id: p.id, list_id: list.id, title: String(t.title).slice(0, 200), description: t.description || '',
    priority: PRIORITIES.some(x => x.value === t.priority) ? t.priority : null,
    labels: (t.labels || []).map(l => known.get(String(l).toLowerCase()) || String(l)).slice(0, 6),
    checklist: (t.checklist || []).map(x => ({ id: Math.random().toString(36).slice(2, 10), text: String(x.text || x), done: false })),
    assignees: t.assignee && people.has(t.assignee) ? [t.assignee] : [],
    due_at: t.due_in_days ? new Date(Date.now() + t.due_in_days * 864e5).toISOString() : null,
    position: (pos += 1000), created_by: api.me.id,
  }));
  // Ajoute les étiquettes inconnues au projet pour qu'elles aient une couleur.
  const missing = [...new Set(rows.flatMap(r => r.labels))].filter(l => !known.has(l.toLowerCase()));
  if (missing.length) await api.insert('pt_labels', missing.map((name, i) => ({ project_id: p.id, name, color: ['#8B7CF6', '#4FA3F7', '#3CC9A0', '#E8833A', '#D16BD8'][i % 5] })));
  await api.insert('pt_cards', rows);
  logActivity(p.id, 'tasks', `a créé ${rows.length} tâche(s) avec le Copilot`, `#/p/${p.id}/tasks`);
  return rows.length;
}

export { findProject };
