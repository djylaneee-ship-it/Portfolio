// Progrès : fil des avancées du projet (captures, vidéos, versions, devlogs), likes, commentaires, temps réel.
import { api } from '../api.js';
import {
  h, clear, icon, avatar, person, md, timeAgo, menu, form, toast, fail, uploadFiles, pickFiles, lightbox, confirmBox, empty,
} from '../ui.js';
import { isAdmin, logActivity } from '../store.js';

export const KINDS = [
  { id: 'progress', label: 'Progrès', icon: '🚀', color: '#F5B935' },
  { id: 'release', label: 'Mise à jour', icon: '📦', color: '#3CC9A0' },
  { id: 'milestone', label: 'Étape', icon: '🏁', color: '#8B7CF6' },
  { id: 'devlog', label: 'Devlog', icon: '📝', color: '#4FA3F7' },
];
const kind = id => KINDS.find(k => k.id === id) || KINDS[0];
const PAGE = 30;

export default async function progress(box, { project: p }) {
  const me = api.me;
  let posts = [];
  let comments = [];
  let filter = 'all';
  let limit = PAGE;
  let hasMore = false;
  const openComments = new Set();

  // ---------- Composer ----------
  let ckind = 'progress';
  let media = [];
  const kindRow = h('div.pc-kinds');
  const titleIn = h('input.input.pc-title', { placeholder: 'Titre (facultatif) — ex : Nouvelle map du lobby', maxLength: 140 });
  const bodyIn = h('textarea.input.pc-body', { rows: 3, placeholder: 'Qu\'as-tu avancé ? Markdown accepté : **gras**, listes, `code`… Colle ou glisse des captures ici.' });
  const mediaBox = h('div.pc-media', { hidden: true });
  const publishBtn = h('button.btn.primary', { onclick: publish }, icon('send'), 'Publier');
  const composer = h('div.panel.post-composer',
    h('div.pc-top', avatar(me, 40), h('div.pc-fields', kindRow, titleIn, bodyIn)),
    mediaBox,
    h('div.pc-actions',
      h('button.btn.small', { onclick: async () => addMedia(await pickFiles({ accept: 'image/*,video/*', multiple: true })) }, icon('image'), 'Images / vidéos'),
      h('span.muted.small.pc-hint', 'Ctrl + Entrée pour publier'),
      publishBtn));
  const drawKinds = () => clear(kindRow, KINDS.map(k => h('button.pc-kind' + (k.id === ckind ? '.on' : ''), { style: { '--c': k.color }, onclick: () => { ckind = k.id; drawKinds(); } }, k.icon, ' ', k.label)));
  drawKinds();
  const drawMedia = () => {
    mediaBox.hidden = !media.length;
    clear(mediaBox, media.map((f, i) => h('div.pc-thumb' + (f.loading ? '.loading-att' : ''),
      f.url && (f.type || '').startsWith('image/') ? h('img', { src: f.url, alt: '' }) : f.url && (f.type || '').startsWith('video/') ? h('video', { src: f.url, muted: true }) : h('span', icon('image')),
      h('button.icon-btn', { title: 'Retirer', onclick: () => { media.splice(i, 1); drawMedia(); } }, icon('x')))));
  };
  async function addMedia(files) {
    files = [...files].filter(f => /^(image|video)\//.test(f.type)).slice(0, 12);
    if (!files.length) return;
    const slots = files.map(f => ({ name: f.name, type: f.type, loading: true }));
    media.push(...slots); drawMedia();
    for (let i = 0; i < files.length; i++) {
      try { Object.assign(slots[i], (await uploadFiles([files[i]], 'progress'))[0], { loading: false }); }
      catch (e) { fail(e); media.splice(media.indexOf(slots[i]), 1); }
      drawMedia();
    }
  }
  bodyIn.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addMedia(f); } });
  bodyIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); publish(); } });
  bodyIn.addEventListener('input', () => { bodyIn.style.height = 'auto'; bodyIn.style.height = Math.min(bodyIn.scrollHeight, 360) + 'px'; });
  composer.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); composer.classList.add('drop'); } });
  composer.addEventListener('dragleave', e => { if (!composer.contains(e.relatedTarget)) composer.classList.remove('drop'); });
  composer.addEventListener('drop', e => { e.preventDefault(); composer.classList.remove('drop'); addMedia(e.dataTransfer.files); });

  async function publish() {
    if (media.some(m => m.loading)) return toast('Attends la fin de l\'envoi des fichiers…');
    const body = bodyIn.value.trim();
    const title = titleIn.value.trim();
    if (!body && !title && !media.length) { bodyIn.focus(); return toast('Écris quelque chose ou ajoute une image.'); }
    publishBtn.disabled = true;
    try {
      const post = await api.insert('pt_posts', {
        project_id: p.id, author: me.id, kind: ckind, title, body,
        media: media.map(({ url, name, type, size }) => ({ url, name, type, size })), likes: [], pinned: false,
      });
      if (!posts.some(x => x.id === post.id)) { posts.unshift(post); draw(); }
      logActivity(p.id, 'post', `a posté ${kind(ckind).label.toLowerCase() === 'progrès' ? 'un progrès' : 'un ' + kind(ckind).label.toLowerCase()}${title ? ` : « ${title} »` : ''}`, `#/p/${p.id}/progress`);
      titleIn.value = ''; bodyIn.value = ''; bodyIn.style.height = ''; media = []; drawMedia();
      toast('Publié !', 'ok');
    } catch (e) { fail(e); } finally { publishBtn.disabled = false; }
  }

  // ---------- Fil ----------
  const filters = h('div.pf-filters');
  const feed = h('div.post-feed');
  const more = h('div.center', { hidden: true }, h('button.btn.small.ghost', { onclick: () => { limit += PAGE; load().then(draw).catch(fail); } }, 'Voir les posts plus anciens'));
  clear(box, h('div.progress-page', composer, filters, feed, more));

  function drawFilters() {
    const count = id => posts.filter(x => x.kind === id).length;
    clear(filters, [{ id: 'all', label: 'Tout', icon: '✦' }, ...KINDS].map(k => h('button.pf' + (filter === k.id ? '.on' : ''), { onclick: () => { filter = k.id; draw(); } },
      k.icon, ' ', k.label, k.id !== 'all' && count(k.id) ? h('b', String(count(k.id))) : null)));
  }

  async function load() {
    const [rows, coms] = await Promise.all([
      api.select('pt_posts', { eq: { project_id: p.id }, order: [['created_at', 'desc']], limit: limit + 1 }),
      api.select('pt_comments', { eq: { project_id: p.id, target_type: 'post' }, order: [['created_at', 'asc']] }).catch(() => []),
    ]);
    hasMore = rows.length > limit;
    posts = rows.slice(0, limit);
    comments = coms;
  }

  function draw() {
    drawFilters();
    const list = posts.filter(x => filter === 'all' || x.kind === filter).sort((a, b) => (b.pinned - a.pinned) || new Date(b.created_at) - new Date(a.created_at));
    more.hidden = !hasMore;
    clear(feed, list.length ? list.map(postEl) : empty('rocket', filter === 'all' ? 'Aucun progrès posté' : 'Rien dans cette catégorie',
      'Partage une capture, une vidéo ou un devlog : toute l\'équipe verra l\'avancée du jeu.'));
  }

  function postEl(post) {
    const a = person(post.author);
    const k = kind(post.kind);
    const mine = post.author === me.id;
    const liked = (post.likes || []).includes(me.id);
    const coms = comments.filter(c => c.target_id === post.id);
    const showComs = openComments.has(post.id);
    const imgs = (post.media || []).filter(m => (m.type || '').startsWith('image/'));
    const vids = (post.media || []).filter(m => (m.type || '').startsWith('video/'));
    return h('article.post' + (post.pinned ? '.pinned' : ''), { dataset: { id: post.id }, style: { '--c': k.color } },
      h('header.post-head',
        avatar(a, 42),
        h('div.post-who', h('b', a.display_name), h('small.muted', a.title ? a.title + ' · ' : '', h('time', { title: new Date(post.created_at).toLocaleString('fr-FR') }, timeAgo(post.created_at)))),
        post.pinned ? h('span.post-pin', { title: 'Épinglé' }, icon('pin')) : null,
        h('span.post-kind', k.icon, ' ', k.label),
        (mine || isAdmin()) ? h('button.icon-btn', { title: 'Options', onclick: e => postMenu(e.currentTarget, post, mine) }, icon('more')) : null),
      post.title ? h('h3.post-title', post.title) : null,
      post.body ? h('div.post-body.md', { html: md(post.body) }) : null,
      imgs.length ? h('div.post-media.n' + Math.min(imgs.length, 4), imgs.slice(0, 4).map((m, i) => h('button.pm', { onclick: () => lightbox(m.url) },
        h('img', { src: m.url, alt: m.name || '', loading: 'lazy' }), i === 3 && imgs.length > 4 ? h('span.pm-more', '+' + (imgs.length - 4)) : null))) : null,
      imgs.length > 4 ? h('div.post-extra', imgs.slice(4).map(m => h('img', { src: m.url, alt: '', loading: 'lazy', onclick: () => lightbox(m.url) }))) : null,
      vids.map(v => h('video.post-video', { src: v.url, controls: true, preload: 'metadata', playsInline: true })),
      h('footer.post-foot',
        h('button.pa' + (liked ? '.on' : ''), { title: (post.likes || []).map(id => person(id).display_name).join(', ') || 'J\'aime', onclick: () => like(post) },
          icon('heart'), h('span', (post.likes || []).length ? String(post.likes.length) : 'J\'aime')),
        h('button.pa' + (showComs ? '.open' : ''), { onclick: () => { showComs ? openComments.delete(post.id) : openComments.add(post.id); draw(); if (!showComs) setTimeout(() => feed.querySelector(`[data-id="${post.id}"] .pc-in`)?.focus(), 30); } },
          icon('comment'), h('span', coms.length ? `${coms.length} commentaire${coms.length > 1 ? 's' : ''}` : 'Commenter')),
        (post.likes || []).length ? h('span.avatars.post-likers', (post.likes || []).slice(0, 5).map(id => avatar(id, 22))) : null),
      showComs ? commentsEl(post, coms) : null);
  }

  function commentsEl(post, coms) {
    const inp = h('input.input.pc-in', { placeholder: 'Écrire un commentaire…', maxLength: 2000, onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); comment(); } } });
    async function comment() {
      const body = inp.value.trim();
      if (!body) return;
      inp.value = '';
      try {
        const c = await api.insert('pt_comments', { project_id: p.id, target_type: 'post', target_id: post.id, author: me.id, body });
        if (!comments.some(x => x.id === c.id)) { comments.push(c); draw(); }
        feed.querySelector(`[data-id="${post.id}"] .pc-in`)?.focus();
      } catch (e) { fail(e); inp.value = body; }
    }
    return h('div.post-comments',
      coms.map(c => h('div.pcom', avatar(person(c.author), 28),
        h('div.pcom-bubble', h('div.row', h('b', person(c.author).display_name), h('small.muted', timeAgo(c.created_at)),
          c.author === me.id || isAdmin() ? h('button.pcom-del', { title: 'Supprimer', onclick: async () => { if (await confirmBox('Supprimer ce commentaire ?', { ok: 'Supprimer' })) api.remove('pt_comments', c.id).catch(fail); } }, icon('trash')) : null),
          h('div.md', { html: md(c.body) })))),
      h('div.pcom.new', avatar(me, 28), inp, h('button.icon-btn', { title: 'Envoyer', onclick: comment }, icon('send'))));
  }

  async function like(post) {
    const ids = new Set(post.likes || []);
    ids.has(me.id) ? ids.delete(me.id) : ids.add(me.id);
    post.likes = [...ids];
    draw();
    try {
      const fresh = await api.get('pt_posts', post.id);
      const f = new Set(fresh?.likes || []);
      ids.has(me.id) ? f.add(me.id) : f.delete(me.id);
      await api.update('pt_posts', post.id, { likes: [...f] });
    } catch (e) { fail(e); }
  }

  function postMenu(anchor, post, mine) {
    menu(anchor, [
      { label: post.pinned ? 'Désépingler' : 'Épingler en haut', icon: 'pin', onclick: () => api.update('pt_posts', post.id, { pinned: !post.pinned }).then(r => { if (r) Object.assign(post, r); draw(); }).catch(fail) },
      mine ? { label: 'Modifier', icon: 'edit', onclick: () => edit(post) } : null,
      '-',
      { label: 'Supprimer', icon: 'trash', danger: true, onclick: async () => {
        if (!(await confirmBox('Supprimer ce post ?', { ok: 'Supprimer' }))) return;
        try { await api.remove('pt_posts', post.id); posts = posts.filter(x => x.id !== post.id); draw(); } catch (e) { fail(e); }
      } },
    ], { align: 'right' });
  }

  async function edit(post) {
    const v = await form('Modifier le post', [
      { name: 'kind', label: 'Type', type: 'select', value: post.kind, options: KINDS.map(k => ({ value: k.id, label: `${k.icon} ${k.label}` })) },
      { name: 'title', label: 'Titre', value: post.title || '' },
      { name: 'body', label: 'Texte', type: 'textarea', rows: 6, value: post.body || '' },
    ], { wide: true });
    if (!v) return;
    try { const r = await api.update('pt_posts', post.id, v); Object.assign(post, r || v); draw(); } catch (e) { fail(e); }
  }

  // ---------- Temps réel ----------
  const offPosts = api.subscribe('pt_posts', { project_id: p.id }, ({ type, row, old }) => {
    if (type === 'DELETE') posts = posts.filter(x => x.id !== old?.id);
    else if (row?.project_id === p.id) {
      const i = posts.findIndex(x => x.id === row.id);
      i < 0 ? posts.unshift(row) : (posts[i] = row);
    }
    draw();
  });
  const offComs = api.subscribe('pt_comments', { project_id: p.id }, ({ type, row, old }) => {
    if (type === 'DELETE') comments = comments.filter(c => c.id !== old?.id);
    else if (row?.target_type === 'post' && !comments.some(c => c.id === row.id)) comments.push(row);
    else if (row) comments = comments.map(c => (c.id === row.id ? row : c));
    draw();
  });

  clear(feed, h('div.loading', 'Chargement…'));
  try { await load(); } catch (e) { fail(e); }
  draw();

  return () => { offPosts(); offComs(); };
}

