// Réglages : mon profil, apparence, base de données, téléchargements, à propos.
import { api, dbConfig } from '../api.js';
import { h, clear, icon, avatar, fail, toast, pickFiles, uploadFiles, COLORS, loadPeople } from '../ui.js';
import { setCrumbs, dbDialog } from '../app.js';
import { STUDIO, DOWNLOADS, WEB_URL } from '../config.js';

export default async function settings(view) {
  setCrumbs('Réglages');
  const me = api.me;
  const avBox = h('div.av-edit', avatar(me, 84));
  let avatarUrl = me.avatar_url;
  let color = me.color;
  const f = h('form.form.panel', {
    onsubmit: async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      try {
        await api.update('pt_profiles', me.id, { display_name: d.display_name.trim() || me.display_name, title: d.title.trim(), bio: d.bio.trim(), color, avatar_url: avatarUrl });
        await api.refreshMe(); await loadPeople(true);
        toast('Profil enregistré', 'ok');
        location.reload();
      } catch (ex) { fail(ex); }
    },
  },
    h('h3', icon('users'), 'Mon profil'),
    h('div.profile-row',
      avBox,
      h('div.col',
        h('button.btn.small', { type: 'button', onclick: async () => {
          const [file] = await pickFiles();
          if (!file) return;
          try { [{ url: avatarUrl }] = await uploadFiles([file], 'avatars'); clear(avBox, avatar({ ...me, avatar_url: avatarUrl, color }, 84)); } catch (e) { fail(e); }
        } }, icon('image'), 'Changer la photo'),
        h('div.swatches', COLORS.map(c => h('button.swatch' + (c === color ? '.on' : ''), { type: 'button', style: { background: c }, onclick: e => { color = c; e.target.parentNode.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s === e.target)); clear(avBox, avatar({ ...me, avatar_url: avatarUrl, color }, 84)); } }))))),
    h('label.field', h('span', 'Nom affiché'), h('input.input', { name: 'display_name', value: me.display_name, maxLength: 40 })),
    h('label.field', h('span', 'Rôle dans le studio'), h('input.input', { name: 'title', value: me.title || '', placeholder: 'Scripteur, Builder, UI designer, Modeleur 3D…' })),
    h('label.field', h('span', 'Bio'), h('textarea.input', { name: 'bio', rows: 3 }, me.bio || '')),
    h('label.field', h('span', 'E-mail'), h('input.input', { value: me.email || '', disabled: true })),
    h('div.row.end', h('button.btn.primary', { type: 'submit' }, icon('check'), 'Enregistrer')));

  const cfg = dbConfig();
  clear(view,
    h('div.page-head', h('div', h('p.eyebrow', STUDIO.app), h('h1.h1', 'Réglages'))),
    h('div.settings-grid',
      f,
      h('div.col',
        h('div.panel',
          h('h3', icon('download'), 'Installer l\'app'),
          h('p.muted', 'PC Windows : installateur .exe. Android : fichier .apk. iPhone : ouvre la version web dans Safari puis « Partager › Sur l\'écran d\'accueil ».'),
          h('div.col', { style: { gap: '8px' } },
            h('a.btn.primary.full', { href: DOWNLOADS, target: '_blank', rel: 'noopener' }, icon('download'), 'PC et Android'),
            h('a.btn.full', { href: WEB_URL, target: '_blank', rel: 'noopener' }, icon('globe'), 'Version web (iPhone)'))),
        h('div.panel',
          h('h3', icon('database'), 'Base de données'),
          api.mode === 'demo'
            ? h('p.muted', 'Mode démo : les données restent sur cet appareil. Branche la base Supabase pour travailler en équipe.')
            : h('p.muted', 'Connecté à ', h('code', cfg?.url?.replace('https://', '') || ''), cfg?.source === 'saved' ? ' (réglage de cet appareil)' : ''),
          h('button.btn.small', { onclick: dbDialog }, icon('database'), api.mode === 'demo' ? 'Brancher la base' : 'Changer de base')),
        h('div.panel',
          h('h3', icon('sun'), 'Apparence'),
          h('label.toggle', h('input', { type: 'checkbox', checked: localStorage.getItem('pt.motion') === 'off', onchange: e => { localStorage.setItem('pt.motion', e.target.checked ? 'off' : 'on'); document.documentElement.classList.toggle('no-motion', e.target.checked); } }), h('span', 'Réduire les animations'))),
        h('div.panel',
          h('h3', icon('logout'), 'Session'),
          h('button.btn.danger.full', { onclick: () => api.signOut() }, icon('logout'), 'Se déconnecter')),
        h('p.muted.small.center', `${STUDIO.app} · ${STUDIO.name}`))));
}
