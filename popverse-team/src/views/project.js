// Page d'un projet (un jeu) : en-tête + onglets. Chaque onglet est un module :
//   export default async function (container, { project, sub, query }) → fonction de nettoyage (optionnelle)
import { api } from '../api.js';
import { h, clear, icon, fail, empty, modal, form, confirmBox, toast, uploadFiles, pickFiles } from '../ui.js';
import { project as findProject, onProjects, go, isAdmin, logActivity } from '../store.js';
import { setCrumbs } from '../app.js';
import overview from './overview.js';
import tasks from './tasks.js';
import boards from './board.js';
import lore from './lore.js';
import progress from './progress.js';
import stats from './stats.js';
import { aiPage, setCopilotProject } from './ai.js';

export const TABS = [
  { id: 'overview', label: 'Vue d\'ensemble', icon: 'home', mod: overview },
  { id: 'tasks', label: 'Tâches', icon: 'kanban', mod: tasks },
  { id: 'boards', label: 'Tableaux', icon: 'board', mod: boards },
  { id: 'lore', label: 'Lore', icon: 'book', mod: lore },
  { id: 'progress', label: 'Progrès', icon: 'rocket', mod: progress },
  { id: 'stats', label: 'Stats', icon: 'chart', mod: stats },
  { id: 'ai', label: 'Copilot', icon: 'spark', mod: aiPage },
];
export const STATUS = {
  idea: { label: 'Idée', color: '#9a8f78' },
  dev: { label: 'En développement', color: '#F5B935' },
  beta: { label: 'Bêta', color: '#4FA3F7' },
  live: { label: 'En ligne', color: '#3CC9A0' },
  paused: { label: 'En pause', color: '#8C8C8C' },
};

export default async function projectView(view, { params, query }) {
  let p = findProject(params.id);
  if (!p) p = await api.get('pt_projects', params.id);
  if (!p) { clear(view, empty('gamepad', 'Projet introuvable', 'Il a peut-être été supprimé.', h('a.btn', { href: '#/projects' }, 'Voir les projets'))); return; }

  setCopilotProject(p);
  const head = h('header.project-head');
  const tabs = h('nav.tabs');
  const body = h('div.tab-body');
  view.classList.add('project-view');
  clear(view, head, tabs, body);

  let tabCleanup = null;
  let current = null;

  function drawHead() {
    const st = STATUS[p.status] || STATUS.dev;
    clear(head,
      h('div.ph-cover', { style: p.cover_url ? { backgroundImage: `url("${p.cover_url}")` } : { '--c': p.color || '#F5B935' } }),
      h('div.ph-row',
        h('div.ph-icon', { style: { '--c': p.color || '#F5B935' } }, p.cover_url ? h('img', { src: p.cover_url, alt: '' }) : p.icon || '🎮'),
        h('div.ph-meta',
          h('div.row', h('span.status', { style: { '--c': st.color } }, h('i'), st.label), p.genre ? h('span.tag', p.genre) : null),
          h('h1.ph-title', p.name),
          p.description ? h('p.muted.ph-desc', p.description) : null),
        h('div.ph-actions',
          p.roblox_url || p.roblox_place_id ? h('a.btn.small', { href: p.roblox_url || `https://www.roblox.com/games/${p.roblox_place_id}`, target: '_blank', rel: 'noopener' }, icon('play'), 'Ouvrir sur Roblox') : null,
          h('button.btn.small', { onclick: () => editProject(p) }, icon('edit'), 'Modifier'))));
  }
  function drawTabs() {
    clear(tabs, TABS.map(t => h('a.tab' + (t.id === current ? '.active' : ''), { href: `#/p/${p.id}/${t.id}` }, icon(t.icon), h('span', t.label))));
  }
  async function openTab(tab, sub, q) {
    const t = TABS.find(t => t.id === tab) || TABS[0];
    const same = current === t.id;
    current = t.id;
    drawTabs();
    setCrumbs({ label: 'Projets', href: '#/projects' }, { label: p.name, href: `#/p/${p.id}` }, t.label);
    if (same && tabCleanup?.onSub) { tabCleanup.onSub(sub, q); return; }
    try { tabCleanup?.(); } catch (e) { console.error(e); }
    tabCleanup = null;
    clear(body);
    body.className = 'tab-body tab-' + t.id;
    view.dataset.tab = t.id;
    try { tabCleanup = (await t.mod(body, { project: p, sub, query: q || {} })) || null; }
    catch (e) { fail(e); clear(body, empty('x', 'Erreur', e.message)); }
  }

  drawHead();
  await openTab(params.tab || 'overview', params.sub, query);

  const off = onProjects(() => {
    const np = findProject(p.id);
    if (!np) { toast('Ce projet a été supprimé.', 'error'); go('/projects'); return; }
    if (np !== p) { Object.assign(p, np); drawHead(); }
  });

  const cleanup = () => { off(); try { tabCleanup?.(); } catch {} setCopilotProject(null); };
  cleanup.sameRoute = (viewFn, prm, q) => {
    if (viewFn !== projectView || prm.id !== p.id) return false;
    openTab(prm.tab || 'overview', prm.sub, q);
    return true;
  };
  return cleanup;
}

