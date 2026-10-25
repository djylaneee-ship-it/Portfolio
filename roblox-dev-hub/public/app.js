// Interface de Roblox Dev Hub (aucun framework). Textes : voir i18n.js.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');

const ICONS = {
  scripting: 'M8.6 16.6L4 12l4.6-4.6L7.2 6 1.2 12l6 6zm6.8 0L20 12l-4.6-4.6L16.8 6l6 6-6 6z',
  vfx: 'M12 2l2.4 6.3L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.6-.7z',
  animation: 'M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2a5 5 0 0 1-4.3-2.4l-1-1.6A2 2 0 0 0 12 6c-.3 0-.5 0-.8.2L6 8.3V13h2V9.6z',
  gui: 'M3 3h18v18H3zm2 2v4h14V5zm0 6v8h6v-8zm8 0v3h6v-3zm0 5v3h6v-3z',
  gfx: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z',
  modeling: 'M12 1l10 5.5v11L12 23 2 17.5v-11zm0 2.3L5 7.2l7 3.9 7-3.9zM4 8.9v7.4l7 3.9v-7.4zm16 0l-7 3.9v7.4l7-3.9z',
  building: 'M3 21V10l5-3v3l5-3v3l5-3v14zm4-3h2v-3H7zm4 0h2v-3h-2zm4 0h2v-3h-2zM2 21h20v2H2z',
  audio: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3z',
  design: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 4a6 6 0 1 1-6 6 6 6 0 0 1 6-6zm0 3a3 3 0 1 0 3 3 3 3 0 0 0-3-3z',
  gameplay: 'M21 7H3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm-11 6H8v2H6v-2H4v-2h2V9h2v2h2zm5.5 1a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5zm3-3a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5z',
  tools: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
};
const TYPE_ICONS = {
  opensource: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.5 9.5 0 0 1 5 0c2-1.3 2.8-1 2.8-1a3.6 3.6 0 0 1 .1 2.7 3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z',
  asset: 'M20 6h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 6H4a2 2 0 0 0-2 2v3h20V8a2 2 0 0 0-2-2zM9 4a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v1h-2V5a1 1 0 0 1 1-1zM3 13v7a1 1 0 0 0 1 1h7v-8zm10 0v8h7a1 1 0 0 0 1-1v-7z',
  doc: 'M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM8 12v2h8v-2zm0 4v2h8v-2z',
  recherche: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z',
  video: 'M8 5v14l11-7z',
  chaine: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  fichier: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z',
};
const typeLabel = (k) => t('type.' + k);
const LEVELS = ['debutant', 'intermediaire', 'avance'];
const levelLabel = (k) => t('lvl.' + k);
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

let META = { categories: [], types: [] };
let STATS = {};
const cat = (id) => {
  const c = META.categories.find((x) => x.id === id) || { id, color: '#888' };
  return { ...c, label: t('cat.' + id), desc: t('catDesc.' + id) };
};
const num = (n) => Number(n || 0).toLocaleString(locale());
const date = (d) => new Date(d).toLocaleDateString(locale());
const dateTime = (d) => new Date(d).toLocaleString(locale());
const icon = (id, size) => `<svg viewBox="0 0 24 24"${size ? ` style="width:${size}px;height:${size}px"` : ''}><path d="${ICONS[id] || ICONS.tools}"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const catOptions = (sel) => META.categories.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(t('cat.' + c.id))}</option>`).join('');

// Sélecteur de langue (barre latérale, connexion, réglages).
function langSelect(id, cls = 'select') {
  return `<select class="${cls} lang-select" id="${id}" aria-label="Language">${LANGS.map(([k, l]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
function bindLangSelect(id) {
  const el = $('#' + id);
  if (el) el.onchange = (e) => setLang(e.target.value);
}
function setLang(l) {
  LANG = l;
  try { localStorage.setItem('rdh-lang', l); } catch {}
  applyStatic();
  if (SESSION && SESSION.loggedIn) { renderSession(); refreshStats(); route(); if (isAdmin()) watchJob(); }
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json();
  if (res.status === 401 && path !== '/login') { showLogin(); }
  if (!res.ok) throw new Error(data.key && has('err.' + data.key) ? t('err.' + data.key, data.vars) : data.error || t('err.generic'));
  return data;
}

// ---------- Connexion ----------
let SESSION = null;
const isAdmin = () => SESSION && SESSION.role === 'admin';

function showLogin(msg = '') {
  document.body.classList.add('locked');
  $('#login').hidden = false;
  if (msg) $('#login-err').textContent = msg;
  setTimeout(() => $('#login-code').focus(), 50);
}

$('#login-lang').innerHTML = LANGS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
$('#login-lang').onchange = (e) => setLang(e.target.value);

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  $('#login-err').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { code: $('#login-code').value } });
    location.reload();
  } catch (err) { $('#login-err').textContent = err.message; btn.disabled = false; }
};

function renderSession() {
  document.body.classList.toggle('role-user', !isAdmin());
  const exp = new Date(SESSION.expiresAt);
  const who = SESSION.label && SESSION.label !== 'Admin' ? esc(SESSION.label) + ' · ' : '';
  $('#side-user').innerHTML = `<div class="who"><span class="role ${SESSION.role}">${isAdmin() ? t('session.admin') : t('session.member')}</span>
    <small>${who}${SESSION.permanent ? t('session.permanent') : t('session.until', { date: date(exp) })}</small></div>
    ${langSelect('side-lang')}
    <button class="btn small" id="logout">${t('session.logout')}</button>`;
  bindLangSelect('side-lang');
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.reload(); };
}

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3800);
}

function ytId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

// ---------- Cartes ----------
function card(r) {
  const c = cat(r.category);
  const fb = `<span class="fb">${TYPE_ICONS[r.type] ? `<svg viewBox="0 0 24 24"><path d="${TYPE_ICONS[r.type]}"/></svg>` : icon(r.category)}</span>`;
  const play = r.type === 'video' ? `<span class="play">${PLAY}</span>` : '';
  const thumb = r.thumbnail
    ? `<div class="thumb"><img src="${esc(r.thumbnail)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('ph');this.remove()">${fb}${play}`
    : r.file && r.type === 'video'
      ? `<div class="thumb"><video src="/media/${esc(r.file)}#t=1" muted preload="metadata"></video>${play}`
      : `<div class="thumb ph">${fb}`;
  return `<article class="card" style="--c:${c.color}" data-id="${r.id}">
    ${thumb}<span class="badge">${typeLabel(r.type)}</span>
    <button class="star admin-only ${r.favorite ? 'on' : ''}" data-star="${r.id}" title="${t('card.favorite')}">${STAR}</button></div>
    <div class="card-body">
      <div class="card-cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</div>
      <h3>${esc(r.title)}</h3>
      ${r.tags.length ? `<div class="tags">${r.tags.slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="meta">${r.level ? `<span class="lvl ${r.level}">${levelLabel(r.level)}</span>` : ''}<span>${esc(r.author || '')}</span></div>
    </div></article>`;
}

let LIST = [];
function bindCards(root, list) {
  LIST = list;
  root.addEventListener('click', async (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      e.stopPropagation();
      const r = LIST.find((x) => x.id === star.dataset.star);
      r.favorite = !r.favorite;
      star.classList.toggle('on', r.favorite);
      await api('/resources/' + r.id, { method: 'PUT', body: { favorite: r.favorite } });
      toast(r.favorite ? t('toast.favAdded') : t('toast.favRemoved'));
      return;
    }
    const el = e.target.closest('.card[data-id]');
    if (el) openDetail(LIST.find((x) => x.id === el.dataset.id));
  });
}

