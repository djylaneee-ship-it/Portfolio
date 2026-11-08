// Petits outils d'interface partagés par toutes les vues.
import DOMPurify from 'dompurify';
import { api } from './api.js';

// h('div.card#id', { onclick, style, dataset, html }, ...enfants)
export function h(sel, props, ...kids) {
  if (props instanceof Node || typeof props !== 'object' || props === null || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i) || [];
  const el = document.createElement(m[1] || 'div');
  let deferredValue;
  (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { t === '.' ? el.classList.add(v) : (el.id = v); });
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv); }
    else if (k === 'value' && 'value' in el) deferredValue = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el; };
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// ---------- Icônes (traits) ----------
const P = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chat: 'M4 5h16v11H9l-5 4z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M15.5 3.1a3.5 3.5 0 0 1 0 6.8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  kanban: 'M3 4h5v16H3zM10 4h5v11h-5zM17 4h4v7h-4z',
  board: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  book: 'M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM8 7h6M8 11h6',
  rocket: 'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L13 16l-5-5zM9 11l-3 1-2 3 4 1M13 15l-1 3 1 4 3-2 1-3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  spark: 'M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15.5 9.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  tag: 'M3 12V4h8l9 9-8 8zM7.5 7.5h.01',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  checklist: 'M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8',
  send: 'M4 12l16-8-6 16-2-7z',
  paperclip: 'M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4L14.6 7.3',
  hash: 'M5 9h14M5 15h14M10 3L8 21M16 3l-2 18',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  comment: 'M4 5h16v11H9l-5 4z',
  arrow: 'M5 19L19 5M10 5h9v9',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  title: 'M6 4v16M18 4v16M6 12h12',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  note: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h5',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  play: 'M7 4l13 8-13 8z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  refresh: 'M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4',
  zoomin: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5M8 11h6M11 8v6',
  zoomout: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5M8 11h6',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 5.5a1.5 1.5 0 0 1 3 0V12M17 8.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a7 7 0 0 1-5-2.1L3.6 15.3a1.6 1.6 0 0 1 2.3-2.2L8 15',
  cursor: 'M5 3l14 7-6 2-2 6z',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.5-8 9.5-4.6-1-8-5-8-9.5V6z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  gamepad: 'M6 9h4M8 7v4M15 9h.01M18 11h.01M7.5 17h9a4.5 4.5 0 0 0 4.4-5.4l-.8-4A3.5 3.5 0 0 0 16.7 5H7.3a3.5 3.5 0 0 0-3.4 2.6l-.8 4A4.5 4.5 0 0 0 7.5 17z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M10 4h8M6 20h8M14 4l-4 16',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  reply: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v4',
  pin: 'M12 17v5M9 3h6l-1 6 4 3v2H6v-2l4-3z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ic ' + cls);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || P.spark);
  s.append(p);
  return s;
}

// ---------- Texte ----------
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sanitize = html => DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] });

