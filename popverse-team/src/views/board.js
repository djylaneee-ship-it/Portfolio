// Tableaux visuels façon Milanote : une toile infinie où l'on pose notes, titres, post-it, images, liens,
// checklists, tableaux, colonnes et flèches pour structurer un projet. Temps réel + curseurs des autres membres.
//   #/p/<pid>/boards            → premier tableau du projet
//   #/p/<pid>/boards/<boardId>  → ce tableau
import { api } from '../api.js';
import { h, clear, icon, menu, form, modal, toast, fail, uploadFiles, pickFiles, sanitize, avatar, confirmBox, lightbox, empty } from '../ui.js';
import { logActivity } from '../store.js';

// ---------- Couleurs ----------
const CARD = {
  default: { bg: '#17120B', fg: '#F7F0E1', bd: '#3A2D18', label: 'Sombre' },
  gold: { bg: '#3A2A0C', fg: '#FFF1CC', bd: '#8A6418', label: 'Or' },
  ember: { bg: '#3A1E0C', fg: '#FFE3CC', bd: '#8A4A18', label: 'Ambre' },
  red: { bg: '#3A1416', fg: '#FFD9DB', bd: '#7A2A30', label: 'Rouge' },
  green: { bg: '#0F2A22', fg: '#CFF5E8', bd: '#1F5A48', label: 'Vert' },
  blue: { bg: '#0F1F33', fg: '#D3E6FF', bd: '#24476E', label: 'Bleu' },
  purple: { bg: '#24163A', fg: '#E6DAFF', bd: '#4C3278', label: 'Violet' },
  paper: { bg: '#F4EAD2', fg: '#2A1F0C', bd: '#D9C79C', label: 'Papier' },
};
const STICKY = { yellow: '#FFE27A', orange: '#FFB870', pink: '#FF9FB2', green: '#A8E6A1', blue: '#9CCBFF', purple: '#C9B2FF' };
const LINE = { gold: '#F5B935', white: '#E8DFC8', red: '#FF6B6B', green: '#3CC9A0', blue: '#4FA3F7', purple: '#B676F0' };
const paletteOf = kind => (kind === 'sticky' ? STICKY : kind === 'arrow' || kind === 'title' ? LINE : CARD);

const KINDS = {
  note: { label: 'Note', icon: 'note', w: 260, h: 0, rs: 'w', data: () => ({ html: '', color: 'default' }) },
  title: { label: 'Titre', icon: 'title', w: 440, h: 0, rs: 'w', data: () => ({ text: '', size: 'm', color: 'gold' }) },
  sticky: { label: 'Post-it', icon: 'tag', w: 200, h: 200, rs: 'both', data: () => ({ text: '', color: 'yellow' }) },
  image: { label: 'Image', icon: 'image', w: 320, h: 0, rs: 'w', data: () => ({ url: '', caption: '' }) },
  link: { label: 'Lien', icon: 'link', w: 300, h: 0, rs: 'w', data: () => ({ url: '', title: '', color: 'default' }) },
  todo: { label: 'Checklist', icon: 'checklist', w: 280, h: 0, rs: 'w', data: () => ({ title: 'Checklist', items: [{ t: '', done: false }], color: 'default' }) },
  table: { label: 'Tableau', icon: 'table', w: 440, h: 0, rs: 'w', data: () => ({ rows: [['Colonne 1', 'Colonne 2', 'Colonne 3'], ['', '', ''], ['', '', '']], color: 'default' }) },
  column: { label: 'Colonne', icon: 'layers', w: 320, h: 480, rs: 'both', data: () => ({ title: 'Nouvelle colonne', color: 'gold' }) },
  arrow: { label: 'Flèche', icon: 'arrow' },
};
const TOOL_ORDER = ['note', 'title', 'sticky', 'image', 'link', 'todo', 'table', 'column', 'arrow'];
const EDITABLE = new Set(['note', 'title', 'sticky', 'image', 'link', 'todo', 'table', 'column']);

