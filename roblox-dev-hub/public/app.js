// Interface de Rovex Hub (aucun framework). Textes : voir i18n.js.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Badges et couleurs des catégories (style Rovex).
const CAT_STYLE = {
  scripting: ['</>', '#A78BFA'], vfx: ['FX', '#F0ABFC'], animation: ['AN', '#FCD34D'], cutscenes: ['CS', '#FDA4AF'], gui: ['UI', '#6EE7B7'], gfx: ['GX', '#C4B5FD'],
  modeling: ['3D', '#FDBA74'], building: ['MP', '#7DD3FC'], audio: ['♪', '#FDE68A'], design: ['GD', '#F9A8D4'], gameplay: ['GP', '#FCA5A5'], tools: ['TL', '#CBD5E1'],
};
const TYPE_ICONS = {
  opensource: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.7s.8-.3 2.8 1a9.5 9.5 0 0 1 5 0c2-1.3 2.8-1 2.8-1a3.6 3.6 0 0 1 .1 2.7 3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z',
  asset: 'M20 6h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 6H4a2 2 0 0 0-2 2v3h20V8a2 2 0 0 0-2-2zM9 4a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v1h-2V5a1 1 0 0 1 1-1zM3 13v7a1 1 0 0 0 1 1h7v-8zm10 0v8h7a1 1 0 0 0 1-1v-7z',
  doc: 'M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM8 12v2h8v-2zm0 4v2h8v-2z',
  recherche: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z',
  video: 'M8 5v14l11-7z',
  chaine: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  fichier: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z',
  article: 'M4 4h16v2H4zm0 4h16v2H4zm0 4h10v2H4zm0 4h16v2H4z',
  outil: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z',
};
const STAR = '<svg class="fill" viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>';
const PLAY = '<svg class="fill" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const PLUS = '<svg class="line" viewBox="0 0 24 24" style="stroke-width:2.6"><path d="M12 5v14M5 12h14"/></svg>';
const BOLT = '<svg class="line" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';
const ARROW = '<svg class="line" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const LEVELS = ['debutant', 'intermediaire', 'avance'];

let META = { categories: [], types: [] };
let STATS = {};
let SESSION = null;
let MCP = { connected: false, log: [] };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeLabel = (k) => t('type.' + k);
const levelLabel = (k) => t('lvl.' + k);
const isAdmin = () => SESSION && SESSION.role === 'admin';
const num = (n) => Number(n || 0).toLocaleString(locale());
const date = (d) => new Date(d).toLocaleDateString(locale());
const dateTime = (d) => new Date(d).toLocaleString(locale());
const cat = (id) => {
  const [badge, color] = CAT_STYLE[id] || ['··', '#9890AD'];
  return { id, badge, color, label: t('cat.' + id), desc: t('catDesc.' + id) };
};
const catOptions = (sel) => META.categories.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(t('cat.' + c.id))}</option>`).join('');
const svgPath = (d) => `<svg class="fill" viewBox="0 0 24 24"><path d="${d}"/></svg>`;

function ago(d) {
  const s = Math.max(1, (Date.now() - Date.parse(d)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (s < 60) return rtf.format(-Math.round(s), 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json();
  if (res.status === 401 && path !== '/login') showLogin(data.key === 'otherDevice' ? t('err.otherDevice', data.vars) : '');
  if (!res.ok) throw new Error(data.key && has('err.' + data.key) ? t('err.' + data.key, data.vars) : data.error || t('err.generic'));
  return data;
}

// ---------- Animations ----------
// Onde au clic sur les boutons et puces.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn, .chip, .int, .tabs button');
  if (!el || reduced) return;
  const r = el.getBoundingClientRect();
  const s = Math.max(r.width, r.height);
  const w = document.createElement('span');
  w.className = 'ripple';
  w.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.style.overflow = 'hidden';
  el.append(w);
  setTimeout(() => w.remove(), 650);
});

// Halo lumineux qui suit la souris sur les cartes.
// Une mise à jour par image au plus (pas à chaque mouvement de souris).
let spotEv = null;
document.addEventListener('pointermove', (e) => {
  if (spotEv) { spotEv = e; return; }
  spotEv = e;
  requestAnimationFrame(() => {
    const ev = spotEv;
    spotEv = null;
    const el = ev.target.closest && ev.target.closest('[data-spot], .card, .cat-tile, .stat');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${ev.clientX - r.left}px`);
    el.style.setProperty('--my', `${ev.clientY - r.top}px`);
  });
}, { passive: true });

