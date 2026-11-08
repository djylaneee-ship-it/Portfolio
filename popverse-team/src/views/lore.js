// Lore / wiki du jeu : arbre de pages par catégorie, éditeur riche, sauvegarde auto, temps réel, Copilot.
import { api } from '../api.js';
import {
  h, clear, icon, person, sanitize, md, timeAgo, menu, toast, fail, uploadFiles, pickFiles, confirmBox, empty, modal, form,
} from '../ui.js';
import { go, logActivity } from '../store.js';

export const CATS = [
  { id: 'histoire', label: 'Histoire & univers', icon: '🌍' },
  { id: 'personnages', label: 'Personnages', icon: '🧙' },
  { id: 'lieux', label: 'Lieux', icon: '🗺️' },
  { id: 'objets', label: 'Objets', icon: '🗡️' },
  { id: 'mecaniques', label: 'Mécaniques', icon: '⚙️' },
  { id: 'factions', label: 'Factions', icon: '🏰' },
  { id: 'autre', label: 'Autre', icon: '📎' },
];
const cat = id => CATS.find(c => c.id === id) || CATS[CATS.length - 1];
const EMOJIS = ['📜', '🌍', '🧙', '🗺️', '🗡️', '⚙️', '🏰', '🐉', '👑', '💎', '🔮', '⚔️', '🛡️', '🧪', '🌋', '🌲', '🏝️', '👾', '🤖', '👻', '⭐', '🔥', '💀', '📖', '🎭', '🪙', '🧭', '🏆'];
const isMobile = () => matchMedia('(max-width: 820px)').matches;

