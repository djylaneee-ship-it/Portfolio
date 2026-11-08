// Messages façon Discord : salons généraux, salons par projet, messages privés.
// Temps réel (pt_messages), présence / « en train d'écrire » (api.presence), non-lus (pt_reads).
import { api } from '../api.js';
import {
  h, clear, icon, avatar, person, allPeople, md, timeAgo, fmtTime, fmtDate, menu, form, toast, fail,
  uploadFiles, pickFiles, lightbox, confirmBox, empty, debounce, modal,
} from '../ui.js';
import { state, isAdmin, onProjects, go } from '../store.js';
import { setCrumbs } from '../app.js';

const REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '👀', '✅', '😮', '😢', '🙏', '💯', '🚀'];
const GROUP_GAP = 5 * 60e3;
const PAGE = 60;
const isMobile = () => matchMedia('(max-width: 820px)').matches;

// Trouve (ou crée) le salon privé entre moi et `userId`, puis l'ouvre.
export async function openDM(userId) {
  const me = api.me;
  if (!me || userId === me.id) return;
  try {
    const dms = await api.select('pt_channels', { eq: { kind: 'dm' } });
    let ch = dms.find(c => (c.members || []).length === 2 && c.members.includes(me.id) && c.members.includes(userId));
    if (!ch) ch = await api.insert('pt_channels', { name: 'dm', kind: 'dm', members: [me.id, userId], position: 0, created_by: me.id });
    go('/chat/' + ch.id);
  } catch (e) { fail(e); }
}

