// ---------- Équipe IA : plusieurs IA branchées par MCP se parlent et s'échangent des tâches ----------
// Données dans le serveur (team.js). Ici : brancher une IA (consigne à coller), la salle des agents, le tableau
// des tâches et le fil des messages, relus toutes les 3 s tant que la page est ouverte. Utilise les outils de app.js.
const TM_APPS = ['Claude Desktop', 'Claude Code', 'Cursor', 'Codex', 'Gemini CLI', 'Windsurf', 'VS Code (Copilot)'];
const TM_COLS = ['todo', 'doing', 'blocked', 'done'];
let TM = null;
let TM_TIMER = null;

function tmStop() { clearInterval(TM_TIMER); TM_TIMER = null; }

const tmWho = (name) => `<span class="tm-who" style="--h:${cwHue(name || '?')}">${esc(name === 'user' ? t('tm.you') : name || '?')}</span>`;
const tmAgentOpts = (sel, withAll) => `${withAll ? `<option value="">${t(withAll)}</option>` : ''}${TM.agents.map((a) => `<option value="${esc(a.id)}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;

function tmAgents() {
  if (!TM.agents.length) return `<div class="panel tm-empty">${t('tm.noAgents')}</div>`;
  return `<div class="tm-agents">${TM.agents.map((a) => {
    const st = a.listening ? 'on' : a.online ? 'busy' : 'off';
    return `<div class="panel tm-agent ${st}" data-spot>
      <div class="tm-agent-top"><span class="tm-av" style="--h:${cwHue(a.name)}">${esc(cwInitials(a.name))}</span>
        <div><b>${esc(a.name)}</b><small>${esc([a.app, a.role].filter(Boolean).join(' · ') || '—')}</small></div>
        <button class="icon-btn tm-kick" data-kick="${esc(a.id)}" title="${t('tm.remove')}">×</button></div>
      <p class="tm-state"><i></i>${t('tm.st.' + st)}${a.working_on ? ` · ${esc(a.working_on)}` : ''}</p>
      <small class="muted">${t('tm.seen', { when: ago(a.lastSeen) })}</small></div>`;
  }).join('')}</div>`;
}

function tmBoard() {
  return `<div class="tm-board">${TM_COLS.map((c) => {
    const list = TM.tasks.filter((x) => x.status === c);
    return `<div class="tm-col ${c}"><header><b>${t('tm.col.' + c)}</b><small>${list.length}</small></header>
      ${list.map((x) => `<button class="tm-card prio-${x.priority}" data-task="${esc(x.id)}"><b>${esc(x.title)}</b>
        <span class="tm-card-meta">${tmWho(x.fromName)} → ${x.to ? tmWho(x.toName) : `<span class="tm-any">${t('tm.anyone')}</span>`}${x.notes.length ? ` · 💬 ${x.notes.length}` : ''}</span></button>`).join('')
        || `<p class="muted small tm-none">${t('tm.colEmpty')}</p>`}</div>`;
  }).join('')}</div>`;
}