export default async function lore(box, { project: p, sub }) {
  const me = api.me;
  let pages = [];
  let open = null;            // page ouverte
  let query = '';
  let dirty = null;           // modifications en attente { content?, title?, ... }
  let saveTimer = null;
  let lastInput = 0;
  const collapsed = new Set();

  const search = h('input.input.lore-search', { type: 'search', placeholder: 'Rechercher dans le lore…', oninput: e => { query = e.target.value.trim().toLowerCase(); drawTree(); } });
  const tree = h('div.lore-tree');
  const side = h('aside.lore-side',
    h('div.lore-side-head', h('h3', icon('book'), 'Lore'), h('button.btn.primary.small', { onclick: () => createPage({}) }, icon('plus'), 'Page')),
    search, tree);
  const main = h('section.lore-main');
  const layout = h('div.lore-layout', side, h('div.lore-scrim', { onclick: () => layout.classList.remove('tree-open') }), main);
  clear(box, layout);

  // ---------- Données ----------
  async function load() {
    pages = await api.select('pt_lore', { eq: { project_id: p.id }, order: [['position', 'asc'], ['created_at', 'asc']] });
  }

  // ---------- Arbre ----------
  function drawTree() {
    const match = pg => !query || pg.title.toLowerCase().includes(query) || (pg.tags || []).some(t => t.toLowerCase().includes(query)) || stripHtml(pg.content).toLowerCase().includes(query);
    const ids = new Set(pages.map(x => x.id));
    const roots = pages.filter(x => !x.parent_id || !ids.has(x.parent_id));
    const kids = id => pages.filter(x => x.parent_id === id);
    const visible = pg => match(pg) || kids(pg.id).some(visible);
    const node = (pg, depth) => {
      const children = kids(pg.id).filter(visible);
      const isCol = collapsed.has(pg.id) && !query;
      return h('div.lt-node',
        h('a.lt-item' + (open?.id === pg.id ? '.active' : ''), {
          href: `#/p/${p.id}/lore/${pg.id}`, style: { paddingLeft: 10 + depth * 16 + 'px' },
          oncontextmenu: e => { e.preventDefault(); pageMenu(e, pg); },
        },
          children.length ? h('button.lt-caret' + (isCol ? '' : '.open'), { onclick: e => { e.preventDefault(); e.stopPropagation(); isCol ? collapsed.delete(pg.id) : collapsed.add(pg.id); drawTree(); } }, '▸') : h('span.lt-caret.none'),
          h('span.lt-ic', pg.icon || '📜'), h('span.lt-name', pg.title || 'Sans titre'),
          h('button.lt-add', { title: 'Sous-page', onclick: e => { e.preventDefault(); e.stopPropagation(); createPage({ parent: pg }); } }, icon('plus')),
          h('button.lt-more', { title: 'Options', onclick: e => { e.preventDefault(); e.stopPropagation(); pageMenu(e, pg); } }, icon('more'))),
        isCol ? null : children.map(c => node(c, depth + 1)));
    };
    const groups = CATS.map(c => [c, roots.filter(x => (cat(x.category).id === c.id) && visible(x))]).filter(([, l]) => l.length);
    clear(tree, groups.length ? groups.map(([c, list]) => h('div.lt-group',
      h('div.lt-title', h('span', c.icon, ' ', c.label), h('button.lt-add.always', { title: 'Nouvelle page ici', onclick: () => createPage({ category: c.id }) }, icon('plus'))),
      list.map(x => node(x, 0)))) : h('p.muted.small.lt-none', query ? 'Aucun résultat.' : 'Aucune page pour l\'instant.'));
  }

  function pageMenu(e, pg) {
    menu(e.currentTarget?.getBoundingClientRect ? e.currentTarget : { x: e.clientX, y: e.clientY }, [
      { label: 'Ouvrir', icon: 'eye', onclick: () => go(`/p/${p.id}/lore/${pg.id}`) },
      { label: 'Ajouter une sous-page', icon: 'plus', onclick: () => createPage({ parent: pg }) },
      { label: 'Monter', icon: 'arrow', onclick: () => move(pg, -1) },
      { label: 'Descendre', icon: 'download', onclick: () => move(pg, 1) },
      { label: 'Changer de catégorie', icon: 'tag', onclick: async () => {
        const v = await form('Catégorie', [{ name: 'category', label: 'Catégorie', type: 'select', value: pg.category, options: CATS.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` })) }]);
        if (v) save(pg, { category: v.category, parent_id: null });
      } },
      '-',
      { label: 'Supprimer', icon: 'trash', danger: true, onclick: () => removePage(pg) },
    ]);
  }

  async function move(pg, dir) {
    const sibs = pages.filter(x => x.parent_id === pg.parent_id && (pg.parent_id || cat(x.category).id === cat(pg.category).id));
    const i = sibs.findIndex(x => x.id === pg.id);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    const a = sibs[i], b = sibs[j];
    const pa = a.position ?? i * 1000, pb = b.position ?? j * 1000;
    a.position = pb; b.position = pa === pb ? pb + dir : pa;
    pages.sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
    drawTree();
    try { await Promise.all([api.update('pt_lore', a.id, { position: a.position }), api.update('pt_lore', b.id, { position: b.position })]); } catch (ex) { fail(ex); }
  }

  async function createPage({ parent, category }) {
    try {
      const pg = await api.insert('pt_lore', {
        project_id: p.id, parent_id: parent?.id || null, category: parent?.category || category || 'histoire',
        title: 'Nouvelle page', icon: parent ? '📄' : cat(category).icon, content: '', tags: [], position: Date.now(), updated_by: me.id,
      });
      if (!pages.some(x => x.id === pg.id)) pages.push(pg);
      if (parent) collapsed.delete(parent.id);
      logActivity(p.id, 'lore', `a créé la page de lore « ${pg.title} »`, `#/p/${p.id}/lore/${pg.id}`);
      go(`/p/${p.id}/lore/${pg.id}`);
      setTimeout(() => { const t = main.querySelector('.lore-title'); t?.focus(); t?.select(); }, 120);
    } catch (e) { fail(e); }
  }

  async function removePage(pg) {
    const desc = [];
    const walk = id => pages.filter(x => x.parent_id === id).forEach(c => { desc.push(c); walk(c.id); });
    walk(pg.id);
    if (!(await confirmBox(`Supprimer « ${pg.title} »${desc.length ? ` et ses ${desc.length} sous-page(s)` : ''} ?`, { ok: 'Supprimer' }))) return;
    try {
      for (const d of desc.reverse()) await api.remove('pt_lore', d.id).catch(() => {});
      await api.remove('pt_lore', pg.id);
      pages = pages.filter(x => x.id !== pg.id && !desc.includes(x));
      if (open && (open.id === pg.id || desc.some(d => d.id === open.id))) go(`/p/${p.id}/lore`);
      else drawTree();
    } catch (e) { fail(e); }
  }

  // ---------- Sauvegarde ----------
  const status = h('span.lore-status');
  function setStatus(s) {
    status.className = 'lore-status ' + s;
    status.textContent = { saving: 'Enregistrement…', saved: 'Enregistré', dirty: 'Modifications…', error: 'Erreur d\'enregistrement' }[s] || '';
  }
  function queue(patch) {
    if (!open) return;
    dirty = { ...(dirty || {}), ...patch };
    Object.assign(open, patch);
    setStatus('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 900);
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (!dirty || !open) return;
    const patch = { ...dirty, updated_by: me.id };
    const target = open;
    dirty = null;
    setStatus('saving');
    try {
      const row = await api.update('pt_lore', target.id, patch);
      if (row) { target.updated_at = row.updated_at; target.updated_by = row.updated_by; }
      if (open === target) { setStatus('saved'); drawMeta(); }
    } catch (e) { setStatus('error'); fail(e); dirty = { ...patch, ...(dirty || {}) }; }
  }
  async function save(pg, patch) {
    Object.assign(pg, patch);
    drawTree();
    if (open?.id === pg.id) drawPage();
    try { await api.update('pt_lore', pg.id, { ...patch, updated_by: me.id }); } catch (e) { fail(e); }
  }

  // ---------- Page ----------
  let editor = null;
  let metaEl = null;
  let banner = null;

  function drawMeta() {
    if (!metaEl || !open) return;
    clear(metaEl, open.updated_by ? h('span.muted', 'Modifié par ', h('b', person(open.updated_by).display_name), ' ', timeAgo(open.updated_at || open.created_at)) : null);
  }

  function home() {
    const recent = [...pages].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).slice(0, 6);
    clear(main,
      h('div.lore-home',
        h('div.lore-mobile-bar', h('button.btn.small', { onclick: () => layout.classList.add('tree-open') }, icon('list'), 'Pages')),
        h('div.lore-hero', h('p.eyebrow', 'Bible du jeu'), h('h2', `Le lore de ${p.name}`), h('p.muted', 'Toute l\'histoire, les personnages, les lieux et les règles du jeu. Le Copilot lit ces pages pour connaître ton jeu par cœur.')),
        h('div.lore-cats', CATS.map(c => {
          const n = pages.filter(x => cat(x.category).id === c.id).length;
          const first = pages.find(x => cat(x.category).id === c.id && !x.parent_id);
          return h('button.lore-cat', { onclick: () => first ? go(`/p/${p.id}/lore/${first.id}`) : createPage({ category: c.id }) },
            h('span.lc-ic', c.icon), h('b', c.label), h('small.muted', n ? `${n} page${n > 1 ? 's' : ''}` : 'Créer la première page'));
        })),
        recent.length ? [h('h3.lore-sub', 'Modifiées récemment'), h('div.lore-recent', recent.map(x => h('a.lore-rec', { href: `#/p/${p.id}/lore/${x.id}` },
          h('span.lt-ic', x.icon || '📜'), h('div', h('b', x.title), h('small.muted', `${cat(x.category).label} · ${timeAgo(x.updated_at || x.created_at)}`)))))] : null));
  }

  function drawPage() {
    if (!open) return home();
    const pg = open;
    const title = h('input.lore-title', { value: pg.title, placeholder: 'Titre de la page', maxLength: 120,
      oninput: e => { queue({ title: e.target.value }); const a = tree.querySelector('.lt-item.active .lt-name'); if (a) a.textContent = e.target.value || 'Sans titre'; } });
    editor = h('div.lore-editor.md', { contentEditable: 'true', spellcheck: 'true', 'data-placeholder': 'Écris le lore ici… Utilise la barre d\'outils pour les titres, images, tableaux et encadrés.' });
    editor.innerHTML = sanitize(pg.content || '');
    editor.addEventListener('input', () => { lastInput = Date.now(); queue({ content: sanitize(editor.innerHTML) }); });
    editor.addEventListener('paste', async e => {
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); insertImages(files); return; }
      const html = e.clipboardData?.getData('text/html');
      if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitize(html)); }
    });
    editor.addEventListener('drop', e => {
      const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); insertImages(files); }
    });
    editor.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener');
      if (e.target.tagName === 'IMG' && e.detail === 2) import('../ui.js').then(u => u.lightbox(e.target.src));
    });
    editor.addEventListener('keyup', updateTableTools);
    editor.addEventListener('mouseup', updateTableTools);
    metaEl = h('div.lore-meta');
    banner = h('div.lore-banner', { hidden: true });
    const tagsBox = h('div.lore-tags');
    const drawTags = () => clear(tagsBox,
      (pg.tags || []).map(t => h('span.tag.lore-tag', '#' + t, h('button', { title: 'Retirer', onclick: () => { queue({ tags: (pg.tags || []).filter(x => x !== t) }); drawTags(); } }, '×'))),
      h('input.lore-tag-input', { placeholder: '+ étiquette', onkeydown: e => {
        if (e.key === 'Enter' && e.target.value.trim()) {
          const t = e.target.value.trim().replace(/^#/, '').slice(0, 30);
          if (!(pg.tags || []).includes(t)) queue({ tags: [...(pg.tags || []), t] });
          drawTags(); setTimeout(() => tagsBox.querySelector('input')?.focus(), 0);
        }
      } }));
    drawTags();

    const crumbs = [];
    let cur = pages.find(x => x.id === pg.parent_id);
    while (cur) { crumbs.unshift(cur); cur = pages.find(x => x.id === cur.parent_id); }

    clear(main,
      pg.cover ? h('div.lore-cover', { style: { backgroundImage: `url("${pg.cover}")` } },
        h('div.lore-cover-tools', h('button.btn.small', { onclick: setCover }, icon('image'), 'Changer'), h('button.btn.small', { onclick: () => save(pg, { cover: null }) }, icon('x'), 'Retirer'))) : null,
      h('div.lore-page' + (pg.cover ? '.has-cover' : ''),
        h('div.lore-topbar',
          h('button.btn.small.lore-tree-btn', { onclick: () => layout.classList.add('tree-open') }, icon('list'), 'Pages'),
          h('div.lore-path', h('a', { href: `#/p/${p.id}/lore` }, cat(pg.category).icon, ' ', cat(pg.category).label), crumbs.map(c => [h('span.sep', '/'), h('a', { href: `#/p/${p.id}/lore/${c.id}` }, c.title)])),
          status,
          h('button.btn.small.copilot-lore', { onclick: askCopilot }, icon('spark'), 'Copilot'),
          h('button.icon-btn', { title: 'Options', onclick: e => pageMenu(e, pg) }, icon('more'))),
        h('div.lore-head',
          h('button.lore-emoji', { title: 'Changer l\'emoji', onclick: e => {
            const m = menu(e.currentTarget, [{ label: '' }]);
            clear(m, h('div.emoji-grid.lore-emojis', EMOJIS.map(em => h('button', { onclick: ev => { ev.stopPropagation(); m.remove(); save(pg, { icon: em }); } }, em))));
          } }, pg.icon || '📜'),
          !pg.cover ? h('button.btn.small.ghost.add-cover', { onclick: setCover }, icon('image'), 'Ajouter une couverture') : null),
        title,
        h('div.lore-info', tagsBox, metaEl),
        banner,
        toolbar(),
        editor,
        children(pg)));
    drawMeta();
    setStatus(dirty ? 'dirty' : '');
  }

  function children(pg) {
    const kids = pages.filter(x => x.parent_id === pg.id);
    return h('div.lore-children',
      kids.length ? h('h4', 'Sous-pages') : null,
      h('div.lore-kids', kids.map(k => h('a.lore-kid', { href: `#/p/${p.id}/lore/${k.id}` }, h('span', k.icon || '📄'), h('b', k.title))),
        h('button.lore-kid.add', { onclick: () => createPage({ parent: pg }) }, icon('plus'), h('b', 'Sous-page'))));
  }

  async function setCover() {
    const [f] = await pickFiles();
    if (!f || !open) return;
    try { const [up] = await uploadFiles([f], 'lore'); save(open, { cover: up.url }); } catch (e) { fail(e); }
  }

  // ---------- Éditeur ----------
  const tableTools = h('div.tb-group.table-tools', { hidden: true });
  function toolbar() {
    const b = (ic, title, fn, label) => h('button.tb-btn', { title, onmousedown: e => e.preventDefault(), onclick: () => { editor.focus(); fn(); change(); } }, ic ? icon(ic) : null, label ? h('span', label) : null);
    const cmd = (c, v) => () => document.execCommand(c, false, v);
    const block = tag => () => document.execCommand('formatBlock', false, `<${tag}>`);
    clear(tableTools,
      b(null, 'Ajouter une ligne', () => tableOp('row+'), '+ ligne'),
      b(null, 'Ajouter une colonne', () => tableOp('col+'), '+ colonne'),
      b(null, 'Supprimer la ligne', () => tableOp('row-'), '− ligne'),
      b(null, 'Supprimer la colonne', () => tableOp('col-'), '− colonne'),
      b('trash', 'Supprimer le tableau', () => tableOp('del')));
    return h('div.lore-toolbar',
      h('div.tb-group', b(null, 'Titre 1', block('h2'), 'H1'), b(null, 'Titre 2', block('h3'), 'H2'), b(null, 'Titre 3', block('h4'), 'H3'), b(null, 'Texte normal', block('p'), '¶')),
      h('div.tb-group', b('bold', 'Gras (Ctrl+B)', cmd('bold')), b('italic', 'Italique (Ctrl+I)', cmd('italic')), b(null, 'Souligné (Ctrl+U)', cmd('underline'), 'U'), b(null, 'Barré', cmd('strikeThrough'), 'S')),
      h('div.tb-group', b('list', 'Liste à puces', cmd('insertUnorderedList')), b(null, 'Liste numérotée', cmd('insertOrderedList'), '1.'), b(null, 'Citation', block('blockquote'), '❝'), b(null, 'Séparateur', cmd('insertHorizontalRule'), '―')),
      h('div.tb-group',
        b('link', 'Lien', () => { const url = prompt('Adresse du lien :', 'https://'); if (url && /^https?:\/\//.test(url)) document.execCommand('createLink', false, url); }),
        b('image', 'Image', async () => { const files = await pickFiles({ multiple: true }); if (files.length) insertImages(files); }),
        b('table', 'Tableau', () => insertBlock(tableHTML(3, 3))),
        b(null, 'Encadré info', () => insertBlock('<div class="callout"><p>💡 Info importante…</p></div><p><br></p>'), '💡'),
        b(null, 'Encadré attention', () => insertBlock('<div class="callout warn"><p>⚠️ Attention…</p></div><p><br></p>'), '⚠️')),
      tableTools);
  }
  const change = () => editor && editor.dispatchEvent(new Event('input'));
  function insertHTML(html) { editor.focus(); document.execCommand('insertHTML', false, sanitize(html)); change(); }
  // Blocs (tableau, encadré, image) : insérés APRÈS le paragraphe courant pour ne pas être aplatis dans un <p>.
  function insertBlock(html) {
    const sel = window.getSelection();
    let n = sel.rangeCount && editor.contains(sel.anchorNode) ? sel.anchorNode : null;
    while (n && n.parentNode !== editor) n = n.parentNode;
    const tpl = document.createElement('template');
    tpl.innerHTML = sanitize(html);
    const nodes = [...tpl.content.childNodes];
    const empty = n && n.nodeName === 'P' && !n.textContent.trim() && !n.querySelector('img');
    if (n) { n.after(...nodes); if (empty) n.remove(); } else editor.append(...nodes);
    const target = nodes.find(x => x.nodeType === 1);
    const focusEl = target?.querySelector?.('th, td, p') || target;
    if (focusEl) {
      const r = document.createRange(); r.selectNodeContents(focusEl); if (focusEl.nodeName !== 'TH') r.collapse(!(focusEl.nodeName === 'P' && target?.classList?.contains('callout')));
      sel.removeAllRanges(); sel.addRange(r);
    }
    editor.focus();
    change();
    updateTableTools();
  }
  function tableHTML(r, c) {
    const head = '<tr>' + Array.from({ length: c }, (_, i) => `<th>Colonne ${i + 1}</th>`).join('') + '</tr>';
    const rows = Array.from({ length: r - 1 }, () => '<tr>' + '<td><br></td>'.repeat(c) + '</tr>').join('');
    return `<table><tbody>${head}${rows}</tbody></table><p><br></p>`;
  }
  async function insertImages(files) {
    const sel = window.getSelection();
    const range = sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    toast('Envoi de l\'image…');
    try {
      const ups = await uploadFiles(files, 'lore');
      editor.focus();
      if (range) { sel.removeAllRanges(); sel.addRange(range); }
      insertBlock(ups.map(u => `<figure><img src="${u.url}" alt=""></figure>`).join('') + '<p><br></p>');
    } catch (e) { fail(e); }
  }
  function currentCell() {
    const sel = window.getSelection();
    let n = sel.rangeCount ? sel.anchorNode : null;
    while (n && n !== editor) { if (n.nodeName === 'TD' || n.nodeName === 'TH') return n; n = n.parentNode; }
    return null;
  }
  function updateTableTools() { tableTools.hidden = !currentCell(); }
  function tableOp(op) {
    const cell = currentCell();
    if (!cell) return;
    const tr = cell.parentNode;
    const table = cell.closest('table');
    const idx = [...tr.children].indexOf(cell);
    if (op === 'row+') { const nr = tr.cloneNode(true); [...nr.children].forEach(c => { const td = document.createElement('td'); td.innerHTML = '<br>'; c.replaceWith(td); }); tr.after(nr); }
    if (op === 'row-') { if (table.rows.length > 1) tr.remove(); }
    if (op === 'col+') [...table.rows].forEach((r, i) => { const c = document.createElement(i === 0 && r.cells[0]?.nodeName === 'TH' ? 'th' : 'td'); c.innerHTML = i === 0 && c.nodeName === 'TH' ? 'Colonne' : '<br>'; r.cells[idx].after(c); });
    if (op === 'col-') { if (tr.cells.length > 1) [...table.rows].forEach(r => r.cells[idx]?.remove()); }
    if (op === 'del') table.remove();
    updateTableTools();
  }

  // ---------- Copilot ----------
  async function askCopilot() {
    if (!open) return;
    await flush();
    const body = h('div.lore-ai', h('div.loading', 'Le Copilot lit ton lore…'));
    const m = modal({ title: '✨ Copilot — ' + open.title, body, wide: true });
    try {
      const res = await api.fn('pt-ai', { mode: 'lore', project_id: p.id, page: { id: open.id, title: open.title, category: open.category, content_text: (editor?.innerText || '').slice(0, 8000) } });
      const actions = (res?.actions || []).filter(a => a.type === 'append_lore' && a.html);
      clear(body,
        h('div.md.ai-reply', { html: md(res?.reply || 'Pas de réponse.') }),
        actions.map(a => h('div.ai-proposal',
          h('div.ai-preview.md', { html: sanitize(a.html) }),
          h('div.row.end', h('button.btn.primary.small', { onclick: () => {
            editor.focus();
            const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false);
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
            insertHTML(a.html);
            toast('Ajouté à la page', 'ok'); m.close();
          } }, icon('plus'), 'Ajouter à la page')))));
    } catch (e) { clear(body, h('p', 'Le Copilot n\'a pas pu répondre : ' + e.message)); }
  }

  // ---------- Navigation ----------
  async function openPage(id) {
    await flush();
    open = id ? pages.find(x => x.id === id) || null : null;
    if (id && !open) {
      const row = await api.get('pt_lore', id).catch(() => null);
      if (row && row.project_id === p.id) { pages.push(row); open = row; }
      else toast('Page introuvable.', 'error');
    }
    layout.classList.remove('tree-open');
    drawTree();
    drawPage();
    main.scrollTop = 0;
  }

  // ---------- Temps réel ----------
  const off = api.subscribe('pt_lore', { project_id: p.id }, ({ type, row, old }) => {
    if (type === 'DELETE') {
      pages = pages.filter(x => x.id !== old?.id);
      if (open?.id === old?.id) { toast('Cette page a été supprimée.'); go(`/p/${p.id}/lore`); return; }
      drawTree();
      return;
    }
    if (!row || row.project_id !== p.id) return;
    const i = pages.findIndex(x => x.id === row.id);
    if (open?.id === row.id && row.updated_by !== me.id) {
      const typing = Date.now() - lastInput < 4000 || dirty;
      if (!typing && document.activeElement !== editor) { Object.assign(open, row); pages[i] = open; drawTree(); drawPage(); }
      else if (banner) {
        banner.hidden = false;
        clear(banner, icon('bell'), h('span', h('b', person(row.updated_by).display_name), ' vient de modifier cette page.'),
          h('button.btn.small', { onclick: () => { Object.assign(open, row); dirty = null; drawTree(); drawPage(); } }, 'Voir sa version'));
      }
      return;
    }
    if (i < 0) pages.push(row); else if (pages[i] !== open) pages[i] = row;
    pages.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    drawTree();
  });

  const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && open) { e.preventDefault(); flush(); } };
  document.addEventListener('keydown', onKey);
  const beforeUnload = () => { if (dirty) flush(); };
  addEventListener('beforeunload', beforeUnload);

  try { await load(); } catch (e) { fail(e); }
  await openPage(sub);
  if (!sub && isMobile()) layout.classList.add('tree-open');

  const cleanup = () => { flush(); off(); document.removeEventListener('keydown', onKey); removeEventListener('beforeunload', beforeUnload); };
  cleanup.onSub = s => openPage(s);
  return cleanup;
}

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, ' '); }