function grid(list, emptyMsg = '') {
  if (!list.length) {
    return `<div class="empty"><b>${t('empty.title')}</b>${emptyMsg || t('empty.text')}
      <div class="row"><button class="btn primary admin-only" onclick="openAdd()">${t('empty.add')}</button>
      <a class="btn" href="#/youtube?q=${encodeURIComponent($('#search').value || 'roblox studio')}">${t('nav.youtube')}</a></div></div>`;
  }
  return `<div class="grid">${list.map(card).join('')}</div>`;
}

// ---------- Vues ----------
async function renderHome() {
  const recent = (await api('/resources?limit=8')).items;
  view.innerHTML = `
    <div class="hero">
      <h1>${t('home.title1')}<br><span>${t('home.title2')}</span></h1>
      <p>${t('home.lead')}</p>
      <div class="row">
        <button class="btn primary admin-only" onclick="openAdd()"><svg viewBox="0 0 24 24"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/></svg>${t('add')}</button>
        <a class="btn admin-only" href="#/explore">⚡ ${t('nav.explore')}</a>
        <a class="btn" href="#/channels">${t('nav.channels')}</a>
        <a class="btn admin-only" href="#/mcp">${t('nav.mcp')}</a>
      </div>
      <div class="stats">
        <div class="stat"><b>${num(STATS.total)}</b><span>${t('stat.resources')}</span></div>
        <div class="stat"><b>${num((STATS.byType || {}).video)}</b><span>${t('stat.videos')}</span></div>
        <div class="stat"><b>${num((STATS.byType || {}).opensource)}</b><span>${t('stat.opensource')}</span></div>
        <div class="stat"><b>${num(((STATS.byType || {}).image || 0) + ((STATS.byType || {}).fichier || 0))}</b><span>${t('stat.files')}</span></div>
        <div class="stat"><b>${num(STATS.channels)}</b><span>${t('stat.channels')}</span></div>
      </div>
    </div>
    <div class="section-head"><h2>${t('home.byCategory')}</h2></div>
    <div class="cat-grid">${META.categories.map((x) => cat(x.id)).map((c) => `
      <a class="cat-tile" style="--c:${c.color}" href="#/library?cat=${c.id}">
        <span class="count">${STATS.byCategory[c.id] || 0}</span>
        <span class="ico">${icon(c.id)}</span>
        <h3>${esc(c.label)}</h3><p>${esc(c.desc)}</p>
      </a>`).join('')}</div>
    <div class="section-head"><h2>${t('home.recent')}</h2><a class="link" href="#/library">${t('home.seeAll')} →</a></div>
    <div id="recent">${grid(recent)}</div>`;
  bindCards($('#recent'), recent);
}

const filters = { type: '', level: '' };
async function renderLibrary(params, favorites = false) {
  const q = params.get('q') || '';
  const c = params.get('cat') || '';
  $('#search').value = q;
  const qs = new URLSearchParams({ q, category: c, type: filters.type, level: filters.level, favorite: favorites ? '1' : '', limit: 60 });
  const { total, items: list } = await api('/resources?' + qs);
  const cc = c && cat(c);
  view.innerHTML = `
    <h1 class="h1">${favorites ? t('nav.favorites') : cc ? esc(cc.label) : q ? t('lib.results', { q: esc(q) }) : t('nav.library')}</h1>
    <p class="sub">${cc && !favorites ? esc(cc.desc) + ' · ' : ''}${t('lib.count', { n: total, num: num(total) })}</p>
    <div class="toolbar">
      <button class="chip ${!filters.type ? 'on' : ''}" data-type="">${t('lib.all')}</button>
      ${META.types.map((ty) => `<button class="chip ${filters.type === ty ? 'on' : ''}" data-type="${ty}">${typeLabel(ty)}</button>`).join('')}
      <span class="spacer"></span>
      <select class="select" id="lvl"><option value="">${t('lib.allLevels')}</option>${LEVELS.map((k) => `<option value="${k}" ${filters.level === k ? 'selected' : ''}>${levelLabel(k)}</option>`).join('')}</select>
    </div>
    <div id="list">${grid(list, favorites ? t('lib.favEmpty') : '')}</div>
    <div class="row more-row" id="more-row" ${list.length < total ? '' : 'hidden'}><button class="btn" id="more">${t('more')}</button></div>`;
  $$('[data-type]').forEach((b) => b.onclick = () => { filters.type = b.dataset.type; route(); });
  $('#lvl').onchange = (e) => { filters.level = e.target.value; route(); };
  bindCards($('#list'), list);
  $('#more').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    qs.set('offset', list.length);
    const page = await api('/resources?' + qs);
    list.push(...page.items);
    $('#list .grid').insertAdjacentHTML('beforeend', page.items.map(card).join(''));
    btn.disabled = false;
    $('#more-row').hidden = list.length >= total;
  };
}