// Compteurs qui défilent jusqu'à leur valeur.
function countUp(root = document) {
  for (const el of $$('[data-count]', root)) {
    const end = Number(el.dataset.count) || 0;
    if (reduced || end < 2) { el.textContent = num(end); continue; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 1100);
      el.textContent = num(Math.round(end * (1 - Math.pow(1 - p, 4))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// Numérote les enfants pour les apparitions en cascade.
function stagger(root) {
  [...root.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 14)));
}

// Pastille du menu qui glisse vers l'onglet actif.
function movePill() {
  const pill = $('#nav-pill');
  const a = $('#nav a.active');
  if (!a || a.offsetParent === null) { pill.style.opacity = 0; return; }
  pill.style.opacity = 1;
  pill.style.height = a.offsetHeight + 'px';
  pill.style.transform = `translateY(${a.offsetTop}px)`;
}

// Change de page avec une animation de sortie puis d'entrée.
let renderSeq = 0;
async function transition(render) {
  const seq = ++renderSeq;
  if (!reduced && view.childElementCount) {
    view.classList.add('leaving');
    await sleep(170);
  }
  if (seq !== renderSeq) return;
  view.classList.remove('entering');
  await render();
  if (seq !== renderSeq) return;
  stagger(view);
  for (const g of $$('.grid, .cat-grid, .stats, .ch-grid, .ex-list, .codes', view)) { g.classList.add('stagger'); stagger(g); }
  view.classList.remove('leaving');
  void view.offsetWidth;
  view.classList.add('entering');
  countUp(view);
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}

// ---------- Connexion ----------
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
  const err = $('#login-err');
  err.textContent = ''; err.classList.remove('shake');
  try {
    await api('/login', { method: 'POST', body: { code: $('#login-code').value } });
    $('.login-card').style.animation = 'modalIn .4s reverse forwards';
    await sleep(300);
    location.reload();
  } catch (ex) {
    err.textContent = ex.message; void err.offsetWidth; err.classList.add('shake');
    btn.disabled = false;
  }
};

function langSelect(id) {
  return `<select class="select" id="${id}" aria-label="Language">${LANGS.map(([k, l]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
// La langue de l'admin sert aussi aux modèles de prompts proposés dans Claude (menu +).
function syncLang() {
  if (isAdmin()) api('/settings', { method: 'PUT', body: { lang: LANG } }).catch(() => {});
}
function setLang(l) {
  LANG = l;
  try { localStorage.setItem('rdh-lang', l); } catch {}
  applyStatic();
  syncLang();
  if (SESSION && SESSION.loggedIn) { renderSession(); refreshStats(); refreshMcp(); route(); }
}

function renderSession() {
  document.body.classList.toggle('role-user', !isAdmin());
  const name = SESSION.label && SESSION.label !== 'Admin' ? SESSION.label : isAdmin() ? t('session.admin') : t('session.member');
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'RH';
  $('#side-user').innerHTML = `
    <div class="who"><span class="avatar">${esc(initials)}</span>
      <span class="meta"><b>${esc(name)}</b><small>${isAdmin() ? t('session.admin') + ' · ' : ''}${SESSION.permanent ? t('session.permanent') : t('session.until', { date: date(SESSION.expiresAt) })}</small></span>
    </div>
    <div class="side-actions">
      <a class="btn small admin-only" href="#/settings"><svg class="line" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>${t('nav.settings')}</a>
      <button class="btn small" id="logout"><svg class="line" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>${t('session.logout')}</button>
    </div>
    <div class="ver" id="side-ver"></div>
    <div class="row">${langSelect('side-lang')}</div>`;
  $('#side-lang').onchange = (e) => setLang(e.target.value);
  api('/version').then((v) => { const el = $('#side-ver'); if (el) el.textContent = 'Rovex Hub v' + v.version; }).catch(() => {});
  watchUpdates();
  watchPlaces();
  loadCustom();
  applySpace(SPACE);
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.reload(); };
}

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3600);
}

function ytId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

// ---------- Cartes ----------
function card(r) {
  const c = cat(r.category);
  const fb = `<span class="fb">${svgPath(TYPE_ICONS[r.type] || TYPE_ICONS.article)}</span>`;
  const play = r.type === 'video' ? `<span class="play">${PLAY}</span>` : '';
  const thumb = r.thumbnail
    ? `<div class="thumb"><img src="${esc(r.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('ph');this.remove()">${fb}${play}`
    : r.file && r.type === 'video'
      ? `<div class="thumb"><video src="/media/${esc(r.file)}#t=1" muted preload="metadata"></video>${play}`
      : `<div class="thumb ph">${fb}`;
  return `<article class="card" style="--c:${c.color}" data-id="${r.id}">
    ${thumb}<span class="badge">${typeLabel(r.type)}</span>
    <button class="star admin-only ${r.favorite ? 'on' : ''}" data-star="${r.id}" title="${t('card.favorite')}">${STAR}</button></div>
    <div class="card-body">
      <div class="card-cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</div>
      <h3>${esc(r.title)}</h3>
      ${r.tags.length ? `<div class="tags">${r.tags.slice(0, 3).map((x) => `<span class="tag">#${esc(x)}</span>`).join('')}</div>` : ''}
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
      star.animate([{ transform: 'scale(1.6) rotate(-20deg)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.34,1.56,.64,1)' });
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

function pageHead(eyebrow, title, sub, actions = '') {
  return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1 class="h1">${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;
}

// ---------- Accueil ----------
async function renderHome() {
  const [recent, mcp, lv] = await Promise.all([api('/resources?limit=8'), api('/mcp').catch(() => ({ log: [] })), api('/level').catch(() => null)]);
  const s = STATS.byType || {};
  view.innerHTML = `
    <section class="hero" data-spot>
      <div>
        <p class="eyebrow">${t('home.eyebrow')}</p>
        <h1>${t('home.title1')}<span>${t('home.title2')}</span></h1>
        <p>${t('home.lead')}</p>
        <div class="row">
          <a class="btn primary admin-only" href="#/connect">${t('home.connect')} ${ARROW}</a>
          <a class="btn admin-only" href="#/examples">${t('home.addExamples')}</a>
          <a class="btn admin-only" href="#/explore">${BOLT}${t('nav.explore')}</a>
          <a class="btn role-only-user" href="#/examples">${t('nav.examples')} ${ARROW}</a>
        </div>
      </div>
      <div class="terminal"><div class="term-bar"><i></i><i></i><i></i><span>claude ↔ rovex-hub</span></div><div class="term-body" id="term"></div></div>
    </section>
    <div class="stats">
      <div class="stat"><b data-count="${STATS.total}">0</b><span>${t('stat.resources')}</span></div>
      <div class="stat"><b data-count="${s.video || 0}">0</b><span>${t('stat.videos')}</span></div>
      <a class="stat" href="#/opensource"><b data-count="${STATS.opensource || 0}">0</b><span>${t('stat.opensource')}</span></a>
      <div class="stat"><b data-count="${STATS.channels}">0</b><span>${t('stat.channels')}</span></div>
      <div class="stat"><b data-count="${STATS.examples || 0}">0</b><span>${t('stat.examples')}</span></div>
    </div>
    <div class="home-grid">
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="section-head"><h2>${t('home.byCategory')}</h2><a class="link" href="#/library">${t('home.seeAll')}</a></div>
        <div class="cat-grid">${META.categories.map((x) => cat(x.id)).map((c) => `
          <a class="cat-tile" style="--c:${c.color}" href="#/library?cat=${c.id}" data-spot>
            <span class="top"><span class="badge-ico">${esc(c.badge)}</span><span class="count">${num((STATS.learnByCategory || STATS.byCategory)[c.id])}</span></span>
            <h3>${esc(c.label)}</h3><p>${esc(c.desc)}</p>
          </a>`).join('')}</div>
      </div>
      <aside class="panel activity" data-spot>
        ${lv ? `<a class="lv-widget" href="#/level">${ring(lv.progress, `<b>${lv.level}</b>`, true)}<span><b>${t('lvt.' + lv.title)}</b><small>${t('lv.understanding', { n: lv.overall })} · ${num(lv.xp)} XP</small></span></a>` : ''}
        <div class="section-head" style="margin-bottom:8px"><h2 style="font-size:19px">${t('act.title')}</h2><span class="live"><span class="pulse"></span>${t('act.live')}</span></div>
        <div id="act-list">${activityList(mcp.log || [])}</div>
        <a class="link admin-only" href="#/connect">${t('act.journal')}</a>
      </aside>
    </div>
    <div class="section-head"><h2>${t('home.recent')}</h2><a class="link" href="#/library">${t('home.seeAll')}</a></div>
    <div id="recent">${grid(recent.items)}</div>`;
  $$('.role-only-user', view).forEach((el) => { el.hidden = isAdmin(); });
  bindCards($('#recent'), recent.items);
  animateBars(view);
  if (lv) checkLevelUp(lv);
  runTerminal();
}

function activityList(log) {
  if (!log.length) return `<p class="sub" style="font-size:13.5px;padding:14px 0">${t('act.none')}</p>`;
  return log.slice(0, 6).map((l, i) => {
    const c = l.category ? l.category.split(' + ').map((x) => cat(x).label).join(' + ') : '';
    return `<div class="act" style="--i:${i}"><span class="avatar">${esc(l.tool[0].toUpperCase())}</span><div>
      <b>${esc(l.tool)}${l.q ? ` · « ${esc(l.q)} »` : ''}</b>
      <small>${[c, typeof l.count === 'number' ? t('act.results', { n: l.count }) : '', ago(l.t)].filter(Boolean).join(' · ')}</small></div></div>`;
  }).join('');
}

// Petit terminal animé : Claude interroge Rovex Hub.
let termTimer;
async function runTerminal() {
  clearTimeout(termTimer);
  const el = $('#term');
  if (!el) return;
  const q = t('term.query');
  let results = [];
  try {
    const r = await api('/mcp/test', { method: 'POST', body: { query: 'tween' } });
    results = [...(r.examples || []).map((e) => [t('term.example'), e.file || e.title, t('term.validated')]), ...(r.results || []).map((x) => [typeLabel(x.type).toLowerCase(), x.title, x.author || ''])].slice(0, 3);
  } catch {}
  if (!results.length) results = [[t('term.example'), 'ShopToggle.client.lua', t('term.validated')], ['video', 'Tween UI', 'YouTube'], ['doc', 'TweenService', 'Creator Docs']];
  const lines = [
    `<div class="c">› ${t('term.asks')}</div>`,
    `<div>rovex.<span class="k">search</span>(<span class="s">"${esc(q)}"</span>, cat=<span class="s">"GUI / UI"</span>)</div>`,
    `<div class="c" style="margin-top:8px">‹ ${t('term.answers')}</div>`,
    `<div class="term-res">${results.map(([a, b, c], i) => `<div style="animation-delay:${i * 120}ms"><span><span class="k">${esc(a)}</span> · ${esc(String(b).slice(0, 34))}</span><span class="${c === t('term.validated') ? 'g' : 'c'}">${esc(String(c).slice(0, 16))}</span></div>`).join('')}</div>`,
  ];
  el.innerHTML = '';
  if (reduced) {
    el.innerHTML = lines.join('') + `<div style="margin-top:10px"><span class="k">● ${t('term.writes')}</span></div>`;
    return;
  }
  for (const l of lines) {
    if (!document.body.contains(el)) return;
    el.insertAdjacentHTML('beforeend', l);
    el.lastElementChild.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 350, easing: 'ease-out' });
    await sleep(650);
  }
  // Dernière ligne tapée lettre par lettre.
  el.insertAdjacentHTML('beforeend', `<div style="margin-top:10px"><span class="k">●</span> <span class="k" id="typed"></span><span class="caret"></span></div>`);
  const txt = t('term.writes');
  for (let i = 1; i <= txt.length; i++) {
    if (!document.body.contains(el)) return;
    $('#typed').textContent = txt.slice(0, i);
    await sleep(35);
  }
  termTimer = setTimeout(runTerminal, 7000);
}

// ---------- Bibliothèque ----------
const filters = { type: '', level: '' };
async function renderLibrary(params, favorites = false) {
  const q = params.get('q') || '';
  const c = params.get('cat') || '';
  $('#search').value = q;
  const qs = new URLSearchParams({ q, category: c, type: filters.type, level: filters.level, favorite: favorites ? '1' : '', exclude: favorites ? '' : OS_TYPES.join(','), limit: 60 });
  const { total, items: list } = await api('/resources?' + qs);
  const cc = c && cat(c);
  view.innerHTML = `
    ${pageHead(cc ? t('lib.category') : t('lib.eyebrow'), favorites ? t('nav.favorites') : cc ? esc(cc.label) : q ? t('lib.results', { q: esc(q) }) : t('nav.library'),
      `${cc && !favorites ? esc(cc.desc) + ' · ' : ''}${t('lib.count', { n: total, num: num(total) })}`)}
    <div class="toolbar">
      <button class="chip ${!filters.type ? 'on' : ''}" data-type="">${t('lib.all')}</button>
      ${META.types.filter((ty) => favorites || !OS_TYPES.includes(ty)).map((ty) => `<button class="chip ${filters.type === ty ? 'on' : ''}" data-type="${ty}">${typeLabel(ty)}</button>`).join('')}
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
    const g = $('#list .grid');
    const start = g.children.length;
    g.insertAdjacentHTML('beforeend', page.items.map(card).join(''));
    [...g.children].slice(start).forEach((el, i) => { el.style.setProperty('--i', Math.min(i, 14)); });
    btn.disabled = false;
    $('#more-row').hidden = list.length >= total;
  };
}

// ---------- Open source & systèmes gratuits (séparé de la bibliothèque d'apprentissage) ----------
const OS_TYPES = ['opensource', 'asset'];
const OS_TABS = [['', 'os2.all'], ['github', 'GitHub'], ['devforum', 'DevForum'], ['modele', 'os2.models'], ['plugin', 'os2.plugins']];
const osF = { tab: '', q: '', cat: '', sort: 'stars' };
const shortNum = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k' : String(n));

function osCard(r) {
  const c = cat(r.category);
  const parts = String(r.description || '').split(' · ');
  const desc = parts.filter((x) => !/^★|^(Luau|Lua|TypeScript|MIT|Apache|GPL|MPL|BSD|Plugin|Modèle gratuit|Free model)\b|^👍/i.test(x)).join(' · ');
  const meta = parts.filter((x) => /^(Luau|Lua|TypeScript|MIT|Apache-2.0|GPL|MPL-2.0|BSD)/.test(x));
  const src = (r.tags || []).includes('github') ? 'GitHub' : (r.tags || []).includes('devforum') ? 'DevForum' : (r.tags || []).includes('plugin') ? t('os2.plugin') : r.type === 'asset' ? t('os2.model') : typeLabel(r.type);
  const fb = `<span class="fb">${svgPath(TYPE_ICONS[r.type] || TYPE_ICONS.opensource)}</span>`;
  return `<article class="card" style="--c:${c.color}" data-id="${r.id}">
    ${r.thumbnail ? `<div class="thumb"><img src="${esc(r.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('ph');this.remove()">${fb}` : `<div class="thumb ph">${fb}`}
    <span class="badge">${esc(src)}</span>${r.stars ? `<span class="stars">★ ${shortNum(r.stars)}</span>` : ''}</div>
    <div class="card-body">
      <div class="card-cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</div>
      <h3>${esc(r.title)}</h3>
      ${desc ? `<p class="os-desc">${esc(desc)}</p>` : ''}
      <div class="meta">${meta.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}<span>${esc(r.author || '')}</span></div>
    </div></article>`;
}

async function renderOpenSource() {
  const qs = new URLSearchParams({ types: OS_TYPES.join(','), q: osF.q, category: osF.cat, tag: osF.tab, sort: osF.sort === 'stars' ? 'stars' : '', limit: 60 });
  const { total, items } = await api('/resources?' + qs);
  view.innerHTML = `
    ${pageHead(t('os2.eyebrow'), t('os2.title'), t('os2.sub'), `<a class="btn primary admin-only" href="#/explore">${BOLT}${t('os.go')}</a>`)}
    <div class="toolbar">
      ${OS_TABS.map(([v, k]) => `<button class="chip solid ${osF.tab === v ? 'on' : ''}" data-ostab="${v}">${k.includes('.') ? t(k) : k}</button>`).join('')}
    </div>
    <div class="toolbar">
      <input class="input" id="os-q" style="flex:1;min-width:220px" placeholder="${t('os2.searchPh')}" value="${esc(osF.q)}">
      <select class="select" id="os-cat" style="padding:11px 14px"><option value="">${t('os2.allCats')}</option>${catOptions(osF.cat)}</select>
      <select class="select" id="os-sort" style="padding:11px 14px"><option value="stars" ${osF.sort === 'stars' ? 'selected' : ''}>${t('os2.byStars')}</option><option value="recent" ${osF.sort === 'recent' ? 'selected' : ''}>${t('os2.byRecent')}</option></select>
    </div>
    <p class="sub">${t('lib.count', { n: total, num: num(total) })}</p>
    <div id="os-list">${items.length ? `<div class="grid">${items.map(osCard).join('')}</div>` : `<div class="empty"><b>${t('os2.none')}</b>${t('os2.noneText')}</div>`}</div>
    <div class="row more-row" id="more-row" ${items.length < total ? '' : 'hidden'}><button class="btn" id="more">${t('more')}</button></div>`;
  $$('[data-ostab]').forEach((b) => b.onclick = () => { osF.tab = b.dataset.ostab; transition(renderOpenSource); });
  let tm;
  $('#os-q').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { osF.q = e.target.value; refreshOs(); }, 300); };
  $('#os-cat').onchange = (e) => { osF.cat = e.target.value; refreshOs(); };
  $('#os-sort').onchange = (e) => { osF.sort = e.target.value; refreshOs(); };
  bindCards($('#os-list'), items);
  $('#more').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    qs.set('offset', items.length);
    const page = await api('/resources?' + qs);
    items.push(...page.items);
    $('#os-list .grid').insertAdjacentHTML('beforeend', page.items.map(osCard).join(''));
    btn.disabled = false;
    $('#more-row').hidden = items.length >= total;
  };
}

// Rafraîchit la liste sans rejouer toute l'animation de page (garde le focus de la recherche).
async function refreshOs() {
  const qs = new URLSearchParams({ types: OS_TYPES.join(','), q: osF.q, category: osF.cat, tag: osF.tab, sort: osF.sort === 'stars' ? 'stars' : '', limit: 60 });
  const { total, items } = await api('/resources?' + qs);
  const box = $('#os-list');
  if (!box) return;
  box.innerHTML = items.length ? `<div class="grid stagger">${items.map(osCard).join('')}</div>` : `<div class="empty"><b>${t('os2.none')}</b>${t('os2.noneText')}</div>`;
  if (box.firstElementChild) stagger(box.firstElementChild);
  $('#os-list').previousElementSibling.textContent = t('lib.count', { n: total, num: num(total) });
  bindCards(box, items);
  $('#more-row').hidden = items.length >= total;
}

// ---------- Skills : un skill Claude par catégorie ----------
async function renderSkills() {
  const data = await api('/skills');
  view.innerHTML = `
    ${pageHead(t('sk.eyebrow'), t('sk.title'), t('sk.sub'), `<button class="btn primary admin-only" id="sk-code">${data.codeInstalled ? '✓ ' + t('sk.codeUpdate') : t('sk.codeInstall')}</button>`)}
    <div class="flow">
      ${[['🎯', 'sk.f1'], ['📥', 'sk.f2'], ['📚', 'sk.f3'], ['⚙️', 'sk.f4']].map(([ico, k], i) => `<div class="flow-step" style="--i:${i}"><span>${ico}</span><b>${t(k + 't')}</b><small>${t(k)}</small></div>`).join('<i class="flow-arrow">→</i>')}
    </div>
    <button class="sk-core" data-sk="core" data-spot>
      <span class="badge-ico">◆</span>
      <span><code>${esc(data.core.name)}</code>${data.core.custom ? ` <span class="st review">${t('sk.custom')}</span>` : ''}<h3>${t('sk.core')}</h3><small>${t('sk.coreDesc')}</small></span>
    </button>
    <div class="sk-grid">${data.skills.map((x) => {
      const c = cat(x.id);
      return `<button class="sk-card ${x.enabled ? '' : 'off'}" style="--c:${c.color}" data-sk="${x.id}" data-spot>
        <span class="top"><span class="badge-ico">${esc(c.badge)}</span>${x.custom ? `<span class="st review">${t('sk.custom')}</span>` : ''}${x.enabled ? '' : `<span class="st draft">${t('sk.disabled')}</span>`}</span>
        <code>${esc(x.name)}</code><h3>${esc(c.label)}</h3>
        <span class="sk-counts"><span>📘 ${x.totals.examples}</span><span>🎬 ${num(x.totals.resources)}</span><span>📦 ${num(x.totals.opensource)}</span></span>
      </button>`;
    }).join('')}</div>
    <div class="two-col">
      <div class="panel" data-spot><h3>🖥️ Claude Desktop</h3><p>${t('sk.desktop')}</p></div>
      <div class="panel" data-spot><h3>⌨️ Claude Code</h3><p>${t('sk.code', { dir: esc(data.codeDir) })}</p></div>
    </div>`;
  $$('[data-sk]').forEach((b) => b.onclick = () => openSkill(b.dataset.sk));
  const btn = $('#sk-code');
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    try { const r = await api('/skills/install-code', { method: 'POST' }); toast(t('sk.codeDone', { n: r.installed.length })); transition(renderSkills); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

async function openCore() {
  const sk = await api('/skills/core');
  openModal(`
    <div class="card-cat"><span class="dot" style="background:#a970ff"></span><span class="mono">${esc(sk.name)}</span></div>
    <h2 class="detail-title" style="margin-top:8px">${t('sk.core')}</h2>
    <p class="sub" style="margin-bottom:18px">${t('sk.coreDesc')}</p>
    <div class="field"><label>${t('sk.instr')}</label><textarea id="sk-instr" style="min-height:420px" spellcheck="false" ${isAdmin() ? '' : 'readonly'}>${esc(sk.instructions)}</textarea></div>
    <div class="row admin-only">
      <button class="btn primary" id="sk-save">${t('save')}</button>
      <button class="btn" id="sk-reset">${t('cn.default')}</button>
    </div>`);
  if (!isAdmin()) return;
  $('#sk-save').onclick = async () => { await api('/skills/core', { method: 'PUT', body: { instructions: $('#sk-instr').value } }); toast(t('toast.saved')); closeModal(); transition(renderSkills); };
  $('#sk-reset').onclick = () => {
    $('#sk-instr').value = sk.defaultInstructions;
    $('#sk-instr').animate([{ background: 'rgba(124,58,237,.25)' }, { background: 'transparent' }], { duration: 700 });
  };
}

async function openSkill(id) {
  if (id === 'core') return openCore();
  const sk = await api('/skills/' + id);
  const c = cat(id);
  const ctx = sk.context;
  const list = (items, fmt) => items.length ? `<ul class="sk-list">${items.map(fmt).join('')}</ul>` : `<p class="sub" style="font-size:13px">${t('sk.empty')}</p>`;
  openModal(`
    <div class="card-cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)} · <span class="mono">${esc(sk.name)}</span></div>
    <h2 class="detail-title" style="margin-top:8px">${t('sk.skillOf', { cat: esc(c.label) })}</h2>
    <p class="sub" style="margin-bottom:6px">${esc(sk.description || '')}</p>
    <p class="sub" style="margin-bottom:18px">${t('sk.modalSub')}</p>
    <div class="row admin-only" style="margin-bottom:18px">
      <label class="switch"><input type="checkbox" id="sk-on" ${sk.enabled ? 'checked' : ''}><span></span></label><span>${t('sk.enabled')}</span>
    </div>
    <div class="field"><label>${t('sk.instr')}</label><textarea id="sk-instr" style="min-height:320px" spellcheck="false" ${isAdmin() ? '' : 'readonly'}>${esc(sk.instructions)}</textarea></div>
    <div class="field" ${id === 'audio' ? 'hidden' : ''}><label>${t('sk.art')}</label><textarea id="sk-art" style="min-height:80px" spellcheck="false" ${isAdmin() ? '' : 'readonly'}>${esc(sk.art || '')}</textarea></div>
    <div class="row admin-only" style="margin-bottom:22px">
      <button class="btn primary" id="sk-save">${t('save')}</button>
      <button class="btn" id="sk-reset">${t('cn.default')}</button>
      <a class="btn" href="/api/skills/${id}/zip" download>⬇ ${t('sk.zip')}</a>
    </div>
    <p class="label">${t('sk.reads')}</p>
    <div class="two">
      <div><b>📘 ${t('sk.examples', { n: ctx.totals.examples })}</b>${list(ctx.examples, (e) => `<li>${esc(e.title)} <span class="mono">${esc(e.file)}</span></li>`)}</div>
      <div><b>📦 ${t('sk.os', { n: num(ctx.totals.opensource) })}</b>${list(ctx.opensource, (r) => `<li>${esc(r.title)}${r.stars ? ` <span class="mono">★ ${r.stars}</span>` : ''}</li>`)}</div>
    </div>
    <b style="display:block;margin-top:14px">🎬 ${t('sk.res', { n: num(ctx.totals.resources) })}</b>
    ${list(ctx.resources.slice(0, 12), (r) => `<li>${esc(r.title)} <span class="mono">${esc(typeLabel(r.type))}</span>${r.notes ? ' 📝' : ''}</li>`)}
    <p class="label">SKILL.md</p>
    <div class="code"><pre>${esc(sk.skillMd)}</pre></div>`);
  if (!isAdmin()) return;
  $('#sk-on').onchange = async (e) => { await api('/skills/' + id, { method: 'PUT', body: { enabled: e.target.checked } }); toast(t('toast.saved')); };
  $('#sk-save').onclick = async () => { await api('/skills/' + id, { method: 'PUT', body: { instructions: $('#sk-instr').value, art: $('#sk-art').value } }); toast(t('toast.saved')); closeModal(); transition(renderSkills); };
  $('#sk-reset').onclick = () => {
    $('#sk-instr').value = sk.defaultInstructions;
    $('#sk-art').value = sk.defaultArt || '';
    $('#sk-instr').animate([{ background: 'rgba(124,58,237,.25)' }, { background: 'transparent' }], { duration: 700 });
  };
}

// ---------- Prompts : tu écris en vrac, l'IA (Groq) en fait un prompt détaillé pour Claude + Rovex ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Mode partagé en http : pas d'API presse-papiers, on passe par une zone de texte.
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  document.body.append(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

let BOOST = null; // dernier résultat affiché

function boostResult(b) {
  return `<div class="panel boost-out" data-spot id="pb-result">
    <div class="section-head" style="margin-bottom:12px"><h3 style="margin:0">🚀 ${t('pb.result')}</h3>
      <div class="row"><button class="btn primary" data-send="desktop">🚀 ${t('pb.send')}</button><button class="btn" id="pb-copy">${t('pb.copy')}</button><button class="btn" id="pb-again">↻ ${t('pb.again')}</button></div></div>
    <p class="sub" style="font-size:13px;margin:0 0 10px">${t('pb.from')} « ${esc(b.input.length > 140 ? b.input.slice(0, 137) + '…' : b.input)} »</p>
    <textarea class="input boost-text" id="pb-out" spellcheck="false">${esc(b.output)}</textarea>
    <div class="row pb-send-row"><span class="sub" style="font-size:13px">${t('pb.sendOther')}</span><button class="btn small" data-send="code">⌨️ Claude Code</button><button class="btn small" data-send="web">🌐 claude.ai</button></div>
    <p class="sub" style="font-size:13px;margin:10px 0 0">${t('pb.paste')}</p>
  </div>`;
}

async function renderPrompts() {
  const g = await api('/gen/boost');
  const q = g.quota;
  const left = q && q.ok ? (q.unlimited ? t('st.unlimited') : t('st.left', { n: Math.max(0, q.limit - q.used), limit: q.limit })) : '';
  view.innerHTML = `
    ${pageHead(t('pb.eyebrow'), t('pb.title'), t('pb.sub'))}
    <div class="flow">
      ${[['✍️', 'pb.f1'], ['🧠', 'pb.f2'], ['🚀', 'pb.f3']].map(([ico, k], i) => `<div class="flow-step" style="--i:${i}"><span>${ico}</span><b>${t(k + 't')}</b><small>${t(k)}</small></div>`).join('<i class="flow-arrow">→</i>')}
    </div>
    <div class="panel" data-spot>
      <h3>✨ ${t('pb.boxTitle')} ${g.available ? `<span class="st validated">${t('st.ready')}</span>${left ? ` <span class="st review">${esc(left)}</span>` : ''}` : `<span class="st draft">${t('st.off')}</span>`}</h3>
      ${g.available ? `<form id="pb-form">
        <textarea class="input boost-in" id="pb-in" required placeholder="${t('pb.ph')}"></textarea>
        <div class="row" style="margin-top:12px">
          <select class="select" id="pb-cat" style="padding:11px 14px"><option value="">${t('pb.autoCat')}</option>${catOptions('')}</select>
          <button class="btn primary" id="pb-go">✨ ${t('pb.go')}</button>
          <span class="sub" style="font-size:13px">${t('pb.hint')}</span>
        </div>
      </form>` : `<p>${t(isAdmin() ? 'pb.setup' : 'st.soon')}</p>`}
    </div>
    <div id="pb-slot">${BOOST ? boostResult(BOOST) : ''}</div>
    ${isAdmin() && g.available ? `<div class="panel" data-spot><h3>👑 ${t('pb.limTitle')}</h3><p>${t('pb.limText')}</p>
      <div class="row"><label class="lim">${t('pb.limLbl')} <input class="input" id="pb-lim" type="number" min="0" max="1000" value="${q && q.limit != null ? q.limit : 50}"></label>
      <button class="btn primary" id="pb-lim-save">${t('save')}</button></div></div>` : ''}
    ${g.history.length ? `<div class="section-head"><h2>${t('pb.history')}</h2></div>
      <div class="boost-list">${g.history.map((h, i) => `<button class="boost-item" data-boost="${i}" style="--i:${i}"><b>${esc(h.input)}</b><small>${h.category ? esc(cat(h.category).label) + ' · ' : ''}${ago(h.at)}</small></button>`).join('')}</div>` : ''}`;
  stagger($('.boost-list') || view);
  const bindResult = () => {
    const c = $('#pb-copy');
    if (!c) return;
    c.onclick = async () => {
      const ok = await copyText($('#pb-out').value);
      if (!ok) return toast(t('toast.copyFail'), true);
      c.textContent = '✓ ' + t('copied');
      setTimeout(() => (c.textContent = t('pb.copy')), 1600);
      toast(t('pb.copied'));
    };
    // Envoi à Claude : le prompt est copié, puis Claude s'ouvre avec une nouvelle conversation pré-remplie.
    $$('[data-send]').forEach((b) => b.onclick = async () => {
      const text = $('#pb-out').value;
      await copyText(text);
      try {
        const r = await api('/claude/send', { method: 'POST', body: { text, target: b.dataset.send } });
        if (!r.opened) window.location.href = r.link;
        toast(t(r.plain ? 'pb.sentPaste' : r.truncated ? 'pb.sentLong' : 'pb.sent'));
      } catch (err) { toast(err.message, true); }
    });
    $('#pb-again').onclick = () => {
      $('#pb-in').value = BOOST.input;
      $('#pb-cat').value = BOOST.category || '';
      $('#pb-form').requestSubmit();
    };
  };
  const show = (b) => {
    BOOST = b;
    $('#pb-slot').innerHTML = boostResult(b);
    bindResult();
    $('#pb-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  bindResult();
  const form = $('#pb-form');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#pb-go');
    const input = $('#pb-in').value.trim();
    if (!input) return;
    btn.disabled = true;
    btn.textContent = '⏳ ' + t('pb.working');
    try {
      const out = await api('/gen/enhance', { method: 'POST', body: { text: input, category: $('#pb-cat').value || undefined } });
      BOOST = { input, output: out.text, category: $('#pb-cat').value };
      transition(renderPrompts);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = '✨ ' + t('pb.go');
    }
  };
  $$('[data-boost]').forEach((b) => b.onclick = () => show(g.history[Number(b.dataset.boost)]));
  const ls = $('#pb-lim-save');
  if (ls) ls.onclick = async () => {
    try { await api('/gen/limits', { method: 'PUT', body: { texts: $('#pb-lim').value } }); toast(t('toast.saved')); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------- Studio IA : Claude génère des images via Rovex (clé de l'admin, limite par ID et par jour) ----------
function genCard(r) {
  const c = cat(r.category);
  const kind = (r.tags || []).find((x) => ['icon', 'ui', 'thumbnail', 'texture', 'vfx', 'art'].includes(x)) || '';
  return `<div class="gen-card" data-spot>
    <div class="gen-media checker"><img src="/media/${esc(r.file)}" alt="" loading="lazy"></div>
    <div class="gen-meta"><span class="card-cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}${kind ? ' · ' + esc(t('st.k.' + kind)) : ''}</span>
      <b title="${esc(r.description)}">${esc(r.title)}</b>
      <div class="row"><a class="btn small" href="/media/${esc(r.file)}" download="${esc(r.file)}">⬇ ${t('st.download')}</a><button class="btn small danger" data-gendel="${r.id}">${t('delete')}</button></div>
    </div>
  </div>`;
}

function quotaText(q) {
  if (!q || !q.ok) return '';
  return q.unlimited ? t('st.unlimited') : t('st.left', { n: Math.max(0, q.limit - q.used), limit: q.limit });
}

async function renderStudio() {
  const g = await api('/gen');
  const q = g.quota && g.quota.image;
  view.innerHTML = `
    ${pageHead(t('st.eyebrow'), t('st.title'), t('st.sub'))}
    <div class="flow">
      ${[['💬', 'st.f1'], ['📚', 'st.f2'], ['🎨', 'st.f3'], ['📥', 'st.f4']].map(([ico, k], i) => `<div class="flow-step" style="--i:${i}"><span>${ico}</span><b>${t(k + 't')}</b><small>${t(k)}</small></div>`).join('<i class="flow-arrow">→</i>')}
    </div>
    <div class="panel" data-spot>
      <h3>🎨 ${t('st.imgTitle')} ${g.available ? `<span class="st validated">${t('st.ready')}</span>` : `<span class="st draft">${t('st.off')}</span>`}
        ${g.available && q ? `<span class="st review">${esc(quotaText(q))}</span>` : ''}</h3>
      ${g.available
        ? `<form id="gen-form" class="gen-form">
            <input class="input" id="gen-prompt" required placeholder="${t('st.phImg')}">
            <select class="select" id="gen-kind">${g.kinds.map((k) => `<option value="${k}">${t('st.k.' + k)}</option>`).join('')}</select>
            <select class="select" id="gen-cat"><option value="">${t('st.autoCat')}</option>${catOptions('')}</select>
            <select class="select" id="gen-count">${[1, 2, 3, 4].map((n) => `<option value="${n}">×${n}</option>`).join('')}</select>
            <button class="btn primary" id="gen-go">✨ ${t('st.generate')}</button>
          </form>
          <p class="sub" style="font-size:13px;margin:10px 0 0">${t('st.tryNote')}</p>`
        : `<p>${t(isAdmin() ? 'st.limSetup' : 'st.soon')}</p>`}
    </div>
    ${isAdmin() && g.available ? `<div class="panel" data-spot>
      <h3>👑 ${t('st.limTitle')}</h3>
      <p>${t('st.limText')}</p>
      <div class="row"><label class="lim">${t('st.limImg')} <input class="input" id="lim-img" type="number" min="0" max="1000" value="${q && q.limit != null ? q.limit : 20}"></label>
        <button class="btn primary" id="lim-save">${t('save')}</button></div>
    </div>` : ''}
    <div class="section-head"><h2>${t('st.gallery', { n: g.items.length })}</h2></div>
    <div class="gen-grid" id="gen-grid">${g.items.length ? g.items.map(genCard).join('') : `<div class="empty"><b>${t('st.none')}</b>${t('st.noneText')}</div>`}</div>`;
  const ls = $('#lim-save');
  if (ls) ls.onclick = async () => {
    try { await api('/gen/limits', { method: 'PUT', body: { images: $('#lim-img').value } }); toast(t('toast.saved')); }
    catch (e) { toast(e.message, true); }
  };
  const form = $('#gen-form');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#gen-go');
    btn.disabled = true;
    btn.textContent = '⏳ ' + t('st.working');
    try {
      const out = await api('/gen/image', { method: 'POST', body: { prompt: $('#gen-prompt').value, kind: $('#gen-kind').value, category: $('#gen-cat').value || undefined, count: Number($('#gen-count').value) } });
      toast(t('st.done', { n: out.items.length }));
      transition(renderStudio);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = '✨ ' + t('st.generate');
    }
  };
  $$('[data-gendel]').forEach((b) => b.onclick = async () => {
    if (!confirm(t('st.confirmDel'))) return;
    await api('/gen/' + b.dataset.gendel, { method: 'DELETE' });
    b.closest('.gen-card').remove();
  });
}

// ---------- Exemples d'apprentissage ----------
let EX_FILTER = '';
let EX_SEL = null;
const statusLabel = (s) => t('exs.' + s);

function highlight(code) {
  const re = /(--\[\[[\s\S]*?\]\]|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(local|function|end|if|then|else|elseif|return|for|in|do|while|repeat|until|not|and|or|true|false|nil|break|continue)\b|\b(\d+(?:\.\d+)?)\b/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'kw' : 'num';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

async function renderExamples() {
  const all = await api('/examples');
  const cats = [...new Set(all.map((e) => e.category))];
  const list = all.filter((e) => !EX_FILTER || e.category === EX_FILTER);
  if (!list.some((e) => e.id === EX_SEL)) EX_SEL = list[0] ? list[0].id : null;
  view.innerHTML = `
    ${pageHead(t('ex2.eyebrow'), t('nav.examples'), t('ex2.sub'),
      `<label class="btn admin-only">${t('ex2.import')}<input type="file" accept=".lua,.luau,.txt" hidden id="ex-import"></label>
       <button class="btn primary admin-only" id="ex-new">${PLUS}${t('ex2.new')}</button>`)}
    <div class="toolbar">
      <button class="chip solid ${!EX_FILTER ? 'on' : ''}" data-exf="">${t('lib.all')}</button>
      ${cats.map((c) => `<button class="chip solid ${EX_FILTER === c ? 'on' : ''}" data-exf="${c}">${esc(cat(c).label)}</button>`).join('')}
    </div>
    ${list.length ? `<div class="ex-layout">
      <div class="ex-list">${list.map((e) => `
        <button class="ex-item ${e.id === EX_SEL ? 'on' : ''}" data-ex="${e.id}">
          <span class="ex-top"><span><span class="dot" style="background:${cat(e.category).color}"></span>${esc(cat(e.category).label)}</span><span class="st ${e.status}">${statusLabel(e.status)}</span></span>
          <h4>${esc(e.title)}</h4><p>« ${esc(e.prompt)} »</p>
        </button>`).join('')}</div>
      <div class="panel ex-detail" id="ex-detail" data-spot></div>
    </div>` : `<div class="empty"><b>${t('ex2.none')}</b>${t('ex2.noneText')}</div>`}`;
  $$('[data-exf]').forEach((b) => b.onclick = () => { EX_FILTER = b.dataset.exf; transition(renderExamples); });
  $$('[data-ex]').forEach((b) => b.onclick = () => {
    EX_SEL = b.dataset.ex;
    $$('.ex-item').forEach((x) => x.classList.toggle('on', x === b));
    showExample(all.find((e) => e.id === EX_SEL), true);
  });
  if (isAdmin()) {
    $('#ex-new').onclick = () => editExample({});
    $('#ex-import').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      editExample({ filename: f.name, code: await f.text(), title: f.name.replace(/\.[^.]+$/, '') });
    };
  }
  if (EX_SEL) showExample(all.find((e) => e.id === EX_SEL));
}

function showExample(e, animate) {
  const box = $('#ex-detail');
  if (!box || !e) return;
  const c = cat(e.category);
  box.innerHTML = `
    <div class="ex-top"><span><span class="dot" style="background:${c.color}"></span>${esc(c.label)} · <span class="mono">${esc(e.filename)}</span></span><span class="st ${e.status}">${statusLabel(e.status)}</span></div>
    <h2>${esc(e.title)}</h2>
    <p class="label">${t('ex2.request')}</p>
    <div class="prompt">${esc(e.prompt)}</div>
    <p class="label">${t('ex2.answer')}</p>
    <div class="code"><div class="code-head"><span>${esc(e.filename)}</span><span class="row" style="gap:12px">${esc(e.language || 'Luau')}<button class="btn small ghost" data-copy="${esc(e.code)}">${t('copy')}</button></span></div><pre>${highlight(e.code)}</pre></div>
    ${e.why.length ? `<p class="label">${t('ex2.why')}</p><ul class="why">${e.why.map((w, i) => `<li style="--i:${i}">${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="ex-foot"><span>${e.sources ? t('ex2.source') + ' ' + esc(e.sources) : ''}</span>
      <span class="row admin-only"><button class="btn" id="ex-edit">${t('ex2.edit')}</button>
      ${e.status === 'validated' ? `<button class="btn" data-st="draft">${t('ex2.unvalidate')}</button>` : `<button class="btn primary" data-st="validated">${t('ex2.validate')}</button>`}</span></div>`;
  if (animate && !reduced) box.animate([{ opacity: 0, transform: 'translateX(18px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
  bindCopy(box);
  if (!isAdmin()) return;
  $('#ex-edit').onclick = () => editExample(e);
  $$('[data-st]', box).forEach((b) => b.onclick = async () => {
    await api('/examples/' + e.id, { method: 'PUT', body: { status: b.dataset.st } });
    toast(b.dataset.st === 'validated' ? t('ex2.validated') : t('toast.saved'));
    refreshStats();
    transition(renderExamples);
  });
}

function editExample(e) {
  const isNew = !e.id;
  openModal(`
    <h2 class="detail-title">${isNew ? t('ex2.new') : t('ex2.edit')}</h2>
    <form id="ex-form">
      <div class="field"><label>${t('f.title')}</label><input name="title" required value="${esc(e.title || '')}"></div>
      <div class="two">
        <div class="field"><label>${t('f.category')}</label><select name="category">${catOptions(e.category || 'scripting')}</select></div>
        <div class="field"><label>${t('ex2.status')}</label><select name="status">${['draft', 'review', 'validated'].map((s) => `<option value="${s}" ${s === (e.status || 'draft') ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>${t('ex2.request')}</label><input name="prompt" required value="${esc(e.prompt || '')}" placeholder="${t('ex2.requestPh')}"></div>
      <div class="field"><label>${t('ex2.file')}</label><input name="filename" value="${esc(e.filename || 'Script.lua')}"></div>
      <div class="field"><label>${t('ex2.answer')}</label><textarea name="code" style="min-height:240px" spellcheck="false">${esc(e.code || '')}</textarea></div>
      <div class="field"><label>${t('ex2.whyLines')}</label><textarea name="why">${esc((e.why || []).join('\n'))}</textarea></div>
      <div class="field"><label>${t('ex2.sources')}</label><input name="sources" value="${esc(e.sources || '')}"></div>
      <div class="row"><button class="btn primary">${t('save')}</button>${isNew ? '' : `<button class="btn danger" type="button" id="ex-del">${t('delete')}</button>`}</div>
    </form>`);
  $('#ex-form textarea[name=code]').onkeydown = (ev) => {
    if (ev.key !== 'Tab') return;
    ev.preventDefault();
    const ta = ev.target;
    ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end');
  };
  $('#ex-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    d.why = d.why.split('\n');
    const saved = await api(isNew ? '/examples' : '/examples/' + e.id, { method: isNew ? 'POST' : 'PUT', body: d });
    EX_SEL = saved.id;
    toast(t('toast.saved')); closeModal(); refreshStats(); transition(renderExamples);
  };
  if (!isNew) $('#ex-del').onclick = async () => {
    if (!confirm(t('detail.confirmDelete', { title: e.title }))) return;
    await api('/examples/' + e.id, { method: 'DELETE' });
    toast(t('toast.deleted')); closeModal(); refreshStats(); transition(renderExamples);
  };
}

// ---------- YouTube ----------
async function renderYoutube(params) {
  const q = params.get('q') || '';
  view.innerHTML = `
    ${pageHead('YOUTUBE', t('nav.youtube'), t('yt.sub'))}
    <form class="toolbar" id="yt-form">
      <input class="input" id="yt-q" style="flex:1;min-width:220px" placeholder="${t('yt.ph')}" value="${esc(q)}">
      <button class="btn primary">${t('search')}</button>
    </form>
    <div class="row">${['roblox vfx tutorial', 'roblox scripting tutorial', 'moon animator 2', 'roblox ui design', 'roblox gfx blender', 'roblox combat system', 'roblox datastore', 'roblox building tips'].map((x) => `<button class="chip" data-s="${x}">${x}</button>`).join('')}</div>
    <div id="yt-res"></div>`;
  $('#yt-form').onsubmit = (e) => { e.preventDefault(); location.hash = '#/youtube?q=' + encodeURIComponent($('#yt-q').value); };
  $$('[data-s]').forEach((b) => b.onclick = () => { location.hash = '#/youtube?q=' + encodeURIComponent(b.dataset.s); });
  if (q) loadYoutube(q);
}

async function loadYoutube(q) {
  const out = $('#yt-res');
  out.innerHTML = `<div class="grid">${'<div class="skel"></div>'.repeat(8)}</div>`;
  try {
    const res = await api('/youtube?q=' + encodeURIComponent(q));
    if (!res.length) { out.innerHTML = `<div class="empty"><b>${t('yt.none')}</b>${t('yt.noneText')}</div>`; return; }
    out.innerHTML = `<div class="row admin-only" style="margin-bottom:16px"><button class="btn primary" id="add-all">${PLUS}${t('yt.addAll', { n: res.length })}</button></div><div class="grid stagger">${res.map((v, i) => `
      <article class="card" style="--c:#A78BFA;--i:${Math.min(i, 14)}">
        <div class="thumb"><img src="${esc(v.thumbnail)}" alt="" loading="lazy"><span class="badge">${esc(v.duration || typeLabel('video'))}</span></div>
        <div class="card-body"><h3>${esc(v.title)}</h3><div class="meta">${esc(v.author)}${v.views ? ' · ' + esc(v.views) : ''}</div>
        <div class="row"><button class="btn small primary admin-only" data-add="${i}">${t('add')}</button><a class="btn small" href="${esc(v.url)}" target="_blank">${t('view')}</a></div></div>
      </article>`).join('')}</div>`;
    const addOne = async (b) => {
      if (b.disabled) return;
      b.disabled = true;
      const v = res[b.dataset.add];
      await api('/resources', { method: 'POST', body: { ...v, type: 'video', category: guess(v.title + ' ' + q) } });
      b.textContent = '✓ ' + t('added');
    };
    $$('[data-add]').forEach((b) => b.onclick = async () => { await addOne(b); refreshStats(); });
    if ($('#add-all')) $('#add-all').onclick = async (e) => {
      e.currentTarget.disabled = true;
      for (const b of $$('[data-add]')) await addOne(b);
      toast(t('yt.addedN', { n: res.length })); refreshStats();
    };
  } catch (e) { out.innerHTML = `<div class="panel"><h3>${t('err.generic')}</h3><p>${esc(e.message)}</p></div>`; }
}

function guess(s) {
  const rules = [['vfx', /vfx|particle|beam|trail|slash|aura|explosion/i], ['animation', /anim|moon|rig|r6|r15/i], ['gui', /\bui\b|gui|hud|menu|shop/i], ['gfx', /gfx|thumbnail|icon|render/i], ['modeling', /blender|model|mesh|texture/i], ['building', /build|map|terrain|light/i], ['audio', /sound|audio|music/i], ['design', /design|monetiz|popular/i]];
  for (const [c, re] of rules) if (re.test(s)) return c;
  return 'scripting';
}

// ---------- Chaînes ----------
async function renderChannels(params) {
  const q = params.get('q') || '';
  const { total, followed, items } = await api('/channels?' + new URLSearchParams({ q, limit: 120 }));
  view.innerHTML = `
    ${pageHead('YOUTUBE', t('ch.title'), t('ch.sub', { n: followed, num: num(followed) }))}
    <div class="explore-cards admin-only">
      <div class="panel" data-spot>
        <h3>🔎 ${t('ch.findTitle')}</h3>
        <p>${t('ch.findText')}</p>
        <div class="row"><button class="btn primary" data-crawl='{"mode":"channels","scope":"dev","intensity":"normal","syncAfter":true}'>${t('ch.findGo')}</button></div>
      </div>
      <div class="panel" data-spot>
        <h3>🔄 ${t('ch.syncTitle')}</h3>
        <p>${t('ch.syncText')}</p>
        <div class="row"><button class="btn primary" data-crawl='{"mode":"sync"}'>${t('ch.syncGo')}</button></div>
      </div>
    </div>
    <div id="job"></div>
    <form class="row admin-only" id="ch-form">
      <input class="input" id="ch-h" style="flex:2;min-width:200px" placeholder="${t('ch.addPh')}">
      <select class="select" id="ch-c" style="flex:1;min-width:150px;padding:11px 14px"><option value="">${t('autoCategory')}</option>${catOptions()}</select>
      <button class="btn primary">${t('ch.link')}</button>
    </form>
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
  let tm;
  $('#ch-q').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { location.hash = '#/channels' + (e.target.value ? '?q=' + encodeURIComponent(e.target.value) : ''); }, 300); };
  if (q) { const i = $('#ch-q'); setTimeout(() => { i.focus(); i.setSelectionRange(q.length, q.length); }, 250); }
  $('#ch-grid').onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    e.preventDefault();
    await api('/channels/' + del.dataset.del, { method: 'DELETE' });
    const el = del.closest('.chc');
    el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.6)' }], { duration: 300 }).onfinish = () => el.remove();
    refreshStats();
  };
  $('#more').onclick = async () => {
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
const SOURCES = [['youtube', 'YouTube'], ['devforum', 'DevForum Roblox'], ['reddit', 'Reddit'], ['github', 'GitHub'], ['store', 'Creator Store']];
async function renderExplore() {
  const cats = META.categories.filter((c) => c.id !== 'gameplay').map((c) => cat(c.id));
  view.innerHTML = `
    ${pageHead(t('ex.eyebrow'), t('ex.title'), t('ex.sub'))}
    <div class="explore-grid">
      <div class="panel" data-spot>
        <h3>${t('ex.cats')}</h3>
        <div class="row" id="ex-cats">${cats.map((c) => `<label class="chip on"><input type="checkbox" value="${c.id}" checked hidden><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</label>`).join('')}</div>
        <h3 style="margin-top:22px">${t('ex.sources')}</h3>
        <div class="row" id="ex-src">${SOURCES.slice(0, 3).map(([v, l]) => `<label class="chip on"><input type="checkbox" value="${v}" checked hidden>${l}</label>`).join('')}</div>
        <h3 style="margin-top:22px">${t('ex.intensity')}</h3>
        <div class="int-grid" id="ex-int">
          ${[['rapide', 'fast'], ['normal', 'normal'], ['massif', 'massive']].map(([v, k]) => `<label class="int ${v === 'normal' ? 'on' : ''}"><input type="radio" name="int" value="${v}" ${v === 'normal' ? 'checked' : ''} hidden><b>${t('ex.' + k + 'T')}</b><small>${t('ex.' + k + 'D')}</small></label>`).join('')}
        </div>
        <div class="row" style="margin-top:24px;padding-top:20px;border-top:1px solid var(--line)"><button class="btn primary" id="ex-go">${BOLT}${t('ex.go')}</button>
        <a class="btn" href="#/channels">${t('ch.findTitle')}</a></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:24px;min-width:0">
        <div id="job"><div class="panel"><h3>${t('ex.idle')}</h3><p>${t('ex.idleText')}</p></div></div>
        <div class="panel" data-spot><h3>🛡️ ${t('qf.title')}</h3><p>${t('qf.text')}</p><button class="btn" id="qf-clean">${t('qf.clean')}</button></div>
      </div>
    </div>
    <div class="panel" data-spot>
      <div class="row" style="justify-content:space-between;align-items:center">
        <div style="flex:1;min-width:260px"><h3>📦 ${t('os.title')}</h3><p style="margin:0">${t('os.text')}</p></div>
        <div class="row" id="os-src">${[['github', 'GitHub'], ['devforum', t('os.forum')], ['store', 'Creator Store']].map(([v, l]) => `<label class="chip on"><input type="checkbox" value="${v}" checked hidden>${l}</label>`).join('')}
        <button class="btn primary" id="os-go">${t('os.go')}</button><a class="btn" href="#/opensource">${t('os2.see')}</a></div>
      </div>
    </div>`;
  const toggle = (l) => l.onclick = (e) => {
    e.preventDefault();
    const i = $('input', l); i.checked = !i.checked;
    l.classList.toggle('on', i.checked);
  };
  $$('#ex-cats label, #ex-src label, #os-src label').forEach(toggle);
  $$('#ex-int label').forEach((l) => l.onclick = (e) => {
    e.preventDefault();
    $$('#ex-int label').forEach((x) => { x.classList.remove('on'); $('input', x).checked = false; });
    l.classList.add('on'); $('input', l).checked = true;
  });
  $('#ex-go').onclick = () => startCrawl({
    mode: 'explore',
    categories: $$('#ex-cats input:checked').map((i) => i.value),
    sources: $$('#ex-src input:checked').map((i) => i.value),
    intensity: $('#ex-int input:checked').value,
  });
  $('#qf-clean').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const r = await api('/clean', { method: 'POST' });
    toast(t('qf.done', { n: r.resources, c: r.channels }));
    refreshStats();
    e.currentTarget.disabled = false;
  };
  $('#os-go').onclick = () => startCrawl({ mode: 'opensource', sources: $$('#os-src input:checked').map((i) => i.value), intensity: $('#ex-int input:checked').value });
  watchJob();
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
  if (!isAdmin()) return;
  let st;
  try { st = await api('/crawl'); } catch { return; }
  const side = $('#side-job');
  side.hidden = !st.running;
  const pct = Math.round((st.step / Math.max(st.steps, 1)) * 100);
  if (st.running) side.innerHTML = `<a href="#/explore"><span class="spinner"></span><span>${esc(modeLabel(st.mode))}<small>${t('job.side', { added: num(st.added), channels: num(st.channels) })}</small></span></a><div class="bar" style="margin-top:10px"><i style="width:${pct}%"></i></div>`;
  const box = $('#job');
  if (box && (st.running || st.finishedAt)) {
    const prog = Object.entries(st.progress || {});
    const fresh = !box.querySelector('.job');
    box.innerHTML = `<div class="panel job" data-spot>
      <div class="section-head"><h3 style="margin:0">${st.running ? '' : '✅ '}${esc(modeLabel(st.mode))}</h3><span class="live">${st.running ? `<span class="pulse"></span>${t('job.running')}` : t('job.finished')}</span></div>
      ${(prog.length ? prog : [['all', { done: st.step, total: st.steps }]]).map(([src, p]) => {
        const v = st.running ? Math.round((p.done / Math.max(p.total, 1)) * 100) : 100;
        return `<div class="prog"><div class="top">${esc((SOURCES.find((s) => s[0] === src) || [0, t('job.steps')])[1])}<span>${v}%</span></div><div class="bar"><i style="width:${v}%"></i></div></div>`;
      }).join('')}
      <div class="job-stats">
        <div><b>${num(st.added)}</b><span>${t('job.added')}</span></div>
        <div><b>${num(st.channels)}</b><span>${t('job.channels')}</span></div>
        <div><b>${num(st.rejected)}</b><span>${t('job.rejected')}</span></div>
        <div><b>${st.errors}</b><span>${t('job.errors')}</span></div>
      </div>
      ${st.current ? `<p style="margin:14px 0 0;font-size:13px">${t('job.current')} ${esc(current(st.current))}</p>` : ''}
      <div class="log">${(st.log || []).slice(0, 25).map((l) => `<div class="${l.err ? 'err' : ''}">${esc(logLine(l))}</div>`).join('')}</div>
      ${st.running ? `<div class="row" style="margin-top:16px"><button class="btn danger" id="job-stop">${t('job.stop')}</button></div>` : ''}
    </div>`;
    if (fresh && !reduced) box.firstElementChild.animate([{ opacity: 0, transform: 'translateY(16px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    if ($('#job-stop')) $('#job-stop').onclick = () => api('/crawl/stop', { method: 'POST' });
  }
  if (st.running) jobTimer = setTimeout(() => { watchJob(); refreshStats(); }, 1500);
  else if (box && box.dataset.wasRunning) refreshStats();
  if (box) box.dataset.wasRunning = st.running ? '1' : '';
}

// ---------- Connexion Claude ----------
async function refreshMcp() {
  try { MCP = await api('/mcp'); } catch { return; }
  const pill = $('#mcp-pill');
  pill.classList.toggle('off', !MCP.connected);
  $('#mcp-pill-text').textContent = MCP.connected ? t('cn.pillOn') : t('cn.pillOff');
}

async function renderConnect() {
  await refreshMcp();
  const m = MCP;
  // Claude Desktop n'accepte que des serveurs lancés par une commande (pas d'adresse http dans son fichier).
  const cfg = JSON.stringify({ mcpServers: { 'rovex-hub': m.desktopEntry || { command: 'node', args: [m.mcpPath] } } }, null, 2);
  view.innerHTML = `
    ${pageHead(t('cn.eyebrow'), t('nav.connect'), t('cn.sub'), `
      <div class="server-card ${m.connected ? '' : 'off'}"><span class="pulse"></span><div><b>${m.connected ? t('cn.statusOn') : t('cn.statusOff')}</b><small>${esc(m.url.replace('http://', ''))}${m.lastCall ? ' · ' + ago(m.lastCall) : ''}</small></div>
      <button class="btn small" data-copy="${esc(m.url)}">${t('copy')}</button></div>`)}
    <a class="panel cn-chat" href="#/chat" data-spot><span>💬</span><div><b>${t('cn.chatTitle')}</b><p>${t('cn.chatText')}</p></div>${ARROW}</a>
    <div class="claude-apps" id="claude-apps"><div class="skel" style="min-height:150px"></div><div class="skel" style="min-height:150px"></div></div>
    <div class="steps">
      <div class="panel" data-spot><span class="num">1</span><h3>${t('cn.s1')}</h3><p>${t('cn.s1t')}</p></div>
      <div class="panel" data-spot><span class="num">2</span><h3>${t('cn.s2')}</h3><p>${t('cn.s2t')}</p>
        <div class="codebox"><code>${esc(cfg)}</code></div>
        <div class="row" style="margin-top:12px"><button class="btn" data-copy="${esc(cfg)}">${t('cn.copyCfg')}</button><button class="btn" data-copy="claude mcp add --transport http rovex-hub ${esc(m.url)}">${t('cn.copyCmd')}</button></div></div>
      <div class="panel" data-spot><span class="num">3</span><h3>${t('cn.s3')}</h3><p>${t('cn.s3t')}</p>
        <div class="field"><label>${t('cn.testLabel')}</label><input id="cn-q" value="${esc(t('cn.testQ'))}"></div>
        <button class="btn primary" id="cn-test">${t('cn.testGo')}</button><div class="test-out" id="cn-out"></div></div>
    </div>
    <div class="two-col admin-only">
      <div class="panel" data-spot><h3>${t('cn.tools')}</h3><p>${t('cn.toolsT')}</p>
        ${(m.tools || []).map((x) => `<div class="tool"><div><b>${esc(x.name)}</b><small>${esc(t('tool.' + x.name))}</small></div>
          <label class="switch"><input type="checkbox" data-tool="${x.name}" ${x.enabled ? 'checked' : ''}><span></span></label></div>`).join('')}
      </div>
      <div class="panel" data-spot><h3>${t('cn.instr')}</h3><p>${t('cn.instrT')}</p>
        <textarea class="input big" id="cn-instr" spellcheck="false">${esc(m.instructions || '')}</textarea>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="cn-save">${t('save')}</button><button class="btn" id="cn-default">${t('cn.default')}</button></div>
      </div>
    </div>
    <div class="panel" data-spot><div class="section-head"><h3 style="margin:0">${t('act.title')}</h3><span class="live"><span class="pulse"></span>${t('act.live')}</span></div><div id="cn-log">${activityList(m.log)}</div></div>`;
  bindCopy(view);
  loadClaudeApps();
  $$('[data-tool]').forEach((i) => i.onchange = async () => {
    await api('/mcp', { method: 'PUT', body: { tools: { [i.dataset.tool]: i.checked } } });
    toast(t('toast.saved'));
  });
  $('#cn-save').onclick = async () => { await api('/mcp', { method: 'PUT', body: { instructions: $('#cn-instr').value } }); toast(t('toast.saved')); };
  $('#cn-default').onclick = () => {
    $('#cn-instr').value = m.defaultInstructions;
    $('#cn-instr').animate([{ background: 'rgba(124,58,237,.25)' }, { background: 'transparent' }], { duration: 700 });
  };
  $('#cn-test').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await api('/mcp/test', { method: 'POST', body: { query: $('#cn-q').value } });
      const rows = [...r.examples.map((x) => [t('term.example') + ' · ' + statusLabel(x.status), x.title]), ...r.results.map((x) => [typeLabel(x.type), x.title])];
      $('#cn-out').innerHTML = rows.length ? rows.map(([a, b2], i) => `<div style="--i:${i}"><b style="font-weight:600">${esc(b2)}</b><span>${esc(a)}</span></div>`).join('') : `<p class="sub">${t('yt.none')}</p>`;
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  };
}

// ---------- Blender : l'add-on « Claude Blender MCP » ; Rovex donne ses outils à Claude (modélisation, animations R6) ----------
async function renderBlender() {
  const d = await api('/blender');
  const state = !d.enabled ? 'off' : d.connected ? 'ready' : 'error';
  const ideas = ['bl.idea1', 'bl.idea2', 'bl.idea3', 'bl.idea4'];
  view.innerHTML = `
    ${pageHead('MCP', 'Blender', t('bl.sub'))}
    <div class="panel rs-status ${state}" data-spot>
      <span class="pulse"></span>
      <div class="rs-main"><b>${t('bl.state.' + state)}</b>
        <small>${state === 'ready' ? esc(['Blender ' + (d.blender || ''), d.file ? d.file.split(/[\\/]/).pop() : t('bl.noFile'), 'add-on ' + (d.addon || '')].join(' · ')) + ' · ' + t('rs.nTools', { n: d.tools })
          : state === 'error' ? esc(d.error) : t('bl.offText')}</small></div>
      <label class="switch"><input type="checkbox" id="bl-on" ${d.enabled ? 'checked' : ''}><span></span></label>
      <button class="btn" id="bl-retry" ${d.enabled ? '' : 'hidden'}>${t('rs.retry')}</button>
    </div>
    <div class="steps bl-steps">
      <div class="panel" data-spot><span class="num">1</span><h3>${t('bl.s1')}</h3><p>${t('bl.s1t')}</p><button class="btn primary" id="bl-addon">📦 ${t('bl.showAddon')}</button><div id="bl-addon-out"></div></div>
      <div class="panel" data-spot><span class="num">2</span><h3>${t('bl.s2')}</h3><p>${t('bl.s2t')}</p></div>
      <div class="panel" data-spot><span class="num">3</span><h3>${t('bl.s3')}</h3><p>${t('bl.s3t')}</p></div>
      <div class="panel" data-spot><span class="num">4</span><h3>${t('bl.s4')}</h3><p>${t('bl.s4t')}</p></div>
    </div>
    <div class="two-col">
      <div class="panel" data-spot><h3>💬 ${t('bl.askTitle')}</h3><p>${t('bl.askText')}</p>
        <div class="chips">${ideas.map((k) => `<button class="chip" data-copy="${esc(t(k))}">${esc(t(k))}</button>`).join('')}</div></div>
      <div class="panel" data-spot><h3>⚙️ ${t('bl.cfgTitle')}</h3><p>${t('bl.cfgText')}</p>
        <form class="row" id="bl-cfg"><input class="input" id="bl-port" inputmode="numeric" style="max-width:140px" value="${esc(d.port)}"><button class="btn">${t('save')}</button></form>
        <p class="sub" style="font-size:13px;margin-top:12px">${t('bl.exports')}</p>${codeBox(d.exportDir)}</div>
    </div>`;
  bindCopy(view);
  $('#bl-on').onchange = async (e) => { await api('/blender', { method: 'PUT', body: { enabled: e.target.checked } }).catch((er) => toast(er.message, true)); renderBlender(); };
  $('#bl-retry').onclick = () => renderBlender();
  $('#bl-cfg').onsubmit = async (e) => { e.preventDefault(); await api('/blender', { method: 'PUT', body: { port: $('#bl-port').value } }).catch((er) => toast(er.message, true)); renderBlender(); };
  $('#bl-addon').onclick = async () => {
    const r = await api('/blender/addon', { method: 'POST' }).catch((er) => { toast(er.message, true); return null; });
    if (r && !r.shown) { $('#bl-addon-out').innerHTML = codeBox(r.path); bindCopy($('#bl-addon-out')); }
    else if (r) toast(t('bl.addonShown'));
  };
}

// ---------- Roblox Studio : Rovex se branche sur le serveur MCP de Studio et repasse ses outils à Claude ----------
async function renderRobloxStudio() {
  const d = await api('/robloxstudio');
  const st = d.status || {};
  const state = d.enabled ? st.state : 'off';
  const steps = [['rs.s1', 'rs.s1t'], ['rs.s2', 'rs.s2t'], ['rs.s3', 'rs.s3t']];
  view.innerHTML = `
    ${pageHead('MCP', t('nav.rstudio'), t('rs.sub'))}
    <div class="panel rs-status ${esc(state)}" data-spot>
      <span class="pulse"></span>
      <div class="rs-main"><b>${t('rs.state.' + state)}</b>
        <small>${state === 'ready' ? esc([st.server && st.server.name, st.server && st.server.version].filter(Boolean).join(' ')) + ' · ' + t('rs.nTools', { n: st.tools.length }) : state === 'error' ? esc(st.error) : t('rs.offText')}</small></div>
      <label class="switch"><input type="checkbox" id="rs-on" ${d.enabled ? 'checked' : ''}><span></span></label>
      <button class="btn" id="rs-retry" ${d.enabled ? '' : 'hidden'}>${t('rs.retry')}</button>
    </div>
    <div class="steps">${steps.map(([h, p], i) => `<div class="panel" data-spot><span class="num">${i + 1}</span><h3>${t(h)}</h3><p>${t(p)}</p></div>`).join('')}</div>
    <div class="two-col">
      <div class="panel" data-spot><h3>${t('rs.cfgTitle')}</h3><p>${t('rs.cfgText')}</p>
        <textarea class="input big" id="rs-cfg" spellcheck="false" style="min-height:190px;font-family:var(--mono);font-size:12.5px">${esc(d.config)}</textarea>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="rs-save">${t('rs.save')}</button><button class="btn" id="rs-default">${t('cn.default')}</button></div></div>
      <div class="panel" data-spot><h3>${t('rs.toolsTitle')}</h3><p>${t('rs.toolsText', { prefix: esc(d.prefix) })}</p>
        ${st.tools && st.tools.length ? st.tools.map((x) => `<div class="tool"><div><b>${esc(d.prefix + x.name)}</b><small>${esc(x.description.slice(0, 160))}</small></div></div>`).join('') : `<p class="sub" style="font-size:13px">${t('rs.noTools')}</p>`}</div>
    </div>
    <div class="panel" data-spot><h3>🖼️ ${t('rs.ocTitle')}</h3><p>${t('rs.ocText')}</p>
      <form class="row" id="rs-oc">
        <input class="input" id="rs-oc-key" type="password" style="flex:2;min-width:220px" placeholder="${d.hasOpenCloud ? t('rs.ocSaved') : t('rs.ocKey')}" autocomplete="off">
        <select class="select" id="rs-oc-type"><option value="user" ${d.creatorType === 'user' ? 'selected' : ''}>${t('rs.ocUser')}</option><option value="group" ${d.creatorType === 'group' ? 'selected' : ''}>${t('rs.ocGroup')}</option></select>
        <input class="input" id="rs-oc-id" style="flex:1;min-width:140px" inputmode="numeric" placeholder="${t('rs.ocId')}" value="${esc(d.creatorId)}">
        <button class="btn primary">${t('save')}</button>
      </form></div>`;
  const run = async (b, fn) => {
    b.disabled = true;
    const old = b.innerHTML;
    b.innerHTML = `<span class="spinner"></span>${t('rs.connecting')}`;
    try { await fn(); transition(renderRobloxStudio); } catch (e) { toast(e.message, true); b.disabled = false; b.innerHTML = old; }
  };
  $('#rs-save').onclick = (e) => run(e.currentTarget, () => api('/robloxstudio', { method: 'PUT', body: { config: $('#rs-cfg').value, enabled: true } }));
  $('#rs-retry').onclick = (e) => run(e.currentTarget, () => api('/robloxstudio/restart', { method: 'POST' }));
  $('#rs-on').onchange = (e) => run($('#rs-retry'), () => api('/robloxstudio', { method: 'PUT', body: { enabled: e.target.checked } }));
  $('#rs-default').onclick = () => { $('#rs-cfg').value = d.defaultConfig; };
  $('#rs-oc').onsubmit = async (e) => {
    e.preventDefault();
    const body = { creatorType: $('#rs-oc-type').value, creatorId: $('#rs-oc-id').value };
    if ($('#rs-oc-key').value.trim()) body.openCloudKey = $('#rs-oc-key').value.trim();
    try { await api('/robloxstudio', { method: 'PUT', body }); toast(t('toast.saved')); $('#rs-oc-key').value = ''; } catch (err) { toast(err.message, true); }
  };
  const dot = $('#rs-dot');
  if (dot) dot.hidden = state !== 'ready';
  refreshPlaces(true);
}

// ---------- La place ouverte dans Studio : scripts et réglages du jeu ----------
// Les Studio connectés apparaissent dans le menu, sous « Roblox Studio ».
let placesWatch = null;
let PLACES = [];
async function refreshPlaces(force) {
  const d = await api('/place/studios' + (force ? '?force=1' : '')).catch(() => null);
  PLACES = (d && d.studios) || [];
  const box = $('#side-places');
  if (!box) return;
  box.hidden = !PLACES.length;
  const cur = new URLSearchParams(location.hash.split('?')[1] || '').get('s') || '';
  $('#side-places-list').innerHTML = PLACES.map((p) => `<a href="#/place?s=${encodeURIComponent(p.id)}" data-s="${esc(p.id)}" class="${location.hash.startsWith('#/place') && cur === p.id ? 'active' : ''}"><span class="dot" style="background:#34d399;border-radius:50%"></span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span></a>`).join('');
}
function watchPlaces() {
  if (placesWatch) return;
  refreshPlaces();
  placesWatch = setInterval(refreshPlaces, 20e3);
}

const SCRIPT_ICON = { Script: '📜', LocalScript: '💻', ModuleScript: '📦' };
const segKey = (segs) => JSON.stringify(segs);

async function renderPlace(params) {
  const s = params.get('s') || '';
  const tab = params.get('tab') === 'values' ? 'values' : 'scripts';
  const p = PLACES.find((x) => x.id === s) || { name: 'Roblox Studio' };
  const link = (t2) => `#/place?s=${encodeURIComponent(s)}${t2 === 'values' ? '&tab=values' : ''}`;
  view.innerHTML = `
    ${pageHead('ROBLOX STUDIO', esc(p.name), t('pl.sub'), `<button class="btn" id="pl-refresh">↻ ${t('pl.refresh')}</button>`)}
    <div class="tabs pl-tabs"><a href="${link('scripts')}" class="${tab === 'scripts' ? 'active' : ''}">📜 ${t('pl.scripts')}</a><a href="${link('values')}" class="${tab === 'values' ? 'active' : ''}">🎛️ ${t('pl.values')}</a></div>
    <div id="pl-body"><div class="skel" style="min-height:320px"></div></div>`;
  $('#pl-refresh').onclick = () => transition(() => renderPlace(params));
  try {
    if (tab === 'values') await placeValues(s, params);
    else await placeScripts(s, params);
  } catch (e) {
    $('#pl-body').innerHTML = `<div class="empty"><b>${t('pl.error')}</b>${esc(e.message)}<br><a href="#/robloxstudio">${t('nav.rstudio')} →</a></div>`;
  }
}

async function placeScripts(s, params) {
  const d = await api('/place/scripts?s=' + encodeURIComponent(s));
  const list = d.scripts || [];
  if (d.name && $('.page-head .h1')) $('.page-head .h1').textContent = d.name;
  const body = $('#pl-body');
  body.innerHTML = `
    <div class="pl-grid">
      <div class="panel pl-list">
        <input class="input" id="pl-q" placeholder="${t('pl.search', { n: list.length })}">
        <div id="pl-items"></div>
      </div>
      <div class="panel pl-editor" id="pl-editor"><div class="empty" style="margin:0"><b>${t('pl.pick')}</b>${t('pl.pickText')}</div></div>
    </div>`;
  let open = null; // { item, source, dirty }
  const draw = () => {
    const q = $('#pl-q').value.trim().toLowerCase();
    const items = list.map((x, i) => ({ ...x, i })).filter((x) => !q || x.full.toLowerCase().includes(q));
    const groups = {};
    for (const x of items) (groups[x.path[0][0]] = groups[x.path[0][0]] || []).push(x);
    $('#pl-items').innerHTML = Object.entries(groups).map(([svc, xs]) => `<div class="pl-group"><small>${esc(svc)} · ${xs.length}</small>${xs.map((x) => `
      <button class="pl-item ${open && segKey(open.item.path) === segKey(x.path) ? 'active' : ''}" data-i="${x.i}" title="${esc(x.full)}">
        <span>${SCRIPT_ICON[x.class] || '📄'}</span><span class="pl-name"><b>${esc(x.path[x.path.length - 1][0])}</b><small>${esc(x.path.slice(1, -1).map((z) => z[0]).join(' › '))}</small></span>
      </button>`).join('')}</div>`).join('') || `<p class="sub" style="font-size:13px">${t('pl.none')}</p>`;
    $$('[data-i]', $('#pl-items')).forEach((b) => b.onclick = () => openScript(list[Number(b.dataset.i)]));
  };
  const openScript = async (item) => {
    if (open && open.dirty && !confirm(t('pl.discard'))) return;
    const ed = $('#pl-editor');
    ed.innerHTML = '<div class="skel" style="min-height:300px"></div>';
    try {
      const r = await api('/place/read', { method: 'POST', body: { s, path: item.path } });
      open = { item, source: r.source, dirty: false };
      draw();
      ed.innerHTML = `
        <div class="pl-head"><div><b>${SCRIPT_ICON[r.class] || '📄'} ${esc(item.path[item.path.length - 1][0])}</b><small class="mono">${esc(r.full)}</small></div>
          <div class="row"><span class="pl-dirty" id="pl-dirty" hidden>● ${t('pl.unsaved')}</span><button class="btn" id="pl-reload">↻</button><button class="btn primary" id="pl-save">${t('pl.save')}</button></div></div>
        <div class="code-ed"><pre class="gutter" id="pl-gutter"></pre><textarea id="pl-code" spellcheck="false" wrap="off"></textarea></div>`;
      const ta = $('#pl-code');
      ta.value = r.source;
      const gutter = () => { $('#pl-gutter').textContent = Array.from({ length: ta.value.split('\n').length }, (_, i) => i + 1).join('\n'); };
      gutter();
      ta.onscroll = () => { $('#pl-gutter').scrollTop = ta.scrollTop; };
      ta.oninput = () => { open.dirty = ta.value !== open.source; $('#pl-dirty').hidden = !open.dirty; gutter(); };
      ta.onkeydown = (e) => {
        if (e.key === 'Tab') { e.preventDefault(); const a = ta.selectionStart; ta.setRangeText('\t', a, ta.selectionEnd, 'end'); ta.oninput(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      };
      const save = async () => {
        const b = $('#pl-save');
        b.disabled = true;
        try {
          await api('/place/write', { method: 'POST', body: { s, path: item.path, source: ta.value } });
          open.source = ta.value; open.dirty = false; $('#pl-dirty').hidden = true;
          toast(t('pl.saved'));
        } catch (e) { toast(e.message, true); }
        b.disabled = false;
      };
      $('#pl-save').onclick = save;
      $('#pl-reload').onclick = () => { open.dirty = false; openScript(item); };
    } catch (e) { ed.innerHTML = `<div class="empty" style="margin:0"><b>${t('pl.error')}</b>${esc(e.message)}</div>`; }
  };
  $('#pl-q').oninput = draw;
  draw();
  const want = params.get('path');
  if (want) { const it = list.find((x) => x.full === want); if (it) openScript(it); }
}

async function placeValues(s) {
  const d = await api('/place/values?s=' + encodeURIComponent(s) + '&force=1');
  if (d.name && $('.page-head .h1')) $('.page-head .h1').textContent = d.name;
  const body = $('#pl-body');
  const total = d.groups.reduce((n, g) => n + g.values.length, 0);
  body.innerHTML = `
    <div class="row" style="margin-bottom:16px"><input class="input" id="pv-q" style="flex:1;min-width:220px" placeholder="${t('pv.search', { n: total })}"></div>
    <div id="pv-groups"></div>`;
  const input = (v, gi, vi) => {
    const id = `pv-${gi}-${vi}`;
    if (v.kind === 'bool') return `<label class="switch"><input type="checkbox" id="${id}" ${v.value ? 'checked' : ''}><span></span></label>`;
    return `<input class="input pv-in" id="${id}" type="${v.kind === 'number' ? 'number' : 'text'}" step="any" value="${esc(String(v.value))}">`;
  };
  const draw = () => {
    const q = $('#pv-q').value.trim().toLowerCase();
    $('#pv-groups').innerHTML = d.groups.map((g, gi) => {
      const rows = g.values.map((v, vi) => ({ v, vi })).filter(({ v }) => !q || `${g.full} ${v.group} ${v.name} ${v.comment}`.toLowerCase().includes(q));
      if (!rows.length) return '';
      return `<div class="panel pv-card" data-spot>
        <div class="pl-head"><div><b>${SCRIPT_ICON[g.class] || '📄'} ${esc(g.path[g.path.length - 1][0])}</b><small class="mono">${esc(g.full)}</small></div>
          <a class="btn small" href="#/place?s=${encodeURIComponent(s)}&path=${encodeURIComponent(g.full)}">${t('pv.code')}</a></div>
        ${rows.map(({ v, vi }) => `<div class="pv-row">
          <div class="pv-label"><b>${v.group ? `<span>${esc(v.group)} › </span>` : ''}${esc(v.name)}</b>${v.comment ? `<small>${esc(v.comment)}</small>` : ''}<small class="mono">${t('pv.line', { n: v.line })}</small></div>
          ${input(v, gi, vi)}<button class="btn small primary" data-save="${gi}-${vi}" hidden>${t('save')}</button></div>`).join('')}
      </div>`;
    }).join('') || `<div class="empty"><b>${t('pv.none')}</b>${t('pv.noneText')}</div>`;
    $$('.pv-row').forEach((row) => {
      const btn = row.querySelector('[data-save]');
      const [gi, vi] = btn.dataset.save.split('-').map(Number);
      const v = d.groups[gi].values[vi];
      const el = row.querySelector(`#pv-${gi}-${vi}`);
      const val = () => (v.kind === 'bool' ? el.checked : v.kind === 'number' ? Number(el.value) : el.value);
      const save = async () => {
        btn.disabled = true;
        try {
          const r = await api('/place/value', { method: 'POST', body: { s, path: d.groups[gi].path, line: v.line, text: v.text, kind: v.kind, value: val() } });
          v.text = r.text; v.value = val(); btn.hidden = true;
          toast(t('pv.saved', { name: v.name }));
        } catch (e) { toast(e.message, true); }
        btn.disabled = false;
      };
      if (v.kind === 'bool') el.onchange = save;
      else {
        el.oninput = () => { btn.hidden = String(val()) === String(v.value); };
        el.onkeydown = (e) => { if (e.key === 'Enter') save(); };
        btn.onclick = save;
      }
    });
  };
  $('#pv-q').oninput = draw;
  draw();
}

// ---------- Textures VFX : les IDs Roblox des textures de particules (Claude les récupère par find_vfx_textures) ----------
let TEX = null;
async function renderTextures(params) {
  TEX = await api('/textures');
  const { items, groups } = TEX;
  const KIND = { particle: '✨', flipbook: '🎞️', decal: '🖼️', texture: '🧩' };
  view.innerHTML = `
    ${pageHead('VFX', t('nav.textures'), t('tx.sub', { n: num(items.length) }), `<button class="btn primary admin-only" id="tx-add">+ ${t('tx.add')}</button>`)}
    <div class="row tx-tools">
      <input class="input" id="tx-q" style="flex:1;min-width:220px" placeholder="${t('tx.search')}" value="${esc(params.get('q') || '')}">
      <select class="select" id="tx-kind"><option value="">${t('tx.allKinds')}</option>${['particle', 'flipbook', 'decal', 'texture'].map((k) => `<option value="${k}">${KIND[k]} ${t('tx.kind.' + k)}</option>`).join('')}</select>
      <select class="select" id="tx-grid"><option value="">${t('tx.allGrids')}</option>${['2x2', '4x4', '8x8'].map((g) => `<option value="${g}">Flipbook ${g}</option>`).join('')}</select>
    </div>
    <div class="chips tx-chips"><button class="chip on" data-g="">${t('tx.all')} · ${num(items.length)}</button>${groups.map((g) => `<button class="chip" data-g="${esc(g.id)}">${KIND[g.kind] || ''} ${esc(g.label)} · ${g.count}</button>`).join('')}</div>
    <p class="sub" style="font-size:13px;margin:6px 0 14px">${t('tx.hint')}</p>
    <div class="tx-grid" id="tx-grid-box"></div>
    <div class="row" style="justify-content:center;margin-top:18px"><button class="btn" id="tx-more" hidden>${t('tx.more')}</button></div>`;
  let group = params.get('g') || '';
  let shown = 0;
  let list = [];
  const filter = () => {
    const q = $('#tx-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const kind = $('#tx-kind').value;
    const grid = $('#tx-grid').value;
    return items.filter((x) => (!group || x.groupId === group) && (!kind || x.kind === kind) && (!grid || x.flipbook === grid)
      && q.every((w) => `${x.id} ${x.name} ${x.variant || ''} ${x.group} ${x.tip || ''}`.toLowerCase().replace(/_/g, ' ').includes(w)));
  };
  const card = (x) => `<button class="tx-card" data-id="${x.id}" title="rbxassetid://${x.id}">
      <span class="tx-img" data-thumb="${x.id}" data-grid="${x.flipbook || ''}" ${x.thumb ? `style="background-image:url('${esc(x.thumb)}')"` : ''}></span>
      ${x.flipbook ? `<span class="tx-badge">${x.flipbook}</span>` : ''}
      <b>${esc(x.name || t('tx.noName'))}${x.variant ? ` <small>${esc(x.variant)}</small>` : ''}</b>
      <span class="mono">${x.id}</span>${x.tip ? `<small class="tx-tip">${esc(x.tip)}</small>` : ''}
    </button>`;
  const loadThumbs = async (ids) => {
    for (let i = 0; i < ids.length; i += 200) {
      const map = await api('/textures/thumbs', { method: 'POST', body: { ids: ids.slice(i, i + 200) } }).catch(() => ({}));
      for (const [id, url] of Object.entries(map)) {
        const it = items.find((x) => x.id === id);
        if (it) it.thumb = url;
        $$(`[data-thumb="${id}"]`).forEach((el) => { if (url) el.style.backgroundImage = `url('${url}')`; else el.classList.add('none'); });
      }
    }
  };
  const more = () => {
    const next = list.slice(shown, shown + 120);
    $('#tx-grid-box').insertAdjacentHTML('beforeend', next.map(card).join(''));
    shown += next.length;
    $('#tx-more').hidden = shown >= list.length;
    loadThumbs(next.filter((x) => !x.thumb).map((x) => x.id));
  };
  const draw = () => {
    list = filter();
    shown = 0;
    $('#tx-grid-box').innerHTML = list.length ? '' : `<div class="empty"><b>${t('tx.none')}</b></div>`;
    more();
  };
  $$('.tx-chips .chip').forEach((b) => { b.classList.toggle('on', b.dataset.g === group); b.onclick = () => { group = b.dataset.g; $$('.tx-chips .chip').forEach((c) => c.classList.toggle('on', c === b)); draw(); }; });
  $('#tx-q').oninput = draw;
  $('#tx-kind').onchange = draw;
  $('#tx-grid').onchange = draw;
  $('#tx-more').onclick = more;
  // Clic : copie l'ID ; survol d'un flipbook : l'animation joue image par image.
  $('#tx-grid-box').onclick = async (e) => {
    const c = e.target.closest('.tx-card');
    if (!c) return;
    if (await copyText('rbxassetid://' + c.dataset.id)) toast(t('tx.copied', { id: c.dataset.id }));
  };
  let anim = null;
  $('#tx-grid-box').onmouseover = (e) => {
    const img = e.target.closest('.tx-card') && e.target.closest('.tx-card').querySelector('.tx-img');
    if (!img || img === (anim && anim.el) || !img.dataset.grid || !img.style.backgroundImage) return;
    if (anim) { clearInterval(anim.timer); anim.el.classList.remove('tx-anim'); anim.el.style.backgroundPosition = ''; anim.el.style.backgroundSize = ''; }
    const n = Number(img.dataset.grid[0]);
    let f = 0;
    img.classList.add('tx-anim');
    img.style.backgroundSize = `${n * 100}% ${n * 100}%`;
    const step = () => { const x = f % n; const y = Math.floor(f / n) % n; img.style.backgroundPosition = `${(x / (n - 1)) * 100}% ${(y / (n - 1)) * 100}%`; f = (f + 1) % (n * n); };
    step();
    anim = { el: img, timer: setInterval(step, 70) };
  };
  $('#tx-grid-box').onmouseleave = () => { if (anim) { clearInterval(anim.timer); anim.el.classList.remove('tx-anim'); anim.el.style.backgroundPosition = ''; anim.el.style.backgroundSize = ''; anim = null; } };
  const add = $('#tx-add');
  if (add) add.onclick = () => {
    openModal(`<h2 class="detail-title">${t('tx.add')}</h2><p class="sub" style="margin-bottom:14px">${t('tx.addText')}</p>
      <div class="field"><label>${t('tx.section')}</label><input class="input" id="tx-sec" placeholder="${t('tx.sectionPh')}"></div>
      <div class="field"><label>IDs</label><textarea class="input big" id="tx-text" spellcheck="false" style="min-height:220px;font-family:var(--mono);font-size:12.5px" placeholder="* 13800702582 — ToonBird (Misc) · 4x4&#10;4x4 : 14106379216, 14117822736&#10;Wind : 10352559573, 6863041721"></textarea></div>
      <button class="btn primary" id="tx-save">${t('tx.import')}</button>`);
    $('#tx-save').onclick = async () => {
      try {
        const r = await api('/textures/import', { method: 'POST', body: { text: $('#tx-text').value, section: $('#tx-sec').value } });
        toast(t('tx.imported', { n: r.added }));
        closeModal();
        TEX = null;
        transition(() => renderTextures(params));
      } catch (err) { toast(err.message, true); }
    };
  };
  draw();
}

// Petit Markdown sûr (tout est échappé) : titres, listes, citations, tableaux, code, gras, liens.
function mdInline(raw) {
  return String(raw).split(/(`[^`\n]+`)/g).map((part, i) => (i % 2 ? `<code>${esc(part.slice(1, -1))}</code>` : esc(part)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'))).join('');
}
function md(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  const LIST = /^\s*([-*+]|\d+[.)])\s+/;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = l.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const code = buf.join('\n');
      const lua = /^(lua|luau)?$/i.test(fence[1]);
      out.push(`<div class="code md-code"><div class="md-code-bar"><span>${esc(fence[1] || 'code')}</span><button class="btn small" data-copy="${esc(code)}">${t('copy')}</button></div><pre>${lua ? highlight(code) : esc(code)}</pre></div>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length + 2}>${mdInline(h[2])}</h${h[1].length + 2}>`); i++; continue; }
    if (LIST.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(lines[i++].replace(LIST, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${mdInline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${q.map(mdInline).join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^[\s|:-]+$/.test(r)).map(cells);
      out.push(`<div class="md-table"><table><thead><tr>${(body.shift() || []).map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|>|\|)/.test(lines[i]) && !LIST.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    out.push(`<p>${para.map(mdInline).join('<br>')}</p>`);
  }
  return out.join('');
}

// ---------- Chat Claude : ta conversation Claude Desktop (ton abonnement), reliée à Rovex par MCP ----------
// Claude écoute le chat avec l'outil chat_listen et répond avec chat_reply : on discute ici, Claude Desktop reste réduit.
const AG = { claude: { online: false, working: false, waiting: 0 }, messages: [], es: null };

function agClose() {
  if (AG.es) { AG.es.close(); AG.es = null; }
}

function agMsgHtml(m) {
  if (m.role === 'user') return `<div class="msg user" data-m="${m.id}"><div class="bubble">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
  if (m.role === 'claude') return `<div class="msg bot" data-m="${m.id}"><span class="bot-av"><img src="logo.png" alt=""></span><div class="bot-body"><div class="md">${md(m.text)}</div></div></div>`;
  if (m.role === 'status') return `<div class="chat-step" data-m="${m.id}"><i class="tool-st ok"></i>${esc(m.text)}</div>`;
  return '';
}

// Ouvre Claude Desktop sur une nouvelle conversation avec la consigne déjà écrite (aussi copiée).
async function agConnect() {
  try {
    const { text } = await api('/agents/prompt');
    await copyText(text);
    const r = await api('/claude/send', { method: 'POST', body: { text, target: 'desktop' } });
    if (!r.opened) window.location.href = r.link;
    toast(t('ag.desktopOpened'));
  } catch (e) { toast(e.message, true); }
}

function agHead() {
  const c = AG.claude;
  const st = c.online ? (c.working ? 'working' : 'on') : 'off';
  const pill = $('#ag-pill');
  if (pill) { pill.className = 'ag-pill ' + st; pill.textContent = t(st === 'working' ? 'ag.working' : st === 'on' ? 'ag.listening' : 'ag.notConnected'); }
  const con = $('#ag-connect');
  if (con) con.hidden = c.online;
  const bar = $('#ag-offbar');
  if (bar) bar.hidden = c.online || !AG.messages.length;
  const typing = $('#ag-typing');
  if (typing) typing.hidden = !(c.online && c.working);
  const dot = $('#chat-dot');
  if (dot) dot.hidden = !c.online;
}

// Panneau de droite : les étapes annoncées par Claude et les outils Rovex utilisés.
function agSide() {
  const box = $('#chat-steps');
  if (!box) return;
  const steps = AG.messages.filter((m) => m.role === 'status').slice(-12).reverse();
  const tools = (MCP.log || []).slice(0, 8);
  box.innerHTML = `${steps.map((m, i) => `<div class="side-step act ${i || !AG.claude.working ? 'ok' : ''}"><i class="tool-st"></i><div><b>${esc(m.text)}</b><small>${ago(m.t)}</small></div></div>`).join('')}
    ${tools.length ? `<h4 class="side-sub">${t('ag.tools')}</h4>${tools.map((l) => `<div class="side-step rtool ok"><i class="tool-st"></i><div><b>${esc(l.tool)}</b><small>${esc([l.category, l.q].filter(Boolean).join(' · '))} · ${ago(l.t)}</small></div></div>`).join('')}` : ''}
    ${!steps.length && !tools.length ? `<p class="muted small chat-side-empty">${t('ag.sideEmpty')}</p>` : ''}`;
}

const agNear = () => { const b = $('#chat-msgs'); return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 160; };
const agScroll = () => { const b = $('#chat-msgs'); if (b) b.scrollTop = b.scrollHeight; };

function agWelcome() {
  return `<div class="ag-setup">
    <span class="logo big"><img src="logo.png" alt=""></span>
    <h2>${t('ag.setupTitle')}</h2><p class="muted">${t('ag.setupSub3')}</p>
    <div class="ag-steps">
      <div class="ag-step"><span class="num">1</span><div><b>${t('ag.c1')}</b><p>${t('ag.c1t')}</p><button class="btn primary" data-connect>${t('ag.connectDesktop')}</button></div></div>
      <div class="ag-step"><span class="num">2</span><div><b>${t('ag.c2')}</b><p>${t('ag.c2t')}</p></div></div>
      <div class="ag-step"><span class="num">3</span><div><b>${t('ag.c3')}</b><p>${t('ag.c3t')}</p></div></div>
    </div>
  </div>`;
}

function agThread() {
  const box = $('#chat-msgs');
  if (!box) return;
  box.innerHTML = (AG.messages.length ? AG.messages.map(agMsgHtml).join('') : agWelcome())
    + `<div class="msg bot" id="ag-typing" hidden><span class="bot-av"><img src="logo.png" alt=""></span><div class="bot-body"><div class="typing"><i></i><i></i><i></i></div></div></div>`;
  bindCopy(box);
  $$('[data-connect]', box).forEach((b) => b.onclick = agConnect);
  agHead();
  agSide();
  agScroll();
}

function agListen() {
  agClose();
  const es = new EventSource('/api/agents/events');
  AG.es = es;
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'state') {
      AG.claude = ev.claude;
      agHead();
      agSide();
    } else if (ev.type === 'msg') {
      AG.messages.push(ev.msg);
      const box = $('#chat-msgs');
      if (!box) return;
      const stick = agNear();
      if ($('.ag-setup', box)) return agThread();
      $('#ag-typing').insertAdjacentHTML('beforebegin', agMsgHtml(ev.msg));
      bindCopy(box);
      if (stick || ev.msg.role === 'user') agScroll();
      agHead();
      agSide();
    } else if (ev.type === 'reset') {
      AG.messages = [];
      agThread();
    }
  };
}

async function agSend() {
  const ta = $('#chat-text');
  const text = ta.value.trim();
  if (!text) return;
  $('#chat-send').disabled = true;
  try {
    await api('/agents/send', { method: 'POST', body: { text } });
    ta.value = '';
    ta.style.height = '';
  } catch (e) { toast(e.message, true); }
  $('#chat-send').disabled = false;
}

async function renderChat() {
  document.body.classList.add('chat-mode');
  const v = await api('/agents');
  AG.claude = v.claude;
  AG.messages = v.messages;
  view.innerHTML = `
    <div class="chat solo ${AG.hideSide ? 'no-side' : ''}" id="chat">
      <section class="chat-main">
        <div class="chat-head"><span class="bot-av"><img src="logo.png" alt=""></span><div><b>Claude</b><small>${t('ag.subtitle')}</small></div>
          <span class="ag-pill" id="ag-pill"></span>
          <button class="btn small primary" id="ag-connect">${t('ag.connectDesktop')}</button>
          <button class="icon-btn" id="ag-clear" title="${t('ag.clear')}"><svg class="line" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
          <button class="icon-btn" id="chat-side-btn" title="${t('ag.activity')}"><svg class="line" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg></button></div>
        <div class="chat-msgs" id="chat-msgs"></div>
        <div class="ag-offbar" id="ag-offbar" hidden>${t('ag.offbar')} <button class="btn small" data-connect>${t('ag.connectDesktop')}</button></div>
        <form class="chat-input" id="chat-form">
          <textarea id="chat-text" rows="1" placeholder="${t('ag.ph', { name: 'Claude' })}"></textarea>
          <div class="chat-input-row"><small class="muted">${t('ag.hint')}</small>
            <button class="btn primary chat-send" id="chat-send" title="${t('ag.send')}"><svg class="line" viewBox="0 0 24 24" style="stroke-width:2.4"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div>
        </form>
      </section>
      <aside class="chat-side">
        <h3>${t('ag.activity')}</h3>
        <p class="muted small">${t('ag.activitySub2')}</p>
        <div class="chat-steps" id="chat-steps"></div>
      </aside>
    </div>`;
  const ta = $('#chat-text');
  ta.oninput = () => { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 260) + 'px'; };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); agSend(); } };
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); agSend(); };
  $('#ag-connect').onclick = agConnect;
  $$('#ag-offbar [data-connect]').forEach((b) => b.onclick = agConnect);
  $('#ag-clear').onclick = async () => {
    if (!confirm(t('ag.clearAsk'))) return;
    await api('/agents/clear', { method: 'POST' }).catch((er) => toast(er.message, true));
  };
  $('#chat-side-btn').onclick = () => {
    if (innerWidth <= 1250) return $('#chat').classList.toggle('side-open');
    AG.hideSide = !AG.hideSide;
    $('#chat').classList.toggle('no-side', AG.hideSide);
  };
  agThread();
  agListen();
  ta.focus();
}

// ---------- Deux espaces : Création (skills, textures, prompts…) et Ressources (bibliothèque, open source…) ----------
const SPACES = {
  create: ['examples', 'textures', 'skills', 'prompts', 'studio', 'level', 'connect', 'robloxstudio', 'blender', 'place', 'dev'],
  resources: ['library', 'opensource', 'channels', 'youtube', 'favorites', 'explore'],
};
const spaceOf = (route) => Object.keys(SPACES).find((k) => SPACES[k].includes(route)) || null;
let SPACE = (() => { try { return localStorage.getItem('rovex-space') || 'create'; } catch { return 'create'; } })();
function applySpace(s) {
  SPACE = SPACES[s] ? s : 'create';
  try { localStorage.setItem('rovex-space', SPACE); } catch {}
  $$('#nav a').forEach((a) => { const sp = spaceOf(a.dataset.route); a.classList.toggle('other-space', Boolean(sp) && sp !== SPACE); });
  const cats = $('#side-cats');
  if (cats) cats.parentElement.classList.toggle('other-space', SPACE !== 'resources');
  const places = $('#side-places');
  if (places) places.classList.toggle('other-space', SPACE !== 'create');
  $$('#space-switch button').forEach((b) => b.classList.toggle('on', b.dataset.space === SPACE));
  moveSpacePill();
  movePill();
}
function moveSpacePill() {
  const b = $('#space-switch button.on');
  const pill = $('#sw-pill');
  if (!b || !pill) return;
  pill.style.width = b.offsetWidth + 'px';
  pill.style.transform = `translateX(${b.offsetLeft - 4}px)`;
}
$$('#space-switch button').forEach((b) => b.onclick = () => {
  const s = b.dataset.space;
  applySpace(s);
  const cur = (location.hash.slice(2).split('?')[0]) || 'home';
  const sp = spaceOf(cur);
  if (sp && sp !== s) location.hash = s === 'create' ? '#/skills' : '#/library';
});
window.addEventListener('resize', moveSpacePill);

// ---------- Personnaliser : thème, fond d'écran animé, police, CSS libre ----------
let CUSTOM = null;
let DEVMODE = false;
let devWatch = null;
function watchDev() {
  clearInterval(devWatch);
  if (!DEVMODE) return;
  devWatch = setInterval(async () => {
    const d = await api('/custom').catch(() => null);
    if (d && d.custom && JSON.stringify(d.custom) !== JSON.stringify(CUSTOM)) { CUSTOM = RovexTheme.merge(d.custom); RovexTheme.apply(CUSTOM); }
  }, 4000);
}
async function loadCustom() {
  const d = await api('/custom').catch(() => null);
  if (!d) return;
  DEVMODE = Boolean(d.devMode);
  document.body.classList.toggle('dev-on', DEVMODE);
  CUSTOM = RovexTheme.merge(d.custom || RovexTheme.cached() || {});
  RovexTheme.apply(CUSTOM);
  watchDev();
}
let customTimer = null;
function saveCustom(now) {
  RovexTheme.apply(CUSTOM);
  clearTimeout(customTimer);
  const go = () => api('/custom', { method: 'PUT', body: { custom: CUSTOM } }).catch((e) => toast(e.message, true));
  if (now) return go();
  customTimer = setTimeout(go, 500);
}

window.addEventListener('rovex-bg-error', () => toast(t('cu.videoError'), true));

async function renderCustom() {
  if (!CUSTOM) await loadCustom();
  CUSTOM = RovexTheme.merge(CUSTOM || {});
  const c = CUSTOM;
  const P = RovexTheme.PRESETS;
  const bgTypes = [['aurora', '🌌'], ['gradient', '🌈'], ['image', '🖼️'], ['video', '🎬'], ['none', '⬛']];
  const slider = (id, label, min, max, step, val, fmt) => `<label class="cu-slider"><span>${label} <b id="${id}-v">${fmt(val)}</b></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
  const color = (k, label) => `<label class="cu-color"><input type="color" data-color="${k}" value="${c[k] || (P[c.theme] || P.violet)[k === 'bgColor' ? 'bg' : k]}"><span>${label}</span>${c[k] ? `<button class="btn small" data-uncolor="${k}">${t('cu.auto')}</button>` : `<small>${t('cu.auto')}</small>`}</label>`;
  view.innerHTML = `
    ${pageHead('ROVEX HUB', t('nav.custom'), t('cu.sub'), `<button class="btn" id="cu-export">⬇ ${t('cu.export')}</button><label class="btn">⬆ ${t('cu.import')}<input type="file" id="cu-import" accept="application/json,.json" hidden></label><button class="btn danger" id="cu-reset">${t('cu.reset')}</button>`)}
    <div class="panel" data-spot><h3>🎨 ${t('cu.theme')}</h3>
      <div class="cu-themes">${Object.entries(P).map(([k, p]) => `<button class="cu-theme ${c.theme === k ? 'on' : ''}" data-theme="${k}" style="--a:${p.accent};--b:${p.accent2};--c:${p.aurora[1]};--bg:${p.bg}"><i></i><b>${esc(p.label)}</b></button>`).join('')}</div>
      <div class="cu-colors">${color('accent', t('cu.accent'))}${color('accent2', t('cu.accent2'))}${color('accent3', t('cu.accent3'))}${color('bgColor', t('cu.bgColor'))}</div>
    </div>
    <div class="panel" data-spot><h3>🖼️ ${t('cu.bg')}</h3><p>${t('cu.bgText')}</p>
      <div class="chips">${bgTypes.map(([k, ico]) => `<button class="chip ${c.bg.type === k ? 'on' : ''}" data-bg="${k}">${ico} ${t('cu.bg.' + k)}</button>`).join('')}</div>
      <div class="cu-media" ${['image', 'video'].includes(c.bg.type) ? '' : 'hidden'}>
        <div class="row" style="margin-top:14px">
          <label class="btn primary">⬆ ${t('cu.upload')}<input type="file" id="cu-file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm" hidden></label>
          <input class="input" id="cu-url" style="flex:1;min-width:220px" placeholder="${t('cu.urlPh')}" value="${esc(c.bg.src && !c.bg.src.startsWith('/media/') ? c.bg.src : '')}">
          <button class="btn" id="cu-url-ok">${t('cu.useUrl')}</button>
        </div>
        <p class="sub" style="font-size:12.5px;margin-top:8px">${c.bg.src ? esc(t('cu.current', { src: c.bg.src.split('/').pop().slice(0, 60) })) : t('cu.noFile')}</p>
        <div class="row"><select class="select" id="cu-fit"><option value="cover" ${c.bg.fit !== 'contain' ? 'selected' : ''}>${t('cu.fitCover')}</option><option value="contain" ${c.bg.fit === 'contain' ? 'selected' : ''}>${t('cu.fitContain')}</option></select></div>
      </div>
      <div class="cu-sliders">
        ${slider('cu-dim', t('cu.dim'), 0, 0.9, 0.05, c.bg.dim, (v) => Math.round(v * 100) + '%')}
        ${slider('cu-blur', t('cu.blur'), 0, 30, 1, c.bg.blur, (v) => v + 'px')}
        ${slider('cu-glass', t('cu.glass'), 0.2, 1, 0.02, c.glass, (v) => Math.round(v * 100) + '%')}
      </div>
    </div>
    <div class="panel" data-spot><h3>🔤 ${t('cu.text')}</h3>
      <div class="row"><select class="select" id="cu-font">${Object.entries(RovexTheme.FONTS).map(([k, f]) => `<option value="${k}" ${c.font === k ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
        <label class="switch"><input type="checkbox" id="cu-anim" ${c.animations !== false ? 'checked' : ''}><span></span></label><span>${t('cu.anim')}</span></div>
      <div class="cu-sliders">
        ${slider('cu-scale', t('cu.scale'), 0.85, 1.25, 0.05, c.scale, (v) => Math.round(v * 100) + '%')}
        ${slider('cu-radius', t('cu.radius'), 4, 30, 1, c.radius, (v) => v + 'px')}
      </div>
    </div>
    <div class="panel" data-spot><h3>🧩 ${t('cu.css')}</h3><p>${t('cu.cssText')}</p>
      <textarea class="input big" id="cu-css" spellcheck="false" style="min-height:160px;font-family:var(--mono);font-size:12.5px" placeholder=".sidebar { border-right-color: hotpink; }">${esc(c.css || '')}</textarea>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="cu-css-ok">${t('save')}</button></div>
    </div>`;
  const redraw = () => transition(renderCustom);
  $$('[data-theme]').forEach((b) => b.onclick = () => { Object.assign(c, { theme: b.dataset.theme, accent: '', accent2: '', accent3: '', bgColor: '' }); saveCustom(); redraw(); });
  $$('[data-color]').forEach((i) => i.oninput = () => { c[i.dataset.color] = i.value; saveCustom(); });
  $$('[data-uncolor]').forEach((b) => b.onclick = () => { c[b.dataset.uncolor] = ''; saveCustom(); redraw(); });
  $$('[data-bg]').forEach((b) => b.onclick = () => { c.bg.type = b.dataset.bg; saveCustom(); redraw(); });
  const sl = (id, fn) => { const el = $('#' + id); el.oninput = () => { fn(Number(el.value)); saveCustom(); }; };
  sl('cu-dim', (v) => { c.bg.dim = v; });
  sl('cu-blur', (v) => { c.bg.blur = v; });
  sl('cu-glass', (v) => { c.glass = v; });
  sl('cu-scale', (v) => { c.scale = v; });
  sl('cu-radius', (v) => { c.radius = v; });
  // Les valeurs affichées des curseurs.
  for (const [id, f] of [['cu-dim', (v) => Math.round(v * 100) + '%'], ['cu-blur', (v) => v + 'px'], ['cu-glass', (v) => Math.round(v * 100) + '%'], ['cu-scale', (v) => Math.round(v * 100) + '%'], ['cu-radius', (v) => v + 'px']]) {
    const el = $('#' + id);
    el.addEventListener('input', () => { $(`#${id}-v`).textContent = f(Number(el.value)); });
  }
  $('#cu-font').onchange = (e) => { c.font = e.target.value; saveCustom(); };
  $('#cu-anim').onchange = (e) => { c.animations = e.target.checked; saveCustom(); };
  const fit = $('#cu-fit');
  if (fit) fit.onchange = (e) => { c.bg.fit = e.target.value; saveCustom(); };
  const file = $('#cu-file');
  if (file) file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    const note = $('.cu-media .sub');
    try {
      // Envoi avec la progression affichée (une vidéo peut peser des centaines de Mo).
      const j = await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', '/api/custom/background');
        x.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
        x.setRequestHeader('X-File-Name', encodeURIComponent(f.name));
        x.upload.onprogress = (e) => { if (e.lengthComputable && note) note.textContent = t('cu.uploadingP', { p: Math.round((e.loaded / e.total) * 100) }); };
        x.onload = () => {
          let r = {};
          try { r = JSON.parse(x.responseText); } catch {}
          if (x.status >= 200 && x.status < 300) resolve(r);
          else reject(new Error(r.key && has('err.' + r.key) ? t('err.' + r.key) : r.error || 'Upload failed'));
        };
        x.onerror = () => reject(new Error(f.size > 1024 ** 3 ? t('err.bgTooBig') : t('err.generic')));
        x.send(f);
      });
      Object.assign(c.bg, { type: j.type, src: j.src });
      await saveCustom(true);
      toast(t('cu.uploaded'));
      redraw();
    } catch (e) { if (note) note.textContent = e.message; toast(e.message, true); }
  };
  const urlOk = $('#cu-url-ok');
  if (urlOk) urlOk.onclick = () => {
    const u = $('#cu-url').value.trim();
    if (!/^https?:\/\//i.test(u)) return toast(t('cu.badUrl'), true);
    c.bg.src = u;
    c.bg.type = /\.(mp4|webm)(\?|$)/i.test(u) ? 'video' : 'image';
    saveCustom(true);
    redraw();
  };
  $('#cu-css-ok').onclick = () => { c.css = $('#cu-css').value; saveCustom(true); toast(t('toast.saved')); };
  $('#cu-reset').onclick = async () => {
    if (!confirm(t('cu.resetAsk'))) return;
    CUSTOM = RovexTheme.merge({});
    await api('/custom', { method: 'PUT', body: { reset: true } });
    RovexTheme.apply(CUSTOM);
    redraw();
  };
  $('#cu-export').onclick = () => {
    const blob = new Blob([JSON.stringify({ rovexTheme: 1, ...c, bg: { ...c.bg, src: c.bg.src && c.bg.src.startsWith('/media/') ? '' : c.bg.src } }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'rovex-theme.json' });
    a.click();
  };
  $('#cu-import').onchange = async (e) => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      delete j.rovexTheme;
      CUSTOM = RovexTheme.merge(j);
      await saveCustom(true);
      redraw();
    } catch { toast(t('cu.badFile'), true); }
  };
}

// ---------- Mode développeur : modifier Rovex avec son Claude, à plusieurs ----------
const REPO = 'https://github.com/djylaneee-ship-it/Portfolio';
async function renderDev() {
  const v = await api('/version').catch(() => ({}));
  const cmds = `git clone ${REPO}.git\ncd Portfolio/roblox-dev-hub\nnpm install\nnpm run app`;
  const prompt = t('dev.prompt', { repo: REPO });
  view.innerHTML = `
    ${pageHead(t('dev.eyebrow'), t('nav.dev'), t('dev.sub', { v: esc(v.version || '?') }))}
    <div class="two-col">
      <div class="panel" data-spot><h3>⚡ ${t('dev.liveTitle')}</h3><p>${t('dev.liveText')}</p>
        <div class="row"><a class="btn primary" href="#/custom">🎨 ${t('nav.custom')}</a><a class="btn" href="#/connect">🔌 ${t('nav.connect')}</a></div></div>
      <div class="panel" data-spot><h3>🤝 ${t('dev.teamTitle')}</h3><p>${t('dev.teamText')}</p>
        <div class="row"><a class="btn" href="${REPO}/settings/access" target="_blank" rel="noopener">👥 ${t('dev.invite')}</a><a class="btn" href="${REPO}/pulls" target="_blank" rel="noopener">🔀 ${t('dev.prs')}</a></div></div>
    </div>
    <div class="steps">
      <div class="panel" data-spot><span class="num">1</span><h3>${t('dev.s1')}</h3><p>${t('dev.s1t')}</p>
        <div class="row"><button class="btn primary" id="dev-code">⌨️ ${t('dev.openCode')}</button><a class="btn" href="https://claude.ai/code" target="_blank" rel="noopener">🌐 ${t('dev.openWeb')}</a></div></div>
      <div class="panel" data-spot><span class="num">2</span><h3>${t('dev.s2')}</h3><p>${t('dev.s2t')}</p>
        <div class="codebox"><code>${esc(cmds.replace(/\\n/g, '\n'))}</code></div>
        <button class="btn" style="margin-top:10px" data-copy="${esc(cmds.replace(/\\n/g, '\n'))}">${t('copy')}</button></div>
      <div class="panel" data-spot><span class="num">3</span><h3>${t('dev.s3')}</h3><p>${t('dev.s3t')}</p></div>
    </div>
    <div class="panel" data-spot><h3>🧠 ${t('dev.promptTitle')}</h3><p>${t('dev.promptText')}</p>
      <textarea class="input big" id="dev-prompt" spellcheck="false" style="min-height:150px">${esc(prompt)}</textarea>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="dev-send">🚀 ${t('dev.sendCode')}</button><button class="btn" id="dev-copy">${t('copy')}</button></div></div>`;
  bindCopy(view);
  const send = async () => {
    const text = $('#dev-prompt').value;
    await copyText(text);
    const r = await api('/claude/send', { method: 'POST', body: { text, target: 'code' } }).catch((e) => toast(e.message, true));
    if (r && !r.opened) window.location.href = r.link;
    if (r) toast(t('dev.sent'));
  };
  $('#dev-code').onclick = send;
  $('#dev-send').onclick = send;
  $('#dev-copy').onclick = async () => { if (await copyText($('#dev-prompt').value)) toast(t('pb.copied')); };
}

// ---------- Niveau de Claude ----------
const BADGE_ICONS = { firstCall: '🔌', calls50: '⚡', calls500: '🚀', examples5: '📘', examples25: '📚', resources1k: '🗂️', resources10k: '🌌', allRounder: '🧭', master: '👑' };

// Anneau de progression (SVG) ; la valeur s'anime après l'insertion.
function ring(pct, inner, mini) {
  const r = mini ? 30 : 106;
  const size = mini ? 74 : 240;
  const c = 2 * Math.PI * r;
  return `<div class="ring ${mini ? 'mini' : ''}"><svg viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="lvgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C3AED"/><stop offset=".6" stop-color="#C084FC"/><stop offset="1" stop-color="#F0ABFC"/></linearGradient></defs>
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
    <circle class="val" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-ring="${c * (1 - Math.max(0, Math.min(100, pct)) / 100)}"/>
  </svg><div class="in">${inner}</div></div>`;
}
function animateBars(root) {
  requestAnimationFrame(() => setTimeout(() => {
    for (const el of $$('[data-ring]', root)) el.style.strokeDashoffset = el.dataset.ring;
    for (const el of $$('[data-w]', root)) el.style.width = el.dataset.w + '%';
  }, 120));
}

// Courbe d'XP sur les derniers jours.
function xpChart(history) {
  if (history.length < 2) return `<p class="sub" style="font-size:13.5px">${t('lv.chartEmpty')}</p>`;
  const W = 700, H = 190, P = 12;
  const max = Math.max(...history.map((h) => h.xp), 1);
  const pts = history.map((h, i) => [P + (i * (W - 2 * P)) / (history.length - 1), H - P - (h.xp / max) * (H - 2 * P)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="chartgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(167,139,250,.35)"/><stop offset="1" stop-color="rgba(167,139,250,0)"/></linearGradient></defs>
    <path class="area" d="${line} L ${last[0]} ${H} L ${pts[0][0]} ${H} Z"/><path class="line" d="${line}"/>
    <circle class="dot" cx="${last[0]}" cy="${last[1]}" r="6"/></svg>
    <div class="xpmeta"><span>${date(history[0].d)}</span><span>${date(history[history.length - 1].d)}</span></div>`;
}

async function renderLevel() {
  const lv = await api('/level');
  const cats = [...lv.categories].sort((a, b) => b.mastery - a.mastery);
  view.innerHTML = `
    ${pageHead(t('lv.eyebrow'), t('lv.title'), t('lv.sub'))}
    <section class="lv-hero" data-spot>
      ${ring(lv.progress, `<small>${t('lv.level')}</small><b>${lv.level}</b><span>${t('lvt.' + lv.title)}</span>`)}
      <div style="position:relative;z-index:1">
        <p class="eyebrow">${t('lv.understanding', { n: lv.overall })}</p>
        <h2 class="lv-title">${t('lvt.' + lv.title)} · ${t('lv.level')} ${lv.level}</h2>
        <p class="sub">${t('lv.desc', { strong: cat(lv.strongest).label, weak: cat(lv.weakest).label })}</p>
        <div class="xpbar"><i data-w="${lv.progress}"></i></div>
        <div class="xpmeta"><span><b data-count="${lv.xp}">0</b> XP</span><span>${t('lv.next', { n: num(lv.levelNext - lv.xp), level: lv.level + 1 })}</span></div>
        <p class="lv-note">${t('lv.note')}</p>
      </div>
    </section>
    <div class="stats">
      <div class="stat"><b data-count="${lv.totals.calls}">0</b><span>${t('lv.calls')}</span></div>
      <div class="stat"><b data-count="${lv.totals.examplesUsed}">0</b><span>${t('lv.examplesUsed')}</span></div>
      <div class="stat"><b data-count="${lv.totals.validated}">0</b><span>${t('stat.examples')}</span></div>
      <div class="stat"><b data-count="${lv.totals.resources}">0</b><span>${t('stat.resources')}</span></div>
      <div class="stat"><b data-count="${lv.overall}">0</b><span>${t('lv.overall')}</span></div>
    </div>
    <div class="two-col">
      <div class="panel" data-spot>
        <h3>${t('lv.mastery')}</h3><p>${t('lv.masteryT')}</p>
        <div class="mastery">${cats.map((c) => { const k = cat(c.id); return `
          <div class="mrow" style="--c:${k.color}"><span class="name"><span class="dot" style="background:${k.color}"></span>${esc(k.label)}</span>
            <div class="bar"><i data-w="${c.mastery}"></i></div><span class="pct">${c.mastery}%</span>
            <small>${t('lv.catDetail', { e: c.examples, r: num(c.resources), u: c.uses })}</small></div>`; }).join('')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:24px">
        <div class="panel" data-spot><h3>${t('lv.chart')}</h3>${xpChart(lv.history)}</div>
        <div class="panel" data-spot><h3>${t('lv.tips')}</h3><div class="tips">${lv.tips.map((x) => {
          const label = t('tip.' + x.k, { cat: x.p ? cat(x.p.cat).label : '' });
          const href = x.k === 'addExamples' ? '#/examples' : x.k === 'explore' ? '#/explore' : '#/connect';
          return isAdmin() ? `<a href="${href}">💡 <span>${label}</span></a>` : `<div>💡 <span>${label}</span></div>`;
        }).join('') || `<div>🏆 <span>${t('tip.none')}</span></div>`}</div></div>
      </div>
    </div>
    <div class="panel" data-spot><h3>${t('lv.badges')}</h3><p>${t('lv.badgesT', { n: lv.badges.filter((b) => b.done).length, total: lv.badges.length })}</p>
      <div class="badges">${lv.badges.map((b) => `<div class="bdg ${b.done ? 'done' : ''}"><span class="ico">${BADGE_ICONS[b.id]}</span><b>${t('bdg.' + b.id)}</b><small>${t('bdgd.' + b.id)}</small></div>`).join('')}</div>
    </div>`;
  animateBars(view);
  checkLevelUp(lv);
}

// Célébration quand le niveau a monté depuis la dernière visite.
function checkLevelUp(lv) {
  let seen = 0;
  try { seen = Number(localStorage.getItem('rovex-level')) || 0; localStorage.setItem('rovex-level', lv.level); } catch {}
  if (!seen || lv.level <= seen || reduced) return;
  const el = document.createElement('div');
  el.className = 'levelup';
  el.innerHTML = `<div class="box"><small>${t('lv.levelUp')}</small><h2>${t('lv.level')} ${lv.level}</h2><p>${t('lvt.' + lv.title)} · ${t('lv.understanding', { n: lv.overall })}</p></div>`;
  document.body.append(el);
  const colors = ['#A78BFA', '#F0ABFC', '#FCD34D', '#6EE7B7', '#7DD3FC', '#fff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    const a = Math.random() * Math.PI * 2;
    const d = 200 + Math.random() * 420;
    c.style.cssText = `background:${colors[i % colors.length]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--r:${Math.random() * 720}deg;animation-delay:${Math.random() * 150}ms`;
    el.append(c);
  }
  const close = () => { el.style.transition = 'opacity .4s'; el.style.opacity = 0; setTimeout(() => el.remove(), 400); };
  el.onclick = close;
  setTimeout(close, 4200);
}

// Claude Desktop / Claude Code détectés sur ce PC.
async function loadClaudeApps() {
  const box = $('#claude-apps');
  if (!box) return;
  let st;
  try { st = await api('/claude'); } catch (e) { box.innerHTML = ''; return; }
  const d = st.desktop;
  const c = st.code;
  const state = (on, txt) => `<span class="state ${on ? 'on' : ''}"><span class="pulse"></span>${txt}</span>`;
  // « Ajouté » = la config contient Rovex ; « Actif » = Claude a vraiment lancé Rovex (poignée de main MCP).
  const seen = (cl) => (cl ? ' · ' + t('cl.lastSeen', { when: ago(cl.lastSeen) }) : '');
  const dOn = d.linked && d.client && d.client.alive;
  const cOn = c.linked && c.client && c.client.alive;
  box.innerHTML = `
    <div class="panel app-card" data-spot><span class="ico">🖥️</span><div style="flex:1">
      <h3>Claude Desktop</h3>
      ${!d.installed ? state(false, t('cl.notFound')) : d.outdated ? `<span class="state warn"><span class="pulse"></span>${t('cl.broken')}</span>` : dOn ? state(true, t('cl.active') + seen(d.client)) : d.linked ? `<span class="state warn"><span class="pulse"></span>${t('cl.added')}</span>` : state(false, t('cl.notLinked'))}
      <p>${!d.installed ? t('cl.desktopMissing') : d.outdated ? t('cl.brokenText') : dOn ? t('cl.activeText') : d.linked ? t('cl.restart') : t('cl.desktopFound')}</p>
      <div class="row">${d.installed ? (d.linked ? `<button class="btn" id="cl-unlink">${t('cl.unlink')}</button>` : `<button class="btn primary" id="cl-link">${t('cl.link')}</button>`) : '<a class="btn" href="https://claude.ai/download" target="_blank">' + t('cl.download') + '</a>'}
        ${d.linked && (!dOn || d.outdated) ? `<button class="btn ${d.outdated ? 'primary' : ''}" id="cl-repair">${t('cl.repair')}</button><button class="btn" id="cl-recheck">${t('cl.recheck')}</button>` : ''}</div>
      ${d.linked && !dOn ? `<p style="margin:12px 0 0;font-size:12.5px">${t('cl.logs')}</p>` : ''}
    </div></div>
    <div class="panel app-card" data-spot><span class="ico">⌨️</span><div style="flex:1">
      <h3>Claude Code</h3>
      ${!c.installed ? state(false, t('cl.notFound')) : cOn ? state(true, t('cl.active') + seen(c.client)) : c.linked ? `<span class="state warn"><span class="pulse"></span>${t('cl.addedCode')}</span>` : state(false, t('cl.notLinked'))}
      <p>${!c.installed ? t('cl.codeMissing') : c.linked ? t('cl.codeOk') : t('cl.codeFound')}</p>
      <div class="row">${c.installed && !c.linked ? `<button class="btn primary" id="cl-code">${t('cl.link')}</button>` : ''}</div>
    </div></div>`;
  stagger(box); box.classList.add('stagger');
  const act = (id, fn) => { const b = $('#' + id); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); toast(t('toast.saved')); } catch (e) { toast(e.message, true); } loadClaudeApps(); }; };
  act('cl-link', () => api('/claude/desktop', { method: 'POST' }));
  act('cl-unlink', () => api('/claude/desktop', { method: 'DELETE' }));
  act('cl-repair', () => api('/claude/desktop', { method: 'POST' }));
  act('cl-code', () => api('/claude/code', { method: 'POST' }));
  if ($('#cl-recheck')) $('#cl-recheck').onclick = () => { loadClaudeApps(); refreshMcp(); };
}

// ---------- Admin ----------
// Appareils d'un ID : celui connecté en ce moment, et tous ceux qui ont essayé de s'y connecter.
function devicesHtml(c) {
  if (!Array.isArray(c.devices)) return '';
  const list = c.devices;
  const now = c.activeDevice ? `<span class="dev-on">● ${t('admin.devOn', { name: esc(c.activeDevice), when: c.activeSince ? ago(c.activeSince) : '' })}</span>` : `<span class="dev-off">○ ${t('admin.devNone')}</span>`;
  if (!list.length) return `<small class="devs-line">${now}</small>`;
  return `<details class="devs"><summary><small class="devs-line">${now} · <b>${t('admin.devCount', { n: list.length })}</b></small></summary>
    <ul>${list.map((d) => `<li>${d.active ? '🟢' : '⚪'} <b>${esc(d.name || t('admin.devUnknown'))}</b> · ${t('admin.devLogins', { n: d.logins })} · ${t('admin.devLast', { when: ago(d.lastSeen) })}</li>`).join('')}</ul></details>`;
}

async function renderAdmin() {
  let [codes, info] = await Promise.all([api('/admin/codes').catch((e) => ({ error: e.message })), api('/admin/info')]);
  const codesErr = codes.error;
  if (codesErr) codes = [];
  const actives = codes.filter((c) => c.status === 'active').length;
  view.innerHTML = `
    ${pageHead('ADMIN', t('admin.title'), t('admin.sub'))}
    ${codesErr ? `<div class="panel warn-panel" data-spot><h3>⚠️ ${t('admin.offTitle')}</h3><p>${esc(codesErr)} ${t('admin.offText')}</p><button class="btn primary" id="admin-retry">${t('admin.retry')}</button></div>` : ''}
    <div class="panel" data-spot>
      <h3>${t('admin.create')}</h3>
      <form class="row" id="code-form">
        <input class="input" name="label" style="flex:2;min-width:200px" placeholder="${t('admin.forWho')}">
        <select class="select" name="days" style="flex:1;min-width:150px;padding:11px 14px">
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
          <small>${c.admin ? t('session.admin') + ' · ' : ''}${!c.expiresAt ? t('admin.never') : t(c.status === 'expired' ? 'admin.expiredOn' : 'admin.expiresOn', { date: date(c.expiresAt) })} · ${t('admin.logins', { n: c.uses })}${c.lastUsed ? ' · ' + t('admin.lastLogin', { date: dateTime(c.lastUsed) }) : ''}</small>
          ${devicesHtml(c)}</div>
        <span class="status ${c.status}">${t('status.' + c.status)}</span>
        <div class="row">
          <button class="btn small" data-copy="${esc(c.code)}">${t('copy')}</button>
          ${c.activeDevice ? `<button class="btn small" data-kick="${c.id}">${t('admin.kick')}</button>` : ''}
          ${c.expiresAt ? `<button class="btn small" data-extend="${c.id}">+30 ${t('admin.daysShort')}</button><button class="btn small" data-forever="${c.id}">∞ ${t('admin.makeForever')}</button>` : ''}
          <button class="btn small" data-block="${c.id}" data-v="${!c.revoked}">${c.revoked ? t('admin.unblock') : t('admin.block')}</button>
          <button class="btn small danger" data-remove="${c.id}">${t('delete')}</button>
        </div>
      </div>`).join('') || `<div class="empty"><b>${t('admin.none')}</b>${t('admin.noneText')}</div>`}</div>
    <div class="two-col">
      <div class="panel" data-spot>
        <h3>🔑 ${t('admin.keyTitle')}</h3>
        <p>${t('admin.keyFile')}</p>
        ${codeBox(info.keyFile)}
        ${info.master ? `<div class="row" style="margin-top:14px"><button class="btn danger" id="reset-key">${t('admin.resetKey')}</button></div>` : `<p class="sub" style="margin-top:14px;font-size:13px">${t('admin.masterOnly')}</p>`}
      </div>
      <div class="panel" data-spot>
        <h3>🌐 ${t('admin.onlineTitle')}</h3>
        <p><span class="status ${info.online && !info.offline ? 'active' : 'expired'}">${t(info.online ? (info.offline ? 'admin.offline' : 'admin.online') : 'admin.local')}</span></p>
        <p>${t('admin.onlineText')}</p>
        ${codeBox(info.download)}
        ${info.lastShared ? `<p class="sub" style="margin-top:12px;font-size:13px">${t('admin.lastShared', { date: dateTime(info.lastShared) })}</p>` : ''}
      </div>
    </div>`;
  bindCopy(view);
  if ($('#admin-retry')) $('#admin-retry').onclick = () => transition(renderAdmin);
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
    const msg = t(c.admin ? 'admin.msgAdmin' : 'admin.msg', { code: c.code }) + '\n' + (c.expiresAt ? t('admin.msgUntil', { date: date(c.expiresAt) }) : t('admin.msgForever'))
      + '\n\n' + t('admin.msgDownload', { url: info.download });
    await renderAdmin();
    $('#new-code').innerHTML = `<div class="new-code"><span>${c.label ? t('admin.newFor', { name: esc(c.label) }) : t('admin.newId')}</span><strong>${esc(c.code)}</strong>
      <div class="row"><button class="btn small primary" data-copy="${esc(c.code)}">${t('admin.copyId')}</button><button class="btn small" data-copy="${esc(msg)}">${t('admin.copyMsg')}</button></div></div>`;
    bindCopy($('#new-code'));
  };
  $$('[data-extend]').forEach((b) => b.onclick = async () => { await api('/admin/codes/' + b.dataset.extend, { method: 'PUT', body: { addDays: 30 } }); toast(t('admin.extended')); renderAdmin(); });
  $$('[data-forever]').forEach((b) => b.onclick = async () => { await api('/admin/codes/' + b.dataset.forever, { method: 'PUT', body: { permanent: true } }); toast(t('admin.nowForever')); renderAdmin(); });
  $$('[data-block]').forEach((b) => b.onclick = async () => { await api('/admin/codes/' + b.dataset.block, { method: 'PUT', body: { revoked: b.dataset.v === 'true' } }); renderAdmin(); });
  $$('[data-kick]').forEach((b) => b.onclick = async () => { await api('/admin/codes/' + b.dataset.kick + '/kick', { method: 'POST' }); toast(t('admin.kicked')); renderAdmin(); });
  $$('[data-remove]').forEach((b) => b.onclick = async () => { if (!confirm(t('admin.confirmDelete'))) return; await api('/admin/codes/' + b.dataset.remove, { method: 'DELETE' }); renderAdmin(); });
  if ($('#reset-key')) $('#reset-key').onclick = async () => {
    if (!confirm(t('admin.confirmReset'))) return;
    const r = await api('/admin/reset-key', { method: 'POST' });
    prompt(t('admin.newKey'), r.key);
    location.reload();
  };
}

function codeBox(text) {
  return `<div class="codebox"><code>${esc(text)}</code><button class="btn small" data-copy="${esc(text)}">${t('copy')}</button></div>`;
}
function bindCopy(root = document) {
  $$('[data-copy]', root).forEach((b) => b.onclick = async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      const old = b.textContent;
      b.textContent = '✓ ' + t('copied');
      setTimeout(() => (b.textContent = old), 1400);
    } catch { toast(t('toast.copyFail'), true); }
  });
}

// ---------- Réglages ----------
// État de la mise à jour (app de bureau) en texte.
function updState(u) {
  if (!u || !u.state || u.state === 'idle') return '';
  if (u.state === 'downloading') return t('upd.downloading', { v: esc(u.version || ''), p: u.percent || 0 });
  if (u.state === 'error') return t('upd.error');
  return t('upd.' + u.state, { v: esc(u.version || '') });
}

// ---------- Mise à jour : ouverte à tous (admins et membres) ----------
async function renderUpdate() {
  const ver = await api('/version').catch(() => ({}));
  const u = ver.update || {};
  view.innerHTML = `
    ${pageHead('ROVEX HUB', t('nav.update'), t('upd.sub'))}
    <div class="panel upd-hero" data-spot>
      <div class="upd-ver"><small>${t('upd.yours')}</small><b>v${esc(ver.version || '?')}</b></div>
      <div class="upd-main">
        <p id="upd-state" class="upd-state">${updState(u) || t('upd.idle')}</p>
        <div class="upd-bar" id="upd-bar" ${u.state === 'downloading' ? '' : 'hidden'}><i style="width:${u.percent || 0}%"></i></div>
        <div class="row">
          <button class="btn primary" id="upd-check" ${ver.desktop ? '' : 'disabled'}>${t('upd.check')}</button>
          <button class="btn primary" id="upd-install" ${u.state === 'ready' ? '' : 'hidden'}>${t('upd.install')}</button>
        </div>
      </div>
    </div>
    <div class="two-col">
      <div class="panel" data-spot><h3>🔄 ${t('upd.autoTitle')}</h3><p>${t('upd.autoText')}</p></div>
      <div class="panel" data-spot><h3>⬇️ ${t('upd.manualTitle')}</h3><p>${t('upd.manualText')}</p>
        <a class="btn" href="https://github.com/djylaneee-ship-it/Portfolio/releases/latest" target="_blank" rel="noopener">${t('upd.manualBtn')}</a></div>
    </div>`;
  const show = (v) => {
    const st = v.update || {};
    if (!$('#upd-state')) return false;
    $('#upd-state').textContent = updState(st) || t('upd.idle');
    $('#upd-bar').hidden = st.state !== 'downloading';
    $('#upd-bar i').style.width = (st.percent || 0) + '%';
    $('#upd-install').hidden = st.state !== 'ready';
    return true;
  };
  $('#upd-check').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    await api('/update/check', { method: 'POST' });
    // Suit l'état pendant le téléchargement (jusqu'à 5 minutes).
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      const v = await api('/version').catch(() => null);
      if (!v || !show(v)) break;
      if (v.update && ['latest', 'ready', 'error', 'dev'].includes(v.update.state)) break;
    }
    b.disabled = false;
  };
  $('#upd-install').onclick = () => api('/update/install', { method: 'POST' });
}

// Prévient tout le monde quand une nouvelle version est téléchargée et prête.
let updWatch = null;
function watchUpdates() {
  if (updWatch) return;
  const tick = async () => {
    const v = await api('/version').catch(() => null);
    const st = v && v.update;
    const ready = Boolean(st && st.state === 'ready');
    const dot = $('#upd-dot');
    if (dot) dot.hidden = !ready;
    if (ready && !$('#upd-banner')) {
      const el = document.createElement('div');
      el.id = 'upd-banner';
      el.className = 'upd-banner';
      el.innerHTML = `<span>⬆️ ${t('upd.banner', { v: esc(st.version || '') })}</span><button class="btn primary">${t('upd.install')}</button><button class="icon-btn" aria-label="×">✕</button>`;
      el.querySelector('.btn').onclick = () => api('/update/install', { method: 'POST' });
      el.querySelector('.icon-btn').onclick = () => el.remove();
      document.body.append(el);
    }
  };
  tick();
  updWatch = setInterval(tick, 60e3);
}

async function renderSettings() {
  const [s, ver] = await Promise.all([api('/settings'), api('/version').catch(() => ({}))]);
  view.innerHTML = `
    ${pageHead('ROVEX HUB', t('nav.settings'), t('set.sub'))}
    <a class="panel upd-link" href="#/update" data-spot><h3>⬆️ ${t('upd.title')}</h3><p>${t('upd.current', { v: esc(ver.version || '?') })} ${updState(ver.update)}</p></a>
    <div class="two-col">
      <div class="panel" data-spot><h3>${t('set.langTitle')}</h3><p>${t('set.langText')}</p>${langSelect('set-lang')}</div>
      <div class="panel" data-spot><h3>${t('set.autoTitle')}</h3>
        <p>${t('set.autoText')}${s.lastAutoSync ? ' ' + t('set.autoLast', { date: dateTime(s.lastAutoSync) }) : ''}</p>
        <select class="select" id="auto">${[0, 1, 6, 12, 24].map((v) => `<option value="${v}" ${Number(s.autoSyncHours) === v ? 'selected' : ''}>${t('set.auto' + v)}</option>`).join('')}</select></div>
    </div>
    <div class="panel" data-spot>
      <h3>☁️ ${t('set.cloudTitle')}</h3>
      <p>${s.lastLibSync ? `<b>${t('set.libLast', { date: dateTime(s.lastLibSync), n: num(s.lastLibAdded) })}</b><br>` : ''}${t('set.cloudText')} ${s.lastCloudSync ? t('set.cloudLast', { date: dateTime(s.lastCloudSync), n: num(s.lastCloudAdded) }) + (s.cloudUpdatedAt ? ' ' + t('set.cloudFile', { date: dateTime(s.cloudUpdatedAt) }) : '') : t('set.cloudNever')}</p>
      <form class="row" id="cloud-form">
        <input class="input" id="cloud-url" style="flex:1;min-width:260px" value="${esc(s.cloudUrl)}" placeholder="${t('set.cloudPh')}">
        <button class="btn">${t('save')}</button>
        <button class="btn primary" type="button" id="cloud-sync">${t('set.syncNow')}</button>
      </form>
    </div>
    <div class="two-col">
      <div class="panel" data-spot>
        <h3>${t('set.ytTitle')}</h3><p>${t('set.ytText')}</p>
        <form class="row" id="key-form">
          <input class="input" id="key" style="flex:1;min-width:200px" placeholder="${s.hasKey ? t('set.keySaved') + ' ' + esc(s.youtubeApiKey) : t('set.pasteKey')}">
          <button class="btn primary">${t('save')}</button>
          ${s.hasKey ? `<button class="btn danger" type="button" id="key-del">${t('delete')}</button>` : ''}
        </form>
      </div>
      <div class="panel" data-spot>
        <h3>${t('set.ghTitle')}</h3><p>${t('set.ghText')}</p>
        <form class="row" id="gh-form">
          <input class="input" id="gh" style="flex:1;min-width:200px" placeholder="${s.hasGithub ? t('set.tokenSaved') : t('set.pasteToken')}">
          <button class="btn primary">${t('save')}</button>
        </form>
      </div>
    </div>
    <div class="panel" data-spot>
      <h3>🛠️ ${t('dev.toggleTitle')}</h3><p>${t('dev.toggleText')}</p>
      <div class="row"><label class="switch"><input type="checkbox" id="dev-on" ${DEVMODE ? 'checked' : ''}><span></span></label><span>${t('dev.toggle')}</span></div>
    </div>
    <div class="panel" data-spot>
      <h3>${t('set.backupTitle')}</h3><p>${t('set.backupText')}</p>
      <a class="btn" href="/api/export" download="rovex-hub.json">${t('set.export')}</a>
    </div>`;
  $('#set-lang').onchange = (e) => setLang(e.target.value);
  $('#dev-on').onchange = async (e) => {
    const r = await api('/devmode', { method: 'PUT', body: { on: e.target.checked } });
    DEVMODE = r.devMode;
    document.body.classList.toggle('dev-on', DEVMODE);
    applySpace(SPACE);
    watchDev();
    toast(t(DEVMODE ? 'dev.on' : 'dev.off'));
  };
  $('#key-form').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { youtubeApiKey: $('#key').value } }); toast(t('toast.saved')); route(); };
  $('#cloud-form').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { cloudUrl: $('#cloud-url').value } }); toast(t('toast.saved')); };
  $('#cloud-sync').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = `<span class="spinner"></span>${t('set.syncing')}`;
    try { const r = await api('/cloud/sync', { method: 'POST' }); toast(t('set.cloudDone', { n: num(r.added), c: num(r.channels) })); refreshStats(); route(); }
    catch (err) { toast(err.message, true); b.disabled = false; b.textContent = t('set.syncNow'); }
  };
  $('#gh-form').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { githubToken: $('#gh').value } }); toast(t('toast.saved')); route(); };
  $('#auto').onchange = async (e) => { await api('/settings', { method: 'PUT', body: { autoSyncHours: Number(e.target.value) } }); toast(t('toast.saved')); };
  if ($('#key-del')) $('#key-del').onclick = async () => { await api('/settings', { method: 'PUT', body: { youtubeApiKey: '' } }); toast(t('toast.deleted')); route(); };
}