// Markdown léger (chat, IA, posts) : **gras**, *italique*, `code`, ```bloc```, liens, listes, titres, @mentions.
export function md(src) {
  let s = esc(src || '');
  const blocks = [];
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => { blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)@([\w.-]{2,32})/g, '$1<span class="mention">@$2</span>');
  const lines = s.split('\n');
  const out = [];
  let list = null;
  for (const line of lines) {
    const li = line.match(/^\s*(?:[-•*]|(\d+)[.)])\s+(.*)$/);
    if (li) {
      const type = li[1] ? 'ol' : 'ul';
      if (list !== type) { if (list) out.push(`</${list}>`); out.push(`<${type}>`); list = type; }
      out.push(`<li>${li[2]}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    const hd = line.match(/^(#{1,3})\s+(.*)$/);
    if (hd) out.push(`<h${hd[1].length + 2}>${hd[2]}</h${hd[1].length + 2}>`);
    else if (/^&gt;\s?/.test(line)) out.push(`<blockquote>${line.replace(/^&gt;\s?/, '')}</blockquote>`);
    else out.push(line + '<br>');
  }
  if (list) out.push(`</${list}>`);
  let html = out.join('').replace(/(<br>)+$/, '');
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
  return sanitize(html);
}

export function timeAgo(d) {
  if (!d) return '';
  const t = new Date(d).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 86400 * 7) return `il y a ${Math.round(s / 86400)} j`;
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export const fmtDate = (d, opt = { day: 'numeric', month: 'short' }) => (d ? new Date(d).toLocaleDateString('fr-FR', opt) : '');
export const fmtTime = d => (d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtNum = n => (n === null || n === undefined ? '—' : Number(n) >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M' : Number(n) >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',') + ' k' : Number(n).toLocaleString('fr-FR'));

// ---------- Membres (cache) ----------
let people = new Map();
let peopleLoaded = null;
export async function loadPeople(force) {
  if (!force && peopleLoaded) return peopleLoaded;
  peopleLoaded = api.select('pt_profiles', { order: 'display_name' }).then(list => { people = new Map(list.map(p => [p.id, p])); return list; });
  return peopleLoaded;
}
export const person = id => people.get(id) || { id, display_name: 'Membre', username: 'membre', color: '#8a7a55' };
export const allPeople = () => [...people.values()];
export function avatar(p, size = 32) {
  p = typeof p === 'string' ? person(p) : p || {};
  const name = p.display_name || p.username || '?';
  const el = h('span.avatar', { title: name, style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px', '--c': p.color || '#F5B935' } });
  if (p.avatar_url) el.append(h('img', { src: p.avatar_url, alt: '' }));
  else el.textContent = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return el;
}

// ---------- Notifications éphémères ----------
export function toast(msg, type = 'info', ms = 3200) {
  let box = $('#toasts');
  if (!box) { box = h('div#toasts'); document.body.append(box); }
  const t = h('div.toast.' + type, icon(type === 'error' ? 'x' : type === 'ok' ? 'check' : 'bell'), h('span', msg));
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
export const fail = e => { console.error(e); toast(e?.message || String(e), 'error', 5000); };

// ---------- Fenêtres ----------
export function modal({ title, body, actions = [], wide = false, onClose, cls = '' } = {}) {
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 200); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape' && wrap === $$('.modal-wrap').pop()) close(); };
  const box = h('div.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''),
    h('header.modal-head', h('h3', title || ''), h('button.icon-btn', { onclick: close, 'aria-label': 'Fermer' }, icon('x'))),
    h('div.modal-body', body),
    actions.length ? h('footer.modal-foot', actions.map(a => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
      onclick: async e => { const r = await a.onclick?.(e, close); if (r !== false) close(); },
    }, a.label))) : null);
  const wrap = h('div.modal-wrap', { onmousedown: e => { if (e.target === wrap) close(); } }, box);
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  setTimeout(() => box.querySelector('input,textarea,[contenteditable]')?.focus(), 50);
  return { close, box, body: box.querySelector('.modal-body') };
}

export function confirmBox(text, { ok = 'Confirmer', danger = true } = {}) {
  return new Promise(res => {
    let done = false;
    modal({ title: 'Confirmation', body: h('p.muted', text), onClose: () => !done && res(false),
      actions: [{ label: 'Annuler', onclick: () => { done = true; res(false); } }, { label: ok, primary: !danger, danger, onclick: () => { done = true; res(true); } }] });
  });
}

// Formulaire rapide : fields = [{ name, label, type, value, placeholder, options, required }]
export function form(title, fields, { submit = 'Enregistrer', wide } = {}) {
  return new Promise(res => {
    let done = false;
    const els = {};
    const body = h('form.form', { onsubmit: e => { e.preventDefault(); go(); } }, fields.map(f => {
      let input;
      if (f.type === 'textarea') input = h('textarea.input', { name: f.name, placeholder: f.placeholder || '', rows: f.rows || 4 }, f.value || '');
      else if (f.type === 'select') input = h('select.input', { name: f.name }, f.options.map(o => h('option', { value: o.value ?? o, selected: (o.value ?? o) === f.value }, o.label ?? o)));
      else if (f.type === 'color') input = h('div.swatches', (f.options || COLORS).map(c => h('button.swatch', { type: 'button', style: { background: c }, class: c === f.value ? 'on' : '', onclick: e => { $$('.swatch', e.target.parentNode).forEach(s => s.classList.remove('on')); e.target.classList.add('on'); els[f.name].value = c; } })), h('input', { type: 'hidden', name: f.name, value: f.value || COLORS[0] }));
      else input = h('input.input', { name: f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', required: f.required });
      els[f.name] = input.tagName === 'DIV' ? input.querySelector('input') : input;
      return h('label.field', h('span', f.label), input, f.hint ? h('small.muted', f.hint) : null);
    }), h('button', { type: 'submit', hidden: true }));
    const go = () => {
      const out = {};
      for (const f of fields) {
        out[f.name] = els[f.name].value.trim?.() ?? els[f.name].value;
        if (f.required && !out[f.name]) { els[f.name].focus(); toast(`« ${f.label} » est obligatoire.`, 'error'); return false; }
      }
      done = true; res(out); m.close();
    };
    const m = modal({ title, body, wide, onClose: () => !done && res(null), actions: [{ label: 'Annuler' }, { label: submit, primary: true, onclick: () => go() }] });
  });
}

export const COLORS = ['#F5B935', '#E8833A', '#E25D6A', '#D16BD8', '#8B7CF6', '#4FA3F7', '#3CC9A0', '#9CCB4A', '#B8A07A', '#8C8C8C'];

// Menu contextuel : items = [{ label, icon, onclick, danger } | '-']
export function menu(anchor, items, { align = 'left' } = {}) {
  $$('.ctx-menu').forEach(m => m.remove());
  const m = h('div.ctx-menu', items.filter(Boolean).map(it => it === '-' ? h('hr') : h('button' + (it.danger ? '.danger' : ''), {
    onclick: e => { e.stopPropagation(); m.remove(); it.onclick?.(e); },
  }, it.icon ? icon(it.icon) : null, h('span', it.label))));
  document.body.append(m);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, bottom: anchor.y, top: anchor.y };
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left;
  let y = r.bottom + 6;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  x = Math.min(Math.max(8, x), innerWidth - mw - 8);
  Object.assign(m.style, { left: x + 'px', top: y + 'px' });
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  return m;
}

// Choisir des fichiers (images par défaut).
export function pickFiles({ accept = 'image/*', multiple = false } = {}) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    i.onchange = () => { res([...i.files]); i.remove(); };
    document.body.append(i);
    i.click();
  });
}

// Réduit une image avant envoi (moins de données mobiles, chargements rapides).
export async function shrinkImage(file, max = 1920, quality = 0.86) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 900_000) return file;
    const c = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(r => c.toBlob(r, type, quality));
    return new File([blob], file.name.replace(/\.\w+$/, type === 'image/png' ? '.png' : '.jpg'), { type });
  } catch { return file; }
}
export async function uploadFiles(files, folder) {
  const out = [];
  for (const f of files) {
    const file = await shrinkImage(f);
    out.push({ url: await api.upload(file, folder), name: f.name, type: file.type, size: file.size });
  }
  return out;
}

// Ouvre une image en grand.
export function lightbox(src) {
  const w = h('div.lightbox', { onclick: () => w.remove() }, h('img', { src }));
  document.body.append(w);
}

export function empty(iconName, title, text, action) {
  return h('div.empty', h('div.empty-ic', icon(iconName)), h('h3', title), text ? h('p.muted', text) : null, action || null);
}

export const debounce = (fn, ms = 400) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Effet d'onde dorée au clic sur les boutons.
document.addEventListener('pointerdown', e => {
  const b = e.target.closest?.('.btn');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = h('span.ripple', { style: { width: d + 'px', height: d + 'px', left: e.clientX - r.left - d / 2 + 'px', top: e.clientY - r.top - d / 2 + 'px' } });
  b.append(s);
  setTimeout(() => s.remove(), 650);
});