const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  return el;
}
const clone = x => JSON.parse(JSON.stringify(x ?? null));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ytId = url => (url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/) || [])[1];
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const isTyping = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default async function boards(box, { project, sub }) {
  const me = api.me;
  let boardList = [];
  let board = null;
  const items = new Map(); // id → ligne pt_board_items
  const els = new Map(); // id → élément DOM (sauf flèches)
  const sel = new Set();
  let editing = null, editBefore = null;
  let view = { x: 0, y: 0, k: 1 };
  let tool = 'select';
  let drag = null; // opération de pointeur en cours { move(e), up(e) }
  let spaceDown = false;
  const ptrs = new Map();
  let pinch = null;
  const undo = [], redo = [];
  const pending = new Map(); let flushT = null;
  const recent = new Map(); // id → date de notre dernière écriture (pour ignorer l'écho temps réel)
  let unsubItems = null, unsubBoards = null, pres = null;
  const cursors = new Map();
  let lastCursor = 0;
  const tabId = Math.random().toString(36).slice(2);
  let arrowDraft = null; // { a:{x,y}, b:{x,y}, from, to } pendant la création
  let alive = true;

  // ---------- Structure ----------
  const railList = h('div.bd-rail-list');
  const rail = h('aside.bd-rail',
    h('div.bd-rail-head', h('span', 'Tableaux'), h('button.icon-btn', { title: 'Nouveau tableau', onclick: () => newBoard() }, icon('plus'))),
    railList);
  const links = s('svg', { class: 'bd-links', width: 1, height: 1 });
  const world = h('div.bd-world', links);
  const cursorLayer = h('div.bd-cursors');
  world.append(cursorLayer);
  const marquee = h('div.bd-marquee', { hidden: true });
  const stage = h('div.bd-stage', { tabIndex: 0 }, world, marquee);
  const zoomLbl = h('button.bd-zl', { title: 'Revenir à 100 %', onclick: () => zoomTo(1) }, '100 %');
  const zoomCtl = h('div.bd-zoom',
    h('button.icon-btn', { title: 'Dézoomer', onclick: () => zoomBy(1 / 1.25) }, icon('zoomout')),
    zoomLbl,
    h('button.icon-btn', { title: 'Zoomer', onclick: () => zoomBy(1.25) }, icon('zoomin')),
    h('button.icon-btn', { title: 'Tout voir', onclick: () => fit(true) }, icon('eye')));
  const toolBtns = new Map();
  const tools = h('div.bd-tools',
    h('button.bd-tool.mode', { title: 'Sélection rectangle (ou Maj + glisser)', dataset: { tool: 'marquee' }, onclick: () => setTool(tool === 'marquee' ? 'select' : 'marquee') }, icon('cursor'), h('span', 'Sélect.')),
    h('i.bd-tsep'),
    TOOL_ORDER.map(k => {
      const b = h('button.bd-tool', { title: KINDS[k].label + (k === 'arrow' ? ' : glisse d\'un élément à un autre' : ' : clique ou glisse sur la toile'), dataset: { tool: k } }, icon(KINDS[k].icon), h('span', KINDS[k].label));
      toolBtns.set(k, b);
      b.addEventListener('pointerdown', e => toolPointer(e, k));
      return b;
    }));
  const selbar = h('div.bd-selbar', { hidden: true });
  const people = h('div.bd-people');
  const titleBtn = h('button.bd-title', { onclick: () => board && renameBoard(board) });
  const head = h('header.bd-head',
    h('button.icon-btn.bd-rail-btn', { title: 'Liste des tableaux', onclick: () => root.classList.toggle('rail-open') }, icon('menu')),
    titleBtn, people,
    h('button.icon-btn', { title: 'Aide', onclick: help }, h('b', '?')));
  const wrap = h('div.bd-wrap', stage, tools, zoomCtl, selbar);
  const main = h('div.bd-main', head, wrap);
  const root = h('div.bd' + (localStorage.getItem('pt.board.rail') === 'closed' ? '.rail-closed' : ''), rail, h('div.bd-scrim', { onclick: () => root.classList.remove('rail-open') }), main);
  clear(box, root);

  // ---------- Vue (déplacement / zoom) ----------
  const stageRect = () => stage.getBoundingClientRect();
  const toWorld = (cx, cy) => { const r = stageRect(); return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }; };
  const toScreen = (wx, wy) => ({ x: wx * view.k + view.x, y: wy * view.k + view.y });
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    const g = 26 * view.k;
    stage.style.backgroundSize = `${g}px ${g}px`;
    stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
    stage.style.setProperty('--k', view.k);
    zoomLbl.textContent = Math.round(view.k * 100) + ' %';
    positionSelbar();
    saveView();
  }
  let saveViewT;
  function saveView() {
    clearTimeout(saveViewT);
    saveViewT = setTimeout(() => { try { board && localStorage.setItem('pt.board.view.' + board.id, JSON.stringify(view)); } catch {} }, 300);
  }
  function zoomAt(sx, sy, k2) {
    k2 = clamp(k2, 0.1, 4);
    const wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
    view = { k: k2, x: sx - wx * k2, y: sy - wy * k2 };
    applyView();
  }
  const zoomBy = f => { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, view.k * f); };
  const zoomTo = k => { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, k); };
  function fit(animate) {
    const r = stageRect();
    const list = [...items.values()].filter(i => i.kind !== 'arrow');
    if (!list.length || !r.width) { view = { x: r.width / 2 - 200, y: r.height / 2 - 150, k: 1 }; applyView(); return; }
    const bb = bbox(list);
    const pad = 80;
    const k = clamp(Math.min((r.width - pad * 2) / Math.max(bb.w, 1), (r.height - pad * 2) / Math.max(bb.h, 1)), 0.15, 1.25);
    view = { k, x: r.width / 2 - (bb.x + bb.w / 2) * k, y: r.height / 2 - (bb.y + bb.h / 2) * k };
    if (animate) { world.classList.add('anim'); setTimeout(() => world.classList.remove('anim'), 350); }
    applyView();
  }

  // ---------- Géométrie ----------
  function rectOf(it) {
    const el = els.get(it.id);
    return { x: it.x, y: it.y, w: it.w || el?.offsetWidth || 200, h: it.h || el?.offsetHeight || 60 };
  }
  function bbox(list) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const it of list) {
      if (it.kind === 'arrow') { const [a, b] = arrowPts(it); x1 = Math.min(x1, a.x, b.x); y1 = Math.min(y1, a.y, b.y); x2 = Math.max(x2, a.x, b.x); y2 = Math.max(y2, a.y, b.y); continue; }
      const r = rectOf(it);
      x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  const center = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  // Point du bord du rectangle sur la droite centre → cible (avec un petit espace).
  function edge(r, to, gap = 8) {
    const c = center(r);
    const dx = to.x - c.x, dy = to.y - c.y;
    if (!dx && !dy) return c;
    const tx = dx ? (r.w / 2 + gap) / Math.abs(dx) : Infinity;
    const ty = dy ? (r.h / 2 + gap) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  function arrowPts(it) {
    const d = it.data || {};
    const A = d.from && items.get(d.from), B = d.to && items.get(d.to);
    const ra = A && rectOf(A), rb = B && rectOf(B);
    const ca = ra ? center(ra) : { x: d.x1 ?? it.x, y: d.y1 ?? it.y };
    const cb = rb ? center(rb) : { x: d.x2 ?? it.x + 100, y: d.y2 ?? it.y };
    return [ra ? edge(ra, cb) : ca, rb ? edge(rb, ca) : cb];
  }
  function itemAt(p, exclude) {
    const hit = [...items.values()].filter(it => it.kind !== 'arrow' && it.id !== exclude && (() => { const r = rectOf(it); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; })());
    hit.sort((a, b) => (a.kind === 'column') - (b.kind === 'column') || (b.z || 0) - (a.z || 0));
    return hit[0] || null;
  }
  const maxZ = () => Math.max(0, ...[...items.values()].map(i => i.z || 0));
  const minZ = () => Math.min(0, ...[...items.values()].map(i => i.z || 0));

  // ---------- Rendu des éléments ----------
  function place(it) {
    const el = els.get(it.id);
    if (!el) return;
    el.style.left = it.x + 'px';
    el.style.top = it.y + 'px';
    el.style.width = it.w + 'px';
    el.style.height = it.h ? it.h + 'px' : '';
    el.style.zIndex = (it.kind === 'column' ? 10 : 10000) + clamp(Math.round(it.z || 0), -9, 9000);
  }
  function renderItem(it) {
    if (it.kind === 'arrow') { renderLinks(); return; }
    let el = els.get(it.id);
    if (!el) {
      el = h('div.bi', { dataset: { id: it.id } });
      els.set(it.id, el);
      world.insertBefore(el, cursorLayer);
    }
    el.className = `bi bi-${it.kind}` + (sel.has(it.id) ? ' sel' : '') + (it.data?.locked ? ' locked' : '') + (editing === it.id ? ' editing' : '');
    place(it);
    if (editing !== it.id) fill(el, it, false);
  }
  function fill(el, it, edit) {
    const d = it.data || {};
    const pal = paletteOf(it.kind);
    const col = pal[d.color] || Object.values(pal)[0];
    if (pal === CARD) { el.style.setProperty('--bg', col.bg); el.style.setProperty('--fg', col.fg); el.style.setProperty('--bd', col.bd); }
    else el.style.setProperty('--c', col);
    let c;
    switch (it.kind) {
      case 'note':
        c = h('div.bi-rich', { html: sanitize(d.html || ''), dataset: { edit: 'rich', ph: 'Écris quelque chose…' } });
        break;
      case 'title':
        c = h('div.bi-title-t.size-' + (d.size || 'm'), { dataset: { edit: '', ph: 'Titre' } }, d.text || '');
        break;
      case 'sticky':
        c = h('div.bi-sticky-t', { dataset: { edit: '', ph: 'Post-it…' } }, d.text || '');
        break;
      case 'image':
        c = h('figure.bi-fig',
          d.url ? h('img', { src: d.url, alt: '', draggable: false, onload: () => renderLinks() }) : h('div.bi-noimg', icon('image'), 'Image'),
          d.caption || edit ? h('figcaption', { dataset: { edit: '', ph: 'Légende…' } }, d.caption || '') : null);
        break;
      case 'link': {
        const yt = ytId(d.url || '');
        const host = hostOf(d.url || '');
        c = h('div.bi-link',
          yt ? h('div.bl-thumb', h('img', { src: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`, alt: '', draggable: false, onload: () => renderLinks(), onerror: e => { e.target.parentNode.remove(); renderLinks(); } }), h('span.bl-play', icon('play'))) : null,
          h('div.bl-body',
            h('div.bl-host', h('img', { src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, alt: '', draggable: false, onerror: e => { e.target.style.display = 'none'; } }), h('span', host)),
            h('div.bl-title', { dataset: { edit: '', ph: 'Titre du lien' } }, d.title || ''),
            h('a.bl-open', { href: d.url, target: '_blank', rel: 'noopener', dataset: { nodrag: '' } }, icon('link'), 'Ouvrir')));
        break;
      }
      case 'todo': {
        const list = d.items || [];
        const n = list.filter(t => t.done).length;
        c = h('div.bi-todo',
          h('div.td-title', { dataset: { edit: '', ph: 'Checklist' } }, d.title || ''),
          list.length ? h('div.td-bar', h('i', { style: { width: (list.length ? (n / list.length) * 100 : 0) + '%' } })) : null,
          h('div.td-list', list.map((t, i) => h('div.td-item' + (t.done ? '.done' : ''),
            h('button.td-box', { dataset: { nodrag: '' }, onclick: e => { e.stopPropagation(); toggleTodo(it.id, i); } }, t.done ? icon('check') : null),
            h('span.td-text', { dataset: { edit: 'todo', i, ph: 'À faire…' } }, t.t || ''),
            edit ? h('button.td-del', { dataset: { nodrag: '' }, title: 'Retirer', onmousedown: e => e.preventDefault(), onclick: () => todoEdit(it, 'del', i) }, icon('x')) : null))),
          edit ? h('button.td-add', { dataset: { nodrag: '' }, onmousedown: e => e.preventDefault(), onclick: () => todoEdit(it, 'add', list.length - 1) }, icon('plus'), 'Ajouter un élément') : null);
        break;
      }
      case 'table': {
        const rows = d.rows?.length ? d.rows : [['']];
        c = h('div.bi-tablewrap',
          h('table.bi-table', h('tbody', rows.map((r, ri) => h('tr', r.map((v, ci) => h(ri === 0 ? 'th' : 'td', { dataset: { edit: 'cell', r: ri, c: ci } }, v)))))),
          edit ? h('div.tb-ctl', { dataset: { nodrag: '' } },
            ['+ Ligne', '+ Colonne', '− Ligne', '− Colonne'].map((label, i) => h('button', { onmousedown: e => e.preventDefault(), onclick: () => tableEdit(it, i) }, label))) : null);
        break;
      }
      case 'column':
        c = h('div.bi-colwrap',
          h('div.bi-col-head', h('span.col-t', { dataset: { edit: '', ph: 'Colonne' } }, d.title || ''), h('span.col-n', String(childrenOf(it).length || ''))),
          h('div.bi-col-body'));
        break;
      default:
        c = h('div', it.kind);
    }
    el.replaceChildren(...[c,
      KINDS[it.kind]?.rs ? h('div.bi-rs', { title: 'Redimensionner' }) : null,
      h('div.bi-conn', { title: 'Tirer une flèche' }, icon('arrow')),
      d.locked ? h('span.bi-lock', icon('lock')) : null].filter(Boolean));
  }
  function childrenOf(col) {
    const r = rectOf(col);
    return [...items.values()].filter(it => it.id !== col.id && it.kind !== 'arrow' && it.kind !== 'column' && (() => {
      const q = rectOf(it);
      return q.x >= r.x - 2 && q.y >= r.y - 2 && q.x + q.w <= r.x + r.w + 2 && q.y + q.h <= r.y + r.h + 2;
    })());
  }

  function renderLinks() {
    links.replaceChildren();
    for (const it of items.values()) {
      if (it.kind !== 'arrow') continue;
      const d = it.data || {};
      const [a, b] = arrowPts(it);
      const color = LINE[d.color] || LINE.gold;
      const on = sel.has(it.id);
      const g = s('g', { class: 'bl' + (on ? ' sel' : ''), 'data-id': it.id });
      const path = `M${a.x},${a.y} L${b.x},${b.y}`;
      g.append(s('path', { d: path, class: 'bl-hit', 'data-id': it.id }));
      g.append(s('path', { d: path, class: 'bl-line', stroke: color, 'stroke-dasharray': d.dash ? '9 7' : null }));
      g.append(arrowHead(a, b, color));
      if (d.both) g.append(arrowHead(b, a, color));
      if (d.label) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const w = d.label.length * 7.2 + 18;
        g.append(s('rect', { x: mx - w / 2, y: my - 12, width: w, height: 24, rx: 12, class: 'bl-lbg', stroke: color, 'data-id': it.id }));
        const t = s('text', { x: mx, y: my + 4.5, class: 'bl-lt', 'data-id': it.id });
        t.textContent = d.label;
        g.append(t);
      }
      if (on && sel.size === 1) {
        g.append(s('circle', { cx: a.x, cy: a.y, r: 7, class: 'bl-end', 'data-id': it.id, 'data-end': '1' }));
        g.append(s('circle', { cx: b.x, cy: b.y, r: 7, class: 'bl-end', 'data-id': it.id, 'data-end': '2' }));
      }
      links.append(g);
    }
    if (arrowDraft) {
      const { a, b } = arrowDraft;
      links.append(s('path', { d: `M${a.x},${a.y} L${b.x},${b.y}`, class: 'bl-line draft', stroke: LINE.gold }));
      links.append(arrowHead(a, b, LINE.gold));
    }
  }
  function arrowHead(a, b, color) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const L = 13, W = 0.45;
    const p1 = { x: b.x - L * Math.cos(ang - W), y: b.y - L * Math.sin(ang - W) };
    const p2 = { x: b.x - L * Math.cos(ang + W), y: b.y - L * Math.sin(ang + W) };
    return s('path', { d: `M${p1.x},${p1.y} L${b.x},${b.y} L${p2.x},${p2.y} Z`, fill: color, stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', class: 'bl-head' });
  }
  function renderAll() {
    for (const [id, el] of els) if (!items.has(id)) { el.remove(); els.delete(id); }
    for (const it of items.values()) if (it.kind !== 'arrow') renderItem(it);
    // les hauteurs automatiques ne sont connues qu'après rendu
    requestAnimationFrame(() => { renderLinks(); positionSelbar(); });
  }
  function refreshSel() {
    for (const [id, el] of els) el.classList.toggle('sel', sel.has(id));
    renderLinks();
    positionSelbar();
  }

  // ---------- Sauvegarde ----------
  function queueSave(id, patch) {
    pending.set(id, { ...(pending.get(id) || {}), ...patch });
    recent.set(id, Date.now());
    clearTimeout(flushT);
    flushT = setTimeout(flush, 450);
  }
  async function flush() {
    clearTimeout(flushT);
    const list = [...pending];
    pending.clear();
    await Promise.all(list.map(([id, p]) => { recent.set(id, Date.now()); return api.update('pt_board_items', id, { ...p, updated_by: me.id }).catch(fail); }));
  }
  function patchItem(id, patch, { save = true } = {}) {
    const it = items.get(id);
    if (!it) return;
    Object.assign(it, clone(patch));
    renderItem(it);
    if (it.kind !== 'arrow') renderLinks();
    if (save) queueSave(id, patch);
  }
  function pushOp(op) { undo.push(op); if (undo.length > 120) undo.shift(); redo.length = 0; }
  async function applyOp(op, back) {
    if (op.t === 'update') for (const { id, patch } of back ? op.before : op.after) patchItem(id, patch);
    else if ((op.t === 'create') === back) await deleteItems(op.rows.map(r => r.id), { record: false });
    else await restoreItems(op.rows);
    positionSelbar();
  }
  async function doUndo() { const op = undo.pop(); if (!op) return; exitEdit(); await applyOp(op, true); redo.push(op); }
  async function doRedo() { const op = redo.pop(); if (!op) return; exitEdit(); await applyOp(op, false); undo.push(op); }

  async function createItems(rows, { record = true, select = true } = {}) {
    if (!board) return [];
    const ins = rows.map(r => ({ board_id: board.id, updated_by: me.id, ...r }));
    let out;
    try { out = [].concat(await api.insert('pt_board_items', ins)); } catch (e) { fail(e); return []; }
    out.forEach(r => { items.set(r.id, r); recent.set(r.id, Date.now()); });
    if (select) { sel.clear(); out.forEach(r => sel.add(r.id)); }
    renderAll();
    if (record) pushOp({ t: 'create', rows: clone(out) });
    return out;
  }
  async function createItem(kind, x, y, extra = {}) {
    const k = KINDS[kind];
    const [row] = await createItems([{ kind, x: Math.round(x), y: Math.round(y), w: k.w || 0, h: k.h || 0, z: kind === 'column' ? minZ() - 1 : maxZ() + 1, data: { ...(k.data?.() || {}), ...extra } }]);
    return row;
  }
  async function restoreItems(rows) {
    const missing = rows.filter(r => !items.has(r.id));
    if (!missing.length) return;
    try {
      const out = [].concat(await api.insert('pt_board_items', missing.map(r => ({ ...r, updated_by: me.id }))));
      out.forEach(r => { items.set(r.id, r); recent.set(r.id, Date.now()); });
    } catch (e) { fail(e); }
    renderAll();
  }
  async function deleteItems(ids, { record = true } = {}) {
    const set = new Set(ids);
    for (const it of items.values()) if (it.kind === 'arrow' && (set.has(it.data?.from) || set.has(it.data?.to))) set.add(it.id);
    const rows = [...set].map(id => items.get(id)).filter(Boolean);
    if (!rows.length) return;
    if (editing && set.has(editing)) { editing = null; hideFmt(); }
    rows.forEach(r => { items.delete(r.id); pending.delete(r.id); sel.delete(r.id); recent.set(r.id, Date.now()); });
    renderAll();
    if (record) pushOp({ t: 'delete', rows: clone(rows) });
    await Promise.all(rows.map(r => api.remove('pt_board_items', r.id).catch(fail)));
  }

  // ---------- Édition du contenu ----------
  function collect(it, el) {
    const d = clone(it.data) || {};
    const txt = sel_ => (el.querySelector(sel_)?.innerText || '').replace(/\n$/, '').trim();
    switch (it.kind) {
      case 'note': d.html = sanitize(el.querySelector('.bi-rich')?.innerHTML || '').replace(/^(<br>)+$/, ''); break;
      case 'title': d.text = txt('.bi-title-t'); break;
      case 'sticky': d.text = txt('.bi-sticky-t'); break;
      case 'image': d.caption = txt('figcaption'); break;
      case 'link': d.title = txt('.bl-title'); break;
      case 'column': d.title = txt('.col-t'); break;
      case 'todo':
        d.title = txt('.td-title');
        d.items = [...el.querySelectorAll('.td-text')].map((n, i) => ({ t: n.innerText.trim(), done: !!it.data.items?.[i]?.done }));
        break;
      case 'table': {
        const rows = [];
        el.querySelectorAll('[data-edit=cell]').forEach(n => { (rows[+n.dataset.r] ||= [])[+n.dataset.c] = n.innerText.trim(); });
        d.rows = rows;
        break;
      }
    }
    return d;
  }
  function enterEdit(id, { caret = 'end', focusSel } = {}) {
    const it = items.get(id);
    if (!it || it.data?.locked || !EDITABLE.has(it.kind)) return;
    if (editing && editing !== id) exitEdit();
    if (editing !== id) editBefore = clone(it.data);
    editing = id;
    if (!sel.has(id) || sel.size > 1) { sel.clear(); sel.add(id); }
    const el = els.get(id);
    el.classList.add('editing');
    fill(el, it, true);
    refreshSel();
    const eds = [...el.querySelectorAll('[data-edit]')];
    eds.forEach(n => {
      n.contentEditable = 'true';
      n.spellcheck = true;
      n.addEventListener('paste', onEditPaste);
      n.addEventListener('keydown', e => onEditKey(e, it, n));
      n.addEventListener('input', () => { if (it.kind !== 'arrow') requestAnimationFrame(renderLinks); });
    });
    const target = (focusSel && el.querySelector(focusSel)) || eds[0];
    if (target) {
      target.focus();
      const r = document.createRange();
      r.selectNodeContents(target);
      r.collapse(caret === 'start');
      const s_ = getSelection(); s_.removeAllRanges(); s_.addRange(r);
    }
    if (it.kind === 'note') showFmt(it);
    positionSelbar();
  }
  function exitEdit() {
    if (!editing) return;
    const id = editing;
    editing = null;
    hideFmt();
    const it = items.get(id), el = els.get(id);
    if (!it || !el) return;
    const data = collect(it, el);
    el.classList.remove('editing');
    if (JSON.stringify(data) !== JSON.stringify(editBefore)) {
      pushOp({ t: 'update', before: [{ id, patch: { data: editBefore } }], after: [{ id, patch: { data: clone(data) } }] });
      it.data = data;
      queueSave(id, { data });
    }
    renderItem(it);
    requestAnimationFrame(() => { renderLinks(); positionSelbar(); });
    getSelection()?.removeAllRanges();
  }
  function onEditPaste(e) {
    const text = e.clipboardData?.getData('text/plain');
    if (text === undefined) return;
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }
  function onEditKey(e, it, n) {
    if (e.key === 'Escape') { e.preventDefault(); exitEdit(); stage.focus(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (it.kind === 'title' || it.kind === 'column' || it.kind === 'link' || n.tagName === 'FIGCAPTION' || n.classList.contains('td-title')) { e.preventDefault(); exitEdit(); stage.focus(); }
      else if (it.kind === 'todo' && n.dataset.edit === 'todo') { e.preventDefault(); todoEdit(it, 'add', +n.dataset.i); }
      else if (it.kind === 'table' && n.dataset.edit === 'cell') {
        e.preventDefault();
        const next = els.get(it.id).querySelector(`[data-r="${+n.dataset.r + 1}"][data-c="${n.dataset.c}"]`);
        if (next) { next.focus(); getSelection().selectAllChildren(next); getSelection().collapseToEnd(); }
        else tableEdit(it, 0, true);
      }
    }
    if (e.key === 'Backspace' && it.kind === 'todo' && n.dataset.edit === 'todo' && !n.innerText.trim()) { e.preventDefault(); todoEdit(it, 'del', +n.dataset.i, true); }
    if (e.key === 'Tab' && it.kind === 'table') {
      e.preventDefault();
      const cells = [...els.get(it.id).querySelectorAll('[data-edit=cell]')];
      const nx = cells[cells.indexOf(n) + (e.shiftKey ? -1 : 1)];
      if (nx) { nx.focus(); getSelection().selectAllChildren(nx); getSelection().collapseToEnd(); }
    }
  }
  // Changement de structure pendant l'édition : on relit le DOM, on modifie, on réaffiche en édition.
  function restructure(it, data, focusSel) {
    const before = editBefore;
    it.data = data;
    const el = els.get(it.id);
    el.classList.remove('editing');
    editing = null;
    editBefore = before;
    enterEdit(it.id, { focusSel });
    editBefore = before;
    requestAnimationFrame(renderLinks);
  }
  function todoEdit(it, action, i, focusPrev) {
    const data = collect(it, els.get(it.id));
    if (action === 'add') data.items.splice(i + 1, 0, { t: '', done: false });
    if (action === 'del') { data.items.splice(i, 1); if (!data.items.length && !focusPrev) data.items.push({ t: '', done: false }); }
    const fi = action === 'add' ? i + 1 : Math.max(0, i - 1);
    restructure(it, data, data.items.length ? `[data-edit=todo][data-i="${fi}"]` : '.td-title');
  }
  function toggleTodo(id, i) {
    const it = items.get(id);
    if (!it || it.data?.locked) return;
    const before = clone(it.data);
    const data = editing === id ? collect(it, els.get(id)) : clone(it.data);
    data.items[i].done = !data.items[i].done;
    if (editing === id) { restructure(it, data, `[data-edit=todo][data-i="${i}"]`); return; }
    pushOp({ t: 'update', before: [{ id, patch: { data: before } }], after: [{ id, patch: { data: clone(data) } }] });
    patchItem(id, { data });
  }
  function tableEdit(it, op, focusNew) {
    const data = collect(it, els.get(it.id));
    const rows = data.rows;
    const cols = Math.max(1, ...rows.map(r => r.length));
    if (op === 0) rows.push(Array(cols).fill(''));
    if (op === 1) rows.forEach((r, i) => r.push(i === 0 ? `Colonne ${cols + 1}` : ''));
    if (op === 2 && rows.length > 1) rows.pop();
    if (op === 3 && cols > 1) rows.forEach(r => r.pop());
    restructure(it, data, focusNew || op === 0 ? `[data-r="${rows.length - 1}"][data-c="0"]` : undefined);
  }

  // Barre de mise en forme des notes.
  const fmt = h('div.bd-fmt', { hidden: true });
  wrap.append(fmt);
  function showFmt() {
    const cmd = (c, v) => e => { e.preventDefault(); document.execCommand(c, false, v); };
    clear(fmt,
      h('button', { title: 'Gras (Ctrl+B)', onmousedown: cmd('bold') }, icon('bold')),
      h('button', { title: 'Italique (Ctrl+I)', onmousedown: cmd('italic') }, icon('italic')),
      h('button', { title: 'Barré', onmousedown: cmd('strikeThrough') }, h('s', 'S')),
      h('i.sep'),
      h('button', { title: 'Grand titre', onmousedown: cmd('formatBlock', '<h2>') }, 'H1'),
      h('button', { title: 'Sous-titre', onmousedown: cmd('formatBlock', '<h3>') }, 'H2'),
      h('button', { title: 'Texte', onmousedown: cmd('formatBlock', '<p>') }, '¶'),
      h('i.sep'),
      h('button', { title: 'Liste à puces', onmousedown: cmd('insertUnorderedList') }, icon('list')),
      h('button', { title: 'Liste numérotée', onmousedown: cmd('insertOrderedList') }, '1.'),
      h('button', { title: 'Citation', onmousedown: cmd('formatBlock', '<blockquote>') }, '❝'),
      h('button', { title: 'Lien', onmousedown: e => { e.preventDefault(); const u = prompt('Adresse du lien :', 'https://'); if (u && /^https?:\/\//.test(u)) document.execCommand('createLink', false, u); } }, icon('link')));
    fmt.hidden = false;
    positionSelbar();
  }
  function hideFmt() { fmt.hidden = true; }

  // ---------- Barre de sélection (couleur, dupliquer, plans, verrou, suppression) ----------
  function positionSelbar() {
    const list = [...sel].map(id => items.get(id)).filter(Boolean);
    if (!list.length || drag?.hideBar) { selbar.hidden = true; fmt.hidden = true; return; }
    const bb = bbox(list);
    const a = toScreen(bb.x, bb.y), b = toScreen(bb.x + bb.w, bb.y + bb.h);
    const W = wrap.clientWidth;
    const bar = editing && !fmt.hidden ? fmt : selbar;
    if (bar === selbar) { fillSelbar(list); fmt.hidden = true; } else selbar.hidden = true;
    bar.hidden = false;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let x = (a.x + b.x) / 2 - bw / 2;
    let y = a.y - bh - 12;
    if (y < 8) y = b.y + 12;
    if (y > wrap.clientHeight - bh - 8) y = 8;
    bar.style.left = clamp(x, 8, Math.max(8, W - bw - 8)) + 'px';
    bar.style.top = y + 'px';
  }
  let selbarKey = '';
  function fillSelbar(list) {
    const key = list.map(i => i.id + ':' + (i.data?.color || '') + (i.data?.locked ? 'L' : '') + (i.data?.dash ? 'D' : '') + (i.data?.size || '')).join('|');
    if (key === selbarKey && selbar.childElementCount) return;
    selbarKey = key;
    const one = list.length === 1 ? list[0] : null;
    const kinds = new Set(list.map(i => i.kind));
    const pal = kinds.size === 1 ? paletteOf(list[0].kind) : null;
    const locked = list.every(i => i.data?.locked);
    clear(selbar,
      one && EDITABLE.has(one.kind) && !one.data?.locked ? h('button', { title: 'Modifier', onclick: () => enterEdit(one.id) }, icon('edit')) : null,
      pal && !kinds.has('image') ? h('button.bd-colorbtn', { title: 'Couleur', onclick: e => colorMenu(e.currentTarget, list, pal) }, h('i', { style: { background: colorSwatch(list[0], pal) } })) : null,
      one?.kind === 'title' ? h('button', { title: 'Taille', onclick: () => setData(list, it => ({ size: { s: 'm', m: 'l', l: 's' }[it.data.size || 'm'] })) }, 'Aa') : null,
      kinds.size === 1 && kinds.has('arrow') ? [
        h('button', { title: 'Plein / pointillé', onclick: () => setData(list, it => ({ dash: !it.data.dash })) }, h('span.dashico', one?.data?.dash ? '- -' : '—')),
        h('button', { title: 'Double flèche', onclick: () => setData(list, it => ({ both: !it.data.both })) }, '⇄'),
        one ? h('button', { title: 'Texte sur la flèche', onclick: async () => { const v = await form('Texte de la flèche', [{ name: 'label', label: 'Texte', value: one.data.label || '' }]); if (v) setData([one], () => ({ label: v.label })); } }, icon('text')) : null,
      ] : null,
      one?.kind === 'image' && one.data.url ? h('button', { title: 'Agrandir', onclick: () => lightbox(one.data.url) }, icon('eye')) : null,
      one?.kind === 'link' ? h('button', { title: 'Changer l\'adresse', onclick: async () => { const v = await form('Lien', [{ name: 'url', label: 'Adresse', value: one.data.url }]); if (v?.url) setData([one], () => ({ url: normUrl(v.url) })); } }, icon('link')) : null,
      h('i.sep'),
      !kinds.has('arrow') || kinds.size > 1 ? h('button', { title: 'Dupliquer (Ctrl+D)', onclick: duplicate }, icon('copy')) : null,
      h('button', { title: 'Premier plan', onclick: () => restack(true) }, '⬆'),
      h('button', { title: 'Arrière-plan', onclick: () => restack(false) }, '⬇'),
      h('button' + (locked ? '.on' : ''), { title: locked ? 'Déverrouiller' : 'Verrouiller', onclick: () => setData(list, () => ({ locked: !locked })) }, icon('lock')),
      h('button.danger', { title: 'Supprimer (Suppr)', onclick: () => deleteItems([...sel]) }, icon('trash')));
  }
  const colorSwatch = (it, pal) => { const v = pal[it.data?.color] || Object.values(pal)[0]; return typeof v === 'string' ? v : v.bg; };
  function colorMenu(anchor, list, pal) {
    document.querySelectorAll('.bd-colors').forEach(m => m.remove());
    const m = h('div.ctx-menu.bd-colors', Object.entries(pal).map(([k, v]) => h('button.bd-sw', {
      title: v.label || k, style: { background: typeof v === 'string' ? v : v.bg, borderColor: typeof v === 'string' ? v : v.bd },
      onclick: () => { m.remove(); setData(list, () => ({ color: k })); },
    })));
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    Object.assign(m.style, { left: clamp(r.left - 10, 8, innerWidth - m.offsetWidth - 8) + 'px', top: (r.bottom + 6 + m.offsetHeight > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + 'px' });
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  }
  function setData(list, fn) {
    const before = [], after = [];
    for (const it of list) {
      if (editing === it.id) exitEdit();
      const data = { ...it.data, ...fn(it) };
      before.push({ id: it.id, patch: { data: clone(it.data) } });
      after.push({ id: it.id, patch: { data: clone(data) } });
      patchItem(it.id, { data });
    }
    pushOp({ t: 'update', before, after });
    selbarKey = '';
    positionSelbar();
  }
  function restack(front) {
    const list = [...sel].map(id => items.get(id)).filter(Boolean);
    const before = list.map(it => ({ id: it.id, patch: { z: it.z || 0 } }));
    let z = front ? maxZ() : minZ();
    const after = list.map(it => ({ id: it.id, patch: { z: front ? ++z : --z } }));
    after.forEach(a => patchItem(a.id, a.patch));
    pushOp({ t: 'update', before, after });
  }
  async function duplicate() {
    const list = [...sel].map(id => items.get(id)).filter(Boolean);
    if (!list.length) return;
    exitEdit();
    const blocks = list.filter(i => i.kind !== 'arrow');
    let z = maxZ();
    const copies = await createItems(blocks.map(it => ({ kind: it.kind, x: it.x + 28, y: it.y + 28, w: it.w, h: it.h, z: it.kind === 'column' ? it.z : ++z, data: { ...clone(it.data), locked: false } })), { record: false });
    const map = new Map(blocks.map((b, i) => [b.id, copies[i]?.id]));
    const arrows = list.filter(i => i.kind === 'arrow' || false);
    const extraArrows = [...items.values()].filter(a => a.kind === 'arrow' && map.has(a.data?.from) && map.has(a.data?.to) && !arrows.includes(a));
    const arrowCopies = await createItems([...arrows, ...extraArrows].map(a => ({
      kind: 'arrow', x: a.x + 28, y: a.y + 28, w: 0, h: 0, z: a.z,
      data: { ...clone(a.data), from: map.get(a.data?.from) || null, to: map.get(a.data?.to) || null, x1: (a.data.x1 ?? 0) + 28, y1: (a.data.y1 ?? 0) + 28, x2: (a.data.x2 ?? 0) + 28, y2: (a.data.y2 ?? 0) + 28 },
    })), { record: false, select: false });
    sel.clear();
    [...copies, ...arrowCopies].forEach(r => sel.add(r.id));
    refreshSel();
    pushOp({ t: 'create', rows: clone([...copies, ...arrowCopies]) });
  }

  // ---------- Pointeur : glisser, redimensionner, flèches, sélection, déplacement, pincement ----------
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-nodrag]')) return;
    if (e.isPrimary) ptrs.clear();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && e.pointerType === 'touch') { startPinch(); return; }
    if (ptrs.size > 2) return;
    const inEdit = editing && e.target.closest('.bi.editing');
    if (inEdit) return;
    if (editing) exitEdit();
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
    const itemEl = e.target.closest('.bi');
    const id = itemEl?.dataset.id || e.target.getAttribute?.('data-id');
    if (e.button === 1 || spaceDown || (e.button === 0 && tool === 'hand')) { startPan(e); }
    else if (e.button === 2) return;
    else if (tool === 'arrow' && !e.target.classList.contains('bl-end')) startArrow(e, itemEl ? id : null);
    else if (e.target.closest('.bi-rs') && id) startResize(e, id);
    else if (e.target.closest('.bi-conn') && id) startArrow(e, id);
    else if (e.target.classList.contains('bl-end')) startEndDrag(e, id, e.target.dataset.end);
    else if (id && items.get(id)?.kind === 'arrow') { selectOnly(id, e.shiftKey); startArrowMove(e, id); }
    else if (itemEl && id) startItemDrag(e, id);
    else if (e.shiftKey || tool === 'marquee') startMarquee(e);
    else startPan(e, true);
    if (drag) { stage.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  stage.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { movePinch(); return; }
    drag?.move(e);
    sendCursor(e);
  });
  const endPtr = e => {
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; return; }
    const d = drag;
    drag = null;
    d?.up(e);
    positionSelbar();
  };
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);
  stage.addEventListener('lostpointercapture', e => { if (drag && !ptrs.has(e.pointerId)) { const d = drag; drag = null; d.up(e); } });

  function selectOnly(id, add) {
    if (add) sel.has(id) ? sel.delete(id) : sel.add(id);
    else if (!sel.has(id)) { sel.clear(); sel.add(id); }
    refreshSel();
  }
  function startPan(e, clickClears) {
    const s0 = { x: e.clientX, y: e.clientY }, v0 = { ...view };
    let moved = false;
    stage.classList.add('panning');
    drag = {
      move(ev) {
        if (!moved && Math.hypot(ev.clientX - s0.x, ev.clientY - s0.y) < 3) return;
        moved = true;
        view = { ...v0, x: v0.x + ev.clientX - s0.x, y: v0.y + ev.clientY - s0.y };
        applyView();
      },
      up() {
        stage.classList.remove('panning');
        if (!moved && clickClears && sel.size) { sel.clear(); refreshSel(); }
      },
    };
  }
  function startMarquee(e) {
    const r = stageRect();
    const a = { x: e.clientX - r.left, y: e.clientY - r.top };
    const base = e.shiftKey ? new Set(sel) : new Set();
    marquee.hidden = false;
    Object.assign(marquee.style, { left: a.x + 'px', top: a.y + 'px', width: '0px', height: '0px' });
    drag = {
      hideBar: true,
      move(ev) {
        const b = { x: ev.clientX - r.left, y: ev.clientY - r.top };
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), hh = Math.abs(a.y - b.y);
        Object.assign(marquee.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
        const w1 = { x: (x - view.x) / view.k, y: (y - view.y) / view.k }, w2 = { x: (x + w - view.x) / view.k, y: (y + hh - view.y) / view.k };
        sel.clear(); base.forEach(i => sel.add(i));
        for (const it of items.values()) {
          if (it.kind === 'arrow') {
            const [p, q] = arrowPts(it);
            if ([p, q].every(pt => pt.x >= w1.x && pt.x <= w2.x && pt.y >= w1.y && pt.y <= w2.y)) sel.add(it.id);
            continue;
          }
          const q = rectOf(it);
          if (q.x < w2.x && q.x + q.w > w1.x && q.y < w2.y && q.y + q.h > w1.y) sel.add(it.id);
        }
        for (const [id, el] of els) el.classList.toggle('sel', sel.has(id));
      },
      up() { marquee.hidden = true; if (tool === 'marquee') setTool('select'); refreshSel(); },
    };
  }
  function startItemDrag(e, id) {
    const it = items.get(id);
    const was = sel.has(id);
    if (e.shiftKey) { selectOnly(id, true); if (was) return; }
    else if (!was) { sel.clear(); sel.add(id); refreshSel(); }
    const moving = new Set([...sel].filter(i => { const x = items.get(i); return x && x.kind !== 'arrow' && !x.data?.locked; }));
    for (const i of [...moving]) { const x = items.get(i); if (x.kind === 'column') childrenOf(x).forEach(c => !c.data?.locked && moving.add(c.id)); }
    const start = [...moving].map(i => ({ id: i, x: items.get(i).x, y: items.get(i).y }));
    const freeArrows = [...sel].map(i => items.get(i)).filter(a => a?.kind === 'arrow' && !a.data?.locked).map(a => ({ id: a.id, data: clone(a.data) }));
    const s0 = { x: e.clientX, y: e.clientY };
    let moved = false;
    drag = {
      move(ev) {
        if (!moved && Math.hypot(ev.clientX - s0.x, ev.clientY - s0.y) < 4) return;
        if (!moved) { moved = true; drag.hideBar = true; selbar.hidden = true; start.forEach(s_ => els.get(s_.id)?.classList.add('dragging')); }
        const dx = (ev.clientX - s0.x) / view.k, dy = (ev.clientY - s0.y) / view.k;
        start.forEach(s_ => { const x = items.get(s_.id); if (!x) return; x.x = Math.round(s_.x + dx); x.y = Math.round(s_.y + dy); place(x); });
        freeArrows.forEach(a => { const x = items.get(a.id); if (!x) return; x.data = { ...x.data, x1: a.data.x1 + dx, y1: a.data.y1 + dy, x2: a.data.x2 + dx, y2: a.data.y2 + dy }; });
        renderLinks();
      },
      up() {
        start.forEach(s_ => els.get(s_.id)?.classList.remove('dragging'));
        if (moved) {
          const before = start.map(s_ => ({ id: s_.id, patch: { x: s_.x, y: s_.y } })).concat(freeArrows.map(a => ({ id: a.id, patch: { data: a.data } })));
          const after = start.map(s_ => ({ id: s_.id, patch: { x: items.get(s_.id).x, y: items.get(s_.id).y } })).concat(freeArrows.map(a => ({ id: a.id, patch: { data: clone(items.get(a.id).data) } })));
          pushOp({ t: 'update', before, after });
          after.forEach(a => queueSave(a.id, a.patch));
          // compteur des colonnes
          [...items.values()].filter(c => c.kind === 'column').forEach(c => { const n = els.get(c.id)?.querySelector('.col-n'); if (n) n.textContent = String(childrenOf(c).length || ''); });
        } else if (was && !e.shiftKey && sel.size === 1 && !it.data?.locked) enterEdit(id, { focusSel: clickedEditable(e) });
      },
    };
  }
  // Pour un 2e clic sur un élément sélectionné : éditer la zone cliquée (cellule, ligne de checklist…).
  function clickedEditable(e) {
    const n = e.target.closest('[data-edit]');
    if (!n) return undefined;
    if (n.dataset.edit === 'cell') return `[data-r="${n.dataset.r}"][data-c="${n.dataset.c}"]`;
    if (n.dataset.edit === 'todo') return `[data-edit=todo][data-i="${n.dataset.i}"]`;
    return '.' + [...n.classList][0];
  }
  function startResize(e, id) {
    const it = items.get(id);
    if (it.data?.locked) return;
    const el = els.get(id);
    const k = KINDS[it.kind];
    const s0 = { x: e.clientX, y: e.clientY, w: it.w || el.offsetWidth, h: it.h || el.offsetHeight };
    const before = { w: it.w, h: it.h };
    drag = {
      hideBar: true,
      move(ev) {
        it.w = Math.round(Math.max(it.kind === 'title' ? 120 : 140, s0.w + (ev.clientX - s0.x) / view.k));
        if (k.rs === 'both') it.h = Math.round(Math.max(100, s0.h + (ev.clientY - s0.y) / view.k));
        place(it);
        renderLinks();
      },
      up() {
        const after = { w: it.w, h: it.h };
        if (after.w === before.w && after.h === before.h) return;
        pushOp({ t: 'update', before: [{ id, patch: before }], after: [{ id, patch: after }] });
        queueSave(id, after);
      },
    };
  }
  function startArrow(e, fromId) {
    const p0 = toWorld(e.clientX, e.clientY);
    const from = fromId ? items.get(fromId) : null;
    let target = null;
    let moved = false;
    drag = {
      hideBar: true,
      move(ev) {
        moved = true;
        const p = toWorld(ev.clientX, ev.clientY);
        target = itemAt(p, fromId);
        els.forEach((el, i) => el.classList.toggle('target', target?.id === i));
        const b = target ? edge(rectOf(target), from ? center(rectOf(from)) : p0) : p;
        const a = from ? edge(rectOf(from), target ? center(rectOf(target)) : p) : p0;
        arrowDraft = { a, b };
        renderLinks();
      },
      async up(ev) {
        els.forEach(el => el.classList.remove('target'));
        const p = toWorld(ev.clientX, ev.clientY);
        arrowDraft = null;
        renderLinks();
        if (!moved || (!target && !from && Math.hypot(p.x - p0.x, p.y - p0.y) < 14) || (from && !target && Math.hypot(p.x - p0.x, p.y - p0.y) < 30)) { if (tool === 'arrow') setTool('select'); return; }
        const startId = from?.id || (fromId ? null : itemAt(p0)?.id) || null;
        await createItem('arrow', Math.min(p0.x, p.x), Math.min(p0.y, p.y), { from: startId, to: target?.id || null, x1: p0.x, y1: p0.y, x2: p.x, y2: p.y, color: 'gold', dash: false, both: false, label: '' });
        setTool('select');
      },
    };
  }
  function startEndDrag(e, id, end) {
    const it = items.get(id);
    if (!it || it.data?.locked) return;
    const before = clone(it.data);
    const other = end === '1' ? it.data.to : it.data.from;
    drag = {
      hideBar: true,
      move(ev) {
        const p = toWorld(ev.clientX, ev.clientY);
        const t = itemAt(p, other);
        els.forEach((el, i) => el.classList.toggle('target', t?.id === i));
        it.data = end === '1' ? { ...it.data, from: t?.id || null, x1: p.x, y1: p.y } : { ...it.data, to: t?.id || null, x2: p.x, y2: p.y };
        renderLinks();
      },
      up() {
        els.forEach(el => el.classList.remove('target'));
        pushOp({ t: 'update', before: [{ id, patch: { data: before } }], after: [{ id, patch: { data: clone(it.data) } }] });
        queueSave(id, { data: it.data });
      },
    };
  }
  function startArrowMove(e, id) {
    const it = items.get(id);
    if (!it || it.data?.locked || it.data.from || it.data.to) return; // une flèche reliée suit ses éléments
    const before = clone(it.data);
    const s0 = { x: e.clientX, y: e.clientY };
    let moved = false;
    drag = {
      move(ev) {
        moved = true;
        const dx = (ev.clientX - s0.x) / view.k, dy = (ev.clientY - s0.y) / view.k;
        it.data = { ...before, x1: before.x1 + dx, y1: before.y1 + dy, x2: before.x2 + dx, y2: before.y2 + dy };
        renderLinks();
      },
      up() {
        if (!moved) return;
        pushOp({ t: 'update', before: [{ id, patch: { data: before } }], after: [{ id, patch: { data: clone(it.data) } }] });
        queueSave(id, { data: it.data });
      },
    };
  }
  function startPinch() {
    const [a, b] = [...ptrs.values()];
    if (drag) { const d = drag; drag = null; d.up({ clientX: a.x, clientY: a.y }); }
    const r = stageRect();
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), m0: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, v0: { ...view } };
  }
  function movePinch() {
    const [a, b] = [...ptrs.values()];
    if (!a || !b) return;
    const r = stageRect();
    const m = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const k = clamp(pinch.v0.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, 0.1, 4);
    const wx = (pinch.m0.x - pinch.v0.x) / pinch.v0.k, wy = (pinch.m0.y - pinch.v0.y) / pinch.v0.k;
    view = { k, x: m.x - wx * k, y: m.y - wy * k };
    applyView();
  }

  stage.addEventListener('wheel', e => {
    if (editing && e.target.closest('.bi.editing') && !e.ctrlKey) return;
    e.preventDefault();
    const r = stageRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, view.k * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0022) * 2.2));
    else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
  }, { passive: false });

  stage.addEventListener('dblclick', e => {
    const itemEl = e.target.closest('.bi');
    if (itemEl) {
      const it = items.get(itemEl.dataset.id);
      if (it?.kind === 'image' && it.data.url && !editing) lightbox(it.data.url);
      else if (it) enterEdit(it.id, { focusSel: clickedEditable(e) });
      return;
    }
    if (e.target.closest('.bl')) return;
    const p = toWorld(e.clientX, e.clientY);
    createItem('note', p.x - 20, p.y - 20).then(r => r && enterEdit(r.id));
  });

  stage.addEventListener('contextmenu', e => {
    e.preventDefault();
    const itemEl = e.target.closest('.bi');
    const id = itemEl?.dataset.id || e.target.getAttribute?.('data-id');
    const p = toWorld(e.clientX, e.clientY);
    if (id && items.get(id)) {
      if (!sel.has(id)) { sel.clear(); sel.add(id); refreshSel(); }
      const it = items.get(id);
      menu({ x: e.clientX, y: e.clientY }, [
        EDITABLE.has(it.kind) && !it.data?.locked ? { label: 'Modifier', icon: 'edit', onclick: () => enterEdit(id) } : null,
        it.kind !== 'arrow' ? { label: 'Dupliquer', icon: 'copy', onclick: duplicate } : null,
        { label: 'Premier plan', icon: 'layers', onclick: () => restack(true) },
        { label: 'Arrière-plan', icon: 'layers', onclick: () => restack(false) },
        { label: it.data?.locked ? 'Déverrouiller' : 'Verrouiller', icon: 'lock', onclick: () => setData([...sel].map(i => items.get(i)).filter(Boolean), () => ({ locked: !it.data?.locked })) },
        '-',
        { label: 'Supprimer', icon: 'trash', danger: true, onclick: () => deleteItems([...sel]) },
      ]);
    } else {
      menu({ x: e.clientX, y: e.clientY }, [
        ...['note', 'title', 'sticky', 'todo', 'table', 'column'].map(k => ({ label: 'Ajouter : ' + KINDS[k].label, icon: KINDS[k].icon, onclick: () => addAt(k, p) })),
        { label: 'Ajouter : Image', icon: 'image', onclick: () => addAt('image', p) },
        { label: 'Ajouter : Lien', icon: 'link', onclick: () => addAt('link', p) },
        '-',
        { label: 'Tout voir', icon: 'eye', onclick: () => fit(true) },
      ]);
    }
  });

  // ---------- Barre d'outils (clic = au centre, glisser = à l'endroit lâché) ----------
  function setTool(t) {
    tool = t;
    tools.querySelectorAll('.bd-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    stage.dataset.tool = t;
  }
  function toolPointer(e, kind) {
    e.preventDefault();
    if (kind === 'arrow') { setTool(tool === 'arrow' ? 'select' : 'arrow'); if (tool === 'arrow') toast('Glisse d\'un élément vers un autre pour les relier.', 'info', 2500); return; }
    const s0 = { x: e.clientX, y: e.clientY };
    let ghost = null;
    const move = ev => {
      if (!ghost && Math.hypot(ev.clientX - s0.x, ev.clientY - s0.y) < 8) return;
      if (!ghost) { ghost = h('div.bd-ghost', icon(KINDS[kind].icon), KINDS[kind].label); document.body.append(ghost); }
      Object.assign(ghost.style, { left: ev.clientX + 'px', top: ev.clientY + 'px' });
    };
    const up = ev => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      if (ghost) {
        ghost.remove();
        const r = stageRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) addAt(kind, toWorld(ev.clientX, ev.clientY));
      } else {
        const r = stageRect();
        const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
        // Au centre de l'écran, en cascade si un élément occupe déjà la place.
        const pt = { x: Math.round(c.x - (KINDS[kind].w || 200) / 2), y: Math.round(c.y - 60) };
        for (let i = 0; i < 30 && [...items.values()].some(it => it.kind !== 'arrow' && Math.abs(it.x - pt.x) < 24 && Math.abs(it.y - pt.y) < 24); i++) { pt.x += 32; pt.y += 32; }
        addAt(kind, pt);
      }
    };
    const cancel = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); ghost?.remove(); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  }
  async function addAt(kind, p) {
    exitEdit();
    if (kind === 'image') {
      const files = await pickFiles({ multiple: true });
      if (files.length) await addImages(files, p);
      return;
    }
    if (kind === 'link') {
      const v = await form('Ajouter un lien', [{ name: 'url', label: 'Adresse', placeholder: 'https://…', required: true }, { name: 'title', label: 'Titre (facultatif)' }], { submit: 'Ajouter' });
      if (v?.url) await createItem('link', p.x, p.y, { url: normUrl(v.url), title: v.title || '' });
      return;
    }
    const r = await createItem(kind, p.x, p.y);
    if (r && kind !== 'column') enterEdit(r.id, { focusSel: { todo: '[data-edit=todo][data-i="0"]', table: '[data-r="1"][data-c="0"]' }[kind] });
  }
  const normUrl = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, ''));
  async function addImages(files, p) {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return toast('Seules les images peuvent être posées sur le tableau.', 'error');
    toast(imgs.length > 1 ? `Envoi de ${imgs.length} images…` : 'Envoi de l\'image…', 'info', 1800);
    let z = maxZ();
    const rows = [];
    for (const [i, f] of imgs.entries()) {
      try {
        const [up] = await uploadFiles([f], 'boards');
        const dims = await new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ w: 320, h: 240 }); im.src = up.url; });
        const w = Math.round(clamp(dims.w, 120, 380));
        rows.push({ kind: 'image', x: Math.round(p.x + i * 30), y: Math.round(p.y + i * 30), w, h: 0, z: ++z, data: { url: up.url, caption: '' } });
      } catch (e) { fail(e); }
    }
    if (rows.length) await createItems(rows);
  }

  // Glisser-déposer de fichiers et collage.
  stage.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); stage.classList.add('dropping'); } });
  stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
  stage.addEventListener('drop', e => {
    stage.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addImages(files, toWorld(e.clientX, e.clientY));
  });
  const onPaste = e => {
    if (!root.isConnected || isTyping(e.target) || editing || document.querySelector('.modal-wrap')) return;
    const files = [...(e.clipboardData?.files || [])];
    const r = stageRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); addImages(files, { x: c.x - 150, y: c.y - 100 }); return; }
    const text = (e.clipboardData?.getData('text/plain') || '').trim();
    if (!text) return;
    e.preventDefault();
    if (/^https?:\/\/\S+$/i.test(text)) createItem('link', c.x - 150, c.y - 50, { url: text, title: '' });
    else createItem('note', c.x - 130, c.y - 40, { html: sanitize(text.split('\n').map(l => `<p>${l.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</p>`).join('')) });
  };
  document.addEventListener('paste', onPaste);

  // ---------- Clavier ----------
  const onKey = e => {
    if (!root.isConnected || document.querySelector('.modal-wrap')) return;
    if (e.key === ' ' && !isTyping(e.target)) { if (!spaceDown) { spaceDown = true; stage.classList.add('space'); } e.preventDefault(); return; }
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); items.forEach((_, id) => sel.add(id)); refreshSel(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); deleteItems([...sel].filter(id => !items.get(id)?.data?.locked)); }
    else if (e.key === 'Escape') { sel.clear(); setTool('select'); refreshSel(); }
    else if (e.key === 'Enter' && sel.size === 1) { e.preventDefault(); enterEdit([...sel][0]); }
    else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.2); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); }
    else if (mod && e.key === '0') { e.preventDefault(); zoomTo(1); }
    else if (e.key.startsWith('Arrow') && sel.size) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 2;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const list = [...sel].map(i => items.get(i)).filter(it => it && it.kind !== 'arrow' && !it.data?.locked);
      pushOp({ t: 'update', before: list.map(it => ({ id: it.id, patch: { x: it.x, y: it.y } })), after: list.map(it => ({ id: it.id, patch: { x: it.x + dx, y: it.y + dy } })) });
      list.forEach(it => patchItem(it.id, { x: it.x + dx, y: it.y + dy }));
      positionSelbar();
    }
  };
  const onKeyUp = e => { if (e.key === ' ') { spaceDown = false; stage.classList.remove('space'); } };
  addEventListener('keydown', onKey);
  addEventListener('keyup', onKeyUp);
  const onResize = () => positionSelbar();
  addEventListener('resize', onResize);

  // ---------- Présence : curseurs des autres membres ----------
  function sendCursor(e) {
    if (!pres || Date.now() - lastCursor < 60) return;
    lastCursor = Date.now();
    const p = toWorld(e.clientX, e.clientY);
    pres.send({ t: 'cur', tab: tabId, id: me.id, name: me.display_name, color: me.color || '#F5B935', x: Math.round(p.x), y: Math.round(p.y) });
  }
  function onPresence(list, payload) {
    if (list) {
      const seen = new Map();
      list.forEach(m => m?.id && seen.set(m.id, m));
      clear(people, [...seen.values()].slice(0, 6).map(m => avatar({ id: m.id, display_name: m.name, color: m.color, avatar_url: m.avatar }, 28)));
      for (const [k, c] of cursors) if (!seen.has(c.id)) { c.el.remove(); cursors.delete(k); }
      return;
    }
    if (payload?.t !== 'cur' || payload.tab === tabId) return;
    const key = payload.tab || payload.id;
    let c = cursors.get(key);
    if (!c) {
      c = { id: payload.id, el: h('div.bd-cursor', { style: { '--c': payload.color } }, h('svg-holder'), h('span', payload.name)) };
      c.el.firstChild.replaceWith(Object.assign(s('svg', { viewBox: '0 0 24 24' }), { innerHTML: '<path d="M4 3l16 7-7 2-2 7z"/>' }));
      cursors.set(key, c);
      cursorLayer.append(c.el);
    }
    c.el.style.left = payload.x + 'px';
    c.el.style.top = payload.y + 'px';
    c.el.classList.remove('idle');
    clearTimeout(c.t);
    c.t = setTimeout(() => c.el.classList.add('idle'), 6000);
  }

  // ---------- Tableaux (liste à gauche) ----------
  function drawRail() {
    clear(railList, boardList.length ? boardList.map(b => h('a.bd-board' + (board?.id === b.id ? '.active' : ''), { href: `#/p/${project.id}/boards/${b.id}` },
      h('span.bd-bico', b.icon || '🧭'), h('span.bd-bname', b.name),
      h('button.icon-btn.bd-bmenu', {
        title: 'Options', onclick: e => {
          e.preventDefault(); e.stopPropagation();
          menu(e.currentTarget, [
            { label: 'Renommer', icon: 'edit', onclick: () => renameBoard(b) },
            { label: 'Supprimer', icon: 'trash', danger: true, onclick: () => deleteBoard(b) },
          ], { align: 'right' });
        },
      }, icon('more'))))
      : h('p.muted.small.bd-none', 'Aucun tableau.'),
      h('button.bd-newboard', { onclick: () => newBoard() }, icon('plus'), 'Nouveau tableau'));
  }
  async function newBoard() {
    const v = await form('Nouveau tableau', [
      { name: 'name', label: 'Nom', required: true, placeholder: 'Ex : Boucle de gameplay, Moodboard, Carte du monde…' },
      { name: 'icon', label: 'Emoji', value: '🧭' },
    ], { submit: 'Créer' });
    if (!v) return;
    try {
      const b = await api.insert('pt_boards', { project_id: project.id, name: v.name, icon: v.icon || '🧭', position: Date.now(), created_by: me.id });
      if (!boardList.some(x => x.id === b.id)) boardList.push(b);
      logActivity(project.id, 'board', `a créé le tableau « ${b.name} »`, `#/p/${project.id}/boards/${b.id}`);
      location.hash = `#/p/${project.id}/boards/${b.id}`;
    } catch (e) { fail(e); }
  }
  async function renameBoard(b) {
    const v = await form('Renommer le tableau', [{ name: 'name', label: 'Nom', value: b.name, required: true }, { name: 'icon', label: 'Emoji', value: b.icon || '🧭' }]);
    if (!v) return;
    try {
      const nb = await api.update('pt_boards', b.id, { name: v.name, icon: v.icon || '🧭' });
      Object.assign(b, nb || v);
      drawRail(); drawHead();
    } catch (e) { fail(e); }
  }
  async function deleteBoard(b) {
    if (!(await confirmBox(`Supprimer le tableau « ${b.name} » et tout son contenu ?`, { ok: 'Supprimer' }))) return;
    try {
      await api.remove('pt_boards', b.id);
      boardList = boardList.filter(x => x.id !== b.id);
      if (board?.id === b.id) { board = null; location.hash = `#/p/${project.id}/boards`; openBoard(null); }
      else drawRail();
    } catch (e) { fail(e); }
  }
  function drawHead() {
    clear(titleBtn, board ? [h('span.bd-bico', board.icon || '🧭'), h('b', board.name), icon('edit')] : h('b', 'Tableaux'));
  }

  // ---------- Ouverture d'un tableau ----------
  async function openBoard(id) {
    await flush();
    exitEdit();
    unsubItems?.(); unsubItems = null;
    pres?.close(); pres = null;
    cursors.forEach(c => c.el.remove()); cursors.clear();
    items.clear(); sel.clear(); undo.length = 0; redo.length = 0;
    els.forEach(el => el.remove()); els.clear();
    links.replaceChildren();
    root.classList.remove('rail-open');
    board = boardList.find(b => b.id === id) || boardList[0] || null;
    drawRail(); drawHead();
    wrap.classList.toggle('none', !board);
    wrap.querySelector('.bd-empty')?.remove();
    if (!board) {
      wrap.append(h('div.bd-empty', empty('board', 'Aucun tableau', 'Un tableau est une toile libre pour poser images, notes, flèches et tableaux : parfait pour structurer un jeu.', h('button.btn.primary', { onclick: () => newBoard() }, icon('plus'), 'Créer un tableau'))));
      return;
    }
    const bid = board.id;
    try {
      const rows = await api.select('pt_board_items', { eq: { board_id: bid } });
      if (!alive || board?.id !== bid) return;
      rows.forEach(r => items.set(r.id, r));
    } catch (e) { fail(e); }
    renderAll();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('pt.board.view.' + bid) || 'null'); } catch {}
    requestAnimationFrame(() => { if (saved?.k) { view = saved; applyView(); } else fit(); });
    unsubItems = api.subscribe('pt_board_items', { board_id: bid }, ({ type, row, old }) => {
      const id_ = row?.id || old?.id;
      if (!id_) return;
      if (type === 'DELETE') {
        if (!items.has(id_)) return;
        items.delete(id_); sel.delete(id_);
        if (editing === id_) { editing = null; hideFmt(); }
        renderAll();
        return;
      }
      if (row.board_id !== bid) return;
      const mine = row.updated_by === me.id && Date.now() - (recent.get(id_) || 0) < 4000;
      if (type === 'INSERT') { if (!items.has(id_)) { items.set(id_, row); renderAll(); } return; }
      if (mine || pending.has(id_)) return;
      if (drag && sel.has(id_)) return;
      items.set(id_, row);
      if (editing === id_) { place(row); return; }
      renderItem(row);
      renderLinks();
      positionSelbar();
    });
    pres = api.presence('board:' + bid, { id: me.id, name: me.display_name, color: me.color || '#F5B935', avatar: me.avatar_url || null }, onPresence);
  }

  // ---------- Aide ----------
  function help() {
    const row = (k, t) => h('div.bd-help-row', h('kbd', k), h('span', t));
    modal({
      title: 'Utiliser les tableaux', body: h('div.bd-help',
        row('Double-clic', 'sur le fond : nouvelle note · sur un élément : le modifier'),
        row('Glisser le fond', 'se déplacer (un doigt sur mobile)'),
        row('Maj + glisser', 'sélection rectangle'),
        row('Ctrl + molette', 'zoomer (pincer sur mobile)'),
        row('Espace + glisser', 'se déplacer au-dessus des éléments'),
        row('Ctrl + V', 'coller une image, un lien ou du texte'),
        row('Glisser un fichier', 'déposer des images depuis le PC'),
        row('Ctrl + Z / Ctrl + Y', 'annuler / rétablir'),
        row('Ctrl + D', 'dupliquer'),
        row('Suppr', 'supprimer la sélection'),
        row('Flèche ↗', 'outil Flèche ou la pastille ↗ d\'un élément sélectionné : glisser vers un autre élément'),
        row('Colonne', 'déplacer une colonne déplace aussi ce qu\'elle contient')),
    });
  }

  // ---------- Démarrage ----------
  try {
    boardList = await api.select('pt_boards', { eq: { project_id: project.id }, order: [['position', 'asc'], ['created_at', 'asc']] });
  } catch (e) { fail(e); }
  unsubBoards = api.subscribe('pt_boards', { project_id: project.id }, ({ type, row, old }) => {
    if (type === 'INSERT' && !boardList.some(b => b.id === row.id)) boardList.push(row);
    if (type === 'UPDATE') { boardList = boardList.map(b => (b.id === row.id ? row : b)); if (board?.id === row.id) { board = row; drawHead(); } }
    if (type === 'DELETE') {
      boardList = boardList.filter(b => b.id !== old.id);
      if (board?.id === old.id) { toast('Ce tableau a été supprimé.', 'error'); openBoard(null); return; }
    }
    drawRail();
  });
  setTool('select');
  applyView();
  await openBoard(sub);
  if (!sub && board) history.replaceState(null, '', `#/p/${project.id}/boards/${board.id}`);

  const cleanup = () => {
    alive = false;
    flush();
    unsubItems?.(); unsubBoards?.(); pres?.close();
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('resize', onResize);
    document.removeEventListener('paste', onPaste);
    fmt.remove();
    document.querySelectorAll('.bd-colors, .bd-ghost').forEach(m => m.remove());
  };
  cleanup.onSub = s_ => { if (s_ !== board?.id || !s_) openBoard(s_); };
  // Rail repliable sur ordinateur
  rail.addEventListener('dblclick', e => { if (e.target === rail) { root.classList.toggle('rail-closed'); localStorage.setItem('pt.board.rail', root.classList.contains('rail-closed') ? 'closed' : 'open'); } });
  head.querySelector('.bd-rail-btn').addEventListener('click', () => {
    if (innerWidth > 820) {
      root.classList.remove('rail-open');
      root.classList.toggle('rail-closed');
      try { localStorage.setItem('pt.board.rail', root.classList.contains('rail-closed') ? 'closed' : 'open'); } catch {}
    }
  });
  return cleanup;
}
