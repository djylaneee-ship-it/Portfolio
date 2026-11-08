// Liste des projets (un par jeu), création, import des jeux depuis popversestudio.com.
import { api } from '../api.js';
import { h, clear, icon, empty, menu, toast, fail, modal } from '../ui.js';
import { state, onProjects, isAdmin, go } from '../store.js';
import { setCrumbs } from '../app.js';
import { editProject, deleteProject, changeCover, seedProject } from './project.js';
import { gameCard } from './home.js';
import { STUDIO } from '../config.js';

export default async function projects(view, { query }) {
  setCrumbs('Projets');
  let showArchived = false;
  const grid = h('div.games-grid.big');
  const archBtn = h('button.btn.small.ghost', { onclick: () => { showArchived = !showArchived; draw(); } });
  clear(view,
    h('div.page-head',
      h('div', h('p.eyebrow', STUDIO.name), h('h1.h1', 'Projets'), h('p.sub', 'Un projet par jeu : ses tâches, ses tableaux, son lore, ses progrès et ses stats.')),
      h('div.row',
        h('button.btn', { onclick: importSite, title: `Ajoute les jeux listés sur ${STUDIO.site}` }, icon('globe'), 'Importer depuis le site'),
        h('button.btn.primary', { onclick: () => editProject(null) }, icon('plus'), 'Nouveau projet'))),
    grid, h('div.center', archBtn));

  function draw() {
    const list = state.projects.filter(p => !!p.archived === showArchived);
    archBtn.textContent = showArchived ? '← Projets actifs' : `Projets archivés (${state.projects.filter(p => p.archived).length})`;
    clear(grid, list.length ? list.map(p => {
      const card = gameCard(p);
      card.append(h('button.icon-btn.gc-menu', {
        onclick: e => {
          e.preventDefault(); e.stopPropagation();
          menu(e.currentTarget, [
            { label: 'Ouvrir', icon: 'eye', onclick: () => go(`/p/${p.id}`) },
            { label: 'Modifier', icon: 'edit', onclick: () => editProject(p) },
            { label: 'Changer l\'image', icon: 'image', onclick: () => changeCover(p) },
            { label: p.archived ? 'Désarchiver' : 'Archiver', icon: 'archive', onclick: () => api.update('pt_projects', p.id, { archived: !p.archived }).catch(fail) },
            isAdmin() ? '-' : null,
            isAdmin() ? { label: 'Supprimer', icon: 'trash', danger: true, onclick: () => deleteProject(p) } : null,
          ], { align: 'right' });
        },
      }, icon('more')));
      return card;
    }) : empty('gamepad', showArchived ? 'Aucun projet archivé' : 'Aucun projet pour l\'instant',
      showArchived ? '' : 'Crée un projet pour chaque jeu, ou importe les jeux de ton site.',
      showArchived ? null : h('button.btn.primary', { onclick: () => editProject(null) }, icon('plus'), 'Nouveau projet')));
  }
  const off = onProjects(draw);
  draw();
  if (query.new) { history.replaceState(null, '', '#/projects'); editProject(null); }
  return () => off();
}

// Lit les liens roblox.com/games/… du site du studio (via la fonction pt-roblox) et propose de créer les projets.
async function importSite() {
  const m = modal({ title: `Jeux de ${STUDIO.site.replace('https://', '')}`, body: h('p.muted', 'Lecture du site…') });
  try {
    const res = await api.fn('pt-roblox', { action: 'site', url: STUDIO.site });
    const known = new Set(state.projects.map(p => String(p.roblox_place_id)));
    const games = (res.games || []).filter(g => !known.has(String(g.place_id)));
    if (!games.length) { clear(m.body, h('p.muted', res.games?.length ? 'Tous les jeux du site sont déjà dans tes projets.' : 'Aucun lien de jeu Roblox trouvé sur le site.')); return; }
    const picks = new Set(games.map(g => g.place_id));
    clear(m.body,
      h('p.muted', `${games.length} jeu(x) trouvé(s). Coche ceux à ajouter :`),
      h('div.import-list', games.map(g => h('label.import-item',
        h('input', { type: 'checkbox', checked: true, onchange: e => e.target.checked ? picks.add(g.place_id) : picks.delete(g.place_id) }),
        g.icon ? h('img', { src: g.icon, alt: '' }) : h('span.gc-emoji', '🎮'),
        h('div', h('b', g.name || `Jeu ${g.place_id}`), h('small.muted', g.description ? g.description.slice(0, 120) : g.url))))),
      h('div.row.end', h('button.btn.primary', {
        onclick: async e => {
          e.target.disabled = true;
          try {
            for (const g of games.filter(g => picks.has(g.place_id))) {
              const p = await api.insert('pt_projects', {
                name: g.name || `Jeu ${g.place_id}`, description: (g.description || '').slice(0, 280), icon: '🎮', status: 'live',
                roblox_place_id: g.place_id, roblox_universe_id: g.universe_id || null, roblox_url: g.url, cover_url: g.icon || null,
                created_by: api.me.id, position: Date.now(),
              });
              await seedProject(p);
            }
            toast('Jeux importés', 'ok');
            m.close();
          } catch (ex) { fail(ex); e.target.disabled = false; }
        },
      }, icon('download'), 'Ajouter les jeux cochés')));
  } catch (e) {
    clear(m.body, h('p', 'Impossible de lire le site : ' + e.message), h('p.muted', 'Tu peux aussi créer chaque projet à la main et coller le lien Roblox du jeu.'));
  }
}
