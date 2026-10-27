// ---------- Espace Co-work : projets partagés (tâches façon Trello, tableau d'idées façon Milanote, membres) ----------
// Les données vivent dans la base en ligne (cowork.js côté serveur). Ici : l'affichage, les modifications envoyées
// par petits lots, et une synchro toutes les 4 s tant que le projet est ouvert. Utilise les outils de app.js.
const CW_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777'];
const CW_NOTE_COLORS = ['#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#ede9fe', '#ffedd5', '#f1f5f9'];
const CW_LABELS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
let CW = null;

const cwId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.random() * 16 | 0;
  return (c === 'x' ? r : (r & 3) | 8).toString(16);
}));
const cwInitials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const cwHue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const cwAvatar = (m, small) => m ? `<span class="cw-av ${small ? 'sm' : ''}" style="--h:${cwHue(m.id)}" title="${esc(m.name)}">${esc(cwInitials(m.name))}</span>` : '';
const cwMember = (id) => CW && CW.members.find((m) => m.id === id);
const cwKids = (parent, kinds) => [...CW.nodes.values()].filter((n) => (n.parent || null) === (parent || null) && (!kinds || kinds.includes(n.kind))).sort((a, b) => a.pos - b.pos);

function cwError(e) {
  if (e && e.key === 'cwSetup') return `<div class="empty"><b>${t('cw.setupTitle')}</b>${t('cw.setupText')}</div>`;
  if (e && e.key === 'cwOffline') return `<div class="empty"><b>${t('cw.offTitle')}</b>${t('cw.offText')}</div>`;
  return `<div class="empty"><b>${t('cw.errTitle')}</b>${esc((e && e.message) || '')}</div>`;
}

// ---------- Liste des projets + mes tâches ----------
// La liste se met à jour toute seule (invitation reçue, tâche donnée) tant que la page est ouverte.
let CW_HOME = null;
function cwHomeWatch(sig) {
  clearInterval(CW_HOME);
  CW_HOME = setInterval(async () => {
    if ((location.hash.slice(2).split('?')[0]) !== 'cowork' || document.hidden) return;
    const d = await api('/cowork').catch(() => null);
    if (d && JSON.stringify([d.projects, d.myTasks, d.me]) !== sig && !$('#modal:not([hidden])')) renderCowork();
  }, 12000);
}

async function renderCowork() {
  cwStop();
  clearInterval(CW_HOME);
  let d;
  try { d = await api('/cowork'); } catch (e) {
    view.innerHTML = `${pageHead('CO-WORK', t('nav.cowork'), t('cw.sub'))}${cwError(e)}`;
    return;
  }
  const me = d.me;
  view.innerHTML = `
    ${pageHead('CO-WORK', t('nav.cowork'), t('cw.sub'), `<button class="btn primary" id="cw-new">+ ${t('cw.new')}</button>`)}
    <div class="panel cw-me" data-spot>
      ${cwAvatar(me)}
      <div class="cw-me-txt"><b>${esc(me.name)}</b><small>${t('cw.myId')}</small></div>
      <code class="cw-pid">${esc(me.publicId)}</code>
      <button class="btn small" data-copy="${esc(me.publicId)}">${t('fd.copy')}</button>
      <button class="btn small" id="cw-rename-me">${t('cw.myName')}</button>
    </div>
    <p class="sub cw-hint">${t('cw.idHelp')}</p>
    ${d.projects.length ? `<div class="cw-grid">${d.projects.map((p) => `<a class="cw-card" href="#/project?id=${p.id}" style="--pc:${esc(p.color)}">
        <span class="cw-card-bar"></span>
        <b>${esc(p.name)}</b>
        <small>${p.role === 'owner' ? t('cw.owner') : t('cw.by', { name: esc(p.owner) })}</small>
        <span class="cw-card-meta"><span>👥 ${p.members}</span><span>✅ ${p.tasks}</span>${p.myTasks ? `<span class="cw-badge">${t('cw.forYou', { n: p.myTasks })}</span>` : ''}</span>
      </a>`).join('')}</div>`
      : `<div class="empty"><b>${t('cw.noneTitle')}</b>${t('cw.noneText')}</div>`}
    ${d.myTasks.length ? `<div class="section-head"><h2>${t('cw.myTasks')}</h2></div>
      <div class="cw-mytasks">${d.myTasks.map((x) => `<a class="cw-mytask" href="#/project?id=${x.project}&task=${x.id}" style="--pc:${esc(x.color)}">
        <span class="cw-dot"></span><b>${esc(x.title || '')}</b><small>${esc(x.projectName)} · ${esc(x.list || '')}</small>${x.due ? `<span class="cw-due ${cwLate(x.due) ? 'late' : ''}">${esc(cwDate(x.due))}</span>` : ''}</a>`).join('')}</div>` : ''}`;
  bindCopy(view);
  cwHomeWatch(JSON.stringify([d.projects, d.myTasks, d.me]));
  $('#cw-new').onclick = async () => {
    const name = await askText(t('cw.new'), '', t('cw.namePh'));
    if (!name) return;
    try { const r = await api('/cowork', { method: 'POST', body: { name, color: CW_COLORS[Math.floor(Math.random() * CW_COLORS.length)] } }); location.hash = '#/project?id=' + r.id; }
    catch (e) { toast(e.message, true); }
  };
  $('#cw-rename-me').onclick = async () => {
    const name = await askText(t('cw.myName'), me.name);
    if (!name) return;
    try { await api('/cowork/profile', { method: 'PUT', body: { name } }); renderCowork(); } catch (e) { toast(e.message, true); }
  };
}

