// Équipe : membres, rôles, présence, code d'équipe pour inviter.
import { api } from '../api.js';
import { h, clear, icon, avatar, timeAgo, fail, toast, menu, loadPeople, form, confirmBox } from '../ui.js';
import { isAdmin, go } from '../store.js';
import { setCrumbs, roleLabel } from '../app.js';
import { openDM } from './chat.js';

export default async function team(view) {
  setCrumbs('Équipe');
  const grid = h('div.team-grid');
  const invite = h('div.panel.invite', { hidden: !isAdmin() });
  clear(view,
    h('div.page-head', h('div', h('p.eyebrow', 'Popverse Studio'), h('h1.h1', 'Équipe'), h('p.sub', 'Les devs du studio. Pour inviter quelqu\'un, donne-lui le lien de l\'app et le code d\'équipe.'))),
    invite, grid);

  if (isAdmin()) {
    try {
      const code = await api.rpc('pt_invite_code');
      const codeEl = h('code.invite-code', code || '—');
      clear(invite,
        h('div', h('h3', icon('lock'), 'Code d\'équipe'), h('p.muted', 'Demandé à la création d\'un compte. Change-le si quelqu\'un ne doit plus pouvoir s\'inscrire.')),
        h('div.row', codeEl,
          h('button.btn.small', { onclick: () => navigator.clipboard.writeText(codeEl.textContent).then(() => toast('Code copié', 'ok')) }, icon('copy'), 'Copier'),
          h('button.btn.small', {
            onclick: async () => {
              const v = await form('Nouveau code d\'équipe', [{ name: 'code', label: 'Code', value: 'POP-' + Math.random().toString(36).slice(2, 8).toUpperCase(), required: true }]);
              if (v) codeEl.textContent = await api.rpc('pt_set_invite_code', { code: v.code }).catch(fail) || codeEl.textContent;
            },
          }, icon('refresh'), 'Changer')));
    } catch (e) { invite.hidden = true; console.warn(e); }
  }

  async function draw() {
    const list = await loadPeople(true);
    const order = { owner: 0, admin: 1, member: 2, disabled: 3 };
    clear(grid, list.sort((a, b) => order[a.role] - order[b.role] || a.display_name.localeCompare(b.display_name)).map(p => {
      const online = p.last_seen && Date.now() - new Date(p.last_seen) < 5 * 60e3;
      return h('div.member' + (p.role === 'disabled' ? '.disabled' : ''),
        h('div.member-top', h('div.av-wrap', avatar(p, 64), h('i.presence' + (online ? '.on' : ''))),
          isAdmin() && p.id !== api.me.id && p.role !== 'owner' ? h('button.icon-btn', { onclick: e => roleMenu(e.currentTarget, p) }, icon('more')) : null),
        h('h3', p.display_name), h('p.muted', '@' + p.username),
        h('div.row.center', h('span.role.' + p.role, p.role === 'owner' ? icon('crown') : p.role === 'admin' ? icon('shield') : null, roleLabel(p.role)), p.title ? h('span.tag', p.title) : null),
        p.bio ? h('p.bio', p.bio) : null,
        h('small.muted', online ? 'En ligne' : p.last_seen ? 'Vu ' + timeAgo(p.last_seen) : ''),
        p.id !== api.me.id ? h('button.btn.small.full', { onclick: () => openDM(p.id) }, icon('chat'), 'Message privé') : h('a.btn.small.full', { href: '#/settings' }, icon('edit'), 'Mon profil'));
    }));
  }
  async function roleMenu(anchor, p) {
    const set = role => api.update('pt_profiles', p.id, { role }).then(() => { toast('Rôle mis à jour', 'ok'); draw(); }).catch(fail);
    menu(anchor, [
      p.role !== 'admin' ? { label: 'Passer admin', icon: 'shield', onclick: () => set('admin') } : null,
      p.role !== 'member' ? { label: 'Passer membre', icon: 'users', onclick: () => set('member') } : null,
      p.role !== 'disabled' ? { label: 'Désactiver le compte', icon: 'lock', danger: true, onclick: async () => { if (await confirmBox(`Désactiver ${p.display_name} ? Il ne pourra plus rien voir.`)) set('disabled'); } } : null,
    ], { align: 'right' });
  }
  await draw().catch(fail);
  const off = api.subscribe('pt_profiles', null, () => draw().catch(() => {}));
  return () => off();
}
