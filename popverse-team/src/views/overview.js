// Vue d'ensemble d'un projet : avancement, échéances, derniers progrès, raccourcis.
import { api } from '../api.js';
import { h, clear, icon, avatar, person, timeAgo, fmtDate, fmtNum, empty, fail, md } from '../ui.js';
import { prio } from '../store.js';
import { changeCover, deleteProject } from './project.js';

export default async function overview(box, { project: p }) {
  clear(box, h('div.loading', 'Chargement…'));
  try {
    const [lists, cards, posts, lore, boards, stats, acts] = await Promise.all([
      api.select('pt_lists', { eq: { project_id: p.id }, order: 'position' }),
      api.select('pt_cards', { eq: { project_id: p.id, archived: false } }),
      api.select('pt_posts', { eq: { project_id: p.id }, order: [['created_at', 'desc']], limit: 3 }),
      api.select('pt_lore', { eq: { project_id: p.id }, columns: 'id,title,icon,updated_at' }),
      api.select('pt_boards', { eq: { project_id: p.id }, columns: 'id,name,icon' }),
      api.select('pt_game_stats', { eq: { project_id: p.id }, order: [['at', 'desc']], limit: 1 }).catch(() => []),
      api.select('pt_activity', { eq: { project_id: p.id }, order: [['created_at', 'desc']], limit: 12 }),
    ]);
    const doneIds = new Set(lists.filter(l => l.is_done).map(l => l.id));
    const done = cards.filter(c => c.done || doneIds.has(c.list_id)).length;
    const pct = cards.length ? Math.round((done / cards.length) * 100) : 0;
    const upcoming = cards.filter(c => c.due_at && !c.done && !doneIds.has(c.list_id)).sort((a, b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 6);
    const team = new Map();
    cards.forEach(c => (c.assignees || []).forEach(id => team.set(id, (team.get(id) || 0) + 1)));
    const s = stats[0];

    clear(box, h('div.overview',
      h('div.ov-main',
        h('div.panel.progress-panel',
          h('div.row.between', h('h3', icon('kanban'), 'Avancement'), h('b.big-num.gold-text', pct + ' %')),
          h('div.bar', h('i', { style: { width: pct + '%' } })),
          h('div.list-counts', lists.map(l => h('a.lc', { href: `#/p/${p.id}/tasks` }, h('b', String(cards.filter(c => c.list_id === l.id).length)), h('span', l.name))))),
        h('div.panel',
          h('h3', icon('clock'), 'Prochaines échéances'),
          upcoming.length ? upcoming.map(c => {
            const late = new Date(c.due_at) < Date.now();
            return h('a.task-row', { href: `#/p/${p.id}/tasks/${c.id}` },
              h('span.prio-dot', { style: { background: prio(c.priority)?.color || 'var(--line2)' } }),
              h('span.task-title', c.title),
              h('span.avatars', (c.assignees || []).slice(0, 3).map(id => avatar(id, 22))),
              h('span.due' + (late ? '.late' : ''), icon('clock'), fmtDate(c.due_at)));
          }) : h('p.muted', 'Aucune échéance prévue.')),
        h('div.panel',
          h('div.row.between', h('h3', icon('rocket'), 'Derniers progrès'), h('a.link', { href: `#/p/${p.id}/progress` }, 'Tout voir')),
          posts.length ? posts.map(post => h('a.mini-post', { href: `#/p/${p.id}/progress` },
            avatar(person(post.author), 30),
            h('div', h('b', post.title || person(post.author).display_name), h('div.md.clamp', { html: md(post.body) }), h('small.muted', timeAgo(post.created_at))),
            post.media?.[0]?.type?.startsWith('image') ? h('img.mini-thumb', { src: post.media[0].url, alt: '' }) : null))
            : h('p.muted', 'Rien de posté pour l\'instant.'))),
      h('div.ov-side',
        h('div.panel.live-mini',
          h('h3', icon('chart'), 'Stats du jeu'),
          p.roblox_place_id
            ? h('div.kpis', kpi('En jeu', s?.playing), kpi('Visites', s?.visits), kpi('Favoris', s?.favorites), kpi('J\'aime', s && s.likes + s.dislikes ? Math.round((s.likes / (s.likes + s.dislikes)) * 100) + ' %' : null))
            : h('p.muted', 'Ajoute le lien Roblox du jeu (Modifier) pour voir ses stats.'),
          h('a.btn.small.full', { href: `#/p/${p.id}/stats` }, 'Ouvrir les stats')),
        h('div.panel',
          h('h3', icon('users'), 'Équipe du projet'),
          team.size ? h('div.team-mini', [...team.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => h('div.tm', avatar(id, 30), h('span', person(id).display_name), h('small.muted', `${n} tâche${n > 1 ? 's' : ''}`))))
            : h('p.muted', 'Assigne des tâches pour voir qui travaille sur le projet.')),
        h('div.panel.quick',
          h('h3', icon('layers'), 'Raccourcis'),
          h('a.ql', { href: `#/p/${p.id}/boards` }, icon('board'), `${boards.length} tableau(x)`),
          h('a.ql', { href: `#/p/${p.id}/lore` }, icon('book'), `${lore.length} page(s) de lore`),
          h('a.ql', { href: `#/p/${p.id}/ai` }, icon('spark'), 'Demander au Copilot'),
          h('button.ql', { onclick: () => changeCover(p) }, icon('image'), 'Changer l\'image du projet'),
          h('button.ql.danger', { onclick: () => deleteProject(p) }, icon('trash'), 'Supprimer le projet')),
        h('div.panel.feed',
          h('h3', icon('bell'), 'Activité'),
          acts.length ? acts.map(a => h('div.feed-item', avatar(person(a.actor), 26), h('div', h('p', h('b', person(a.actor).display_name), ' ', a.text), h('small.muted', timeAgo(a.created_at)))))
            : h('p.muted', 'Pas encore d\'activité.')))));
  } catch (e) { fail(e); clear(box, empty('x', 'Erreur', e.message)); }
}

const kpi = (label, v) => h('div.kpi', h('b', typeof v === 'string' ? v : fmtNum(v)), h('small', label));