const cwDate = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString(LANG, { day: 'numeric', month: 'short' }); } catch { return d; } };
const cwLate = (d) => d && d < new Date().toISOString().slice(0, 10);

// ---------- Synchro ----------
function cwStop() {
  if (CW && CW.timer) clearInterval(CW.timer);
  if (CW) CW.timer = null;
}

function cwApply(nodes) {
  let changed = false;
  for (const n of nodes) {
    if (CW.pending.has(n.id)) continue; // ma modification pas encore envoyée gagne
    const cur = CW.nodes.get(n.id);
    if (n.deleted) { if (cur) { CW.nodes.delete(n.id); changed = true; } continue; }
    if (!cur || cur.updatedAt !== n.updatedAt) { CW.nodes.set(n.id, n); changed = true; }
  }
  return changed;
}

async function cwTick() {
  if (!CW || CW.busy) return;
  const [p, qs] = location.hash.slice(2).split('?');
  if (p !== 'project' || new URLSearchParams(qs || '').get('id') !== CW.id) return cwStop();
  CW.busy = true;
  try {
    const r = await api(`/cowork/${CW.id}/sync?since=${encodeURIComponent(CW.since)}`);
    CW.since = r.now;
    const membersChanged = JSON.stringify(r.members) !== JSON.stringify(CW.members);
    CW.members = r.members;
    CW.project = r.project;
    if ((cwApply(r.nodes) || membersChanged) && !CW.editing && !CW.drag) cwRender();
    else if (CW.editing || CW.drag) CW.stale = true;
  } catch (e) {
    if (e.key === 'cwNotMember') { cwStop(); toast(t('cw.kicked'), true); location.hash = '#/cowork'; }
  } finally { CW.busy = false; }
}

// Enregistre un nœud (création, modification ou suppression) : appliqué tout de suite, envoyé par lot.
function cwSave(n) {
  n.updatedAt = 'local';
  n.updatedBy = CW.me;
  if (n.deleted) CW.nodes.delete(n.id); else CW.nodes.set(n.id, n);
  CW.pending.set(n.id, { id: n.id, parent: n.parent || null, kind: n.kind, data: n.data, pos: n.pos, deleted: Boolean(n.deleted) });
  clearTimeout(CW.saveTimer);
  CW.saveTimer = setTimeout(cwFlush, 350);
}
async function cwFlush() {
  if (!CW || !CW.pending.size) return;
  const batch = [...CW.pending.values()];
  CW.pending.clear();
  try { await api(`/cowork/${CW.id}/nodes`, { method: 'PUT', body: { nodes: batch } }); }
  catch (e) {
    toast(e.message, true);
    for (const n of batch) if (!CW.pending.has(n.id)) CW.pending.set(n.id, n);
    clearTimeout(CW.saveTimer);
    CW.saveTimer = setTimeout(cwFlush, 4000);
  }
}
const cwNew = (kind, parent, data, pos) => ({ id: cwId(), kind, parent: parent || null, data, pos });
const cwNextPos = (list) => (list.length ? list[list.length - 1].pos + 1 : 1);

// ---------- Page d'un projet ----------
async function renderProject(params) {
  const id = params.get('id');
  if (!CW || CW.id !== id) {
    cwStop();
    let r;
    try { r = await api(`/cowork/${id}/sync`); } catch (e) {
      view.innerHTML = `${pageHead('CO-WORK', t('nav.cowork'), '')}${cwError(e)}<div class="row"><a class="btn" href="#/cowork">← ${t('nav.cowork')}</a></div>`;
      return;
    }
    CW = { id, nodes: new Map(), pending: new Map(), members: r.members, me: r.me, project: r.project, since: r.now, tab: 'board', folder: null, filter: '' };
    cwApply(r.nodes);
  }
  cwStop();
  CW.timer = setInterval(cwTick, 4000);
  CW.tab = params.get('tab') || CW.tab || 'board';
  CW.folder = params.get('f') || null;
  const p = CW.project;
  view.innerHTML = `
    <div class="cw-head" style="--pc:${esc(p.color)}">
      <a class="btn small" href="#/cowork">←</a>
      <span class="cw-dot big"></span>
      <h1 class="cw-title">${esc(p.name)}</h1>
      <div class="cw-people" id="cw-people"></div>
      <div class="tabs cw-tabs">
        <button data-tab="board">✅ ${t('cw.tabBoard')}</button>
        <button data-tab="ideas">💡 ${t('cw.tabIdeas')}</button>
        <button data-tab="members">👥 ${t('cw.tabMembers')}</button>
      </div>
    </div>
    <div id="cw-body"></div>`;
  $$('.cw-tabs button').forEach((b) => b.onclick = () => { location.hash = `#/project?id=${id}&tab=${b.dataset.tab}`; });
  cwRender();
  const task = params.get('task');
  if (task && CW.nodes.get(task)) cwTaskModal(CW.nodes.get(task));
}

