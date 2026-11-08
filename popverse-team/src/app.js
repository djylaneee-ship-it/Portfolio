// Coquille de l'app : connexion, barre latérale, routes (#/...), panneau Copilot IA.
import { api, dbConfig, saveDbConfig } from './api.js';
import { h, clear, icon, $, $$, toast, fail, avatar, loadPeople, modal, form } from './ui.js';
import { state, loadProjects, onProjects, go, project } from './store.js';
import { STUDIO } from './config.js';
import home from './views/home.js';
import projects from './views/projects.js';
import projectView from './views/project.js';
import chat from './views/chat.js';
import team from './views/team.js';
import settings from './views/settings.js';
import { toggleCopilot } from './views/ai.js';

const ROUTES = [
  { re: /^\/?$/, view: home, nav: 'home' },
  { re: /^\/projects$/, view: projects, nav: 'projects' },
  { re: /^\/p\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/, view: projectView, nav: 'projects', keys: ['id', 'tab', 'sub'] },
  { re: /^\/chat(?:\/([^/]+))?$/, view: chat, nav: 'chat', keys: ['channel'] },
  { re: /^\/team$/, view: team, nav: 'team' },
  { re: /^\/settings$/, view: settings, nav: 'settings' },
];

const root = document.getElementById('app');
let cleanup = null;

// ---------------- Connexion / inscription ----------------
function authScreen() {
  document.body.classList.add('auth-mode');
  let mode = 'login';
  const err = h('div.auth-err', { hidden: true });
  const fields = h('div.auth-fields');
  const submit = h('button.btn.primary.big', { type: 'submit' });
  const switcher = h('div.auth-switch');
  const draw = () => {
    clear(fields,
      mode === 'signup' ? h('label.field', h('span', 'Pseudo'), h('input.input', { name: 'username', required: true, maxLength: 32, placeholder: 'Ex : NovaDev', autocomplete: 'nickname' })) : null,
      h('label.field', h('span', 'E-mail'), h('input.input', { name: 'email', type: 'email', required: true, placeholder: 'toi@exemple.com', autocomplete: 'email' })),
      h('label.field', h('span', 'Mot de passe'), h('input.input', { name: 'password', type: 'password', required: true, minLength: 6, placeholder: '6 caractères minimum', autocomplete: mode === 'login' ? 'current-password' : 'new-password' })),
      mode === 'signup' ? h('label.field', h('span', 'Code d\'équipe'), h('input.input', { name: 'code', placeholder: 'Donné par un admin (vide pour le tout premier compte)', autocomplete: 'off' })) : null,
    );
    submit.textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
    clear(switcher, mode === 'login'
      ? ['Pas encore de compte ? ', h('a', { href: '#', onclick: e => { e.preventDefault(); mode = 'signup'; draw(); } }, 'Créer un compte')]
      : ['Déjà un compte ? ', h('a', { href: '#', onclick: e => { e.preventDefault(); mode = 'login'; draw(); } }, 'Se connecter')],
      mode === 'login' && api.mode === 'online' ? h('a.forgot', { href: '#', onclick: forgot }, 'Mot de passe oublié ?') : null);
    err.hidden = true;
  };
  async function forgot(e) {
    e.preventDefault();
    const v = await form('Mot de passe oublié', [{ name: 'email', label: 'E-mail du compte', type: 'email', required: true }], { submit: 'Envoyer le lien' });
    if (v) api.resetPassword(v.email).then(() => toast('Lien envoyé, regarde tes e-mails.', 'ok')).catch(fail);
  }
  const f = h('form.auth-form', {
    onsubmit: async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      submit.disabled = true; err.hidden = true;
      try {
        if (mode === 'login') await api.signIn(d.email.trim(), d.password);
        else {
          const r = await api.signUp({ email: d.email.trim(), password: d.password, username: d.username.trim(), code: d.code || '' });
          if (r.needsConfirm) { toast('Compte créé ! Confirme ton e-mail puis connecte-toi.', 'ok', 8000); mode = 'login'; draw(); }
        }
      } catch (ex) {
        let m = ex.message || String(ex);
        if (/Invalid login/i.test(m)) m = 'E-mail ou mot de passe incorrect.';
        if (/Code d.équipe invalide|Database error saving new user/i.test(m)) m = 'Code d\'équipe invalide. Demande-le à un admin du studio.';
        if (/already registered/i.test(m)) m = 'Cet e-mail a déjà un compte.';
        err.textContent = m; err.hidden = false;
      } finally { submit.disabled = false; }
    },
  }, fields, err, submit, switcher);
  draw();

  clear(root, h('div.auth',
    h('div.aurora', h('i'), h('i'), h('i')),
    h('div.auth-card',
      h('div.auth-logo', h('img', { src: 'assets/logo.png', alt: '' })),
      h('h1.auth-title', h('span.gold-text', 'POPVERSE'), ' TEAM'),
      h('p.muted.center', `L'espace de travail des devs de ${STUDIO.name}.`),
      api.mode === 'demo' ? h('div.demo-banner', icon('database'), h('div',
        h('b', 'Mode démo'), h('span', ' : la base en ligne n\'est pas encore branchée, les données restent sur cet appareil. '),
        h('a', { href: '#', onclick: e => { e.preventDefault(); dbDialog(); } }, 'Brancher la base'))) : null,
      f),
    h('p.auth-foot.muted', `© ${new Date().getFullYear()} ${STUDIO.name}`)));
}