// ---------- Détail d'une ressource ----------
function mediaFor(r) {
  const id = ytId(r.url);
  if (id) return `<div class="media"><iframe src="https://www.youtube-nocookie.com/embed/${id}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  if (r.file && r.type === 'video') return `<div class="media"><video src="/media/${esc(r.file)}" controls></video></div>`;
  if (r.type === 'image') return `<div class="media"><img src="${esc(r.file ? '/media/' + r.file : r.url)}" alt=""></div>`;
  if (r.thumbnail) return `<div class="media"><img src="${esc(r.thumbnail)}" alt="" referrerpolicy="no-referrer"></div>`;
  const c = cat(r.category);
  return `<div class="media thumb ph" style="--c:${c.color};aspect-ratio:21/6"><span class="fb" style="display:grid">${svgPath(TYPE_ICONS[r.type] || TYPE_ICONS.article)}</span></div>`;
}

function openDetail(r) {
  const c = cat(r.category);
  const link = r.url || (r.file ? '/media/' + r.file : '');
  openModal(`
    ${mediaFor(r)}
    <div class="card-cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)} · ${typeLabel(r.type)}</div>
    <h2 class="detail-title" style="margin-top:8px">${esc(r.title)}</h2>
    <p class="sub" style="margin-bottom:20px">${esc(r.author || '')}${r.description ? (r.author ? ' — ' : '') + esc(r.description) : ''}</p>
    <div class="row" style="margin-bottom:22px">
      ${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" ${r.file ? 'download' : ''}>${r.file ? t('detail.download') : t('detail.open')} ${ARROW}</a>` : ''}
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
    await api('/resources/' + r.id, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
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
      <p class="sub" style="margin-bottom:16px">${t('addm.linkText')}</p>
      <form id="f-link">
        <div class="field"><label>${t('f.link')}</label><input name="url" required placeholder="https://www.youtube.com/watch?v=…"></div>
        <div id="f-prev"></div>
        <div class="two"><div class="field"><label>${t('f.category')}</label><select name="category">${catOpts}</select></div>
        <div class="field"><label>${t('f.tags')}</label><input name="tags" placeholder="slash, combat"></div></div>
        <button class="btn primary">${t('addm.import')}</button>
      </form>
    </div>
    <div data-pane="file">
      <p class="sub" style="margin-bottom:16px">${t('addm.fileText')}</p>
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
  const show = (k) => {
    $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    $$('[data-pane]').forEach((p) => {
      p.hidden = p.dataset.pane !== k;
      if (!p.hidden && !reduced) p.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: 'ease-out' });
    });
  };
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
        $('#f-prev').innerHTML = `<div class="preview">${p.thumbnail ? `<img src="${esc(p.thumbnail)}" alt="">` : ''}<div><b>${esc(p.title)}</b><div class="sub" style="font-size:13px">${esc(p.author || '')} · ${typeLabel(p.type)} · ${esc(cat(p.category).label)}</div></div></div>`;
      } catch { $('#f-prev').innerHTML = ''; }
    }, 500);
  };
  $('#f-link').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${t('addm.importing')}`;
    try {
      const r = await api('/import', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
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
  bindCopy($('#modal-body'));
}
async function closeModal() {
  const card = $('.modal-card');
  if (!reduced && !$('#modal').hidden) {
    await card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(20px) scale(.95)' }], { duration: 180, easing: 'ease-in' }).finished;
  }
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
    <a href="#/library?cat=${c.id}" class="${active === c.id ? 'active' : ''}"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}<span class="n">${num((STATS.learnByCategory || STATS.byCategory)[c.id])}</span></a>`).join('');
}

