// Accueil : bonjour, chiffres clés, mes tâches, jeux du studio, activité récente.
import { api } from '../api.js';
import { h, clear, icon, avatar, person, timeAgo, fmtDate, fmtNum, empty, fail } from '../ui.js';
import { state, onProjects, prio } from '../store.js';
import { STATUS } from './project.js';
import { STUDIO } from '../config.js';

export default async function home(view) {
  const me = api.me;
  const hour = new Date().getHours();
  const hello = hour < 6 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';
  const tiles = h('div.tiles');
  const mine = h('div.panel.list-panel');
  const games = h('div.games-grid');
  const activity = h('div.panel.feed');

  clear(view,
    h('section.hero',
      h('div',
        h('p.eyebrow', STUDIO.name),
        h('h1.h1', `${hello}, `, h('span.gold-text', me.display_name), ' ✦'),
        h('p.sub', 'Tout le studio au même endroit : tâches, tableaux, lore, progrès et stats de vos jeux.')),
      h('img.hero-logo', { src: 'assets/logo-glow.png', alt: '' })),
    tiles,
    h('div.home-grid',
      h('div.col',
        h('div.section-head', h('h2', 'Mes tâches'), h('span.muted.small', 'assignées à moi')),
        mine,
        h('div.section-head', h('h2', 'Jeux du studio'), h('a.link', { href: '#/projects' }, 'Tous les projets')),
        games),
      h('div.col',
        h('div.section-head', h('h2', 'Activité'), null),
        activity)));

  const drawGames = () => {
    const list = state.projects.filter(p => !p.archived);
    clear(games, list.length ? list.map(p => gameCard(p)) : empty('gamepad', 'Aucun projet', 'Crée un projet pour chaque jeu du studio.', h('a.btn.primary', { href: '#/projects?new=1' }, icon('plus'), 'Nouveau projet')));
  };
  const off = onProjects(drawGames);
  drawGames();

  try {
    const [cards, lists, acts, profiles, stats] = await Promise.all([
      api.select('pt_cards', { eq: { archived: false, done: false }, contains: { assignees: [me.id] }, order: [['due_at', 'asc']], limit: 50 }),
      api.select('pt_lists'),
      api.select('pt_activity', { order: [['created_at', 'desc']], limit: 30 }),
      api.select('pt_profiles'),
      api.select('pt_game_stats', { order: [['at', 'desc']], limit: 200 }).catch(() => []),
    ]);
    const doneLists = new Set(lists.filter(l => l.is_done).map(l => l.id));
    const open = cards.filter(c => !doneLists.has(c.list_id));
    const soon = open.filter(c => c.due_at && new Date(c.due_at) - Date.now() < 3 * 864e5);
    const online = profiles.filter(p => p.last_seen && Date.now() - new Date(p.last_seen) < 5 * 60e3);
    const latest = new Map();
    for (const s of stats) if (!latest.has(s.project_id)) latest.set(s.project_id, s);
    const playing = [...latest.values()].reduce((a, s) => a + (s.playing || 0), 0);

    clear(tiles,
      tile('gamepad', 'Projets', state.projects.filter(p => !p.archived).length, 'jeux suivis', '#/projects'),
      tile('checklist', 'Mes tâches', open.length, soon.length ? `${soon.length} à rendre bientôt` : 'rien d\'urgent', null),
      tile('users', 'Équipe', profiles.filter(p => p.role !== 'disabled').length, `${online.length} en ligne`, '#/team'),
      tile('chart', 'Joueurs', fmtNum(playing), 'en jeu en ce moment', state.projects[0] ? `#/p/${state.projects[0].id}/stats` : null));

    const pmap = new Map(state.projects.map(p => [p.id, p]));
    clear(mine, open.length ? open.slice(0, 12).map(c => {
      const p = pmap.get(c.project_id);
      const pr = prio(c.priority);
      const late = c.due_at && new Date(c.due_at) < Date.now();
      return h('a.task-row', { href: `#/p/${c.project_id}/tasks/${c.id}` },
        h('span.prio-dot', { style: { background: pr?.color || 'var(--line2)' }, title: pr?.label || 'Sans priorité' }),
        h('span.task-title', c.title),
        p ? h('span.tag', p.icon || '🎮', ' ', p.name) : null,
        c.due_at ? h('span.due' + (late ? '.late' : ''), icon('clock'), fmtDate(c.due_at)) : null);
    }) : empty('check', 'Rien pour toi', 'Aucune tâche ne t\'est assignée. Profites-en !'));

    clear(activity, acts.length ? acts.map(a => {
      const p = pmap.get(a.project_id);
      return h('a.feed-item', { href: a.link || (p ? `#/p/${p.id}` : '#/') },
        avatar(person(a.actor), 30),
        h('div', h('p', h('b', person(a.actor).display_name), ' ', a.text), h('small.muted', timeAgo(a.created_at), p ? ` · ${p.name}` : '')));
    }) : empty('bell', 'Pas encore d\'activité', 'Les actions de l\'équipe apparaîtront ici.'));
  } catch (e) { fail(e); }

  return () => off();
}

function tile(ic, label, value, hint, href) {
  return h(href ? 'a.tile' : 'div.tile', href ? { href } : {}, h('span.tile-ic', icon(ic)), h('div', h('small', label), h('b', String(value)), h('span.muted', hint)));
}

export function gameCard(p) {
  const st = STATUS[p.status] || STATUS.dev;
  return h('a.game-card', { href: `#/p/${p.id}`, style: { '--c': p.color || '#F5B935' } },
    h('div.gc-cover', p.cover_url ? h('img', { src: p.cover_url, alt: '', loading: 'lazy' }) : h('span.gc-emoji', p.icon || '🎮')),
    h('div.gc-body',
      h('div.row', h('span.status', { style: { '--c': st.color } }, h('i'), st.label), p.genre ? h('span.tag', p.genre) : null),
      h('h3', p.name),
      h('p.muted', p.description || 'Pas encore de description.')));
}