function tmFeed() {
  if (!TM.events.length) return `<p class="muted small">${t('tm.feedEmpty')}</p>`;
  return TM.events.slice().reverse().map((e) => {
    let what;
    if (e.kind === 'msg') what = `→ ${e.to === 'all' ? t('tm.all') : tmWho(e.to)}<div class="tm-msg">${esc(e.text).replace(/\n/g, '<br>')}</div>`;
    else if (e.kind === 'join') what = `<span class="muted">${esc(t('tm.joined'))}</span>`;
    else what = `<span class="muted">${t('tm.ev.' + e.action)}</span> <a href="#" data-task="${esc(e.task.id)}">${esc(e.task.title || '…')}</a>${e.text ? `<div class="tm-msg">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}`;
    return `<div class="tm-ev">${tmWho(e.from)} ${what}<small>${ago(e.t)}</small></div>`;
  }).join('');
}

function tmDraw() {
  const a = $('#tm-agents-box');
  if (!a) return tmStop();
  a.innerHTML = tmAgents();
  $('#tm-board-box').innerHTML = tmBoard();
  $('#tm-feed').innerHTML = tmFeed();
  const to = $('#tm-to');
  const cur = to.value;
  to.innerHTML = `<option value="all">${t('tm.all')}</option>${tmAgentOpts(cur)}`;
  to.value = [...to.options].some((o) => o.value === cur) ? cur : 'all';
  $$('[data-kick]', view).forEach((b) => b.onclick = async () => {
    if (!confirm(t('tm.removeAsk'))) return;
    await api('/team/agents/' + b.dataset.kick, { method: 'DELETE' }).catch((e) => toast(e.message, true));
    tmRefresh();
  });
  $$('[data-task]', view).forEach((b) => b.onclick = (e) => { e.preventDefault(); tmOpenTask(b.dataset.task); });
}

async function tmRefresh() {
  try { TM = await api('/team'); tmDraw(); } catch {}
}

// Détail d'une tâche : notes, résultat, état, personne, suppression.
function tmOpenTask(id) {
  const x = TM.tasks.find((k) => k.id === id);
  if (!x) return;
  openModal(`<h2>${esc(x.title)}</h2>
    <p class="muted small">${tmWho(x.fromName)} → ${x.to ? tmWho(x.toName) : t('tm.anyone')} · ${t('tm.prio.' + x.priority)} · ${ago(x.updatedAt)}</p>
    ${x.details ? `<div class="md tm-details">${md(x.details)}</div>` : ''}
    ${x.result ? `<h4>${t('tm.result')}</h4><div class="md tm-details">${md(x.result)}</div>` : ''}
    ${x.notes.length ? `<h4>${t('tm.notes')}</h4>${x.notes.map((n) => `<div class="tm-ev">${tmWho(n.by === 'user' ? 'user' : (TM.agents.find((a) => a.id === n.by) || {}).name || n.by)}<div class="tm-msg">${esc(n.text).replace(/\n/g, '<br>')}</div><small>${ago(n.t)}</small></div>`).join('')}` : ''}
    <div class="row tm-actions">
      <select class="select" id="tmt-status">${TM_COLS.map((c) => `<option value="${c}" ${x.status === c ? 'selected' : ''}>${t('tm.col.' + c)}</option>`).join('')}</select>
      <select class="select" id="tmt-to">${tmAgentOpts(x.to, 'tm.anyone')}</select>
    </div>
    <textarea class="input" id="tmt-note" rows="2" placeholder="${t('tm.notePh')}"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="tmt-save">${t('save')}</button><span style="flex:1"></span><button class="btn danger" id="tmt-del">${t('tm.delete')}</button></div>`);
  $('#tmt-save').onclick = async () => {
    const body = { note: $('#tmt-note').value };
    if ($('#tmt-status').value !== x.status) body.status = $('#tmt-status').value;
    if ($('#tmt-to').value !== x.to) body.to = $('#tmt-to').value;
    try { await api('/team/tasks/' + x.id, { method: 'PUT', body }); closeModal(); tmRefresh(); } catch (e) { toast(e.message, true); }
  };
  $('#tmt-del').onclick = async () => {
    if (!confirm(t('tm.deleteAsk'))) return;
    await api('/team/tasks/' + x.id, { method: 'DELETE' }).catch((e) => toast(e.message, true));
    closeModal();
    tmRefresh();
  };
}

function tmNewTask() {
  openModal(`<h2>${t('tm.newTask')}</h2>
    <form id="tmn" class="tm-form">
      <input class="input" id="tmn-title" placeholder="${t('tm.titlePh')}" required>
      <textarea class="input" id="tmn-details" rows="5" placeholder="${t('tm.detailsPh')}"></textarea>
      <div class="row"><select class="select" id="tmn-to">${tmAgentOpts('', 'tm.anyone')}</select>
        <select class="select" id="tmn-prio">${['normal', 'high', 'low'].map((p) => `<option value="${p}">${t('tm.prio.' + p)}</option>`).join('')}</select></div>
      <button class="btn primary">${t('tm.create')}</button>
    </form>`);
  $('#tmn').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/team/tasks', { method: 'POST', body: { title: $('#tmn-title').value, details: $('#tmn-details').value, to: $('#tmn-to').value, priority: $('#tmn-prio').value } });
      closeModal();
      tmRefresh();
    } catch (er) { toast(er.message, true); }
  };
  setTimeout(() => $('#tmn-title').focus(), 50);
}

async function renderTeam() {
  TM = await api('/team');
  const cfg = JSON.stringify({ mcpServers: { 'rovex-hub': { command: TM.stdio.command, args: TM.stdio.args, ...(TM.stdio.env && { env: TM.stdio.env }) } } }, null, 2);
  view.innerHTML = `
    ${pageHead('MCP', t('tm.title'), t('tm.sub'), `<button class="btn" id="tm-clear">${t('tm.clear')}</button><button class="btn primary" id="tm-new">＋ ${t('tm.newTask')}</button>`)}
    <div class="two-col">
      <div class="panel" data-spot><h3>🤝 ${t('tm.joinTitle')}</h3><p>${t('tm.joinText')}</p>
        <form class="tm-form" id="tm-join">
          <div class="row"><input class="input" id="tm-name" placeholder="${t('tm.namePh')}" required>
            <select class="select" id="tm-app">${TM_APPS.map((a) => `<option>${esc(a)}</option>`).join('')}</select></div>
          <input class="input" id="tm-role" placeholder="${t('tm.rolePh')}">
          <button class="btn primary">📋 ${t('tm.copyPrompt')}</button>
        </form></div>
      <div class="panel" data-spot><h3>🔌 ${t('tm.otherTitle')}</h3><p>${t('tm.otherText')}</p>
        <p class="sub" style="font-size:13px">${t('tm.httpUrl')}</p>${codeBox(TM.mcpUrl)}
        <details class="tm-cfg"><summary>${t('tm.stdioCfg')}</summary>${codeBox(cfg)}</details></div>
    </div>
    <div class="section-head"><h2>${t('tm.agents')}</h2></div>
    <div id="tm-agents-box"></div>
    <div class="section-head"><h2>${t('tm.tasks')}</h2></div>
    <div id="tm-board-box"></div>
    <div class="panel tm-feed-panel" data-spot><h3>💬 ${t('tm.feed')}</h3>
      <form class="row tm-send" id="tm-send"><select class="select" id="tm-to"></select>
        <input class="input" id="tm-text" placeholder="${t('tm.sendPh')}" style="flex:1;min-width:200px"><button class="btn primary">${t('ag.send')}</button></form>
      <div class="tm-feed" id="tm-feed"></div></div>`;
  bindCopy(view);
  tmDraw();
  $('#tm-join').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#tm-name').value.trim() || $('#tm-app').value;
    const { text } = await api('/team/prompt', { method: 'POST', body: { name, role: $('#tm-role').value } });
    await copyText(text);
    toast(t('tm.copied', { app: $('#tm-app').value }));
  };
  $('#tm-send').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#tm-text').value.trim();
    if (!text) return;
    try {
      await api('/team/send', { method: 'POST', body: { to: $('#tm-to').value, text } });
      $('#tm-text').value = '';
      tmRefresh();
    } catch (er) { toast(er.message, true); }
  };
  $('#tm-new').onclick = tmNewTask;
  $('#tm-clear').onclick = async () => {
    if (!confirm(t('tm.clearAsk'))) return;
    await api('/team/clear', { method: 'POST' }).catch((er) => toast(er.message, true));
    tmRefresh();
  };
  tmStop();
  TM_TIMER = setInterval(tmRefresh, 3000);
}