async function renderYoutube(params) {
  const q = params.get('q') || '';
  view.innerHTML = `
    <h1 class="h1">${t('nav.youtube')}</h1>
    <p class="sub">${t('yt.sub')}</p>
    <form class="toolbar" id="yt-form">
      <input class="input" id="yt-q" style="flex:1;min-width:220px" placeholder="${t('yt.ph')}" value="${esc(q)}">
      <button class="btn primary">${t('search')}</button>
    </form>
    <div class="row" style="margin-bottom:20px">${['roblox vfx tutorial', 'roblox scripting tutorial', 'moon animator 2', 'roblox ui design', 'roblox gfx blender', 'roblox combat system', 'roblox datastore', 'roblox building tips'].map((x) => `<button class="chip" data-s="${x}">${x}</button>`).join('')}</div>
    <div id="yt-res"></div>`;
  $('#yt-form').onsubmit = (e) => { e.preventDefault(); location.hash = '#/youtube?q=' + encodeURIComponent($('#yt-q').value); };
  $$('[data-s]').forEach((b) => b.onclick = () => { location.hash = '#/youtube?q=' + encodeURIComponent(b.dataset.s); });
  if (!q) return;
  const out = $('#yt-res');
  out.innerHTML = `<div class="row"><span class="spinner"></span> ${t('searching')}</div>`;
  try {
    const res = await api('/youtube?q=' + encodeURIComponent(q));
    if (!res.length) { out.innerHTML = `<div class="empty"><b>${t('yt.none')}</b>${t('yt.noneText')}</div>`; return; }
    out.innerHTML = `<div class="row admin-only" style="margin-bottom:16px"><button class="btn primary" id="add-all">+ ${t('yt.addAll', { n: res.length })}</button></div><div class="grid">${res.map((v, i) => `
      <article class="card" style="--c:#ff3d6e">
        <div class="thumb"><img src="${esc(v.thumbnail)}" alt="" loading="lazy"><span class="badge">${esc(v.duration || typeLabel('video'))}</span></div>
        <div class="card-body"><h3>${esc(v.title)}</h3><div class="meta">${esc(v.author)}${v.views ? ' · ' + esc(v.views) : ''}</div>
        <div class="row"><button class="btn small primary admin-only" data-add="${i}">+ ${t('add')}</button><a class="btn small" href="${esc(v.url)}" target="_blank">${t('view')}</a></div></div>
      </article>`).join('')}</div>`;
    const addOne = async (b) => {
      if (b.disabled) return;
      b.disabled = true;
      const v = res[b.dataset.add];
      await api('/resources', { method: 'POST', body: { ...v, type: 'video', category: guess(v.title + ' ' + q) } });
      b.textContent = '✓ ' + t('added');
    };
    $$('[data-add]').forEach((b) => b.onclick = async () => { await addOne(b); refreshStats(); });
    $('#add-all').onclick = async (e) => {
      e.currentTarget.disabled = true;
      for (const b of $$('[data-add]')) await addOne(b);
      toast(t('yt.addedN', { n: res.length })); refreshStats();
    };
  } catch (e) { out.innerHTML = `<div class="panel"><h3>${t('err.generic')}</h3><p>${esc(e.message)}</p></div>`; }
}

function guess(t) {
  const rules = [['vfx', /vfx|particle|beam|trail|slash|aura|explosion/i], ['animation', /anim|moon|rig|r6|r15/i], ['gui', /\bui\b|gui|hud|menu|shop/i], ['gfx', /gfx|thumbnail|icon|render/i], ['modeling', /blender|model|mesh|texture/i], ['building', /build|map|terrain|light/i], ['audio', /sound|audio|music/i], ['design', /design|monetiz|popular/i]];
  for (const [c, re] of rules) if (re.test(t)) return c;
  return 'scripting';
}

async function renderChannels(params) {
  const q = params.get('q') || '';
  const { total, followed, items } = await api('/channels?' + new URLSearchParams({ q, limit: 120 }));
  view.innerHTML = `
    <h1 class="h1">${t('ch.title')}</h1>
    <p class="sub">${t('ch.sub', { n: followed, num: num(followed) })}</p>
    <div class="explore-cards admin-only">
      <div class="panel big-action">
        <h3>🔎 ${t('ch.findTitle')}</h3>
        <p>${t('ch.findText')}</p>
        <div class="row"><button class="btn primary" data-crawl='{"mode":"channels","scope":"all","intensity":"normal","syncAfter":true}'>${t('ch.findGo')}</button>
        <button class="btn" data-crawl='{"mode":"channels","scope":"dev","intensity":"normal","syncAfter":true}'>${t('ch.devOnly')}</button></div>
      </div>
      <div class="panel big-action">
        <h3>🔄 ${t('ch.syncTitle')}</h3>
        <p>${t('ch.syncText')}</p>
        <div class="row"><button class="btn primary" data-crawl='{"mode":"sync"}'>${t('ch.syncGo')}</button></div>
      </div>
    </div>
    <div id="job"></div>
    <div class="panel admin-only" style="margin-top:16px">
      <form class="row" id="ch-form">
        <input class="input" id="ch-h" style="flex:2;min-width:200px" placeholder="${t('ch.addPh')}">
        <select class="input" id="ch-c" style="flex:1;min-width:150px"><option value="">${t('autoCategory')}</option>${catOptions()}</select>
        <button class="btn primary">${t('ch.link')}</button>
      </form>
    </div>
    <div class="section-head"><h2>${t('ch.count', { n: total, num: num(total) })}</h2>
      <input class="input" id="ch-q" style="max-width:260px" placeholder="${t('ch.filter')}" value="${esc(q)}"></div>
    <div class="ch-grid" id="ch-grid">${items.map(chCard).join('') || `<div class="empty" style="grid-column:1/-1"><b>${t('ch.none')}</b>${t('ch.noneText')}</div>`}</div>
    <div class="row more-row" id="more-row" ${items.length < total ? '' : 'hidden'}><button class="btn" id="more">${t('more')}</button></div>`;
  bindCrawlButtons();
  $('#ch-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    try { await api('/channels', { method: 'POST', body: { handle: $('#ch-h').value, category: $('#ch-c').value } }); toast(t('ch.linked')); refreshStats(); route(); }
    catch (err) { toast(err.message, true); btn.disabled = false; }
  };
  let t;
  $('#ch-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = '#/channels' + (e.target.value ? '?q=' + encodeURIComponent(e.target.value) : ''); }, 300); };
  if (q) { const i = $('#ch-q'); i.focus(); i.setSelectionRange(q.length, q.length); }
  $('#ch-grid').onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    e.preventDefault();
    await api('/channels/' + del.dataset.del, { method: 'DELETE' });
    del.closest('.chc').remove(); refreshStats();
  };
  $('#more').onclick = async (e) => {
    const page = await api('/channels?' + new URLSearchParams({ q, limit: 120, offset: $$('#ch-grid .chc').length }));
    $('#ch-grid').insertAdjacentHTML('beforeend', page.items.map(chCard).join(''));
    $('#more-row').hidden = $$('#ch-grid .chc').length >= total;
  };
  watchJob();
}

