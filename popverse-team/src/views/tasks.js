// Onglet Tâches : tableau façon Trello (colonnes, cartes, glisser-déposer souris + doigt), vue liste,
// filtres, étiquettes, fenêtre de carte complète (checklist, pièces jointes, commentaires, Copilot).
import { api, uid } from '../api.js';
import {
  h, clear, icon, modal, menu, form, avatar, person, allPeople, md, toast, fail, uploadFiles, pickFiles,
  confirmBox, fmtDate, timeAgo, lightbox, empty, COLORS, debounce,
} from '../ui.js';
import { PRIORITIES, prio, logActivity } from '../store.js';

const STEP = 1000;
const isImg = a => /^image\//.test(a?.type || '') || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(a?.url || '');
const toDateInput = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
const fromDateInput = (v, end) => (v ? new Date(v + (end ? 'T23:59:00' : 'T00:00:00')).toISOString() : null);

export default async function tasks(box, { project: p, sub }) {
  const me = api.me;
  const S = {
    lists: [], cards: [], labels: [], comments: new Map(), cids: new Set(),
    view: localStorage.getItem('pt.tasks.view') || 'board',
    f: { q: '', member: '', label: '', prio: '', mine: false, late: false },
    sort: { key: 'list', dir: 1 },
    quick: null, // { listId, value } : ajout rapide ouvert
  };
  let drag = null;          // glisser en cours
  let pendingRender = false;
  let openCardCtl = null;   // fenêtre de carte ouverte
  let alive = true;

  const root = h('div.tk');
  const toolbar = h('div.tk-bar');
  const content = h('div.tk-content');
  root.append(toolbar, content);
  clear(box, root);
  clear(content, h('div.loading', 'Chargement des tâches…'));

  // ---------- Données ----------
  const listOf = id => S.lists.find(l => l.id === id);
  const labelColor = name => S.labels.find(l => l.name === name)?.color || '#B8A07A';
  const sortedLists = () => S.lists.slice().sort((a, b) => a.position - b.position);
  const cardsOf = listId => S.cards.filter(c => c.list_id === listId && !c.archived).sort((a, b) => a.position - b.position);
  function countComment(cm, d) {
    if (!cm?.id || !cm.target_id) return false;
    if (d > 0 ? S.cids.has(cm.id) : !S.cids.has(cm.id)) return false;
    d > 0 ? S.cids.add(cm.id) : S.cids.delete(cm.id);
    S.comments.set(cm.target_id, Math.max(0, (S.comments.get(cm.target_id) || 0) + d));
    return true;
  }
  const isDone = c => c.done || !!listOf(c.list_id)?.is_done;
  const isLate = c => c.due_at && new Date(c.due_at) < Date.now() && !isDone(c);

  function visible(c) {
    const f = S.f;
    if (c.archived) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (![c.title, c.description, ...(c.labels || [])].join(' ').toLowerCase().includes(q)) return false;
    }
    if (f.member === 'none' && (c.assignees || []).length) return false;
    if (f.member && f.member !== 'none' && !(c.assignees || []).includes(f.member)) return false;
    if (f.label && !(c.labels || []).includes(f.label)) return false;
    if (f.prio === 'none' ? c.priority : f.prio && c.priority !== f.prio) return false;
    if (f.mine && !(c.assignees || []).includes(me.id)) return false;
    if (f.late && !isLate(c)) return false;
    return true;
  }
  const filterCount = () => ['member', 'label', 'prio'].filter(k => S.f[k]).length + (S.f.mine ? 1 : 0) + (S.f.late ? 1 : 0);

  try {
    const [lists, cards, labels, comments] = await Promise.all([
      api.select('pt_lists', { eq: { project_id: p.id }, order: 'position' }),
      api.select('pt_cards', { eq: { project_id: p.id } }),
      api.select('pt_labels', { eq: { project_id: p.id }, order: 'name' }),
      api.select('pt_comments', { eq: { project_id: p.id, target_type: 'card' }, columns: 'id,target_id' }),
    ]);
    Object.assign(S, { lists, cards, labels });
    comments.forEach(c => countComment(c, 1));
  } catch (e) { fail(e); clear(content, empty('x', 'Erreur', e.message)); return; }
  if (!alive) return;

  // ---------- Barre d'outils ----------
  function drawToolbar() {
    const n = filterCount();
    const search = h('label.tk-search', icon('search'), h('input', {
      type: 'search', placeholder: 'Rechercher une tâche…', value: S.f.q,
      oninput: debounce(e => { S.f.q = e.target.value.trim(); render(); }, 150),
    }));
    clear(toolbar,
      search,
      h('button.btn.small' + (n ? '.tk-active' : ''), { onclick: e => filtersPopover(e.currentTarget) }, icon('filter'), 'Filtres', n ? h('span.tk-badge', String(n)) : null),
      h('button.btn.small' + (S.f.mine ? '.tk-active' : ''), { onclick: () => { S.f.mine = !S.f.mine; drawToolbar(); render(); } }, icon('users'), 'Mes tâches'),
      h('div.tk-seg',
        h('button' + (S.view === 'board' ? '.on' : ''), { onclick: () => setView('board'), title: 'Vue tableau' }, icon('kanban'), h('span', 'Tableau')),
        h('button' + (S.view === 'list' ? '.on' : ''), { onclick: () => setView('list'), title: 'Vue liste' }, icon('list'), h('span', 'Liste'))),
      h('div.tk-spacer'),
      h('button.icon-btn', { title: 'Étiquettes', onclick: manageLabels }, icon('tag')),
      h('button.icon-btn', { title: 'Tâches archivées', onclick: showArchived }, icon('archive')),
      h('button.btn.small.primary', { onclick: newTaskDialog }, icon('plus'), h('span', 'Nouvelle tâche')));
    if (n || S.f.q) {
      const chips = [];
      if (S.f.member) chips.push(['member', S.f.member === 'none' ? 'Sans membre' : person(S.f.member).display_name]);
      if (S.f.label) chips.push(['label', S.f.label]);
      if (S.f.prio) chips.push(['prio', S.f.prio === 'none' ? 'Sans priorité' : prio(S.f.prio)?.label]);
      if (S.f.late) chips.push(['late', 'En retard']);
      if (chips.length) toolbar.append(h('div.tk-chips', chips.map(([k, label]) => h('button.tk-chip', { onclick: () => { S.f[k] = k === 'late' ? false : ''; drawToolbar(); render(); } }, label, icon('x'))),
        h('button.tk-chip.clear', { onclick: () => { Object.assign(S.f, { member: '', label: '', prio: '', mine: false, late: false }); drawToolbar(); render(); } }, 'Tout effacer')));
    }
  }
  function setView(v) { S.view = v; localStorage.setItem('pt.tasks.view', v); drawToolbar(); render(); }

  function filtersPopover(anchor) {
    const people = allPeople().filter(x => x.role !== 'disabled');
    const sel = (key, opts) => h('select.input', { onchange: e => { S.f[key] = e.target.value; drawToolbar(); render(); } },
      opts.map(([v, l]) => h('option', { value: v, selected: S.f[key] === v }, l)));
    popover(anchor, h('div.tk-filters',
      h('label.field', h('span', 'Membre'), sel('member', [['', 'Tous'], ['none', 'Sans membre'], ...people.map(x => [x.id, x.display_name])])),
      h('label.field', h('span', 'Étiquette'), sel('label', [['', 'Toutes'], ...S.labels.map(l => [l.name, l.name])])),
      h('label.field', h('span', 'Priorité'), sel('prio', [['', 'Toutes'], ['none', 'Sans priorité'], ...PRIORITIES.map(x => [x.value, x.label])])),
      h('label.toggle', h('input', { type: 'checkbox', checked: S.f.late, onchange: e => { S.f.late = e.target.checked; drawToolbar(); render(); } }), h('span', 'Seulement en retard'))));
  }

  // ---------- Rendu ----------
  function render() {
    if (!alive) return;
    if (drag) { pendingRender = true; return; }
    if (S.view === 'list') return renderList();
    renderBoard();
  }
  const renderSoon = (() => { let raf = 0; return () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }; })();

  function renderBoard() {
    const old = content.querySelector('.tk-board');
    const scrollLeft = old?.scrollLeft || 0;
    const scrolls = new Map([...content.querySelectorAll('.tk-col')].map(c => [c.dataset.id, c.querySelector('.tk-cards')?.scrollTop || 0]));
    const focusQuick = document.activeElement?.classList.contains('tk-quick-input');
    const board = h('div.tk-board', sortedLists().map(colEl), addColEl());
    clear(content, board);
    board.scrollLeft = scrollLeft;
    board.querySelectorAll('.tk-col').forEach(c => { const t = scrolls.get(c.dataset.id); if (t) c.querySelector('.tk-cards').scrollTop = t; });
    if (focusQuick && S.quick) board.querySelector(`.tk-col[data-id="${S.quick.listId}"] .tk-quick-input`)?.focus();
    board.addEventListener('pointerdown', onPointerDown);
  }

  function colEl(l) {
    const all = cardsOf(l.id);
    const shown = all.filter(visible).length;
    const over = l.wip_limit && all.length > l.wip_limit;
    const col = h('section.tk-col' + (l.is_done ? '.done' : ''), { dataset: { id: l.id }, style: { '--lc': l.color || 'var(--line2)' } },
      h('header.tk-col-head', { title: 'Glisser pour déplacer la colonne · double-clic pour renommer', ondblclick: () => renameList(l) },
        l.is_done ? h('span.tk-done-ic', { title: 'Colonne « terminé »' }, icon('check')) : null,
        h('h3', l.name),
        h('span.tk-count' + (over ? '.over' : ''), { title: l.wip_limit ? `Limite : ${l.wip_limit}` : '' }, l.wip_limit ? `${all.length}/${l.wip_limit}` : String(all.length)),
        h('button.icon-btn.tk-col-menu', { onclick: e => colMenu(e.currentTarget, l), 'aria-label': 'Options de la colonne' }, icon('more'))),
      h('div.tk-cards', { dataset: { list: l.id } }, all.map(c => cardEl(c))),
      shown === 0 && all.length && filterCount() + (S.f.q ? 1 : 0) ? h('p.tk-hidden-note', `${all.length} tâche(s) masquée(s) par les filtres`) : null,
      quickAddEl(l));
    return col;
  }

  function quickAddEl(l) {
    if (S.quick?.listId !== l.id) return h('button.tk-add-card', { onclick: () => { S.quick = { listId: l.id, value: '' }; render(); content.querySelector(`.tk-col[data-id="${l.id}"] .tk-quick-input`)?.focus(); } }, icon('plus'), 'Ajouter une tâche');
    const ta = h('textarea.input.tk-quick-input', {
      rows: 2, placeholder: 'Titre de la tâche… (Entrée pour ajouter)', value: S.quick.value,
      oninput: e => { S.quick.value = e.target.value; },
      onkeydown: e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { S.quick = null; render(); }
      },
    });
    const submit = async () => {
      const title = ta.value.trim();
      if (!title) return;
      S.quick.value = '';
      ta.value = '';
      await createCard({ list_id: l.id, title });
      setTimeout(() => content.querySelector(`.tk-col[data-id="${l.id}"] .tk-quick-input`)?.focus(), 0);
    };
    return h('div.tk-quick', ta, h('div.row', h('button.btn.small.primary', { onclick: submit }, 'Ajouter'), h('button.icon-btn', { onclick: () => { S.quick = null; render(); } }, icon('x'))));
  }

  function addColEl() {
    return h('section.tk-col-add', h('button.tk-add-col', {
      onclick: async () => {
        const v = await form('Nouvelle colonne', [{ name: 'name', label: 'Nom', required: true, placeholder: 'Ex : En revue' }, { name: 'color', label: 'Couleur', type: 'color', value: '#F5B935' }], { submit: 'Créer' });
        if (!v) return;
        const pos = Math.max(0, ...S.lists.map(l => l.position || 0)) + STEP;
        try { const l = await api.insert('pt_lists', { project_id: p.id, name: v.name, color: v.color, position: pos }); addLocal(S.lists, l); render(); } catch (e) { fail(e); }
      },
    }, icon('plus'), 'Ajouter une colonne'));
  }

  function cardEl(c) {
    const pr = prio(c.priority);
    const ck = c.checklist || [];
    const ckDone = ck.filter(i => i.done).length;
    const nCom = S.comments.get(c.id) || 0;
    const nAtt = (c.attachments || []).length;
    const late = isLate(c);
    const soon = !late && c.due_at && new Date(c.due_at) - Date.now() < 2 * 864e5 && !isDone(c);
    const cover = c.cover ? (c.cover.startsWith('#') ? h('div.tk-cover.color', { style: { background: c.cover } }) : h('div.tk-cover', h('img', { src: c.cover, alt: '', loading: 'lazy', draggable: false }))) : null;
    return h('article.tk-card' + (isDone(c) ? '.is-done' : '') + (pr ? '.p-' + pr.value : ''), {
      dataset: { id: c.id }, hidden: !visible(c), tabIndex: 0,
      style: pr ? { '--pc': pr.color } : {},
      onclick: () => { if (justDragged) return; openCard(c.id); },
      onkeydown: e => { if (e.key === 'Enter') openCard(c.id); },
      oncontextmenu: e => { if (e.pointerType === 'touch' || drag) e.preventDefault(); },
    },
      cover,
      (c.labels || []).length ? h('div.tk-labels', c.labels.map(n => h('span.tk-label', { style: { '--c': labelColor(n) }, title: n }, n))) : null,
      h('p.tk-card-title', isDone(c) ? h('span.tk-check', icon('check')) : null, c.title),
      h('div.tk-badges',
        pr ? h('span.tk-b.prio', { style: { '--c': pr.color }, title: 'Priorité ' + pr.label }, icon('flag'), pr.label) : null,
        c.due_at ? h('span.tk-b' + (late ? '.late' : soon ? '.soon' : isDone(c) ? '.ok' : ''), { title: 'Échéance' }, icon('clock'), fmtDate(c.due_at)) : null,
        ck.length ? h('span.tk-b' + (ckDone === ck.length ? '.ok' : ''), { title: 'Checklist' }, icon('checklist'), `${ckDone}/${ck.length}`) : null,
        c.description ? h('span.tk-b', { title: 'A une description' }, icon('text')) : null,
        nCom ? h('span.tk-b', { title: 'Commentaires' }, icon('comment'), String(nCom)) : null,
        nAtt ? h('span.tk-b', { title: 'Pièces jointes' }, icon('paperclip'), String(nAtt)) : null,
        c.estimate ? h('span.tk-b', { title: 'Estimation' }, `${c.estimate} h`) : null,
        (c.assignees || []).length ? h('span.avatars.tk-av', c.assignees.slice(0, 4).map(id => avatar(id, 24))) : null));
  }

  function refreshCard(c) {
    if (S.view !== 'board') return renderSoon();
    const el = content.querySelector(`.tk-card[data-id="${c.id}"]`);
    if (!el || drag) return renderSoon();
    el.replaceWith(cardEl(c));
  }

  // ---------- Vue liste ----------
  function renderList() {
    const lists = sortedLists();
    const order = new Map(lists.map((l, i) => [l.id, i]));
    const prioOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    const key = S.sort.key, dir = S.sort.dir;
    const val = c => ({
      title: c.title.toLowerCase(),
      list: (order.get(c.list_id) ?? 99) * 1e9 + (c.position || 0),
      prio: prioOrder[c.priority] ?? 9,
      due: c.due_at ? new Date(c.due_at).getTime() : Infinity,
      members: (c.assignees || []).map(id => person(id).display_name).join(',').toLowerCase() || '~',
      check: (c.checklist || []).length ? (c.checklist.filter(i => i.done).length / c.checklist.length) : -1,
      updated: -new Date(c.updated_at || c.created_at).getTime(),
    }[key]);
    const rows = S.cards.filter(visible).sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    const th = (k, label) => h('th' + (S.sort.key === k ? '.sorted' : ''), { onclick: () => { S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; render(); } },
      label, S.sort.key === k ? h('span.tk-arrow', S.sort.dir > 0 ? '▲' : '▼') : null);
    clear(content, h('div.tk-listview',
      rows.length ? h('table.tk-table',
        h('thead', h('tr', th('title', 'Tâche'), th('list', 'Colonne'), th('prio', 'Priorité'), th('members', 'Membres'), h('th', 'Étiquettes'), th('due', 'Échéance'), th('check', 'Checklist'), th('updated', 'Modifiée'))),
        h('tbody', rows.map(c => {
          const l = listOf(c.list_id);
          const pr = prio(c.priority);
          const ck = c.checklist || [];
          return h('tr' + (isDone(c) ? '.is-done' : ''), { onclick: () => openCard(c.id) },
            h('td.tk-td-title', h('button.tk-tick' + (isDone(c) ? '.on' : ''), {
              title: isDone(c) ? 'Rouvrir' : 'Marquer terminée',
              onclick: e => { e.stopPropagation(); saveCard(c, { done: !c.done }); },
            }, icon('check')), h('span', c.title)),
            h('td', l ? h('span.tk-listpill', { style: { '--lc': l.color || 'var(--line2)' } }, l.name) : '—'),
            h('td', pr ? h('span.tk-b.prio', { style: { '--c': pr.color } }, icon('flag'), pr.label) : h('span.muted', '—')),
            h('td', (c.assignees || []).length ? h('span.avatars', c.assignees.slice(0, 5).map(id => avatar(id, 24))) : h('span.muted', '—')),
            h('td', h('div.tk-labels', (c.labels || []).map(n => h('span.tk-label', { style: { '--c': labelColor(n) } }, n)))),
            h('td', c.due_at ? h('span.tk-b' + (isLate(c) ? '.late' : ''), icon('clock'), fmtDate(c.due_at)) : h('span.muted', '—')),
            h('td', ck.length ? h('span.tk-mini-bar', h('i', { style: { width: Math.round(ck.filter(i => i.done).length / ck.length * 100) + '%' } })) : h('span.muted', '—')),
            h('td.muted', timeAgo(c.updated_at || c.created_at)));
        })))
        : empty('kanban', S.cards.some(c => !c.archived) ? 'Aucune tâche ne correspond' : 'Aucune tâche', S.cards.some(c => !c.archived) ? 'Change la recherche ou les filtres.' : 'Crée la première tâche du projet.',
          h('button.btn.primary', { onclick: newTaskDialog }, icon('plus'), 'Nouvelle tâche'))));
  }

  // ---------- Colonnes ----------
  function colMenu(anchor, l) {
    const n = cardsOf(l.id).length;
    menu(anchor, [
      { label: 'Ajouter une tâche', icon: 'plus', onclick: () => { S.quick = { listId: l.id, value: '' }; render(); setTimeout(() => content.querySelector(`.tk-col[data-id="${l.id}"] .tk-quick-input`)?.focus(), 0); } },
      { label: 'Renommer', icon: 'edit', onclick: () => renameList(l) },
      { label: 'Couleur', icon: 'sun', onclick: async () => { const v = await form('Couleur de la colonne', [{ name: 'color', label: 'Couleur', type: 'color', value: l.color || '#F5B935' }]); if (v) saveList(l, { color: v.color }); } },
      { label: l.wip_limit ? `Limite de tâches (${l.wip_limit})` : 'Limite de tâches (WIP)', icon: 'filter', onclick: async () => {
        const v = await form('Limite de tâches en cours', [{ name: 'wip', label: 'Nombre maximum de tâches (vide = aucune limite)', type: 'number', value: l.wip_limit || '' }]);
        if (v) saveList(l, { wip_limit: Number(v.wip) > 0 ? Math.round(Number(v.wip)) : null });
      } },
      { label: l.is_done ? 'Ne plus marquer comme « terminé »' : 'Colonne « terminé »', icon: 'check', onclick: () => saveList(l, { is_done: !l.is_done }) },
      '-',
      { label: 'Déplacer à gauche', icon: 'reply', onclick: () => shiftList(l, -1) },
      { label: 'Déplacer à droite', icon: 'send', onclick: () => shiftList(l, 1) },
      '-',
      { label: 'Supprimer la colonne', icon: 'trash', danger: true, onclick: async () => {
        if (!(await confirmBox(`Supprimer la colonne « ${l.name} »${n ? ` et ses ${n} tâche(s)` : ''} ? C'est définitif.`, { ok: 'Supprimer' }))) return;
        try { await api.remove('pt_lists', l.id); S.lists = S.lists.filter(x => x.id !== l.id); S.cards = S.cards.filter(c => c.list_id !== l.id); render(); } catch (e) { fail(e); }
      } },
    ], { align: 'right' });
  }
  async function renameList(l) {
    const v = await form('Renommer la colonne', [{ name: 'name', label: 'Nom', value: l.name, required: true }]);
    if (v && v.name !== l.name) saveList(l, { name: v.name });
  }
  async function saveList(l, patch) {
    Object.assign(l, patch); render();
    try { const r = await api.update('pt_lists', l.id, patch); if (r) Object.assign(l, r); } catch (e) { fail(e); }
  }
  function shiftList(l, d) {
    const ls = sortedLists();
    const i = ls.indexOf(l), j = i + d;
    if (j < 0 || j >= ls.length) return;
    const a = ls[j], b = ls[j + d];
    const pos = b ? (a.position + b.position) / 2 : a.position + d * STEP;
    saveList(l, { position: pos });
  }

  // ---------- Cartes ----------
  async function createCard(fields, open = false) {
    const pos = Math.max(0, ...cardsOf(fields.list_id).map(c => c.position || 0)) + STEP;
    try {
      const c = await api.insert('pt_cards', {
        project_id: p.id, position: pos, labels: [], assignees: [], checklist: [], attachments: [], done: !!listOf(fields.list_id)?.is_done,
        created_by: me.id, ...fields,
      });
      addLocal(S.cards, c);
      render();
      logActivity(p.id, 'task', `a créé la tâche « ${c.title} »`, `#/p/${p.id}/tasks/${c.id}`);
      if (open) openCard(c.id);
      return c;
    } catch (e) { fail(e); return null; }
  }
  async function newTaskDialog() {
    const lists = sortedLists();
    if (!lists.length) return toast('Crée d\'abord une colonne.', 'error');
    const v = await form('Nouvelle tâche', [
      { name: 'title', label: 'Titre', required: true, placeholder: 'Ex : Script de la boutique' },
      { name: 'list_id', label: 'Colonne', type: 'select', value: lists[0].id, options: lists.map(l => ({ value: l.id, label: l.name })) },
      { name: 'priority', label: 'Priorité', type: 'select', value: '', options: [{ value: '', label: 'Aucune' }, ...PRIORITIES.map(x => ({ value: x.value, label: x.label }))] },
      { name: 'due', label: 'Échéance', type: 'date' },
    ], { submit: 'Créer' });
    if (!v) return;
    createCard({ list_id: v.list_id, title: v.title, priority: v.priority || null, due_at: fromDateInput(v.due, true) }, true);
  }
  async function saveCard(c, patch) {
    const before = { list_id: c.list_id, assignees: [...(c.assignees || [])] };
    if ('list_id' in patch && patch.list_id !== c.list_id && !('done' in patch)) patch.done = !!listOf(patch.list_id)?.is_done;
    Object.assign(c, patch);
    refreshCard(c);
    if ('list_id' in patch || 'position' in patch || 'archived' in patch) renderSoon();
    openCardCtl?.id === c.id && openCardCtl.redraw();
    try {
      const r = await api.update('pt_cards', c.id, patch);
      if (r) Object.assign(c, r);
    } catch (e) { fail(e); return; }
    if (patch.list_id && patch.list_id !== before.list_id && listOf(patch.list_id)?.is_done && !listOf(before.list_id)?.is_done)
      logActivity(p.id, 'task', `a terminé « ${c.title} »`, `#/p/${p.id}/tasks/${c.id}`);
    if (patch.assignees) for (const id of patch.assignees.filter(x => !before.assignees.includes(x)))
      logActivity(p.id, 'task', id === me.id ? `s'est assigné « ${c.title} »` : `a assigné « ${c.title} » à ${person(id).display_name}`, `#/p/${p.id}/tasks/${c.id}`);
  }
  async function deleteCard(c) {
    if (!(await confirmBox(`Supprimer définitivement « ${c.title} » ?`, { ok: 'Supprimer' }))) return false;
    try { await api.remove('pt_cards', c.id); S.cards = S.cards.filter(x => x.id !== c.id); render(); return true; } catch (e) { fail(e); return false; }
  }

  // ---------- Glisser-déposer (souris + doigt) ----------
  let justDragged = false;
  let pend = null;
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('button, input, textarea, select, a, .tk-quick')) return;
    const card = e.target.closest('.tk-card');
    const head = !card && e.target.closest('.tk-col-head');
    const el = card || head?.closest('.tk-col');
    if (!el) return;
    pend = { kind: card ? 'card' : 'col', el, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', pid: e.pointerId, timer: 0 };
    if (pend.touch) {
      const mine = pend;
      pend.timer = setTimeout(() => { if (pend === mine) beginDrag(mine); }, 280);
    }
    addEventListener('pointermove', onPointerMove, { passive: false });
    addEventListener('pointerup', onPointerUp);
    addEventListener('pointercancel', onPointerCancel);
  }
  function onPointerMove(e) {
    if (drag) { e.preventDefault(); drag.px = e.clientX; drag.py = e.clientY; updateDrag(); return; }
    if (!pend) return;
    const d = Math.hypot(e.clientX - pend.x, e.clientY - pend.y);
    if (pend.touch) { if (d > 10) stopPending(); return; } // c'est un défilement
    if (d > 5) { beginDrag(pend); drag.px = e.clientX; drag.py = e.clientY; updateDrag(); }
  }
  function onPointerUp() { if (drag) endDrag(true); stopPending(); }
  function onPointerCancel() { if (drag) endDrag(false); stopPending(); }
  function stopPending() {
    if (pend?.timer) clearTimeout(pend.timer);
    pend = null;
    if (!drag) {
      removeEventListener('pointermove', onPointerMove);
      removeEventListener('pointerup', onPointerUp);
      removeEventListener('pointercancel', onPointerCancel);
    }
  }
  const blockTouch = e => { if (drag) e.preventDefault(); };
  document.addEventListener('touchmove', blockTouch, { passive: false });

  function beginDrag(s) {
    if (pend?.timer) clearTimeout(pend.timer);
    pend = null;
    const r = s.el.getBoundingClientRect();
    const board = content.querySelector('.tk-board');
    const ghost = s.el.cloneNode(true);
    ghost.classList.add('tk-ghost', s.kind === 'col' ? 'col' : 'card');
    Object.assign(ghost.style, { width: r.width + 'px', height: (s.kind === 'col' ? Math.min(r.height, 420) : r.height) + 'px' });
    const ph = h(s.kind === 'card' ? 'div.tk-ph' : 'div.tk-col-ph', { style: s.kind === 'card' ? { height: r.height + 'px' } : { width: r.width + 'px' } });
    s.el.before(ph);
    s.el.classList.add('tk-src');
    document.body.append(ghost);
    document.body.classList.add('tk-dragging');
    drag = { ...s, ghost, ph, board, ox: s.x - r.left, oy: s.y - r.top, px: s.x, py: s.y, raf: 0 };
    if (s.touch) navigator.vibrate?.(12);
    const loop = () => { if (!drag) return; autoScroll(); drag.raf = requestAnimationFrame(loop); };
    drag.raf = requestAnimationFrame(loop);
    updateDrag();
  }
  function updateDrag() {
    const d = drag;
    d.ghost.style.transform = `translate(${d.px - d.ox}px, ${d.py - d.oy}px) rotate(${d.kind === 'card' ? 2.5 : 1.5}deg)`;
    const under = document.elementFromPoint(d.px, d.py);
    if (d.kind === 'card') {
      const col = under?.closest('.tk-col');
      if (!col) return;
      const box = col.querySelector('.tk-cards');
      const items = [...box.children].filter(x => x.classList.contains('tk-card') && x !== d.el && !x.hidden);
      const before = items.find(x => { const r = x.getBoundingClientRect(); return d.py < r.top + r.height / 2; });
      if (before) { if (d.ph.nextElementSibling !== before) before.before(d.ph); }
      else if (box.lastElementChild !== d.ph) box.append(d.ph);
    } else {
      const cols = [...d.board.children].filter(x => x.classList.contains('tk-col') && x !== d.el);
      const before = cols.find(x => { const r = x.getBoundingClientRect(); return d.px < r.left + r.width / 2; });
      const target = before || d.board.querySelector('.tk-col-add');
      if (target && d.ph.nextElementSibling !== target) target.before(d.ph);
    }
  }
  function autoScroll() {
    const d = drag;
    if (!d.board) return;
    const br = d.board.getBoundingClientRect();
    const edge = 70;
    let moved = false;
    if (d.px < br.left + edge) { d.board.scrollLeft -= Math.ceil((br.left + edge - d.px) / 4); moved = true; }
    else if (d.px > br.right - edge) { d.board.scrollLeft += Math.ceil((d.px - br.right + edge) / 4); moved = true; }
    if (d.kind === 'card') {
      const box = d.ph.parentElement;
      if (box?.classList.contains('tk-cards')) {
        const r = box.getBoundingClientRect();
        if (d.py < r.top + 40 && d.py > r.top - 30) { box.scrollTop -= 8; moved = true; }
        else if (d.py > r.bottom - 40 && d.py < r.bottom + 60) { box.scrollTop += 8; moved = true; }
      }
    }
    if (moved) updateDrag();
  }
  function endDrag(commit) {
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    removeEventListener('pointermove', onPointerMove);
    removeEventListener('pointerup', onPointerUp);
    removeEventListener('pointercancel', onPointerCancel);
    document.body.classList.remove('tk-dragging');
    d.ghost.remove();
    d.el.classList.remove('tk-src');
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 50);
    const sib = (el, dir) => { let x = el[dir]; while (x && (x === d.el || !(d.kind === 'card' ? x.classList.contains('tk-card') : x.classList.contains('tk-col')))) x = x[dir]; return x; };
    const prevEl = sib(d.ph, 'previousElementSibling');
    const nextEl = sib(d.ph, 'nextElementSibling');
    const parent = d.ph.parentElement;
    d.ph.replaceWith(d.el);
    if (!commit) { pendingRender = false; return render(); }
    if (d.kind === 'card') {
      const c = S.cards.find(x => x.id === d.el.dataset.id);
      const listId = parent?.dataset.list;
      if (c && listId) {
        const pv = prevEl && S.cards.find(x => x.id === prevEl.dataset.id)?.position;
        const nv = nextEl && S.cards.find(x => x.id === nextEl.dataset.id)?.position;
        const pos = mid(pv, nv);
        if (listId !== c.list_id || pos !== c.position) {
          const patch = { position: pos };
          if (listId !== c.list_id) patch.list_id = listId;
          saveCard(c, patch);
        }
      }
    } else {
      const l = S.lists.find(x => x.id === d.el.dataset.id);
      const pv = prevEl && S.lists.find(x => x.id === prevEl.dataset.id)?.position;
      const nv = nextEl && S.lists.find(x => x.id === nextEl.dataset.id)?.position;
      if (l) { const pos = mid(pv, nv); if (pos !== l.position) saveList(l, { position: pos }); }
    }
    pendingRender = false;
    render();
  }
  const mid = (a, b) => (a == null && b == null ? STEP : a == null ? b - STEP : b == null ? a + STEP : (a + b) / 2);

  // ---------- Fenêtre de carte ----------
  async function openCard(id) {
    if (openCardCtl?.id === id) return;
    openCardCtl?.close();
    let c = S.cards.find(x => x.id === id);
    if (!c) {
      try { c = await api.get('pt_cards', id); } catch {}
      if (!c || c.project_id !== p.id) { toast('Tâche introuvable.', 'error'); resetHash(); return; }
      addLocal(S.cards, c);
    }
    const want = `#/p/${p.id}/tasks/${id}`;
    if (location.hash !== want) history.replaceState(null, '', want);
    openCardCtl = cardModal(c);
  }
  function resetHash() {
    if (location.hash.startsWith(`#/p/${p.id}/tasks/`)) history.replaceState(null, '', `#/p/${p.id}/tasks`);
  }

  function cardModal(c) {
    let comments = [];
    let editingDesc = false;
    let ai = null; // { loading, reply, actions, error }
    const main = h('div.tk-cm-main');
    const side = h('aside.tk-cm-side');
    const m = modal({ title: '', body: h('div.tk-cm', main, side), wide: true, cls: 'tk-card-modal', onClose: () => { if (openCardCtl === ctl) openCardCtl = null; resetHash(); } });
    const headTitle = m.box.querySelector('.modal-head h3');

    const ctl = {
      id: c.id,
      close: () => m.close(),
      redraw: () => { if (!m.box.contains(document.activeElement) || document.activeElement === m.box) draw(); else drawSide(); },
      onComment(evt) {
        if (evt.type === 'INSERT' && !comments.some(x => x.id === evt.row.id)) comments.push(evt.row);
        if (evt.type === 'DELETE') comments = comments.filter(x => x.id !== evt.old?.id);
        drawComments();
      },
      gone() { toast('Cette tâche a été supprimée.', 'error'); m.close(); },
    };

    const commentsBox = h('div.tk-comments');
    api.select('pt_comments', { eq: { target_type: 'card', target_id: c.id }, order: 'created_at' })
      .then(list => { comments = list; drawComments(); }).catch(fail);

    function draw() { drawMain(); drawSide(); }

    function drawMain() {
      const l = listOf(c.list_id);
      clear(headTitle, h('span.tk-cm-crumb', icon('kanban'), 'Dans ', h('b', l?.name || '—'), c.archived ? h('span.tag', 'Archivée') : null));
      const title = h('textarea.tk-cm-title', {
        rows: 1, value: c.title, maxLength: 300,
        oninput: e => autosize(e.target),
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
        onblur: e => { const v = e.target.value.trim(); if (v && v !== c.title) saveCard(c, { title: v }); else e.target.value = c.title; },
      });
      setTimeout(() => autosize(title), 0);
      const pr = prio(c.priority);
      const ck = c.checklist || [];
      const ckDone = ck.filter(i => i.done).length;
      clear(main,
        c.cover ? (c.cover.startsWith('#') ? h('div.tk-cm-cover.color', { style: { background: c.cover } }) : h('div.tk-cm-cover', h('img', { src: c.cover, alt: '', onclick: () => lightbox(c.cover) }))) : null,
        h('div.tk-cm-titlerow',
          h('button.tk-tick.big' + (isDone(c) ? '.on' : ''), { title: isDone(c) ? 'Rouvrir la tâche' : 'Marquer terminée', onclick: () => saveCard(c, { done: !c.done }) }, icon('check')),
          title),
        h('div.tk-cm-meta',
          metaBlock('Membres', h('div.row.tk-gap6',
            (c.assignees || []).map(id => h('span.tk-person', avatar(id, 26), person(id).display_name)),
            h('button.icon-btn.small', { title: 'Choisir les membres', onclick: e => membersPopover(e.currentTarget, c) }, icon('plus')))),
          metaBlock('Étiquettes', h('div.row.tk-gap6',
            (c.labels || []).map(n => h('span.tk-label.big', { style: { '--c': labelColor(n) } }, n)),
            h('button.icon-btn.small', { title: 'Choisir les étiquettes', onclick: e => labelsPopover(e.currentTarget, c) }, icon('plus')))),
          pr ? metaBlock('Priorité', h('span.tk-b.prio.big', { style: { '--c': pr.color } }, icon('flag'), pr.label)) : null,
          c.due_at ? metaBlock('Échéance', h('span.tk-b.big' + (isLate(c) ? '.late' : isDone(c) ? '.ok' : ''), icon('clock'), fmtDate(c.due_at, { weekday: 'short', day: 'numeric', month: 'short' }))) : null),
        section('text', 'Description', !editingDesc && c.description ? h('button.btn.small.ghost', { onclick: () => { editingDesc = true; drawMain(); } }, icon('edit'), 'Modifier') : null,
          editingDesc ? descEditor() : c.description
            ? h('div.md.tk-desc', { html: md(c.description), ondblclick: () => { editingDesc = true; drawMain(); } })
            : h('button.tk-desc-empty', { onclick: () => { editingDesc = true; drawMain(); } }, 'Ajouter une description détaillée… (markdown : **gras**, listes, `code`)')),
        aiBox(),
        section('checklist', `Checklist${ck.length ? ` · ${ckDone}/${ck.length}` : ''}`, ck.some(i => i.done) ? h('button.btn.small.ghost', { onclick: () => saveCard(c, { checklist: ck.filter(i => !i.done) }) }, 'Retirer les cochées') : null,
          ck.length ? h('div.tk-ck-bar', h('i', { style: { width: Math.round(ckDone / ck.length * 100) + '%' } })) : null,
          h('div.tk-ck', ck.map(item => h('div.tk-ck-item' + (item.done ? '.done' : ''),
            h('input', { type: 'checkbox', checked: item.done, onchange: () => saveCard(c, { checklist: ck.map(i => (i.id === item.id ? { ...i, done: !i.done } : i)) }) }),
            h('input.tk-ck-text', {
              value: item.text,
              onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
              onblur: e => { const v = e.target.value.trim(); if (!v) return saveCard(c, { checklist: ck.filter(i => i.id !== item.id) }); if (v !== item.text) saveCard(c, { checklist: ck.map(i => (i.id === item.id ? { ...i, text: v } : i)) }); },
            }),
            h('button.icon-btn.small', { title: 'Supprimer', onclick: () => saveCard(c, { checklist: ck.filter(i => i.id !== item.id) }) }, icon('x'))))),
          h('form.tk-ck-add', {
            onsubmit: e => {
              e.preventDefault();
              const inp = e.target.querySelector('input');
              const v = inp.value.trim();
              if (!v) return;
              saveCard(c, { checklist: [...(c.checklist || []), { id: uid(), text: v, done: false }] });
              setTimeout(() => main.querySelector('.tk-ck-add input')?.focus(), 30);
            },
          }, h('input.input', { placeholder: 'Ajouter une étape…' }), h('button.btn.small', { type: 'submit' }, icon('plus')))),
        section('paperclip', `Pièces jointes${(c.attachments || []).length ? ` · ${c.attachments.length}` : ''}`,
          h('button.btn.small.ghost', { onclick: () => addAttachments(c) }, icon('plus'), 'Ajouter'),
          (c.attachments || []).length ? h('div.tk-atts', c.attachments.map(a => h('div.tk-att',
            isImg(a) ? h('img', { src: a.url, alt: '', onclick: () => lightbox(a.url) }) : h('a.tk-att-file', { href: a.url, target: '_blank', rel: 'noopener' }, icon('paperclip'), h('span', (a.name || 'fichier').split('.').pop().toUpperCase())),
            h('div.tk-att-meta', h('a', { href: a.url, target: '_blank', rel: 'noopener', title: a.name }, a.name || 'Fichier'),
              h('div.row.tk-gap6',
                isImg(a) ? h('button.link', { onclick: () => saveCard(c, { cover: c.cover === a.url ? null : a.url }) }, c.cover === a.url ? 'Retirer la couverture' : 'Couverture') : null,
                h('button.link.danger', { onclick: () => saveCard(c, { attachments: c.attachments.filter(x => x.url !== a.url), ...(c.cover === a.url ? { cover: null } : {}) }) }, 'Retirer'))))))
            : h('p.muted.small', 'Images, vidéos ou fichiers (captures du jeu, maquettes…).')),
        section('comment', 'Commentaires', null, commentsBox));
      drawComments();
    }

    function descEditor() {
      let tab = 'write';
      const ta = h('textarea.input.tk-desc-input', { rows: 8, value: c.description || '', placeholder: 'Décris la tâche : objectif, détails, critères de réussite…' });
      const prev = h('div.md.tk-desc', { hidden: true });
      const tabs = h('div.tk-seg.small',
        h('button.on', { type: 'button', onclick: e => sw('write', e) }, 'Écrire'),
        h('button', { type: 'button', onclick: e => sw('preview', e) }, 'Aperçu'));
      function sw(t, e) { tab = t; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); ta.hidden = t !== 'write'; prev.hidden = t === 'write'; prev.innerHTML = md(ta.value) || '<p class="muted">Rien à afficher.</p>'; }
      const save = () => { editingDesc = false; const v = ta.value.trim(); if (v !== (c.description || '')) saveCard(c, { description: v }); else drawMain(); };
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); if (e.key === 'Escape') { e.stopPropagation(); editingDesc = false; drawMain(); } });
      setTimeout(() => ta.focus(), 20);
      return h('div.tk-desc-edit', tabs, ta, prev, h('div.row', h('button.btn.small.primary', { onclick: save }, 'Enregistrer'), h('button.btn.small.ghost', { onclick: () => { editingDesc = false; drawMain(); } }, 'Annuler'), h('small.muted', 'Ctrl+Entrée pour enregistrer')));
    }

    function aiBox() {
      if (!ai) return null;
      const upd = (ai.actions || []).find(a => a.type === 'update_card');
      return h('div.tk-ai',
        h('div.tk-ai-head', icon('spark'), h('b', 'Copilot'), h('button.icon-btn.small', { onclick: () => { ai = null; drawMain(); } }, icon('x'))),
        ai.loading ? h('div.tk-ai-loading', h('i'), h('i'), h('i'), h('span', 'Copilot réfléchit à ta tâche…'))
          : ai.error ? h('p.tk-ai-err', ai.error)
            : [
              ai.reply ? h('div.md', { html: md(ai.reply) }) : null,
              upd?.description ? h('div.tk-ai-prop', h('small.muted', 'Description proposée'), h('div.md', { html: md(upd.description) })) : null,
              upd?.checklist?.length ? h('div.tk-ai-prop', h('small.muted', `Checklist proposée (${upd.checklist.length})`), h('ul', upd.checklist.map(t => h('li', typeof t === 'string' ? t : t.text)))) : null,
              upd ? h('div.row',
                upd.description ? h('button.btn.small.primary', { onclick: () => { saveCard(c, { description: c.description ? c.description + '\n\n' + upd.description : upd.description }); ai = null; drawMain(); } }, icon('check'), c.description ? 'Ajouter à la description' : 'Appliquer la description') : null,
                upd.description && c.description ? h('button.btn.small', { onclick: () => { saveCard(c, { description: upd.description }); ai = null; drawMain(); } }, 'Remplacer') : null,
                upd.checklist?.length ? h('button.btn.small' + (upd.description ? '' : '.primary'), { onclick: () => { saveCard(c, { checklist: [...(c.checklist || []), ...upd.checklist.map(t => ({ id: uid(), text: typeof t === 'string' ? t : t.text, done: false }))] }); ai = null; drawMain(); } }, icon('checklist'), 'Ajouter les étapes')
                  : null) : null,
            ]);
    }
    async function askCopilot() {
      ai = { loading: true };
      drawMain();
      main.querySelector('.tk-ai')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      try {
        const res = await api.fn('pt-ai', {
          mode: 'card', project_id: p.id,
          card: { id: c.id, title: c.title, description: c.description, checklist: (c.checklist || []).map(i => i.text), labels: c.labels, priority: c.priority, list: listOf(c.list_id)?.name },
        });
        ai = { reply: res?.reply || '', actions: res?.actions || [] };
        if (!ai.reply && !ai.actions.length) ai.reply = 'Copilot n\'a rien proposé pour cette tâche.';
      } catch (e) { ai = { error: 'Copilot indisponible : ' + (e.message || e) }; }
      if (openCardCtl === ctl) drawMain();
    }

    function drawComments() {
      const input = h('textarea.input', { rows: 2, placeholder: 'Écrire un commentaire… (Ctrl+Entrée pour envoyer)' });
      const send = async () => {
        const body = input.value.trim();
        if (!body) return;
        input.value = '';
        try {
          const r = await api.insert('pt_comments', { project_id: p.id, target_type: 'card', target_id: c.id, author: me.id, body });
          if (!comments.some(x => x.id === r.id)) comments.push(r);
          if (countComment(r, 1)) refreshCard(c);
          drawComments();
          logActivity(p.id, 'comment', `a commenté « ${c.title} »`, `#/p/${p.id}/tasks/${c.id}`);
        } catch (e) { fail(e); input.value = body; }
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
      const keep = commentsBox.querySelector('textarea');
      const had = keep && document.activeElement === keep ? keep.value : null;
      clear(commentsBox,
        h('div.tk-com-new', avatar(me, 30), h('div.tk-com-field', input, h('button.btn.small.primary', { onclick: send }, icon('send'), 'Envoyer'))),
        comments.slice().reverse().map(cm => h('div.tk-com',
          avatar(cm.author, 30),
          h('div.tk-com-body',
            h('div.tk-com-head', h('b', person(cm.author).display_name), h('small.muted', timeAgo(cm.created_at)),
              cm.author === me.id ? h('button.link.danger', {
                onclick: async () => {
                  if (!(await confirmBox('Supprimer ce commentaire ?', { ok: 'Supprimer' }))) return;
                  try { await api.remove('pt_comments', cm.id); comments = comments.filter(x => x.id !== cm.id); if (countComment(cm, -1)) refreshCard(c); drawComments(); } catch (e) { fail(e); }
                },
              }, 'Supprimer') : null),
            h('div.md', { html: md(cm.body) })))));
      if (had !== null) { input.value = had; input.focus(); }
    }

    function drawSide() {
      const lists = sortedLists();
      const pick = (label, el) => h('label.field', h('span', label), el);
      clear(side,
        h('div.tk-side-title', 'Détails'),
        pick('Colonne', h('select.input', { onchange: e => saveCard(c, { list_id: e.target.value, position: Math.max(0, ...cardsOf(e.target.value).map(x => x.position || 0)) + STEP }) },
          lists.map(l => h('option', { value: l.id, selected: l.id === c.list_id }, l.name)))),
        pick('Priorité', h('select.input', { onchange: e => saveCard(c, { priority: e.target.value || null }) },
          h('option', { value: '' }, 'Aucune'), PRIORITIES.map(x => h('option', { value: x.value, selected: c.priority === x.value }, x.label)))),
        h('div.tk-two',
          pick('Début', h('input.input', { type: 'date', value: toDateInput(c.start_at), onchange: e => saveCard(c, { start_at: fromDateInput(e.target.value) }) })),
          pick('Échéance', h('input.input', { type: 'date', value: toDateInput(c.due_at), onchange: e => saveCard(c, { due_at: fromDateInput(e.target.value, true) }) }))),
        pick('Estimation (heures)', h('input.input', { type: 'number', min: 0, step: 0.5, value: c.estimate ?? '', placeholder: 'Ex : 4', onchange: e => saveCard(c, { estimate: e.target.value === '' ? null : Number(e.target.value) }) })),
        h('div.tk-side-btns',
          h('button.btn.small', { onclick: e => membersPopover(e.currentTarget, c) }, icon('users'), 'Membres'),
          h('button.btn.small', { onclick: e => labelsPopover(e.currentTarget, c) }, icon('tag'), 'Étiquettes'),
          h('button.btn.small', { onclick: e => coverPopover(e.currentTarget, c) }, icon('image'), 'Couverture'),
          h('button.btn.small', { onclick: () => addAttachments(c) }, icon('paperclip'), 'Fichier')),
        h('button.btn.small.tk-ai-btn', { onclick: askCopilot, disabled: ai?.loading }, icon('spark'), 'Copilot : détailler la tâche'),
        h('div.tk-side-title', 'Actions'),
        h('div.tk-side-btns.col1',
          h('button.btn.small', { onclick: () => { const url = location.href.split('#')[0] + `#/p/${p.id}/tasks/${c.id}`; navigator.clipboard?.writeText(url).then(() => toast('Lien copié', 'ok'), () => toast(url)); } }, icon('link'), 'Copier le lien'),
          h('button.btn.small', { onclick: () => { saveCard(c, { archived: !c.archived }); if (!c.archived) { toast('Tâche restaurée', 'ok'); } else { toast('Tâche archivée', 'ok'); m.close(); } } }, icon('archive'), c.archived ? 'Restaurer' : 'Archiver'),
          h('button.btn.small.danger', { onclick: async () => { if (await deleteCard(c)) m.close(); } }, icon('trash'), 'Supprimer')),
        h('p.muted.small.tk-created', 'Créée par ', h('b', person(c.created_by).display_name), ' ', timeAgo(c.created_at),
          c.updated_at && c.updated_at !== c.created_at ? ` · modifiée ${timeAgo(c.updated_at)}` : ''));
    }

    draw();
    return ctl;
  }

  const metaBlock = (label, el) => h('div.tk-meta', h('small', label), el);
  const section = (ic, title, extra, ...kids) => h('section.tk-sec', h('header', icon(ic), h('h4', title), h('div.tk-spacer'), extra), ...kids);
  const autosize = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

  async function addAttachments(c) {
    const files = await pickFiles({ accept: 'image/*,video/*,.pdf,.txt,.zip,.rbxm,.rbxl,.lua,.luau,.fbx,.obj,.blend', multiple: true });
    if (!files.length) return;
    toast('Envoi en cours…');
    try {
      const ups = await uploadFiles(files, 'cards');
      const patch = { attachments: [...(c.attachments || []), ...ups] };
      if (!c.cover) { const img = ups.find(isImg); if (img) patch.cover = img.url; }
      await saveCard(c, patch);
      toast('Fichier(s) ajouté(s)', 'ok');
    } catch (e) { fail(e); }
  }

  // ---------- Petits panneaux flottants ----------
  function popover(anchor, el) {
    document.querySelectorAll('.tk-pop').forEach(x => x.remove());
    const pop = h('div.tk-pop', el);
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, ht = pop.offsetHeight;
    let x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    let y = r.bottom + 6;
    if (y + ht > innerHeight - 8) y = Math.max(8, r.top - ht - 6);
    Object.assign(pop.style, { left: x + 'px', top: y + 'px' });
    const off = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    function close() { pop.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key, true); }
    setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key, true); }, 0);
    return { el: pop, close };
  }
  function membersPopover(anchor, c) {
    const draw = () => clear(list, allPeople().filter(x => x.role !== 'disabled').map(x => {
      const on = (c.assignees || []).includes(x.id);
      return h('button.tk-pick' + (on ? '.on' : ''), {
        onclick: () => { saveCard(c, { assignees: on ? c.assignees.filter(i => i !== x.id) : [...(c.assignees || []), x.id] }); draw(); },
      }, avatar(x, 26), h('span', x.display_name, x.id === me.id ? h('small.muted', ' (moi)') : null), on ? icon('check') : null);
    }));
    const list = h('div.tk-pick-list');
    draw();
    popover(anchor, h('div', h('div.tk-pop-title', 'Membres assignés'), list));
  }
  function labelsPopover(anchor, c) {
    const list = h('div.tk-pick-list');
    const draw = () => clear(list, S.labels.length ? S.labels.map(l => {
      const on = (c.labels || []).includes(l.name);
      return h('button.tk-pick' + (on ? '.on' : ''), {
        onclick: () => { saveCard(c, { labels: on ? c.labels.filter(n => n !== l.name) : [...(c.labels || []), l.name] }); draw(); },
      }, h('span.tk-label.big', { style: { '--c': l.color } }, l.name), on ? icon('check') : null);
    }) : h('p.muted.small', 'Aucune étiquette.'));
    draw();
    const pop = popover(anchor, h('div', h('div.tk-pop-title', 'Étiquettes'), list, h('button.btn.small.full', { onclick: () => { pop.close(); manageLabels(); } }, icon('tag'), 'Gérer les étiquettes')));
  }
  function coverPopover(anchor, c) {
    const imgs = (c.attachments || []).filter(isImg);
    const pop = popover(anchor, h('div',
      h('div.tk-pop-title', 'Couverture'),
      h('div.swatches', COLORS.map(col => h('button.swatch' + (c.cover === col ? '.on' : ''), { style: { background: col }, onclick: () => { saveCard(c, { cover: col }); pop.close(); } }))),
      imgs.length ? h('div.tk-cover-imgs', imgs.map(a => h('button', { onclick: () => { saveCard(c, { cover: a.url }); pop.close(); } }, h('img', { src: a.url, alt: '' })))) : null,
      h('div.row',
        h('button.btn.small', { onclick: async () => { pop.close(); const files = await pickFiles(); if (!files.length) return; try { const [up] = await uploadFiles(files, 'cards'); saveCard(c, { cover: up.url, attachments: [...(c.attachments || []), up] }); } catch (e) { fail(e); } } }, icon('image'), 'Image…'),
        c.cover ? h('button.btn.small.danger', { onclick: () => { saveCard(c, { cover: null }); pop.close(); } }, 'Retirer') : null)));
  }

  // ---------- Étiquettes ----------
  function manageLabels() {
    const box = h('div.tk-labels-admin');
    const draw = () => clear(box,
      S.labels.length ? S.labels.map(l => h('div.tk-lrow',
        h('span.tk-label.big', { style: { '--c': l.color } }, l.name),
        h('small.muted', `${S.cards.filter(c => (c.labels || []).includes(l.name)).length} tâche(s)`),
        h('div.tk-spacer'),
        h('button.icon-btn.small', { title: 'Modifier', onclick: () => editLabel(l) }, icon('edit')),
        h('button.icon-btn.small', { title: 'Supprimer', onclick: () => delLabel(l) }, icon('trash'))))
        : h('p.muted', 'Aucune étiquette pour ce projet.'),
      h('button.btn.small.primary', { onclick: () => editLabel(null) }, icon('plus'), 'Nouvelle étiquette'));
    async function editLabel(l) {
      const v = await form(l ? 'Modifier l\'étiquette' : 'Nouvelle étiquette', [
        { name: 'name', label: 'Nom', value: l?.name || '', required: true, placeholder: 'Ex : Sound design' },
        { name: 'color', label: 'Couleur', type: 'color', value: l?.color || '#F5B935' },
      ]);
      if (!v) return;
      if (S.labels.some(x => x.name.toLowerCase() === v.name.toLowerCase() && x !== l)) return toast('Cette étiquette existe déjà.', 'error');
      try {
        if (l) {
          const oldName = l.name;
          Object.assign(l, await api.update('pt_labels', l.id, { name: v.name, color: v.color }) || v);
          if (oldName !== v.name) for (const c of S.cards.filter(c => (c.labels || []).includes(oldName))) await saveCard(c, { labels: c.labels.map(n => (n === oldName ? v.name : n)) });
        } else addLocal(S.labels, await api.insert('pt_labels', { project_id: p.id, name: v.name, color: v.color }));
        S.labels.sort((a, b) => a.name.localeCompare(b.name));
        draw(); render();
      } catch (e) { fail(e); }
    }
    async function delLabel(l) {
      if (!(await confirmBox(`Supprimer l'étiquette « ${l.name} » ? Elle sera retirée des tâches.`, { ok: 'Supprimer' }))) return;
      try {
        await api.remove('pt_labels', l.id);
        S.labels = S.labels.filter(x => x.id !== l.id);
        for (const c of S.cards.filter(c => (c.labels || []).includes(l.name))) await saveCard(c, { labels: c.labels.filter(n => n !== l.name) });
        if (S.f.label === l.name) S.f.label = '';
        draw(); render();
      } catch (e) { fail(e); }
    }
    draw();
    modal({ title: 'Étiquettes du projet', body: box });
  }

  // ---------- Archives ----------
  function showArchived() {
    const box = h('div.tk-archived');
    const draw = () => {
      const list = S.cards.filter(c => c.archived).sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
      clear(box, list.length ? list.map(c => h('div.tk-lrow',
        h('span.tk-arch-title', c.title), h('small.muted', listOf(c.list_id)?.name || ''),
        h('div.tk-spacer'),
        h('button.btn.small', { onclick: () => { saveCard(c, { archived: false }); draw(); } }, 'Restaurer'),
        h('button.icon-btn.small', { title: 'Supprimer', onclick: async () => { if (await deleteCard(c)) draw(); } }, icon('trash'))))
        : h('p.muted', 'Aucune tâche archivée.'));
    };
    draw();
    modal({ title: 'Tâches archivées', body: box });
  }

  // ---------- Temps réel ----------
  function addLocal(arr, row) { if (row && !arr.some(x => x.id === row.id)) arr.push(row); }
  function applyChange(arr, { type, row, old }) {
    if (type === 'INSERT' && row) { const i = arr.findIndex(x => x.id === row.id); i < 0 ? arr.push(row) : Object.assign(arr[i], row); return arr; }
    if (type === 'UPDATE' && row) { const i = arr.findIndex(x => x.id === row.id); i < 0 ? arr.push(row) : Object.assign(arr[i], row); return arr; }
    if (type === 'DELETE' && old?.id) return arr.filter(x => x.id !== old.id);
    return arr;
  }
  const subs = [
    api.subscribe('pt_cards', { project_id: p.id }, evt => {
      const id = evt.row?.id || evt.old?.id;
      const before = S.cards.find(x => x.id === id);
      const prevList = before?.list_id, prevPos = before?.position, prevArch = before?.archived;
      if (evt.type === 'DELETE' && !before) return;
      S.cards = applyChange(S.cards, evt);
      const c = S.cards.find(x => x.id === id);
      if (evt.type === 'DELETE') { if (openCardCtl?.id === id) openCardCtl.gone(); return renderSoon(); }
      if (!c) return;
      if (evt.type === 'UPDATE' && before && prevList === c.list_id && prevPos === c.position && prevArch === c.archived) refreshCard(c);
      else renderSoon();
      if (openCardCtl?.id === id) openCardCtl.redraw();
    }),
    api.subscribe('pt_lists', { project_id: p.id }, evt => {
      if (evt.type === 'DELETE' && !S.lists.some(x => x.id === evt.old?.id)) return;
      S.lists = applyChange(S.lists, evt);
      if (evt.type === 'DELETE') S.cards = S.cards.filter(c => c.list_id !== evt.old.id);
      renderSoon();
    }),
    api.subscribe('pt_labels', { project_id: p.id }, evt => {
      if (evt.type === 'DELETE' && !S.labels.some(x => x.id === evt.old?.id)) return;
      S.labels = applyChange(S.labels, evt).sort((a, b) => a.name.localeCompare(b.name));
      renderSoon();
    }),
    api.subscribe('pt_comments', { project_id: p.id }, evt => {
      const r = evt.row || evt.old;
      if (!r || r.target_type !== 'card') return;
      if (evt.type === 'INSERT') countComment(r, 1);
      if (evt.type === 'DELETE') countComment(r, -1);
      if (openCardCtl?.id === r.target_id && (evt.type === 'INSERT' || evt.type === 'DELETE')) openCardCtl.onComment(evt);
      const c = S.cards.find(x => x.id === r.target_id);
      if (c) refreshCard(c);
    }),
  ];

  drawToolbar();
  render();
  if (sub) openCard(sub);

  const cleanup = () => {
    alive = false;
    subs.forEach(off => { try { off(); } catch {} });
    document.removeEventListener('touchmove', blockTouch);
    if (drag) { drag.ghost.remove(); document.body.classList.remove('tk-dragging'); drag = null; }
    stopPending();
    document.querySelectorAll('.tk-pop').forEach(x => x.remove());
    openCardCtl?.close();
  };
  cleanup.onSub = s => { if (s) openCard(s); else openCardCtl?.close(); };
  return cleanup;
}