const ADMIN_PAGES = ['explore', 'settings', 'admin', 'favorites', 'dev'];
async function route() {
  const [p, qs] = location.hash.slice(1).split('?');
  let path = (p || '/').replace(/^\//, '') || 'home';
  if (path === 'mcp') path = 'connect';
  const params = new URLSearchParams(qs || '');
  const name = path === 'library' && params.get('cat') ? '' : path;
  const sp = spaceOf(path);
  if (sp && sp !== SPACE) applySpace(sp);
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $$('#side-cats a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/library?cat=' + params.get('cat')));
  $$('#side-places-list a').forEach((a) => a.classList.toggle('active', path === 'place' && a.dataset.s === (params.get('s') || '')));
  movePill();
  document.body.classList.remove('menu');
  // En quittant le chat, les Claudes continuent : on arrête seulement de suivre le flux.
  if (path !== 'chat') { agClose(); document.body.classList.remove('chat-mode'); }
  if (!SESSION || !SESSION.loggedIn) return;
  if (!isAdmin() && ADMIN_PAGES.includes(path)) { location.hash = '#/'; return; }
  const pages = {
    library: () => renderLibrary(params), favorites: () => renderLibrary(params, true), examples: renderExamples,
    youtube: () => renderYoutube(params), channels: () => renderChannels(params), explore: renderExplore,
    chat: renderChat, connect: renderConnect, admin: renderAdmin, settings: renderSettings, update: renderUpdate, robloxstudio: renderRobloxStudio, blender: renderBlender, custom: renderCustom, dev: renderDev, textures: () => renderTextures(params), place: () => renderPlace(params), level: renderLevel, opensource: renderOpenSource, skills: renderSkills, prompts: renderPrompts, studio: renderStudio,
  };
  if (path === 'chat' && $('#chat')) return;
  try {
    await transition(pages[path] || renderHome);
  } catch (e) {
    view.classList.remove('leaving');
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
  }, 300);
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
});
$('#add-btn').onclick = () => openAdd();
$('#menu-btn').onclick = () => document.body.classList.toggle('menu');
window.addEventListener('resize', movePill);

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
  if (/Electron/.test(navigator.userAgent)) document.body.classList.add('desktop');
  applyStatic();
  $('#login-lang').value = LANG;
  try { SESSION = await api('/session'); }
  catch {
    view.innerHTML = `<div class="empty"><b>${t('err.oldTitle')}</b>${t('err.oldText')}</div>`;
    return;
  }
  if (!SESSION.loggedIn) return showLogin(SESSION.kicked ? t('err.otherDevice', { device: SESSION.kicked.device || '?' }) : '');
  renderSession();
  META = await api('/meta');
  await Promise.all([refreshStats(), refreshMcp()]);
  route();
  if (isAdmin()) { watchJob(); syncLang(); }
  setInterval(async () => {
    await refreshMcp();
    const list = $('#act-list') || $('#cn-log');
    if (list) list.innerHTML = activityList(MCP.log || []);
    if ($('#chat')) agSide();
    // Point vert sur « Chat Claude » quand un Claude est connecté (hors de la page du chat).
    else api('/agents').then((v) => { const d = $('#chat-dot'); if (d) d.hidden = !v.claude.online; }).catch(() => {});
  }, 20000);
})();