function chCard(c) {
  const name = c.name || c.handle;
  return `<a class="chc" href="https://www.youtube.com/channel/${esc(c.channelId)}" target="_blank" title="${esc(name)}">
    ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<span class="av">${esc(name.replace('@', '')[0] || '?')}</span>`}
    <b>${esc(name)}</b><small>${esc(c.subscribers || (c.category ? cat(c.category).label : ''))}</small>
    <button class="del admin-only" data-del="${c.id}" title="${t('ch.unlink')}">✕</button></a>`;
}

// ---------- Exploration ----------
async function renderExplore() {
  const cats = META.categories.filter((c) => c.id !== 'gameplay').map((c) => cat(c.id));
  view.innerHTML = `
    <h1 class="h1">⚡ ${t('ex.title')}</h1>
    <p class="sub">${t('ex.sub')}</p>
    <div class="panel">
      <h3>${t('ex.cats')}</h3>
      <div class="row" id="ex-cats">${cats.map((c) => `<label class="chip on" style="--c:${c.color}"><input type="checkbox" value="${c.id}" checked hidden>${esc(c.label)}</label>`).join('')}</div>
      <h3 style="margin-top:18px">${t('ex.sources')}</h3>
      <div class="row" id="ex-src">${[['youtube', 'YouTube'], ['devforum', 'DevForum Roblox'], ['reddit', 'Reddit']].map(([v, l]) => `<label class="chip on"><input type="checkbox" value="${v}" checked hidden>${l}</label>`).join('')}</div>
      <h3 style="margin-top:18px">${t('ex.intensity')}</h3>
      <div class="row" id="ex-int">
        <label class="chip"><input type="radio" name="int" value="rapide" hidden>${t('ex.fast')}</label>
        <label class="chip on"><input type="radio" name="int" value="normal" checked hidden>${t('ex.normal')}</label>
        <label class="chip"><input type="radio" name="int" value="massif" hidden>${t('ex.massive')}</label>
      </div>
      <div class="row" style="margin-top:20px"><button class="btn primary" id="ex-go">${t('ex.go')}</button>
      <a class="btn" href="#/channels">${t('ch.findTitle')} →</a></div>
    </div>
    <div class="panel big-action" style="margin-top:16px">
      <h3>📦 ${t('os.title')}</h3>
      <p>${t('os.text')}</p>
      <div class="row" id="os-src">${[['github', 'GitHub'], ['devforum', t('os.forum')], ['store', 'Creator Store']].map(([v, l]) => `<label class="chip on"><input type="checkbox" value="${v}" checked hidden>${l}</label>`).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn primary" id="os-go">${t('os.go')}</button></div>
    </div>
    <div id="job"></div>`;
  $$('#os-src label').forEach((l) => l.onclick = (e) => { e.preventDefault(); const i = $('input', l); i.checked = !i.checked; l.classList.toggle('on', i.checked); });
  $('#os-go').onclick = () => startCrawl({ mode: 'opensource', sources: $$('#os-src input:checked').map((i) => i.value), intensity: $('#ex-int input:checked').value });
  $$('#ex-cats label, #ex-src label').forEach((l) => l.onclick = (e) => { e.preventDefault(); const i = $('input', l); i.checked = !i.checked; l.classList.toggle('on', i.checked); });
  $$('#ex-int label').forEach((l) => l.onclick = (e) => { e.preventDefault(); $$('#ex-int label').forEach((x) => { x.classList.remove('on'); $('input', x).checked = false; }); l.classList.add('on'); $('input', l).checked = true; });
  $('#ex-go').onclick = () => startCrawl({
    mode: 'explore',
    categories: $$('#ex-cats input:checked').map((i) => i.value),
    sources: $$('#ex-src input:checked').map((i) => i.value),
    intensity: $('#ex-int input:checked').value,
  });
  watchJob();
}

// ---------- Admin ----------
async function renderAdmin() {
  const [codes, info] = await Promise.all([api('/admin/codes'), api('/admin/info')]);
  const actives = codes.filter((c) => c.status === 'active').length;
  view.innerHTML = `
    <h1 class="h1">🛡️ ${t('admin.title')}</h1>
    <p class="sub">${t('admin.sub')}</p>
    <div class="panel big-action">
      <h3>${t('admin.create')}</h3>
      <form class="row" id="code-form">
        <input class="input" name="label" style="flex:2;min-width:200px" placeholder="${t('admin.forWho')}">
        <select class="input" name="days" style="flex:1;min-width:150px">
          ${[[1, 'd1'], [7, 'd7'], [30, 'd30'], [90, 'd90'], [365, 'd365'], [0, 'forever']].map(([v, k]) => `<option value="${v}" ${v === 30 ? 'selected' : ''}>${t('admin.' + k)}</option>`).join('')}
        </select>
        <label class="chip" id="admin-toggle"><input type="checkbox" name="admin" hidden>👑 ${t('admin.rights')}</label>
        <button class="btn primary">${t('admin.createGo')}</button>
      </form>
      <div id="new-code"></div>
    </div>
    <div class="section-head"><h2>${t('admin.count', { n: codes.length })} · ${t('admin.activeCount', { n: actives })}</h2></div>
    <div class="codes">${codes.map((c) => `
      <div class="code-row ${c.status}">
        <div class="code-main"><code>${esc(c.code)}</code><b>${c.admin ? '👑 ' : ''}${esc(c.label || t('admin.noName'))}</b>
          <small>${c.admin ? t('session.admin') + ' · ' : ''}${!c.expiresAt ? t('admin.never') : t(c.status === 'expired' ? 'admin.expiredOn' : 'admin.expiresOn', { date: date(c.expiresAt) })} · ${t('admin.logins', { n: c.uses })}${c.lastUsed ? ' · ' + t('admin.lastLogin', { date: dateTime(c.lastUsed) }) : ''}</small></div>
        <span class="status ${c.status}">${t('status.' + c.status)}</span>
        <div class="row">
          <button class="btn small" data-copy="${esc(c.code)}">${t('copy')}</button>
          ${c.expiresAt ? `<button class="btn small" data-extend="${c.id}">+30 ${t('admin.daysShort')}</button><button class="btn small" data-forever="${c.id}">∞ ${t('admin.makeForever')}</button>` : ''}
          <button class="btn small" data-block="${c.id}" data-v="${!c.revoked}">${c.revoked ? t('admin.unblock') : t('admin.block')}</button>
          <button class="btn small danger" data-remove="${c.id}">${t('delete')}</button>
        </div>
      </div>`).join('') || `<div class="empty"><b>${t('admin.none')}</b>${t('admin.noneText')}</div>`}</div>
    <div class="panel" style="margin-top:22px">
      <h3>🔑 ${t('admin.keyTitle')}</h3>
      <p>${t('admin.keyText')}</p>
      ${codeBox(info.keyFile)}
      <div class="row" style="margin-top:14px"><button class="btn danger" id="reset-key">${t('admin.resetKey')}</button></div>
    </div>
    <div class="panel">
      <h3>🌐 ${t('admin.shareTitle')}</h3>
      ${info.shared ? `<p>${t('admin.sharedOn')}</p>${info.addresses.map(codeBox).join('')}` : `<p>${t('admin.sharedOff')}</p>`}
      <p style="margin-top:14px">${t('admin.internet', { port: info.port })}</p>
    </div>`;
  bindCopy();
  $('#admin-toggle').onclick = (e) => {
    e.preventDefault();
    const i = $('input', e.currentTarget); i.checked = !i.checked;
    e.currentTarget.classList.toggle('on', i.checked);
  };
  $('#code-form').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.admin = $('#code-form [name=admin]').checked;
    const c = await api('/admin/codes', { method: 'POST', body: d });
    const msg = t(c.admin ? 'admin.msgAdmin' : 'admin.msg', { code: c.code }) + '\n' + (c.expiresAt ? t('admin.msgUntil', { date: date(c.expiresAt) }) : t('admin.msgForever'));
    await renderAdmin();
    $('#new-code').innerHTML = `<div class="new-code"><span>${c.label ? t('admin.newFor', { name: esc(c.label) }) : t('admin.newId')}</span><strong>${esc(c.code)}</strong>
      <div class="row"><button class="btn small primary" data-copy="${esc(c.code)}">${t('admin.copyId')}</button><button class="btn small" data-copy="${esc(msg)}">${t('admin.copyMsg')}</button></div></div>`;
    bindCopy();
  };
  $$('[data-extend]').forEach((b) => b.onclick = async () => { await api('/admin/codes/' + b.dataset.extend, { method: 'PUT', body: { addDays: 30 } }); toast(t('admin.extended')); renderAdmin(); });
  $$('[data-forever]').forEach((b) => b.onclick = async () => { await api('/admin/codes/' + b.dataset.forever, { method: 'PUT', body: { permanent: true } }); toast(t('admin.nowForever')); renderAdmin(); });
  $$('[data-block]').forEach((b) => b.onclick = async () => { await api('/admin/codes/' + b.dataset.block, { method: 'PUT', body: { revoked: b.dataset.v === 'true' } }); renderAdmin(); });
  $$('[data-remove]').forEach((b) => b.onclick = async () => { if (!confirm(t('admin.confirmDelete'))) return; await api('/admin/codes/' + b.dataset.remove, { method: 'DELETE' }); renderAdmin(); });
  $('#reset-key').onclick = async () => {
    if (!confirm(t('admin.confirmReset'))) return;
    const r = await api('/admin/reset-key', { method: 'POST' });
    prompt(t('admin.newKey'), r.key);
    location.reload();
  };
}

function bindCrawlButtons() {
  $$('[data-crawl]').forEach((b) => b.onclick = () => startCrawl(JSON.parse(b.dataset.crawl)));
}

async function startCrawl(opts) {
  try { await api('/crawl', { method: 'POST', body: opts }); toast(t('job.started')); watchJob(); }
  catch (e) { toast(e.message, true); }
}

const modeLabel = (m) => t('mode.' + m);
const logLine = (l) => (l.k && has('log.' + l.k) ? t('log.' + l.k, l.p) : l.msg);
const current = (c) => (!c ? '' : typeof c === 'string' ? c : t('cur.' + c.k, c.p));
let jobTimer;
async function watchJob() {
  clearTimeout(jobTimer);
  let st;
  try { st = await api('/crawl'); } catch { return; }
  const side = $('#side-job');
  side.hidden = !st.running;
  if (st.running) side.innerHTML = `<a href="#/explore"><span class="spinner"></span><span>${esc(modeLabel(st.mode))}<small>${t('job.side', { added: num(st.added), channels: num(st.channels) })}</small></span></a><div class="bar"><i style="width:${Math.round((st.step / Math.max(st.steps, 1)) * 100)}%"></i></div>`;
  const box = $('#job');
  if (box && (st.running || st.finishedAt)) {
    const pct = Math.round((st.step / Math.max(st.steps, 1)) * 100);
    box.innerHTML = `<div class="panel job">
      <div class="row" style="justify-content:space-between"><h3>${st.running ? '<span class="spinner"></span> ' : '✅ '}${esc(modeLabel(st.mode))}${st.running ? '' : ' — ' + t('job.finished')}</h3>
      ${st.running ? `<button class="btn small danger" id="job-stop">${t('job.stop')}</button>` : ''}</div>
      <div class="bar big"><i style="width:${st.running ? pct : 100}%"></i></div>
      <div class="job-stats">
        <div><b>${num(st.added)}</b><span>${t('job.added')}</span></div>
        <div><b>${num(st.channels)}</b><span>${t('job.channels')}</span></div>
        <div><b>${num(st.found)}</b><span>${t('job.found')}</span></div>
        <div><b>${st.step}/${st.steps}</b><span>${t('job.steps')}</span></div>
        <div><b>${st.errors}</b><span>${t('job.errors')}</span></div>
      </div>
      ${st.current ? `<p style="margin:12px 0 0">${t('job.current')} ${esc(current(st.current))}</p>` : ''}
      <div class="log">${(st.log || []).slice(0, 25).map((l) => `<div class="${l.err ? 'err' : ''}">${esc(logLine(l))}</div>`).join('')}</div>
    </div>`;
    if ($('#job-stop')) $('#job-stop').onclick = () => api('/crawl/stop', { method: 'POST' });
  }
  if (st.running) jobTimer = setTimeout(() => { watchJob(); refreshStats(); }, 1500);
  else if (box && box.dataset.wasRunning) { refreshStats(); }
  if (box) box.dataset.wasRunning = st.running ? '1' : '';
}

async function renderMcp() {
  const info = await api('/info');
  const http = `http://localhost:${info.port}/mcp`;
  const stdio = JSON.stringify({ mcpServers: { 'roblox-dev-hub': { command: 'node', args: [info.mcpPath] } } }, null, 2);
  const httpCfg = JSON.stringify({ mcpServers: { 'roblox-dev-hub': { type: 'http', url: http } } }, null, 2);
  view.innerHTML = `
    <h1 class="h1">${t('nav.mcp')}</h1>
    <p class="sub">${t('mcp.sub')}</p>
    <div class="panel">
      <h3>${t('mcp.httpTitle')}</h3>
      <p>${t('mcp.httpText')}</p>
      ${codeBox(http)}
      <p style="margin-top:14px">${t('mcp.example')}</p>
      ${jsonBox(httpCfg)}
    </div>
    <div class="panel">
      <h3>${t('mcp.stdioTitle')}</h3>
      <p>${t('mcp.stdioText')}</p>
      ${codeBox(`node "${info.mcpPath}"`)}
      <p style="margin-top:14px">${t('mcp.example')}</p>
      ${jsonBox(stdio)}
    </div>
    <div class="panel">
      <h3>${t('mcp.tools')}</h3>
      <div class="tags" style="gap:8px">${['search_resources', 'get_resource', 'list_categories', 'add_resource', 'import_url', 'update_notes', 'explore_internet', 'explore_status', 'list_channels', 'sync_channels'].map((x) => `<span class="tag" style="font-size:13px;padding:5px 10px">${x}</span>`).join('')}</div>
    </div>`;
  bindCopy();
}