function cwRender() {
  if (!CW || !$('#cw-body')) return;
  CW.stale = false;
  $$('.cw-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === CW.tab));
  $('#cw-people').innerHTML = CW.members.slice(0, 6).map((m) => cwAvatar(m, true)).join('') + (CW.members.length > 6 ? `<span class="cw-more">+${CW.members.length - 6}</span>` : '');
  const keep = [...$$('#cw-body .cw-scroll')].map((el) => [el.scrollLeft, el.scrollTop]);
  if (CW.tab === 'ideas') cwIdeas();
  else if (CW.tab === 'members') cwMembers();
  else cwBoard();
  $$('#cw-body .cw-scroll').forEach((el, i) => { if (keep[i]) [el.scrollLeft, el.scrollTop] = keep[i]; });
}

// Pendant une saisie ou un glisser, la synchro attend ; elle s'applique juste après.
function cwBusy(on) {
  CW.editing = on;
  if (!on && CW.stale) setTimeout(() => { if (!CW.editing && !CW.drag) cwRender(); }, 300);
}

// ---------- Tableau de tâches (colonnes et cartes) ----------
function cwBoard() {
  const lists = cwKids(null, ['list']);
  const tasks = (l) => cwKids(l.id, ['task']).filter((x) => !CW.filter || x.data.assignee === CW.me);
  const card = (x) => {
    const d = x.data;
    const items = d.checklist || [];
    const done = items.filter((i) => i.done).length;
    const m = cwMember(d.assignee);
    return `<div class="cw-task" draggable="true" data-task="${x.id}">
      ${(d.labels || []).length ? `<div class="cw-labels">${d.labels.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</div>` : ''}
      <b>${esc(d.title || '')}</b>
      <div class="cw-task-meta">
        ${d.due ? `<span class="cw-due ${cwLate(d.due) && !d.done ? 'late' : ''}">📅 ${esc(cwDate(d.due))}</span>` : ''}
        ${items.length ? `<span class="${done === items.length ? 'ok' : ''}">☑ ${done}/${items.length}</span>` : ''}
        ${d.desc ? '<span>≡</span>' : ''}
        ${m ? cwAvatar(m, true) : ''}
      </div></div>`;
  };
  $('#cw-body').innerHTML = `
    <div class="row cw-bar">
      <div class="chips"><button class="chip ${CW.filter ? '' : 'on'}" data-filter="">${t('cw.all')}</button><button class="chip ${CW.filter ? 'on' : ''}" data-filter="me">${t('cw.mine')}</button></div>
    </div>
    <div class="cw-board cw-scroll" id="cw-board">
      ${lists.map((l) => `<section class="cw-col" data-list="${l.id}">
        <header><b class="cw-col-title" data-rename="${l.id}">${esc(l.data.title || '')}</b>${l.data.done ? '<span class="cw-done-tag">✓</span>' : ''}<small>${tasks(l).length}</small>
          <button class="icon-btn small" data-colmenu="${l.id}" title="${t('cw.listMenu')}">⋯</button></header>
        <div class="cw-cards" data-drop="${l.id}">${tasks(l).map(card).join('')}</div>
        <form class="cw-add" data-addto="${l.id}"><input class="input" placeholder="+ ${t('cw.addTask')}" maxlength="200"></form>
      </section>`).join('')}
      <form class="cw-col cw-newcol" id="cw-newcol"><input class="input" placeholder="+ ${t('cw.addList')}" maxlength="60"></form>
    </div>`;
  $$('[data-filter]').forEach((b) => b.onclick = () => { CW.filter = b.dataset.filter; cwRender(); });
  $$('.cw-add').forEach((f) => f.onsubmit = (e) => {
    e.preventDefault();
    const inp = $('input', f);
    const title = inp.value.trim();
    if (!title) return;
    const list = CW.nodes.get(f.dataset.addto);
    cwSave(cwNew('task', list.id, { title, done: Boolean(list.data.done), ...(CW.filter ? { assignee: CW.me } : {}) }, cwNextPos(cwKids(list.id, ['task']))));
    cwRender();
    const again = $(`.cw-add[data-addto="${list.id}"] input`);
    if (again) again.focus();
  });
  $('#cw-newcol').onsubmit = (e) => {
    e.preventDefault();
    const title = $('input', e.target).value.trim();
    if (!title) return;
    cwSave(cwNew('list', null, { title }, cwNextPos(lists)));
    cwRender();
  };
  $$('[data-rename]').forEach((b) => b.ondblclick = async () => {
    const l = CW.nodes.get(b.dataset.rename);
    const title = await askText(t('fd.rename'), l.data.title);
    if (title) { cwSave({ ...l, data: { ...l.data, title } }); cwRender(); }
  });
  $$('[data-colmenu]').forEach((b) => b.onclick = () => cwListMenu(CW.nodes.get(b.dataset.colmenu)));
  $$('.cw-task').forEach((c) => {
    c.onclick = () => cwTaskModal(CW.nodes.get(c.dataset.task));
    c.ondragstart = (e) => { CW.drag = c.dataset.task; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.dataset.task); };
    c.ondragend = () => { c.classList.remove('dragging'); CW.drag = null; $$('.cw-cards').forEach((z) => z.classList.remove('over')); if (CW.stale) cwRender(); };
  });
  $$('.cw-cards').forEach((zone) => {
    zone.ondragover = (e) => { if (!CW.drag) return; e.preventDefault(); zone.classList.add('over'); };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = (e) => {
      e.preventDefault();
      const task = CW.nodes.get(CW.drag);
      if (!task) return;
      const list = CW.nodes.get(zone.dataset.drop);
      const others = cwKids(list.id, ['task']).filter((x) => x.id !== task.id);
      const cards = [...zone.querySelectorAll('.cw-task')].filter((el) => el.dataset.task !== task.id);
      let i = cards.findIndex((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
      if (i < 0) i = cards.length;
      const before = others[i - 1];
      const after = others[i];
      const pos = before && after ? (before.pos + after.pos) / 2 : before ? before.pos + 1 : after ? after.pos - 1 : 1;
      CW.drag = null;
      cwSave({ ...task, parent: list.id, pos, data: { ...task.data, done: Boolean(list.data.done) } });
      cwRender();
    };
  });
}

function cwListMenu(l) {
  const lists = cwKids(null, ['list']);
  const i = lists.findIndex((x) => x.id === l.id);
  openModal(`<h2 class="detail-title">${esc(l.data.title)}</h2>
    <div class="cw-menu">
      <button class="btn" data-a="rename">✏️ ${t('fd.rename')}</button>
      <button class="btn" data-a="left" ${i === 0 ? 'disabled' : ''}>← ${t('cw.moveLeft')}</button>
      <button class="btn" data-a="right" ${i === lists.length - 1 ? 'disabled' : ''}>${t('cw.moveRight')} →</button>
      <button class="btn" data-a="done">${l.data.done ? '↺ ' + t('cw.notDoneList') : '✓ ' + t('cw.doneList')}</button>
      <button class="btn danger" data-a="delete">🗑 ${t('cw.deleteList')}</button>
    </div>`);
  $$('.cw-menu [data-a]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.a;
    await closeModal();
    if (a === 'rename') {
      const title = await askText(t('fd.rename'), l.data.title);
      if (title) cwSave({ ...l, data: { ...l.data, title } });
    } else if (a === 'left' || a === 'right') {
      const j = a === 'left' ? i - 1 : i + 1;
      const other = lists[j];
      const far = lists[a === 'left' ? j - 1 : j + 1];
      const pos = far ? (other.pos + far.pos) / 2 : other.pos + (a === 'left' ? -1 : 1);
      cwSave({ ...l, pos });
    } else if (a === 'done') {
      const done = !l.data.done;
      cwSave({ ...l, data: { ...l.data, done } });
      for (const x of cwKids(l.id, ['task'])) cwSave({ ...x, data: { ...x.data, done } });
    } else if (a === 'delete') {
      if (!confirm(t('cw.confirmList', { name: l.data.title, n: cwKids(l.id, ['task']).length }))) return;
      for (const x of cwKids(l.id, ['task'])) cwSave({ ...x, deleted: true });
      cwSave({ ...l, deleted: true });
    }
    cwRender();
  });
}

// Fenêtre d'une tâche : chaque changement est enregistré tout de suite.
function cwTaskModal(x) {
  if (!x) return;
  const d = { ...x.data, checklist: [...(x.data.checklist || [])], labels: [...(x.data.labels || [])] };
  const save = () => { x = { ...x, data: { ...d } }; cwSave(x); };
  const listName = (CW.nodes.get(x.parent) || { data: {} }).data.title || '';
  const draw = () => {
    openModal(`<div class="cw-taskm">
      <input class="input cw-tm-title" id="tm-title" value="${esc(d.title || '')}" maxlength="200">
      <small class="sub">${t('cw.inList', { name: esc(listName) })}</small>
      <div class="cw-tm-grid">
        <label>${t('cw.assignee')}<select class="select" id="tm-who"><option value="">—</option>${CW.members.map((m) => `<option value="${esc(m.id)}" ${m.id === d.assignee ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <label>${t('cw.due')}<input class="input" type="date" id="tm-due" value="${esc(d.due || '')}"></label>
      </div>
      <div class="cw-tm-labels">${CW_LABELS.map((c) => `<button type="button" class="${d.labels.includes(c) ? 'on' : ''}" data-label="${c}" style="background:${c}"></button>`).join('')}</div>
      <label class="cw-tm-l">${t('cw.desc')}<textarea class="input" id="tm-desc" rows="4" placeholder="${t('cw.descPh')}">${esc(d.desc || '')}</textarea></label>
      <div class="cw-tm-l">${t('cw.checklist')}${d.checklist.length ? ` <small>${d.checklist.filter((i) => i.done).length}/${d.checklist.length}</small>` : ''}</div>
      <div class="cw-check">${d.checklist.map((it, i) => `<label class="cw-check-row"><input type="checkbox" data-ci="${i}" ${it.done ? 'checked' : ''}><span>${esc(it.t)}</span><button type="button" data-cx="${i}">×</button></label>`).join('')}</div>
      <form id="tm-add" class="row"><input class="input" placeholder="+ ${t('cw.addItem')}" style="flex:1" maxlength="200"></form>
      <div class="row cw-tm-foot"><small class="sub">${x.updatedBy ? t('cw.editedBy', { name: esc((cwMember(x.updatedBy) || {}).name || '') }) : ''}</small><button class="btn danger small" id="tm-del">🗑 ${t('delete')}</button></div>
    </div>`);
    $('#tm-title').onchange = (e) => { d.title = e.target.value.trim() || d.title; save(); };
    $('#tm-who').onchange = (e) => { d.assignee = e.target.value || undefined; save(); };
    $('#tm-due').onchange = (e) => { d.due = e.target.value || undefined; save(); };
    $('#tm-desc').onchange = (e) => { d.desc = e.target.value; save(); };
    $$('[data-label]').forEach((b) => b.onclick = () => { const c = b.dataset.label; d.labels = d.labels.includes(c) ? d.labels.filter((y) => y !== c) : [...d.labels, c]; save(); draw(); });
    $$('[data-ci]').forEach((b) => b.onchange = () => { d.checklist[Number(b.dataset.ci)].done = b.checked; save(); draw(); });
    $$('[data-cx]').forEach((b) => b.onclick = (e) => { e.preventDefault(); d.checklist.splice(Number(b.dataset.cx), 1); save(); draw(); });
    $('#tm-add').onsubmit = (e) => { e.preventDefault(); const v = $('input', e.target).value.trim(); if (!v) return; d.checklist.push({ t: v, done: false }); save(); draw(); $('#tm-add input').focus(); };
    $('#tm-del').onclick = async () => { if (!confirm(t('cw.confirmTask'))) return; cwSave({ ...x, deleted: true }); await closeModal(); cwRender(); };
  };
  CW.editing = true;
  draw();
  const watch = setInterval(() => { if ($('#modal').hidden) { clearInterval(watch); cwBusy(false); cwRender(); } }, 200);
}

// ---------- Tableau d'idées : dossiers, notes, images, checklists, liens posés librement ----------
function cwIdeas() {
  const folder = CW.folder ? CW.nodes.get(CW.folder) : null;
  if (CW.folder && !folder) CW.folder = null;
  const trail = [];
  for (let f = folder; f; f = f.parent ? CW.nodes.get(f.parent) : null) trail.unshift(f);
  const folders = [...CW.nodes.values()].filter((n) => n.kind === 'folder');
  const tree = (parent, depth) => folders.filter((f) => (f.parent || null) === parent).sort((a, b) => a.pos - b.pos)
    .map((f) => `<a class="fd-node ${f.id === CW.folder ? 'on' : ''}" href="#/project?id=${CW.id}&tab=ideas&f=${f.id}" style="--d:${depth}"><span>📁 ${esc(f.data.title || '')}</span></a>${tree(f.id, depth + 1)}`).join('');
  const cards = cwKids(CW.folder, ['folder', 'note', 'image', 'todo', 'link']);
  $('#cw-body').innerHTML = `
    <div class="cw-ideas">
      <aside class="panel fd-tree cw-tree">
        <a class="fd-node ${!CW.folder ? 'on' : ''}" href="#/project?id=${CW.id}&tab=ideas" style="--d:0"><span>💡 ${t('cw.tabIdeas')}</span></a>
        ${tree(null, 1)}
      </aside>
      <section class="cw-ideas-main">
        <div class="row cw-bar">
          <div class="cw-crumbs"><a href="#/project?id=${CW.id}&tab=ideas">${t('cw.tabIdeas')}</a>${trail.map((f) => ` › <a href="#/project?id=${CW.id}&tab=ideas&f=${f.id}">${esc(f.data.title || '')}</a>`).join('')}</div>
          <div class="row cw-tools">
            <button class="btn small" data-addcard="note">📝 ${t('cw.note')}</button>
            <button class="btn small" data-addcard="todo">☑ ${t('cw.checklist')}</button>
            <label class="btn small">🖼️ ${t('cw.image')}<input type="file" id="cw-img" accept="image/*" multiple hidden></label>
            <button class="btn small" data-addcard="link">🔗 ${t('cw.link')}</button>
            <button class="btn small" data-addcard="folder">📁 ${t('cw.folder')}</button>
          </div>
        </div>
        <div class="cw-canvas-wrap cw-scroll" id="cw-wrap"><div class="cw-canvas" id="cw-canvas">
          ${cards.map(cwCard).join('')}
          ${cards.length ? '' : `<div class="cw-canvas-empty">${t('cw.ideasEmpty')}</div>`}
        </div></div>
      </section>
    </div>`;
  cwBindCanvas();
}

function cwCard(n) {
  const d = n.data;
  const style = `left:${Math.round(d.x || 40)}px;top:${Math.round(d.y || 40)}px;width:${Math.round(d.w || (n.kind === 'folder' ? 170 : 240))}px`;
  const head = `<div class="cw-grip" data-grip="${n.id}"><span>${{ note: '📝', todo: '☑', image: '🖼️', link: '🔗', folder: '📁' }[n.kind]}</span><button class="cw-x" data-del="${n.id}" title="${t('delete')}">×</button></div>`;
  if (n.kind === 'folder') {
    const count = cwKids(n.id).length;
    return `<div class="cw-item cw-folder" data-id="${n.id}" style="${style};--fc:${esc(d.color || '#7c3aed')}">${head}<button class="cw-folder-open" data-open="${n.id}"><span class="cw-folder-ico">📁</span><b>${esc(d.title || '')}</b><small>${t('cw.items', { n: count })}</small></button></div>`;
  }
  if (n.kind === 'note') {
    return `<div class="cw-item cw-note" data-id="${n.id}" style="${style};--nc:${esc(d.color || CW_NOTE_COLORS[0])}">${head}
      <textarea class="cw-note-txt" data-text="${n.id}" placeholder="${t('cw.notePh')}">${esc(d.text || '')}</textarea>
      <div class="cw-swatches">${CW_NOTE_COLORS.map((c) => `<button data-color="${c}" data-for="${n.id}" style="background:${c}"></button>`).join('')}</div></div>`;
  }
  if (n.kind === 'image') {
    return `<div class="cw-item cw-image" data-id="${n.id}" style="${style}">${head}
      <img src="/api/cowork/${CW.id}/files/${esc(d.file)}" alt="" draggable="false" loading="lazy">
      <input class="cw-caption" data-caption="${n.id}" value="${esc(d.caption || '')}" placeholder="${t('cw.captionPh')}"></div>`;
  }
  if (n.kind === 'link') {
    return `<div class="cw-item cw-link" data-id="${n.id}" style="${style}">${head}
      <a href="${esc(/^https?:\/\//.test(d.url || '') ? d.url : '#')}" target="_blank" rel="noopener"><b>${esc(d.title || d.url || '')}</b><small>${esc(d.url || '')}</small></a></div>`;
  }
  const items = d.items || [];
  return `<div class="cw-item cw-todo" data-id="${n.id}" style="${style}">${head}
    <input class="cw-todo-title" data-ttitle="${n.id}" value="${esc(d.title || '')}" placeholder="${t('cw.checklist')}">
    ${items.map((it, i) => `<label class="cw-check-row"><input type="checkbox" data-tci="${n.id}:${i}" ${it.done ? 'checked' : ''}><span>${esc(it.t)}</span><button type="button" data-tcx="${n.id}:${i}">×</button></label>`).join('')}
    <form data-tadd="${n.id}"><input class="input" placeholder="+ ${t('cw.addItem')}" maxlength="200"></form></div>`;
}

function cwBindCanvas() {
  const canvas = $('#cw-canvas');
  const wrap = $('#cw-wrap');
  const at = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.max(0, clientX - r.left - 20), y: Math.max(0, clientY - r.top - 20) };
  };
  // Première place libre dans la partie visible du tableau (de gauche à droite, puis en dessous).
  const center = () => {
    const boxes = $$('.cw-item', canvas).map((el) => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight]);
    const free = (x, y) => !boxes.some(([bx, by, bw, bh]) => x < bx + bw + 16 && x + 250 > bx - 16 && y < by + bh + 16 && y + 170 > by - 16);
    const x0 = wrap.scrollLeft + 30;
    const y0 = wrap.scrollTop + 30;
    const maxX = Math.max(x0, x0 + wrap.clientWidth - 290);
    for (let y = y0; y < y0 + 2400; y += 40) {
      for (let x = x0; x <= maxX; x += 40) if (free(x, y)) return { x, y };
    }
    return { x: x0, y: y0 };
  };
  const add = async (kind, p = center()) => {
    const pos = cwNextPos(cwKids(CW.folder));
    if (kind === 'note') cwSave(cwNew('note', CW.folder, { text: '', color: CW_NOTE_COLORS[0], ...p }, pos));
    if (kind === 'todo') cwSave(cwNew('todo', CW.folder, { title: '', items: [], ...p }, pos));
    if (kind === 'link') {
      const url = await askText(t('cw.link'), 'https://', 'https://…');
      if (!url || !/^https?:\/\/\S+$/.test(url)) return url && toast(t('cw.badLink'), true);
      cwSave(cwNew('link', CW.folder, { url, title: url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), ...p }, pos));
    }
    if (kind === 'folder') {
      const title = await askText(t('cw.folder'), '', t('fd.newPh'));
      if (!title) return;
      cwSave(cwNew('folder', CW.folder, { title, color: CW_COLORS[Math.floor(Math.random() * CW_COLORS.length)], ...p }, pos));
    }
    cwRender();
    if (kind === 'note' || kind === 'todo') { const all = $$(kind === 'note' ? '.cw-note-txt' : '.cw-todo-title'); if (all.length) all[all.length - 1].focus(); }
  };
  $$('[data-addcard]').forEach((b) => b.onclick = () => add(b.dataset.addcard));
  // Images : bouton, glisser-déposer sur le tableau, ou coller.
  const upload = async (files, p) => {
    for (const file of [...files].filter((f) => /^image\//.test(f.type))) {
      try {
        toast(t('fd.uploading', { name: file.name || 'image' }));
        const img = await agImage(file);
        const r = await api(`/cowork/${CW.id}/files`, { method: 'POST', body: { data: img.frames[0] } });
        const pt = p || center();
        cwSave(cwNew('image', CW.folder, { file: r.id, caption: '', x: pt.x, y: pt.y, w: 260 }, cwNextPos(cwKids(CW.folder))));
        if (p) p = { x: p.x + 30, y: p.y + 30 };
      } catch (e) { toast(e.message, true); }
    }
    cwRender();
  };
  $('#cw-img').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; upload(f); };
  wrap.ondragover = (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); wrap.classList.add('over'); } };
  wrap.ondragleave = () => wrap.classList.remove('over');
  wrap.ondrop = (e) => { e.preventDefault(); wrap.classList.remove('over'); if (e.dataTransfer.files.length) upload(e.dataTransfer.files, at(e.clientX, e.clientY)); };
  wrap.onpaste = (e) => { const f = [...((e.clipboardData && e.clipboardData.files) || [])]; if (f.length && !e.target.closest('textarea, input')) { e.preventDefault(); upload(f); } };
  canvas.ondblclick = (e) => { if (e.target === canvas) add('note', at(e.clientX, e.clientY)); };

  // Déplacer une carte : on la tient par sa barre du haut. Élargir : coin en bas à droite.
  $$('[data-grip]').forEach((g) => g.onpointerdown = (e) => {
    if (e.target.closest('button')) return;
    const el = g.closest('.cw-item');
    const n = CW.nodes.get(el.dataset.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = n.data.x || 40;
    const oy = n.data.y || 40;
    CW.drag = n.id;
    el.classList.add('moving');
    g.setPointerCapture(e.pointerId);
    g.onpointermove = (ev) => { el.style.left = Math.max(0, ox + ev.clientX - sx) + 'px'; el.style.top = Math.max(0, oy + ev.clientY - sy) + 'px'; };
    g.onpointerup = (ev) => {
      g.onpointermove = g.onpointerup = null;
      el.classList.remove('moving');
      CW.drag = null;
      const x = Math.max(0, ox + ev.clientX - sx);
      const y = Math.max(0, oy + ev.clientY - sy);
      if (Math.abs(x - ox) + Math.abs(y - oy) > 2) cwSave({ ...n, pos: cwNextPos(cwKids(CW.folder)), data: { ...n.data, x, y } });
      if (CW.stale) cwRender();
      else el.parentElement.appendChild(el); // au premier plan
    };
  });
  $$('.cw-item').forEach((el) => {
    const h = document.createElement('span');
    h.className = 'cw-resize';
    el.appendChild(h);
    h.onpointerdown = (e) => {
      const n = CW.nodes.get(el.dataset.id);
      const sx = e.clientX;
      const ow = el.offsetWidth;
      CW.drag = n.id;
      h.setPointerCapture(e.pointerId);
      h.onpointermove = (ev) => { el.style.width = Math.max(140, Math.min(900, ow + ev.clientX - sx)) + 'px'; };
      h.onpointerup = (ev) => {
        h.onpointermove = h.onpointerup = null;
        CW.drag = null;
        cwSave({ ...n, data: { ...n.data, w: Math.max(140, Math.min(900, ow + ev.clientX - sx)) } });
        if (CW.stale) cwRender();
      };
    };
  });
  $$('[data-del]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const n = CW.nodes.get(b.dataset.del);
    const inside = n.kind === 'folder' ? cwAllInside(n.id) : [];
    if (n.kind === 'folder' && !confirm(t('cw.confirmFolder', { name: n.data.title, n: inside.length }))) return;
    for (const x of inside) cwSave({ ...x, deleted: true });
    cwSave({ ...n, deleted: true });
    cwRender();
  });
  $$('[data-open]').forEach((b) => b.onclick = () => { location.hash = `#/project?id=${CW.id}&tab=ideas&f=${b.dataset.open}`; });
  // Texte des notes, titres et légendes : enregistrés pendant la saisie.
  const typing = (sel, attr, apply) => $$(sel).forEach((inp) => {
    inp.onfocus = () => cwBusy(true);
    inp.onblur = () => cwBusy(false);
    let tm = 0;
    inp.oninput = () => {
      if (inp.tagName === 'TEXTAREA') { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 'px'; }
      clearTimeout(tm);
      tm = setTimeout(() => { const n = CW.nodes.get(inp.dataset[attr]); if (n) cwSave({ ...n, data: apply({ ...n.data }, inp.value) }); }, 500);
    };
  });
  typing('[data-text]', 'text', (d, v) => ({ ...d, text: v }));
  typing('[data-caption]', 'caption', (d, v) => ({ ...d, caption: v }));
  typing('[data-ttitle]', 'ttitle', (d, v) => ({ ...d, title: v }));
  $$('.cw-note-txt').forEach((ta) => { ta.style.height = 'auto'; ta.style.height = Math.max(80, ta.scrollHeight) + 'px'; });
  $$('[data-color]').forEach((b) => b.onclick = () => { const n = CW.nodes.get(b.dataset.for); cwSave({ ...n, data: { ...n.data, color: b.dataset.color } }); cwRender(); });
  $$('[data-tci]').forEach((b) => b.onchange = () => {
    const [id, i] = b.dataset.tci.split(':');
    const n = CW.nodes.get(id);
    const items = [...(n.data.items || [])];
    items[Number(i)] = { ...items[Number(i)], done: b.checked };
    cwSave({ ...n, data: { ...n.data, items } });
    cwRender();
  });
  $$('[data-tcx]').forEach((b) => b.onclick = (e) => {
    e.preventDefault();
    const [id, i] = b.dataset.tcx.split(':');
    const n = CW.nodes.get(id);
    const items = [...(n.data.items || [])];
    items.splice(Number(i), 1);
    cwSave({ ...n, data: { ...n.data, items } });
    cwRender();
  });
  $$('[data-tadd]').forEach((f) => {
    const inp = $('input', f);
    inp.onfocus = () => cwBusy(true);
    inp.onblur = () => cwBusy(false);
    f.onsubmit = (e) => {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      const n = CW.nodes.get(f.dataset.tadd);
      cwSave({ ...n, data: { ...n.data, items: [...(n.data.items || []), { t: v, done: false }] } });
      CW.editing = false;
      cwRender();
      const again = $(`[data-tadd="${n.id}"] input`);
      if (again) again.focus();
    };
  });
}

const cwAllInside = (id) => {
  const out = [];
  for (const n of cwKids(id)) { out.push(n); if (n.kind === 'folder') out.push(...cwAllInside(n.id)); }
  return out;
};

// ---------- Membres et réglages du projet ----------
function cwMembers() {
  const owner = CW.project.role === 'owner';
  const me = cwMember(CW.me) || {};
  $('#cw-body').innerHTML = `
    <div class="two-col">
      <div class="panel" data-spot><h3>👥 ${t('cw.tabMembers')} · ${CW.members.length}</h3>
        <div class="cw-members">${CW.members.map((m) => `<div class="cw-mrow">${cwAvatar(m)}<div><b>${esc(m.name)}${m.id === CW.me ? ` <small>(${t('cw.you')})</small>` : ''}</b><small class="mono">${esc(m.publicId)}</small></div>
          <span class="st ${m.role === 'owner' ? 'validated' : 'review'}">${m.role === 'owner' ? t('cw.ownerRole') : t('cw.memberRole')}</span>
          ${owner && m.role !== 'owner' ? `<button class="btn small danger" data-kick="${esc(m.id)}">${t('cw.remove')}</button>` : ''}</div>`).join('')}</div>
        ${owner ? `<form class="row cw-invite" id="cw-invite"><input class="input" placeholder="RVX-XXXXXXXXXXXX" style="flex:1;min-width:200px" required><button class="btn primary">+ ${t('cw.invite')}</button></form>
          <p class="sub" style="font-size:13px">${t('cw.inviteHelp')}</p>` : ''}
      </div>
      <div class="panel" data-spot><h3>⚙️ ${t('cw.settings')}</h3>
        <p class="sub" style="font-size:13px">${t('cw.myId')} : <code class="cw-pid">${esc(me.publicId || '')}</code> <button class="btn small" data-copy="${esc(me.publicId || '')}">${t('fd.copy')}</button></p>
        ${owner ? `<div class="row" style="margin:14px 0"><button class="btn" id="cw-ren">✏️ ${t('cw.renameProject')}</button></div>
          <div class="cw-colors">${CW_COLORS.map((c) => `<button data-pcolor="${c}" class="${c === CW.project.color ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>
          <div class="row" style="margin-top:18px"><button class="btn danger" id="cw-delp">🗑 ${t('cw.deleteProject')}</button></div>`
          : `<div class="row" style="margin-top:14px"><button class="btn danger" id="cw-leave">${t('cw.leave')}</button></div>`}
      </div>
    </div>`;
  bindCopy($('#cw-body'));
  const inv = $('#cw-invite');
  if (inv) inv.onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api(`/cowork/${CW.id}/members`, { method: 'POST', body: { publicId: $('input', inv).value } }); CW.members = r.members; toast(t('cw.invited')); cwRender(); }
    catch (er) { toast(er.message, true); }
  };
  $$('[data-kick]').forEach((b) => b.onclick = async () => {
    if (!confirm(t('cw.confirmKick', { name: (cwMember(b.dataset.kick) || {}).name || '' }))) return;
    try { const r = await api(`/cowork/${CW.id}/members/${b.dataset.kick}`, { method: 'DELETE' }); CW.members = r.members; cwRender(); } catch (er) { toast(er.message, true); }
  });
  const ren = $('#cw-ren');
  if (ren) ren.onclick = async () => {
    const name = await askText(t('cw.renameProject'), CW.project.name);
    if (!name) return;
    try { await api(`/cowork/${CW.id}`, { method: 'PUT', body: { name } }); CW.project.name = name; renderProject(new URLSearchParams({ id: CW.id, tab: 'members' })); } catch (er) { toast(er.message, true); }
  };
  $$('[data-pcolor]').forEach((b) => b.onclick = async () => {
    try { await api(`/cowork/${CW.id}`, { method: 'PUT', body: { color: b.dataset.pcolor } }); CW.project.color = b.dataset.pcolor; renderProject(new URLSearchParams({ id: CW.id, tab: 'members' })); } catch (er) { toast(er.message, true); }
  });
  const del = $('#cw-delp');
  if (del) del.onclick = async () => {
    const name = await askText(t('cw.confirmDeleteProject', { name: CW.project.name }), '', CW.project.name);
    if (name !== CW.project.name) return name && toast(t('cw.nameMismatch'), true);
    try { await api(`/cowork/${CW.id}`, { method: 'DELETE' }); cwStop(); CW = null; location.hash = '#/cowork'; } catch (er) { toast(er.message, true); }
  };
  const leave = $('#cw-leave');
  if (leave) leave.onclick = async () => {
    if (!confirm(t('cw.confirmLeave'))) return;
    try { await api(`/cowork/${CW.id}/members/${CW.me}`, { method: 'DELETE' }); cwStop(); CW = null; location.hash = '#/cowork'; } catch (er) { toast(er.message, true); }
  };
}