export default async function chat(view, { params }) {
  setCrumbs('Messages');
  const me = api.me;
  view.classList.add('chat-view');

  // ---------- État ----------
  let channels = [];
  let current = null;            // salon ouvert
  let msgs = [];                 // messages du salon ouvert (ordre chronologique)
  let hasMore = false;
  let replyTo = null;            // message auquel on répond
  let pending = [];              // pièces jointes prêtes à partir
  let editing = null;            // id du message en cours d'édition
  let online = [];               // présence
  const typing = new Map();      // userId -> { channel, until }
  const reads = new Map();       // channelId -> read_at (ISO)
  const readRows = new Set();    // salons qui ont déjà une ligne pt_reads
  const last = new Map();        // channelId -> { at, author }

  // ---------- Squelette ----------
  const side = h('aside.chat-side');
  const roomHead = h('header.room-head');
  const list = h('div.msg-list');
  const scroller = h('div.msg-scroll', list);
  const typingBar = h('div.typing');
  const replyBar = h('div.reply-bar', { hidden: true });
  const attachBar = h('div.attach-bar', { hidden: true });
  const input = h('textarea.composer-input', { rows: 1, placeholder: 'Écris un message…', maxLength: 4000 });
  const mentionBox = h('div.mention-box', { hidden: true });
  const composer = h('div.composer',
    replyBar, attachBar, mentionBox,
    h('div.composer-row',
      h('button.icon-btn', { title: 'Joindre un fichier', onclick: attach }, icon('paperclip')),
      input,
      h('button.icon-btn', { title: 'Emoji', onclick: e => menuEmoji(e.currentTarget, em => insertText(em)) }, icon('smile')),
      h('button.btn.primary.small.send-btn', { title: 'Envoyer (Entrée)', onclick: send }, icon('send'))));
  const lockNote = h('div.composer-lock', { hidden: true }, icon('lock'), h('span', 'Seuls les admins peuvent écrire dans ce salon.'));
  const room = h('section.chat-room', roomHead, scroller, typingBar, composer, lockNote);
  const members = h('aside.chat-members');
  const layout = h('div.chat-layout', side, room, members);
  clear(view, layout);

  // ---------- Chargement ----------
  async function loadChannels() {
    channels = await api.select('pt_channels', { order: [['position', 'asc'], ['created_at', 'asc']] });
    channels = channels.filter(c => c.kind !== 'dm' || (c.members || []).includes(me.id));
  }
  async function loadUnread() {
    const [rs, recent] = await Promise.all([
      api.select('pt_reads', { eq: { user_id: me.id } }).catch(() => []),
      api.select('pt_messages', { columns: 'channel_id,created_at,author', order: [['created_at', 'desc']], limit: 400 }).catch(() => []),
    ]);
    rs.forEach(r => { reads.set(r.channel_id, r.read_at); readRows.add(r.channel_id); });
    for (const m of recent) if (!last.has(m.channel_id)) last.set(m.channel_id, { at: m.created_at, author: m.author });
  }
  const unread = c => {
    const l = last.get(c.id);
    if (!l || l.author === me.id || c.id === current?.id) return false;
    const r = reads.get(c.id);
    return !r || new Date(l.at) > new Date(r);
  };

  const markRead = debounce(async cid => {
    const now = new Date().toISOString();
    reads.set(cid, now);
    try {
      if (readRows.has(cid)) await api.updateWhere('pt_reads', { user_id: me.id, channel_id: cid }, { read_at: now });
      else { readRows.add(cid); await api.insert('pt_reads', { user_id: me.id, channel_id: cid, read_at: now }); }
    } catch (e) { console.warn(e); }
  }, 600);

  // ---------- Colonne des salons ----------
  function chName(c) {
    if (c.kind !== 'dm') return c.name;
    const other = (c.members || []).find(id => id !== me.id) || me.id;
    return person(other).display_name;
  }
  function chIcon(c) {
    if (c.kind === 'dm') return avatar(person((c.members || []).find(id => id !== me.id) || me.id), 26);
    return h('span.ch-hash', icon(c.kind === 'announce' ? 'bell' : 'hash'));
  }
  function chLink(c) {
    const isOnline = c.kind === 'dm' && online.some(o => o?.id === (c.members || []).find(id => id !== me.id));
    return h('a.ch-item' + (c.id === current?.id ? '.active' : '') + (unread(c) ? '.unread' : ''), {
      href: '#/chat/' + c.id,
      oncontextmenu: e => { e.preventDefault(); channelMenu(e, c); },
    }, chIcon(c), h('span.ch-name', chName(c)), isOnline ? h('i.ch-online') : null, unread(c) ? h('i.ch-dot') : null);
  }
  function drawSide() {
    const general = channels.filter(c => !c.project_id && c.kind !== 'dm');
    const dms = channels.filter(c => c.kind === 'dm').sort((a, b) => new Date(last.get(b.id)?.at || b.created_at) - new Date(last.get(a.id)?.at || a.created_at));
    const byProject = state.projects.filter(p => !p.archived).map(p => [p, channels.filter(c => c.project_id === p.id && c.kind !== 'dm')]).filter(([, l]) => l.length);
    clear(side,
      h('div.chat-side-head', h('h2', 'Messages'), h('button.icon-btn', { title: 'Nouveau salon', onclick: () => editChannel(null) }, icon('plus'))),
      h('div.ch-scroll',
        h('div.ch-group', h('div.ch-title', 'Studio'), general.map(chLink)),
        byProject.map(([p, l]) => h('div.ch-group', h('div.ch-title', h('span', p.icon || '🎮'), ' ', p.name), l.map(chLink))),
        h('div.ch-group',
          h('div.ch-title', h('span', 'Messages privés'), h('button.ch-add', { title: 'Nouveau message privé', onclick: newDM }, icon('plus'))),
          dms.length ? dms.map(chLink) : h('p.ch-empty.muted', 'Aucune conversation privée.'))));
  }

  async function newDM(e) {
    const others = allPeople().filter(p => p.id !== me.id && p.role !== 'disabled');
    if (!others.length) return toast('Personne d\'autre dans l\'équipe pour l\'instant.');
    menu(e.currentTarget, others.map(p => ({ label: p.display_name, onclick: () => openDM(p.id) })));
  }

  async function editChannel(c) {
    const projOpts = [{ value: '', label: '— Tout le studio —' }, ...state.projects.filter(p => !p.archived).map(p => ({ value: p.id, label: `${p.icon || '🎮'} ${p.name}` }))];
    const fields = [
      { name: 'name', label: 'Nom du salon', value: c?.name || '', required: true, placeholder: 'ex : idées-de-maps' },
      { name: 'topic', label: 'Sujet', value: c?.topic || '', placeholder: 'De quoi parle ce salon ?' },
    ];
    if (!c) fields.push({ name: 'project_id', label: 'Projet', type: 'select', value: current?.project_id || '', options: projOpts });
    if (isAdmin()) fields.push({ name: 'kind', label: 'Type', type: 'select', value: c?.kind || 'text', options: [{ value: 'text', label: 'Discussion' }, { value: 'announce', label: 'Annonces (seuls les admins écrivent)' }] });
    const v = await form(c ? 'Modifier le salon' : 'Nouveau salon', fields, { submit: c ? 'Enregistrer' : 'Créer' });
    if (!v) return;
    const name = v.name.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 40);
    try {
      if (c) {
        const nc = await api.update('pt_channels', c.id, { name, topic: v.topic, ...(v.kind ? { kind: v.kind } : {}) });
        if (nc) Object.assign(c, nc);
        drawSide(); if (current?.id === c.id) drawHead();
      } else {
        const nc = await api.insert('pt_channels', { name, topic: v.topic, project_id: v.project_id || null, kind: v.kind || 'text', position: Date.now(), created_by: me.id });
        if (!channels.some(x => x.id === nc.id)) channels.push(nc);
        go('/chat/' + nc.id);
      }
    } catch (e) { fail(e); }
  }
  function channelMenu(e, c) {
    if (c.kind === 'dm') return;
    const canEdit = isAdmin() || c.created_by === me.id;
    menu(e.currentTarget || e, [
      canEdit ? { label: 'Modifier', icon: 'edit', onclick: () => editChannel(c) } : null,
      { label: 'Marquer comme lu', icon: 'check', onclick: () => { markRead(c.id); last.delete(c.id); drawSide(); } },
      canEdit ? '-' : null,
      canEdit ? { label: 'Supprimer le salon', icon: 'trash', danger: true, onclick: async () => {
        if (!(await confirmBox(`Supprimer #${c.name} et tous ses messages ?`, { ok: 'Supprimer' }))) return;
        try { await api.remove('pt_channels', c.id); } catch (ex) { fail(ex); }
      } } : null,
    ]);
  }

  // ---------- Salon ouvert ----------
  function drawHead() {
    if (!current) return clear(roomHead);
    const p = current.project_id ? state.projects.find(x => x.id === current.project_id) : null;
    clear(roomHead,
      h('button.icon-btn.room-back', { title: 'Salons', onclick: () => go('/chat') }, icon('reply')),
      current.kind === 'dm' ? avatar(person((current.members || []).find(id => id !== me.id) || me.id), 30) : h('span.room-hash', icon(current.kind === 'announce' ? 'bell' : 'hash')),
      h('div.room-title', h('b', chName(current)), current.topic ? h('small.muted', current.topic) : p ? h('small.muted', `${p.icon || '🎮'} ${p.name}`) : null),
      h('div.room-actions',
        h('button.icon-btn', { title: 'Messages épinglés', onclick: showPins }, icon('pin')),
        current.kind !== 'dm' ? h('button.icon-btn', { title: 'Options du salon', onclick: e => channelMenu(e, current) }, icon('more')) : null,
        h('button.icon-btn.members-toggle', { title: 'Membres', onclick: () => layout.classList.toggle(matchMedia('(max-width: 1100px)').matches ? 'show-members' : 'hide-members') }, icon('users'))));
    setCrumbs({ label: 'Messages', href: '#/chat' }, (current.kind === 'dm' ? '@' : '#') + chName(current));
  }

  async function openChannel(id) {
    let c = id ? channels.find(x => x.id === id) : null;
    if (id && !c) {
      await loadChannels().catch(fail);
      c = channels.find(x => x.id === id);
      if (!c) { toast('Salon introuvable.', 'error'); go('/chat'); return; }
    }
    if (!c && !isMobile()) c = channels.find(x => !x.project_id && x.kind !== 'dm') || channels[0];
    current = c || null;
    replyTo = null; pending = []; editing = null;
    drawReply(); drawAttach();
    layout.classList.toggle('show-room', !!current);
    drawSide();
    if (!current) { setCrumbs('Messages'); clear(roomHead); clear(list, empty('chat', 'Choisis un salon', 'Ou crée-en un avec le bouton +.')); return; }
    drawHead();
    const locked = current.kind === 'announce' && !isAdmin();
    composer.hidden = locked; lockNote.hidden = !locked;
    input.placeholder = current.kind === 'dm' ? `Message à @${chName(current)}` : `Message dans #${chName(current)}`;
    clear(list, h('div.loading', 'Chargement…'));
    try {
      const rows = await api.select('pt_messages', { eq: { channel_id: current.id }, order: [['created_at', 'desc']], limit: PAGE });
      if (current?.id !== c.id) return;
      msgs = rows.reverse();
      hasMore = rows.length === PAGE;
      drawMessages(true);
      markRead(current.id);
      presence?.update({ ...meta(), typing: null });
    } catch (e) { fail(e); }
    if (!isMobile()) setTimeout(() => input.focus(), 30);
  }

  async function loadMore() {
    if (!msgs.length) return;
    const oldest = msgs[0];
    const before = scroller.scrollHeight;
    try {
      const rows = await api.select('pt_messages', { eq: { channel_id: current.id }, lte: { created_at: oldest.created_at }, order: [['created_at', 'desc']], limit: PAGE + 1 });
      const ids = new Set(msgs.map(m => m.id));
      const fresh = rows.filter(r => !ids.has(r.id)).reverse();
      hasMore = rows.length > PAGE;
      msgs = [...fresh, ...msgs];
      drawMessages(false);
      scroller.scrollTop = scroller.scrollHeight - before;
    } catch (e) { fail(e); }
  }

  // ---------- Rendu des messages ----------
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  function drawMessages(toBottom) {
    const stick = toBottom || nearBottom();
    const byId = new Map(msgs.map(m => [m.id, m]));
    const out = [];
    if (hasMore) out.push(h('div.load-more', h('button.btn.small.ghost', { onclick: loadMore }, 'Charger les messages précédents')));
    else if (current) out.push(h('div.room-start',
      h('div.room-start-ic', current.kind === 'dm' ? avatar(person((current.members || []).find(id => id !== me.id) || me.id), 64) : icon('hash')),
      h('h2', current.kind === 'dm' ? chName(current) : 'Bienvenue dans #' + current.name),
      h('p.muted', current.kind === 'dm' ? 'Début de votre conversation privée.' : current.topic || 'C\'est le début de ce salon.')));
    let prev = null;
    for (const m of msgs) {
      const day = new Date(m.created_at).toDateString();
      if (!prev || new Date(prev.created_at).toDateString() !== day) {
        out.push(h('div.day-sep', h('span', fmtDate(m.created_at, { weekday: 'long', day: 'numeric', month: 'long' }))));
        prev = null;
      }
      const grouped = prev && prev.author === m.author && !m.reply_to && new Date(m.created_at) - new Date(prev.created_at) < GROUP_GAP;
      out.push(msgEl(m, grouped, byId));
      prev = m;
    }
    clear(list, out);
    if (stick) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  }

  function msgEl(m, grouped, byId) {
    const a = person(m.author);
    const mine = m.author === me.id;
    const mentioned = new RegExp(`@${(me.username || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(m.body || '');
    const el = h('div.msg' + (grouped ? '.grouped' : '') + (mentioned ? '.mentioned' : '') + (m.pinned ? '.pinned' : ''), { dataset: { id: m.id } });
    if (m.reply_to) {
      const r = byId.get(m.reply_to);
      el.append(h('div.msg-reply', { onclick: () => jump(m.reply_to) }, icon('reply'),
        r ? [avatar(person(r.author), 16), h('b', person(r.author).display_name), h('span', (r.body || (r.attachments?.length ? '📎 Pièce jointe' : '')).replace(/[*_`~>#]+/g, '').slice(0, 120))]
          : h('span.muted', 'Message d\'origine plus ancien')));
    }
    const gutter = grouped ? h('span.msg-time-side', fmtTime(m.created_at)) : avatar(a, 38);
    const body = h('div.msg-main');
    if (!grouped) body.append(h('div.msg-meta', h('b', { style: { color: a.color } }, a.display_name), a.title ? h('span.msg-role', a.title) : null, h('time', { title: new Date(m.created_at).toLocaleString('fr-FR') }, timeAgo(m.created_at).startsWith('il y a') || timeAgo(m.created_at) === 'à l\'instant' ? fmtTime(m.created_at) : fmtDate(m.created_at) + ' ' + fmtTime(m.created_at))));
    if (editing === m.id) body.append(editBox(m));
    else if (m.body) body.append(h('div.msg-body.md', { html: md(m.body) }, m.edited_at ? h('small.edited', ' (modifié)') : null));
    if (m.attachments?.length) body.append(h('div.msg-files', m.attachments.map(f => (f.type || '').startsWith('image/')
      ? h('img.msg-img', { src: f.url, alt: f.name || '', loading: 'lazy', onclick: () => lightbox(f.url) })
      : (f.type || '').startsWith('video/') ? h('video.msg-video', { src: f.url, controls: true, preload: 'metadata' })
        : h('a.msg-file', { href: f.url, target: '_blank', rel: 'noopener', download: f.name || '' }, icon('paperclip'), h('span', f.name || 'Fichier'), f.size ? h('small.muted', Math.round(f.size / 1024) + ' Ko') : null))));
    const reacts = Object.entries(m.reactions || {}).filter(([, ids]) => ids?.length);
    if (reacts.length) body.append(h('div.reactions', reacts.map(([em, ids]) => h('button.react' + (ids.includes(me.id) ? '.on' : ''), {
      title: ids.map(id => person(id).display_name).join(', '), onclick: () => react(m, em),
    }, em, h('b', String(ids.length)))), h('button.react.add', { title: 'Réagir', onclick: e => menuEmoji(e.currentTarget, em => react(m, em)) }, icon('smile'))));
    const tools = h('div.msg-tools',
      REACTIONS.slice(0, 3).map(em => h('button', { title: 'Réagir ' + em, onclick: () => react(m, em) }, em)),
      h('button', { title: 'Réagir', onclick: e => menuEmoji(e.currentTarget, em => react(m, em)) }, icon('smile')),
      h('button', { title: 'Répondre', onclick: () => { replyTo = m; drawReply(); input.focus(); } }, icon('reply')),
      h('button', { title: 'Plus', onclick: e => msgMenu(e.currentTarget, m, mine) }, icon('more')));
    el.append(h('div.msg-row', h('div.msg-gutter', gutter), body), tools);
    return el;
  }

  function jump(id) {
    const t = list.querySelector(`[data-id="${id}"]`);
    if (!t) return toast('Ce message est plus ancien : charge les messages précédents.');
    t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1600);
  }

  function msgMenu(anchor, m, mine) {
    const canPin = isAdmin() || mine || current.kind === 'dm';
    menu(anchor, [
      { label: 'Répondre', icon: 'reply', onclick: () => { replyTo = m; drawReply(); input.focus(); } },
      m.body ? { label: 'Copier le texte', icon: 'copy', onclick: () => navigator.clipboard?.writeText(m.body).then(() => toast('Copié', 'ok')) } : null,
      canPin ? { label: m.pinned ? 'Désépingler' : 'Épingler', icon: 'pin', onclick: () => api.update('pt_messages', m.id, { pinned: !m.pinned }).catch(fail) } : null,
      mine ? { label: 'Modifier', icon: 'edit', onclick: () => { editing = m.id; drawMessages(); } } : null,
      mine || isAdmin() ? '-' : null,
      mine || isAdmin() ? { label: 'Supprimer', icon: 'trash', danger: true, onclick: async () => {
        if (await confirmBox('Supprimer ce message ?', { ok: 'Supprimer' })) api.remove('pt_messages', m.id).catch(fail);
      } } : null,
    ], { align: 'right' });
  }

  function editBox(m) {
    const ta = h('textarea.input.edit-input', { rows: 2 }, m.body || '');
    const save = async () => {
      const body = ta.value.trim();
      editing = null;
      if (body && body !== m.body) {
        Object.assign(m, { body, edited_at: new Date().toISOString() });
        api.update('pt_messages', m.id, { body, edited_at: m.edited_at }).catch(fail);
      }
      drawMessages();
    };
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.stopPropagation(); editing = null; drawMessages(); }
    });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 20);
    return h('div.edit-wrap', ta, h('small.muted', 'Entrée pour enregistrer · Échap pour annuler'));
  }

  async function react(m, em) {
    const r = { ...(m.reactions || {}) };
    const ids = new Set(r[em] || []);
    ids.has(me.id) ? ids.delete(me.id) : ids.add(me.id);
    if (ids.size) r[em] = [...ids]; else delete r[em];
    m.reactions = r;
    drawMessages();
    try {
      // On relit le message pour ne pas écraser une réaction arrivée entre-temps.
      const fresh = await api.get('pt_messages', m.id);
      const fr = { ...(fresh?.reactions || {}) };
      const fids = new Set(fr[em] || []);
      ids.has(me.id) ? fids.add(me.id) : fids.delete(me.id);
      if (fids.size) fr[em] = [...fids]; else delete fr[em];
      await api.update('pt_messages', m.id, { reactions: fr });
    } catch (e) { fail(e); }
  }

  function menuEmoji(anchor, pick) {
    const m = menu(anchor, [{ label: '' }]);
    clear(m, h('div.emoji-grid', REACTIONS.concat(['👋', '🤔', '😎', '💀', '🙌', '⭐', '🏆', '🐛', '⚡', '🎮', '🛠️', '❓']).map(em =>
      h('button', { onclick: e => { e.stopPropagation(); m.remove(); pick(em); } }, em))));
  }

  async function showPins() {
    const pins = await api.select('pt_messages', { eq: { channel_id: current.id, pinned: true }, order: [['created_at', 'desc']] }).catch(() => []);
    const box = modal({ title: 'Messages épinglés', body: pins.length ? h('div.pin-list', pins.map(m => h('div.pin-item',
      avatar(person(m.author), 28),
      h('div', h('div.msg-meta', h('b', person(m.author).display_name), h('time', fmtDate(m.created_at) + ' ' + fmtTime(m.created_at))), h('div.md', { html: md(m.body || '📎 Pièce jointe') })),
      h('button.icon-btn', { title: 'Aller au message', onclick: () => { box.close(); jump(m.id); } }, icon('arrow'))))) : empty('pin', 'Aucun message épinglé', 'Épingle les messages importants avec le menu « … ».') });
  }

  // ---------- Saisie ----------
  function drawReply() {
    replyBar.hidden = !replyTo;
    if (!replyTo) return clear(replyBar);
    clear(replyBar, icon('reply'), h('span', 'Réponse à ', h('b', person(replyTo.author).display_name), ' : ', (replyTo.body || '📎').slice(0, 80)),
      h('button.icon-btn', { title: 'Annuler', onclick: () => { replyTo = null; drawReply(); } }, icon('x')));
  }
  function drawAttach() {
    attachBar.hidden = !pending.length;
    clear(attachBar, pending.map((f, i) => h('div.att' + (f.loading ? '.loading-att' : ''),
      (f.type || '').startsWith('image/') && f.url ? h('img', { src: f.url, alt: '' }) : icon('paperclip'),
      h('span', f.name),
      h('button.icon-btn', { title: 'Retirer', onclick: () => { pending.splice(i, 1); drawAttach(); } }, icon('x')))));
  }
  async function addFiles(files) {
    files = [...files].slice(0, 10);
    if (!files.length) return;
    const slots = files.map(f => ({ name: f.name || 'image.png', type: f.type, loading: true }));
    pending.push(...slots); drawAttach();
    for (let i = 0; i < files.length; i++) {
      try {
        const [up] = await uploadFiles([files[i]], 'chat');
        Object.assign(slots[i], up, { loading: false });
      } catch (e) { fail(e); pending.splice(pending.indexOf(slots[i]), 1); }
      drawAttach();
    }
  }
  async function attach() { addFiles(await pickFiles({ accept: '*/*', multiple: true })); }
  function insertText(t) {
    const s = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, s) + t + input.value.slice(input.selectionEnd ?? s);
    input.focus(); input.setSelectionRange(s + t.length, s + t.length); grow();
  }
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };

  async function send() {
    if (!current) return;
    if (pending.some(f => f.loading)) return toast('Attends la fin de l\'envoi des fichiers…');
    const body = input.value.trim();
    if (!body && !pending.length) return;
    const row = { channel_id: current.id, author: me.id, body, attachments: pending.map(({ url, name, type, size }) => ({ url, name, type, size })), reply_to: replyTo?.id || null, reactions: {} };
    input.value = ''; grow();
    pending = []; replyTo = null; drawAttach(); drawReply();
    sendTyping(false);
    try {
      const m = await api.insert('pt_messages', row);
      if (m && !msgs.some(x => x.id === m.id) && m.channel_id === current?.id) { msgs.push(m); drawMessages(true); }
      last.set(row.channel_id, { at: m?.created_at || new Date().toISOString(), author: me.id });
      markRead(row.channel_id);
    } catch (e) { fail(e); input.value = body; }
  }

  // Autocomplétion des @mentions.
  let mentionSel = 0;
  let mentionList = [];
  function mentionQuery() {
    const s = input.selectionStart;
    const m = input.value.slice(0, s).match(/(^|\s)@([\w.-]{0,32})$/);
    return m ? { q: m[2].toLowerCase(), start: s - m[2].length - 1 } : null;
  }
  function drawMentions() {
    const mq = mentionQuery();
    mentionList = mq ? allPeople().filter(p => p.role !== 'disabled' && (p.username.toLowerCase().includes(mq.q) || p.display_name.toLowerCase().includes(mq.q))).slice(0, 6) : [];
    mentionBox.hidden = !mentionList.length;
    if (mentionSel >= mentionList.length) mentionSel = 0;
    clear(mentionBox, mentionList.map((p, i) => h('button' + (i === mentionSel ? '.on' : ''), { onmousedown: e => { e.preventDefault(); pickMention(p); } },
      avatar(p, 22), h('b', p.display_name), h('small.muted', '@' + p.username))));
  }
  function pickMention(p) {
    const mq = mentionQuery();
    if (!mq) return;
    const s = input.selectionStart;
    input.value = input.value.slice(0, mq.start) + '@' + p.username + ' ' + input.value.slice(s);
    const pos = mq.start + p.username.length + 2;
    input.setSelectionRange(pos, pos);
    mentionBox.hidden = true; mentionList = [];
  }

  input.addEventListener('input', () => { grow(); drawMentions(); if (input.value.trim()) sendTyping(true); });
  input.addEventListener('keydown', e => {
    if (mentionList.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mentionSel = (mentionSel + (e.key === 'ArrowDown' ? 1 : mentionList.length - 1)) % mentionList.length; drawMentions(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionList[mentionSel]); return; }
      if (e.key === 'Escape') { mentionBox.hidden = true; mentionList = []; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()) { e.preventDefault(); send(); }
    if (e.key === 'ArrowUp' && !input.value) {
      const mine = [...msgs].reverse().find(m => m.author === me.id && m.body);
      if (mine) { e.preventDefault(); editing = mine.id; drawMessages(); }
    }
    if (e.key === 'Escape' && replyTo) { replyTo = null; drawReply(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { mentionBox.hidden = true; }, 150));
  input.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  room.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); room.classList.add('drop'); } });
  room.addEventListener('dragleave', e => { if (!room.contains(e.relatedTarget)) room.classList.remove('drop'); });
  room.addEventListener('drop', e => { e.preventDefault(); room.classList.remove('drop'); if (current && !composer.hidden) addFiles(e.dataTransfer.files); });

  // ---------- Présence & « en train d'écrire » ----------
  const meta = () => ({ id: me.id, name: me.display_name, typing: null });
  let typingSent = 0;
  let typingTimer = null;
  function sendTyping(on) {
    if (!presence || !current) return;
    clearTimeout(typingTimer);
    if (on) {
      if (Date.now() - typingSent > 2500) { typingSent = Date.now(); presence.send({ type: 'typing', id: me.id, channel: current.id }); }
      typingTimer = setTimeout(() => sendTyping(false), 4000);
    } else if (typingSent) { typingSent = 0; presence.send({ type: 'stop', id: me.id, channel: current.id }); }
  }
  function drawTyping() {
    const now = Date.now();
    const who = [...typing.entries()].filter(([id, t]) => id !== me.id && t.channel === current?.id && t.until > now).map(([id]) => person(id).display_name);
    clear(typingBar, who.length ? [h('span.dots', h('i'), h('i'), h('i')), h('span', who.length === 1 ? `${who[0]} est en train d'écrire…` : who.length < 4 ? `${who.join(', ')} écrivent…` : 'Plusieurs personnes écrivent…')] : null);
  }
  function drawMembers() {
    const ids = new Set(online.filter(Boolean).map(o => o.id));
    let pool = allPeople().filter(p => p.role !== 'disabled');
    if (current?.kind === 'dm') pool = pool.filter(p => (current.members || []).includes(p.id));
    const on = pool.filter(p => ids.has(p.id));
    const off = pool.filter(p => !ids.has(p.id));
    const row = (p, isOn) => h('button.member-row' + (isOn ? '.on' : ''), { onclick: () => p.id !== me.id && openDM(p.id), title: p.id === me.id ? 'Toi' : 'Message privé' },
      h('span.av-wrap', avatar(p, 30), h('i.presence' + (isOn ? '.on' : ''))), h('span', h('b', p.display_name), p.title ? h('small.muted', p.title) : null));
    clear(members, h('div.mem-title', `En ligne — ${on.length}`), on.map(p => row(p, true)), off.length ? h('div.mem-title', `Hors ligne — ${off.length}`) : null, off.map(p => row(p, false)));
  }
  let presence = null;
  try {
    presence = api.presence('chat', meta(), (list, ping) => {
      if (list) { online = list; drawMembers(); drawSide(); return; }
      if (!ping) return;
      if (ping.type === 'typing') typing.set(ping.id, { channel: ping.channel, until: Date.now() + 5000 });
      if (ping.type === 'stop') typing.delete(ping.id);
      drawTyping();
    });
  } catch (e) { console.warn(e); }
  const typingTick = setInterval(drawTyping, 1500);

  // ---------- Temps réel ----------
  const offMsgs = api.subscribe('pt_messages', null, ({ type, row, old }) => {
    const cid = row?.channel_id || old?.channel_id;
    if (type === 'INSERT') {
      last.set(cid, { at: row.created_at, author: row.author });
      typing.delete(row.author); drawTyping();
      if (cid === current?.id) {
        if (!msgs.some(m => m.id === row.id)) { msgs.push(row); drawMessages(row.author === me.id); }
        if (document.visibilityState === 'visible') markRead(cid);
      } else drawSide();
    }
    if (type === 'UPDATE' && cid === current?.id) {
      const i = msgs.findIndex(m => m.id === row.id);
      if (i >= 0 && editing !== row.id) { msgs[i] = row; drawMessages(); }
    }
    if (type === 'DELETE' && old?.id) {
      const i = msgs.findIndex(m => m.id === old.id);
      if (i >= 0) { msgs.splice(i, 1); drawMessages(); }
    }
  });
  const offCh = api.subscribe('pt_channels', null, async ({ type, row, old }) => {
    if (type === 'DELETE') {
      channels = channels.filter(c => c.id !== old?.id);
      if (current?.id === old?.id) { toast('Ce salon a été supprimé.'); go('/chat'); }
    } else if (row && (row.kind !== 'dm' || (row.members || []).includes(me.id))) {
      const i = channels.findIndex(c => c.id === row.id);
      i < 0 ? channels.push(row) : (channels[i] = row);
      if (current?.id === row.id) { current = channels.find(c => c.id === row.id); drawHead(); }
    }
    drawSide();
  });
  const offProj = onProjects(drawSide);
  const onVis = () => { if (document.visibilityState === 'visible' && current) markRead(current.id); };
  document.addEventListener('visibilitychange', onVis);

  // ---------- Démarrage ----------
  try { await Promise.all([loadChannels(), loadUnread()]); } catch (e) { fail(e); }
  drawMembers();
  await openChannel(params.channel);

  const cleanup = () => {
    offMsgs(); offCh(); offProj();
    clearInterval(typingTick);
    sendTyping(false);
    presence?.close();
    document.removeEventListener('visibilitychange', onVis);
    view.classList.remove('chat-view');
  };
  cleanup.sameRoute = (viewFn, prm) => {
    if (viewFn !== chat) return false;
    openChannel(prm.channel);
    return true;
  };
  return cleanup;
}