function jsonBox(text) {
  return `<div class="code" style="align-items:start"><code style="white-space:pre">${esc(text)}</code><button class="btn small" data-copy="${esc(text)}">${t('copy')}</button></div>`;
}

function codeBox(text) {
  return `<div class="code"><code>${esc(text)}</code><button class="btn small" data-copy="${esc(text)}">${t('copy')}</button></div>`;
}
function bindCopy() {
  $$('[data-copy]').forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✓ ' + t('copied'); setTimeout(() => (b.textContent = t('copy')), 1500); }
    catch { toast(t('toast.copyFail'), true); }
  });
}

async function renderSettings() {
  const s = await api('/settings');
  view.innerHTML = `
    <h1 class="h1">${t('nav.settings')}</h1>
    <p class="sub">${t('set.sub')}</p>
    <div class="panel">
      <h3>${t('set.langTitle')}</h3>
      <p>${t('set.langText')}</p>
      ${langSelect('set-lang', 'input')}
    </div>
    <div class="panel">
      <h3>${t('set.ytTitle')}</h3>
      <p>${t('set.ytText')}</p>
      <form class="row" id="key-form">
        <input class="input" id="key" style="flex:1;min-width:220px" placeholder="${s.hasKey ? t('set.keySaved') + ' ' + esc(s.youtubeApiKey) : t('set.pasteKey')}">
        <button class="btn primary">${t('save')}</button>
        ${s.hasKey ? `<button class="btn danger" type="button" id="key-del">${t('delete')}</button>` : ''}
      </form>
    </div>
    <div class="panel">
      <h3>☁️ ${t('set.cloudTitle')}</h3>
      <p>${t('set.cloudText')}
      ${s.lastCloudSync ? t('set.cloudLast', { date: dateTime(s.lastCloudSync), n: num(s.lastCloudAdded) }) + (s.cloudUpdatedAt ? ' ' + t('set.cloudFile', { date: dateTime(s.cloudUpdatedAt) }) : '') : t('set.cloudNever')}</p>
      <form class="row" id="cloud-form">
        <input class="input" id="cloud-url" style="flex:1;min-width:260px" value="${esc(s.cloudUrl)}" placeholder="${t('set.cloudPh')}">
        <button class="btn">${t('save')}</button>
        <button class="btn primary" type="button" id="cloud-sync">${t('set.syncNow')}</button>
      </form>
    </div>
    <div class="panel">
      <h3>${t('set.ghTitle')}</h3>
      <p>${t('set.ghText')}</p>
      <form class="row" id="gh-form">
        <input class="input" id="gh" style="flex:1;min-width:220px" placeholder="${s.hasGithub ? t('set.tokenSaved') : t('set.pasteToken')}">
        <button class="btn primary">${t('save')}</button>
      </form>
    </div>
    <div class="panel">
      <h3>${t('set.autoTitle')}</h3>
      <p>${t('set.autoText')}${s.lastAutoSync ? ' ' + t('set.autoLast', { date: dateTime(s.lastAutoSync) }) : ''}</p>
      <select class="input" id="auto" style="max-width:280px">${[0, 1, 6, 12, 24].map((v) => `<option value="${v}" ${Number(s.autoSyncHours) === v ? 'selected' : ''}>${t('set.auto' + v)}</option>`).join('')}</select>
    </div>
    <div class="panel">
      <h3>${t('set.backupTitle')}</h3>
      <p>${t('set.backupText')}</p>
      <a class="btn" href="/api/export" download="roblox-dev-hub.json">${t('set.export')}</a>
    </div>`;
  $('#key-form').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { youtubeApiKey: $('#key').value } }); toast(t('toast.saved')); renderSettings(); };
  bindLangSelect('set-lang');
  $('#cloud-form').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { cloudUrl: $('#cloud-url').value } }); toast(t('toast.saved')); };
  $('#cloud-sync').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = `<span class="spinner"></span>${t('set.syncing')}`;
    try { const r = await api('/cloud/sync', { method: 'POST' }); toast(t('set.cloudDone', { n: num(r.added), c: num(r.channels) })); refreshStats(); renderSettings(); }
    catch (err) { toast(err.message, true); b.disabled = false; b.textContent = t('set.syncNow'); }
  };
  $('#gh-form').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { githubToken: $('#gh').value } }); toast(t('toast.saved')); renderSettings(); };
  $('#auto').onchange = async (e) => { await api('/settings', { method: 'PUT', body: { autoSyncHours: Number(e.target.value) } }); toast(t('toast.saved')); };
  if ($('#key-del')) $('#key-del').onclick = async () => { await api('/settings', { method: 'PUT', body: { youtubeApiKey: '' } }); toast(t('toast.deleted')); renderSettings(); };
}