export async function editProject(p) {
  const v = await form(p ? 'Modifier le projet' : 'Nouveau projet', [
    { name: 'name', label: 'Nom du jeu', value: p?.name, required: true, placeholder: 'Ex : Pop Simulator' },
    { name: 'icon', label: 'Emoji', value: p?.icon || '🎮' },
    { name: 'description', label: 'Description courte', type: 'textarea', rows: 2, value: p?.description },
    { name: 'genre', label: 'Genre', value: p?.genre, placeholder: 'Simulator, Tycoon, Obby, RPG…' },
    { name: 'status', label: 'Statut', type: 'select', value: p?.status || 'dev', options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })) },
    { name: 'roblox_url', label: 'Lien du jeu Roblox', value: p?.roblox_url || '', placeholder: 'https://www.roblox.com/games/123456789/…', hint: 'Sert aux stats en temps réel et à l\'image du jeu.' },
    { name: 'color', label: 'Couleur', type: 'color', value: p?.color || '#F5B935' },
  ], { submit: p ? 'Enregistrer' : 'Créer le projet' });
  if (!v) return null;
  const placeId = Number((v.roblox_url.match(/games\/(\d+)/) || v.roblox_url.match(/^(\d{5,})$/) || [])[1]) || null;
  const row = { ...v, roblox_url: v.roblox_url || null, roblox_place_id: placeId };
  try {
    if (placeId && placeId !== p?.roblox_place_id) {
      try {
        const info = await api.fn('pt-roblox', { action: 'resolve', place_id: placeId });
        if (info?.universe_id) row.roblox_universe_id = info.universe_id;
        if (info?.icon && !p?.cover_url) row.cover_url = info.icon;
      } catch (e) { console.warn(e); }
    }
    if (p) {
      const np = await api.update('pt_projects', p.id, row);
      toast('Projet enregistré', 'ok');
      return np;
    }
    const np = await api.insert('pt_projects', { ...row, created_by: api.me.id, position: Date.now() });
    await seedProject(np);
    logActivity(np.id, 'project', `a créé le projet ${np.name}`, `#/p/${np.id}`);
    toast('Projet créé', 'ok');
    go(`/p/${np.id}/tasks`);
    return np;
  } catch (e) { fail(e); return null; }
}

// Contenu de départ d'un nouveau projet : colonnes, étiquettes, salon de chat, premier tableau, pages de lore.
export async function seedProject(p) {
  const lists = ['À faire', 'En cours', 'À tester', 'Terminé'].map((name, i) => ({ project_id: p.id, name, position: (i + 1) * 1000, is_done: i === 3 }));
  const labels = [['Script', '#4FA3F7'], ['Build', '#F5B935'], ['UI', '#D16BD8'], ['VFX', '#E8833A'], ['Animation', '#3CC9A0'], ['Bug', '#E25D6A'], ['Game design', '#8B7CF6']]
    .map(([name, color]) => ({ project_id: p.id, name, color }));
  const lore = [
    ['Univers', 'histoire', '🌍'], ['Personnages', 'personnages', '🧙'], ['Lieux', 'lieux', '🗺️'], ['Objets', 'objets', '🗡️'], ['Mécaniques', 'mecaniques', '⚙️'],
  ].map(([title, category, ic], i) => ({ project_id: p.id, title, category, icon: ic, content: '', position: (i + 1) * 1000, updated_by: api.me.id }));
  await Promise.all([
    api.insert('pt_lists', lists),
    api.insert('pt_labels', labels),
    api.insert('pt_channels', { project_id: p.id, name: p.name.toLowerCase().replace(/[^a-z0-9à-ü]+/gi, '-').replace(/^-|-$/g, '') || 'projet', topic: `Discussion du projet ${p.name}`, kind: 'text', position: 10, created_by: api.me.id }),
    api.insert('pt_boards', { project_id: p.id, name: 'Idées & structure', icon: '🧭', position: 1000, created_by: api.me.id }),
    api.insert('pt_lore', lore),
  ]);
}

export async function deleteProject(p) {
  if (!isAdmin()) return toast('Seul un admin peut supprimer un projet.', 'error');
  if (!(await confirmBox(`Supprimer « ${p.name} » et TOUT son contenu (tâches, tableaux, lore, progrès, stats) ? C'est définitif.`, { ok: 'Supprimer' }))) return;
  try { await api.remove('pt_projects', p.id); toast('Projet supprimé', 'ok'); go('/projects'); } catch (e) { fail(e); }
}

export async function changeCover(p) {
  const [file] = await pickFiles();
  if (!file) return;
  try {
    const [up] = await uploadFiles([file], 'covers');
    await api.update('pt_projects', p.id, { cover_url: up.url });
  } catch (e) { fail(e); }
}
export { modal };