export function dbDialog() {
  const cur = dbConfig();
  form('Base de données en ligne', [
    { name: 'url', label: 'URL du projet Supabase', value: cur?.url || '', placeholder: 'https://xxxx.supabase.co', hint: 'Supabase > Project Settings > API' },
    { name: 'key', label: 'Clé publique (publishable / anon)', value: cur?.key || '', placeholder: 'sb_publishable_… ou eyJ…' },
  ], { submit: 'Enregistrer et relancer' }).then(v => {
    if (!v) return;
    saveDbConfig(v.url && v.key ? { url: v.url.replace(/\/$/, ''), key: v.key } : null);
    location.reload();
  });
}

// ---------------- Coquille ----------------
const NAV = [
  { id: 'home', href: '#/', icon: 'home', label: 'Accueil' },
  { id: 'projects', href: '#/projects', icon: 'gamepad', label: 'Projets' },
  { id: 'chat', href: '#/chat', icon: 'chat', label: 'Messages' },
  { id: 'team', href: '#/team', icon: 'users', label: 'Équipe' },
  { id: 'settings', href: '#/settings', icon: 'settings', label: 'Réglages' },
];

function shell() {
  document.body.classList.remove('auth-mode');
  const me = api.me;
  const side = h('aside.sidebar#sidebar',
    h('a.brand', { href: '#/' },
      h('span.logo', h('img', { src: 'assets/logo.png', alt: '' })),
      h('span.brand-text', h('b', 'POPVERSE'), h('small', 'TEAM'))),
    h('nav.nav#nav', NAV.map(n => h('a', { href: n.href, dataset: { nav: n.id } }, icon(n.icon), h('span', n.label), n.id === 'chat' ? h('i.nav-dot#chat-dot', { hidden: true }) : null))),
    h('div.side-section',
      h('div.side-title', h('span', 'Jeux du studio'), h('a.side-add', { href: '#/projects?new=1', title: 'Nouveau projet' }, icon('plus'))),
      h('div.side-projects#side-projects')),
    h('div.side-user',
      h('a.who', { href: '#/settings' }, avatar(me, 38), h('span.meta', h('b', me.display_name), h('small', [roleLabel(me.role), me.title].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')))),
      h('button.icon-btn', { title: 'Se déconnecter', onclick: () => api.signOut() }, icon('logout'))));

  const top = h('header.topbar',
    h('button.icon-btn.menu-btn', { onclick: () => document.body.classList.toggle('nav-open'), 'aria-label': 'Menu' }, icon('menu')),
    h('div.crumbs#crumbs'),
    h('div.top-actions',
      api.mode === 'demo' ? h('button.chip.warn', { onclick: dbDialog, title: 'Brancher la base en ligne' }, icon('database'), h('span', 'Mode démo')) : h('span.chip.ok', h('i.pulse'), h('span', 'En ligne')),
      h('button.btn.copilot-btn#copilot-btn', { onclick: () => toggleCopilot() }, icon('spark'), h('span', 'Copilot'))));

  const mobileNav = h('nav.mobile-nav', NAV.slice(0, 4).map(n => h('a', { href: n.href, dataset: { nav: n.id } }, icon(n.icon), h('span', n.label))),
    h('a', { href: '#', onclick: e => { e.preventDefault(); toggleCopilot(); }, dataset: { nav: 'ai' } }, icon('spark'), h('span', 'Copilot')));

  clear(root,
    h('div.aurora', h('i'), h('i'), h('i')),
    h('div.app', side, h('div.scrim', { onclick: () => document.body.classList.remove('nav-open') }),
      h('main.main', top, h('div.view#view'))),
    h('aside.copilot#copilot'),
    mobileNav);

  const drawProjects = () => {
    const box = $('#side-projects');
    if (!box) return;
    const list = state.projects.filter(p => !p.archived);
    clear(box, list.length ? list.map(p => h('a.side-project', { href: `#/p/${p.id}`, dataset: { pid: p.id } },
      h('span.pico', { style: { '--c': p.color || '#F5B935' } }, p.cover_url ? h('img', { src: p.cover_url, alt: '' }) : p.icon || '🎮'),
      h('span.pname', p.name),
      p.status === 'live' ? h('i.live-dot', { title: 'En ligne sur Roblox' }) : null))
      : h('a.side-empty', { href: '#/projects?new=1' }, icon('plus'), 'Créer le premier projet'));
    markNav();
  };
  onProjects(drawProjects);
  drawProjects();
}

const roleLabel = r => ({ owner: 'Fondateur', admin: 'Admin', member: 'Membre', disabled: 'Désactivé' }[r] || r);
export { roleLabel };

function markNav() {
  const path = location.hash.slice(1).split('?')[0] || '/';
  const r = ROUTES.find(r => r.re.test(path));
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r?.nav && !(r?.nav === 'projects' && path.startsWith('/p/'))));
  const pid = path.match(/^\/p\/([^/]+)/)?.[1];
  $$('.side-project').forEach(a => a.classList.toggle('active', a.dataset.pid === pid));
}

export function setCrumbs(...parts) {
  const c = $('#crumbs');
  if (!c) return;
  clear(c, parts.filter(Boolean).map((p, i) => [i ? h('span.sep', '/') : null, typeof p === 'string' ? h('span', p) : h('a', { href: p.href }, p.label)]));
}

async function route() {
  if (!api.me) return;
  const [path, qs] = location.hash.slice(1).split('?');
  const r = ROUTES.find(r => r.re.test(path || '/')) || ROUTES[0];
  const m = (path || '/').match(r.re) || [];
  const params = Object.fromEntries((r.keys || []).map((k, i) => [k, m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined]));
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  document.body.classList.remove('nav-open');
  const view = $('#view');
  if (!view) return;
  // Même projet, autre onglet : la vue projet gère elle-même le changement (pas de rechargement complet).
  if (cleanup?.sameRoute?.(r.view, params, query)) { markNav(); return; }
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  view.className = 'view entering';
  clear(view);
  document.body.dataset.route = r.nav;
  setCrumbs();
  markNav();
  try {
    cleanup = (await r.view(view, { params, query })) || null;
  } catch (e) { fail(e); clear(view, h('div.empty', h('h3', 'Oups'), h('p.muted', e.message))); }
  setTimeout(() => view.classList.remove('entering'), 700);
}

// Pastille « nouveaux messages » sur l'onglet Messages.
function watchUnread() {
  api.subscribe('pt_messages', null, ({ type, row }) => {
    if (type !== 'INSERT' || row.author === api.me?.id) return;
    if (!location.hash.startsWith('#/chat')) $('#chat-dot')?.removeAttribute('hidden');
  });
  addEventListener('hashchange', () => { if (location.hash.startsWith('#/chat')) $('#chat-dot')?.setAttribute('hidden', ''); });
}

// Dernière présence (affichée dans Équipe).
function heartbeat() {
  const beat = () => api.me && api.update('pt_profiles', api.me.id, { last_seen: new Date().toISOString() }).catch(() => {});
  beat();
  setInterval(beat, 120_000);
}

async function start() {
  try { await api.init(); } catch (e) { console.error(e); }
  api.onRecovery(async () => {
    const v = await form('Nouveau mot de passe', [{ name: 'password', label: 'Nouveau mot de passe', type: 'password', required: true, placeholder: '6 caractères minimum' }], { submit: 'Changer' });
    if (v) api.updatePassword(v.password).then(() => toast('Mot de passe changé', 'ok')).catch(fail);
  });
  api.onAuth(me => { if (!me) { cleanup?.(); cleanup = null; authScreen(); } else boot(); });
  if (api.me) boot(); else authScreen();
}

let booted = false;
async function boot() {
  const me = api.me;
  if (!me) return authScreen();
  if (me.role === 'disabled') {
    clear(root, h('div.auth', h('div.auth-card', h('h2', 'Compte désactivé'), h('p.muted', 'Un admin du studio a désactivé ce compte.'), h('button.btn', { onclick: () => api.signOut() }, 'Se déconnecter'))));
    return;
  }
  shell();
  await Promise.all([loadPeople(true), loadProjects()]).catch(fail);
  if (!booted) {
    booted = true;
    addEventListener('hashchange', route);
    watchUnread();
    heartbeat();
  }
  route();
}

// Raccourci clavier : Ctrl+J ouvre Copilot.
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j' && api.me) { e.preventDefault(); toggleCopilot(); }
});

export { project, go };
start();

if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) navigator.serviceWorker.register('sw.js').catch(() => {});