// ---------- Détail ----------
function mediaFor(r) {
  const id = ytId(r.url);
  if (id) return `<div class="media"><iframe src="https://www.youtube-nocookie.com/embed/${id}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  if (r.file && r.type === 'video') return `<div class="media"><video src="/media/${esc(r.file)}" controls></video></div>`;
  if (r.type === 'image') return `<div class="media"><img src="${esc(r.file ? '/media/' + r.file : r.url)}" alt=""></div>`;
  if (r.thumbnail) return `<div class="media"><img src="${esc(r.thumbnail)}" alt=""></div>`;
  const c = cat(r.category);
  return `<div class="media ph thumb" style="--c:${c.color};aspect-ratio:21/6">${icon(r.category, 60)}</div>`;
}

function openDetail(r) {
  const c = cat(r.category);
  const link = r.url || (r.file ? '/media/' + r.file : '');
  openModal(`
    ${mediaFor(r)}
    <div class="card-cat" style="--c:${c.color}"><span class="dot" style="background:${c.color}"></span>${esc(c.label)} · ${typeLabel(r.type)}</div>
    <h2 class="detail-title">${esc(r.title)}</h2>
    <p class="sub">${esc(r.author || '')}${r.description ? (r.author ? ' — ' : '') + esc(r.description) : ''}</p>
    <div class="row" style="margin-bottom:22px">
      ${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" ${r.file ? 'download' : ''}>${r.file ? t('detail.download') : t('detail.open')}</a>` : ''}
      <span class="admin-only row"><button class="btn" id="d-fav">${STAR}${r.favorite ? t('detail.unfav') : t('card.favorite')}</button>
      <button class="btn danger" id="d-del">${t('delete')}</button></span>
    </div>
    <form id="d-form" class="admin-only">
      <div class="field"><label>${t('f.title')}</label><input name="title" value="${esc(r.title)}"></div>
      <div class="two">
        <div class="field"><label>${t('f.category')}</label><select name="category">${catOptions(r.category)}</select></div>
        <div class="field"><label>${t('f.type')}</label><select name="type">${META.types.map((ty) => `<option value="${ty}" ${ty === r.type ? 'selected' : ''}>${typeLabel(ty)}</option>`).join('')}</select></div>
        <div class="field"><label>${t('f.tagsComma')}</label><input name="tags" value="${esc(r.tags.join(', '))}"></div>
        <div class="field"><label>${t('f.level')}</label><select name="level"><option value="">—</option>${LEVELS.map((k) => `<option value="${k}" ${k === r.level ? 'selected' : ''}>${levelLabel(k)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>${t('f.notes')}</label><textarea name="notes" placeholder="${t('f.notesPh')}">${esc(r.notes)}</textarea></div>
      <button class="btn primary">${t('save')}</button>
    </form>`);
  $('#d-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await api('/resources/' + r.id, { method: 'PUT', body: data });
    toast(t('toast.saved')); closeModal(); refreshStats(); route();
  };
  $('#d-fav').onclick = async () => { await api('/resources/' + r.id, { method: 'PUT', body: { favorite: !r.favorite } }); closeModal(); refreshStats(); route(); };
  $('#d-del').onclick = async () => {
    if (!confirm(t('detail.confirmDelete', { title: r.title }))) return;
    await api('/resources/' + r.id, { method: 'DELETE' });
    toast(t('toast.deleted')); closeModal(); refreshStats(); route();
  };
}

// ---------- Ajout ----------
function openAdd(tab = 'link') {
  const catOpts = `<option value="">${t('autoCategory')}</option>${catOptions()}`;
  openModal(`
    <h2 class="detail-title">${t('addm.title')}</h2>
    <div class="tabs"><button data-tab="link">${t('addm.tabLink')}</button><button data-tab="file">${t('addm.tabFile')}</button><button data-tab="manual">${t('addm.tabNote')}</button></div>
    <div data-pane="link">
      <p class="sub">${t('addm.linkText')}</p>
      <form id="f-link">
        <div class="field"><label>${t('f.link')}</label><input name="url" required placeholder="https://www.youtube.com/watch?v=…"></div>
        <div id="f-prev"></div>
        <div class="two"><div class="field"><label>${t('f.category')}</label><select name="category">${catOpts}</select></div>
        <div class="field"><label>${t('f.tags')}</label><input name="tags" placeholder="slash, combat"></div></div>
        <button class="btn primary">${t('addm.import')}</button>
      </form>
    </div>
    <div data-pane="file">
      <p class="sub">${t('addm.fileText')}</p>
      <div class="field"><label>${t('f.category')}</label><select id="f-cat">${catOpts}</select></div>
      <label class="drop" id="f-drop"><b>${t('addm.drop')}</b>${t('addm.dropOr')}<input type="file" multiple hidden id="f-files"></label>
      <div id="f-prog" style="margin-top:12px"></div>
    </div>
    <div data-pane="manual">
      <form id="f-man">
        <div class="field"><label>${t('f.title')}</label><input name="title" required placeholder="${t('addm.notePh')}"></div>
        <div class="two"><div class="field"><label>${t('f.category')}</label><select name="category">${catOptions()}</select></div>
        <div class="field"><label>${t('f.linkOpt')}</label><input name="url"></div></div>
        <div class="field"><label>${t('f.tags')}</label><input name="tags"></div>
        <div class="field"><label>${t('f.notesCode')}</label><textarea name="notes"></textarea></div>
        <button class="btn primary">${t('add')}</button>
      </form>
    </div>`);
  const show = (t) => { $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t)); };
  $$('[data-tab]').forEach((b) => b.onclick = () => show(b.dataset.tab));
  show(tab);

  const urlIn = $('#f-link [name=url]');
  let timer;
  urlIn.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!/^https?:\/\/\S+\.\S+/.test(urlIn.value)) return ($('#f-prev').innerHTML = '');
      $('#f-prev').innerHTML = `<div class="preview"><span class="spinner"></span> ${t('addm.reading')}</div>`;
      try {
        const p = await api('/preview', { method: 'POST', body: { url: urlIn.value } });
        $('#f-prev').innerHTML = `<div class="preview">${p.thumbnail ? `<img src="${esc(p.thumbnail)}" alt="">` : ''}<div><b>${esc(p.title)}</b><div class="sub" style="margin:0">${esc(p.author || '')} · ${typeLabel(p.type)} · ${esc(cat(p.category).label)}</div></div></div>`;
      } catch { $('#f-prev').innerHTML = ''; }
    }, 500);
  };
  $('#f-link').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${t('addm.importing')}`;
    try {
      const d = Object.fromEntries(new FormData(e.target));
      const r = await api('/import', { method: 'POST', body: d });
      toast(t('toast.addedTitle', { title: r.title })); closeModal(); refreshStats(); route();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = t('addm.import'); }
  };
  const drop = $('#f-drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); upload(e.dataTransfer.files, $('#f-cat').value); };
  $('#f-files').onchange = (e) => upload(e.target.files, $('#f-cat').value);
  $('#f-man').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    await api('/resources', { method: 'POST', body: { ...d, type: d.url ? 'article' : 'fichier' } });
    toast(t('added')); closeModal(); refreshStats(); route();
  };
}

async function upload(files, category = '') {
  files = [...files];
  if (!files.length) return;
  const prog = $('#f-prog');
  let ok = 0;
  for (const [i, f] of files.entries()) {
    if (prog) prog.innerHTML = `<div class="row"><span class="spinner"></span> ${t('addm.uploading', { i: i + 1, n: files.length })} ${esc(f.name)}</div>`;
    try {
      await api(`/upload?${new URLSearchParams({ name: f.name, category })}`, { method: 'POST', body: f });
      ok++;
    } catch (e) { toast(f.name + ' : ' + e.message, true); }
  }
  toast(t('addm.uploaded', { n: ok }));
  if (!$('#modal').hidden) closeModal();
  refreshStats(); route();
}

// ---------- Fenêtre ----------
function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal').hidden = true;
  $('#modal-body').innerHTML = '';
  document.body.style.overflow = '';
}
$('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

// ---------- Navigation ----------
async function refreshStats() {
  STATS = await api('/stats');
  const active = new URLSearchParams(location.hash.split('?')[1] || '').get('cat');
  $('#side-cats').innerHTML = META.categories.map((x) => cat(x.id)).map((c) => `
    <a href="#/library?cat=${c.id}" class="${active === c.id ? 'active' : ''}"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}<span class="n">${num(STATS.byCategory[c.id])}</span></a>`).join('');
}

async function route() {
  const [p, qs] = location.hash.slice(1).split('?');
  const path = (p || '/').replace(/^\//, '') || 'home';
  const params = new URLSearchParams(qs || '');
  const name = path === 'library' && params.get('cat') ? '' : path;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $$('#side-cats a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/library?cat=' + params.get('cat')));
  document.body.classList.remove('menu');
  if (!SESSION || !SESSION.loggedIn) return;
  if (!isAdmin() && ['explore', 'mcp', 'settings', 'admin'].includes(path)) { location.hash = '#/'; return; }
  try {
    if (path === 'library') await renderLibrary(params);
    else if (path === 'favorites') await renderLibrary(params, true);
    else if (path === 'youtube') await renderYoutube(params);
    else if (path === 'channels') await renderChannels(params);
    else if (path === 'explore') await renderExplore();
    else if (path === 'admin' && isAdmin()) await renderAdmin();
    else if (path === 'mcp') await renderMcp();
    else if (path === 'settings') await renderSettings();
    else await renderHome();
  } catch (e) {
    view.innerHTML = `<div class="empty"><b>${t('err.oops')}</b>${esc(e.message)}<br>${t('err.server')}</div>`;
  }
}

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const cur = new URLSearchParams(location.hash.split('?')[1] || '');
    const c = location.hash.startsWith('#/library') ? cur.get('cat') : '';
    const qs = new URLSearchParams({ ...(e.target.value && { q: e.target.value }), ...(c && { cat: c }) });
    location.hash = '#/library' + (qs.toString() ? '?' + qs : '');
  }, 250);
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
});
$('#add-btn').onclick = () => openAdd();
$('#menu-btn').onclick = () => document.body.classList.toggle('menu');

// Glisser-déposer des fichiers n'importe où sur la page.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (isAdmin() && e.dataTransfer.types.includes('Files') && $('#modal').hidden) { dragDepth++; $('#dropzone').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; $('#dropzone').hidden = true;
  if (isAdmin() && $('#modal').hidden && e.dataTransfer.files.length) upload(e.dataTransfer.files);
});

window.addEventListener('hashchange', route);
(async () => {
  applyStatic();
  try { SESSION = await api('/session'); }
  catch {
    view.innerHTML = `<div class="empty"><b>${t('err.oldTitle')}</b>${t('err.oldText')}</div>`;
    return;
  }
  if (!SESSION.loggedIn) return showLogin();
  renderSession();
  META = await api('/meta');
  await refreshStats();
  route();
  if (isAdmin()) watchJob();
})();
