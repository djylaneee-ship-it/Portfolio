// Interface de Roblox Dev Hub (aucun framework).
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
  tools: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
};
const TYPE_ICONS = {
  doc: 'M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM8 12v2h8v-2zm0 4v2h8v-2z',
  recherche: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z',
  video: 'M8 5v14l11-7z',
  chaine: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  fichier: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z',
};
const TYPE_LABEL = { video: 'Vidéo', chaine: 'Chaîne', doc: 'Doc', article: 'Article', outil: 'Outil', image: 'Image', fichier: 'Fichier', recherche: 'Recherche' };
const LEVEL_LABEL = { debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé' };
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

let META = { categories: [], types: [] };
let STATS = {};
const cat = (id) => META.categories.find((c) => c.id === id) || { id, label: id, color: '#888' };
const icon = (id, size) => `<svg viewBox="0 0 24 24"${size ? ` style="width:${size}px;height:${size}px"` : ''}><path d="${ICONS[id] || ICONS.tools}"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
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
    ${thumb}<span class="badge">${TYPE_LABEL[r.type] || r.type}</span>
    <button class="star ${r.favorite ? 'on' : ''}" data-star="${r.id}" title="Favori">${STAR}</button></div>
    <div class="card-body">
      <div class="card-cat"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</div>
      <h3>${esc(r.title)}</h3>
      ${r.tags.length ? `<div class="tags">${r.tags.slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="meta">${r.level ? `<span class="lvl ${r.level}">${LEVEL_LABEL[r.level]}</span>` : ''}<span>${esc(r.author || '')}</span></div>
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
      toast(r.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris');
      return;
    }
    const el = e.target.closest('.card[data-id]');
    if (el) openDetail(LIST.find((x) => x.id === el.dataset.id));
  });
}

function grid(list, emptyMsg = '') {
  if (!list.length) {
    return `<div class="empty"><b>Rien ici pour l'instant</b>${emptyMsg || 'Essaie une autre recherche, ou ajoute une ressource.'}
      <div class="row"><button class="btn primary" onclick="openAdd()">Ajouter une ressource</button>
      <a class="btn" href="#/youtube?q=${encodeURIComponent($('#search').value || 'roblox studio')}">Chercher sur YouTube</a></div></div>`;
  }
  return `<div class="grid">${list.map(card).join('')}</div>`;
}

// ---------- Vues ----------
async function renderHome() {
  const recent = (await api('/resources')).slice(0, 8);
  view.innerHTML = `
    <div class="hero">
      <h1>Ta base de dev<br><span>Roblox ultime</span></h1>
      <p>Tutos vidéo, docs, VFX, scripts, animations, GUI, GFX… tout au même endroit, consultable par toi <b>et par tes outils IA</b> via MCP.</p>
      <div class="row">
        <button class="btn primary" onclick="openAdd()"><svg viewBox="0 0 24 24"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/></svg>Ajouter</button>
        <a class="btn" href="#/youtube">Chercher sur YouTube</a>
        <a class="btn" href="#/mcp">Serveur MCP</a>
      </div>
      <div class="stats">
        <div class="stat"><b>${STATS.total}</b><span>ressources</span></div>
        <div class="stat"><b>${STATS.byType.video || 0}</b><span>vidéos</span></div>
        <div class="stat"><b>${(STATS.byType.image || 0) + (STATS.byType.fichier || 0)}</b><span>fichiers & images</span></div>
        <div class="stat"><b>${STATS.favorites}</b><span>favoris</span></div>
        <div class="stat"><b>${STATS.channels}</b><span>chaînes suivies</span></div>
      </div>
    </div>
    <div class="section-head"><h2>Explorer par catégorie</h2></div>
    <div class="cat-grid">${META.categories.map((c) => `
      <a class="cat-tile" style="--c:${c.color}" href="#/library?cat=${c.id}">
        <span class="count">${STATS.byCategory[c.id] || 0}</span>
        <span class="ico">${icon(c.id)}</span>
        <h3>${esc(c.label)}</h3><p>${esc(c.desc)}</p>
      </a>`).join('')}</div>
    <div class="section-head"><h2>Ajouts récents</h2><a class="link" href="#/library">Tout voir →</a></div>
    <div id="recent">${grid(recent)}</div>`;
  bindCards($('#recent'), recent);
}

const filters = { type: '', level: '' };
async function renderLibrary(params, favorites = false) {
  const q = params.get('q') || '';
  const c = params.get('cat') || '';
  $('#search').value = q;
  const qs = new URLSearchParams({ q, category: c, type: filters.type, level: filters.level, favorite: favorites ? '1' : '' });
  const list = await api('/resources?' + qs);
  const cc = c && cat(c);
  view.innerHTML = `
    <h1 class="h1">${favorites ? 'Favoris' : cc ? esc(cc.label) : q ? `Résultats pour « ${esc(q)} »` : 'Bibliothèque'}</h1>
    <p class="sub">${cc && !favorites ? esc(cc.desc) + ' · ' : ''}${list.length} ressource${list.length > 1 ? 's' : ''}</p>
    <div class="toolbar">
      <button class="chip ${!filters.type ? 'on' : ''}" data-type="">Tout</button>
      ${META.types.map((t) => `<button class="chip ${filters.type === t ? 'on' : ''}" data-type="${t}">${TYPE_LABEL[t]}</button>`).join('')}
      <span class="spacer"></span>
      <select class="select" id="lvl"><option value="">Tous niveaux</option>${Object.entries(LEVEL_LABEL).map(([k, v]) => `<option value="${k}" ${filters.level === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <div id="list">${grid(list, favorites ? 'Clique sur l\'étoile d\'une ressource pour l\'ajouter ici.' : '')}</div>`;
  $$('[data-type]').forEach((b) => b.onclick = () => { filters.type = b.dataset.type; route(); });
  $('#lvl').onchange = (e) => { filters.level = e.target.value; route(); };
  bindCards($('#list'), list);
}

async function renderYoutube(params) {
  const q = params.get('q') || '';
  const settings = await api('/settings');
  view.innerHTML = `
    <h1 class="h1">Chercher sur YouTube</h1>
    <p class="sub">Trouve des tutos et ajoute-les à ta base en un clic.</p>
    <form class="toolbar" id="yt-form">
      <input class="input" id="yt-q" style="flex:1;min-width:220px" placeholder="ex. roblox slash vfx, moon animator, simulator ui…" value="${esc(q)}">
      <button class="btn primary">Chercher</button>
    </form>
    <div class="row" style="margin-bottom:20px">${['roblox vfx tutorial', 'roblox scripting tutorial', 'moon animator 2', 'roblox ui design', 'roblox gfx blender', 'roblox combat system', 'roblox datastore', 'roblox building tips'].map((s) => `<button class="chip" data-s="${s}">${s}</button>`).join('')}</div>
    <div id="yt-res"></div>`;
  $('#yt-form').onsubmit = (e) => { e.preventDefault(); location.hash = '#/youtube?q=' + encodeURIComponent($('#yt-q').value); };
  $$('[data-s]').forEach((b) => b.onclick = () => { location.hash = '#/youtube?q=' + encodeURIComponent(b.dataset.s); });
  if (!q) return;
  const out = $('#yt-res');
  if (!settings.hasKey) {
    out.innerHTML = `<div class="panel"><h3>Recherche intégrée désactivée</h3>
      <p>Pour chercher directement dans l'app, ajoute une clé YouTube gratuite dans <a class="link" href="#/settings">Réglages</a>. En attendant, ouvre la recherche sur YouTube et colle les liens qui te plaisent avec le bouton « Ajouter ».</p>
      <div class="row"><a class="btn primary" target="_blank" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}">Ouvrir « ${esc(q)} » sur YouTube</a>
      <button class="btn" id="save-search">Enregistrer cette recherche</button></div></div>`;
    $('#save-search').onclick = async () => {
      await api('/resources', { method: 'POST', body: { title: 'YouTube : ' + q, url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q), type: 'recherche', category: guess(q), author: 'YouTube' } });
      toast('Recherche enregistrée'); refreshStats();
    };
    return;
  }
  out.innerHTML = '<div class="row"><span class="spinner"></span> Recherche…</div>';
  try {
    const res = await api('/youtube?q=' + encodeURIComponent(q));
    out.innerHTML = `<div class="grid">${res.map((v, i) => `
      <article class="card" style="--c:#ff3d6e">
        <div class="thumb"><img src="${esc(v.thumbnail)}" alt="" loading="lazy"><span class="badge">Vidéo</span></div>
        <div class="card-body"><h3>${esc(v.title)}</h3><div class="meta">${esc(v.author)}</div>
        <div class="row"><button class="btn small primary" data-add="${i}">+ Ajouter</button><a class="btn small" href="${esc(v.url)}" target="_blank">Voir</a></div></div>
      </article>`).join('')}</div>`;
    $$('[data-add]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      const v = res[b.dataset.add];
      await api('/resources', { method: 'POST', body: { ...v, type: 'video', category: guess(v.title + ' ' + q) } });
      b.textContent = '✓ Ajouté'; refreshStats();
    });
  } catch (e) { out.innerHTML = `<div class="panel"><h3>Erreur</h3><p>${esc(e.message)}</p></div>`; }
}

function guess(t) {
  const rules = [['vfx', /vfx|particle|beam|trail|slash|aura|explosion/i], ['animation', /anim|moon|rig|r6|r15/i], ['gui', /\bui\b|gui|hud|menu|shop/i], ['gfx', /gfx|thumbnail|icon|render/i], ['modeling', /blender|model|mesh|texture/i], ['building', /build|map|terrain|light/i], ['audio', /sound|audio|music/i], ['design', /design|monetiz|popular/i]];
  for (const [c, re] of rules) if (re.test(t)) return c;
  return 'scripting';
}

async function renderChannels() {
  const chans = await api('/channels');
  view.innerHTML = `
    <h1 class="h1">Veille chaînes YouTube</h1>
    <p class="sub">Suis tes créateurs préférés : leurs nouvelles vidéos arrivent dans ta base automatiquement (aucune clé requise).</p>
    <div class="panel">
      <form class="row" id="ch-form">
        <input class="input" id="ch-h" style="flex:2;min-width:200px" placeholder="@pseudo ou lien de la chaîne">
        <select class="input" id="ch-c" style="flex:1;min-width:150px"><option value="">Catégorie auto</option>${META.categories.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select>
        <button class="btn primary">Suivre</button>
      </form>
    </div>
    <div class="section-head"><h2>${chans.length} chaîne${chans.length > 1 ? 's' : ''} suivie${chans.length > 1 ? 's' : ''}</h2>
      <button class="btn primary" id="sync"><svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6a6 6 0 0 1 5.7 7.9l1.5 1.5A8 8 0 0 0 12 4zm0 14a6 6 0 0 1-5.7-7.9L4.8 8.6A8 8 0 0 0 12 20v3l4-4-4-4z"/></svg>Récupérer les nouvelles vidéos</button></div>
    <div id="sync-out"></div>
    <div class="ch-list">${chans.map((c) => `
      <div class="ch">${c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : `<span class="av">${esc((c.name || c.handle).replace('@', '')[0] || '?')}</span>`}
        <div class="info"><b>${esc(c.name || c.handle)}</b><small>${esc(c.handle)} · ${c.category ? esc(cat(c.category).label) : 'catégorie auto'} · ${c.lastFetch ? 'màj ' + new Date(c.lastFetch).toLocaleString('fr-FR') : 'jamais synchronisée'}</small></div>
        <button class="btn small danger" data-del="${c.id}">Retirer</button></div>`).join('') || '<div class="empty"><b>Aucune chaîne</b>Ajoute un @pseudo YouTube ci-dessus.</div>'}</div>`;
  $('#ch-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    try { await api('/channels', { method: 'POST', body: { handle: $('#ch-h').value, category: $('#ch-c').value } }); toast('Chaîne ajoutée'); refreshStats(); renderChannels(); }
    catch (err) { toast(err.message, true); btn.disabled = false; }
  };
  $('#sync').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span>Synchronisation…';
    try {
      const rep = await api('/channels/sync', { method: 'POST' });
      const total = rep.reduce((a, r) => a + (r.added || 0), 0);
      toast(`${total} nouvelle${total > 1 ? 's' : ''} vidéo${total > 1 ? 's' : ''} ajoutée${total > 1 ? 's' : ''}`);
      refreshStats(); await renderChannels();
      $('#sync-out').innerHTML = `<div class="panel" style="margin-bottom:16px">${rep.map((r) => `<div>${r.error ? '⚠️' : '✅'} <b>${esc(r.name)}</b> — ${r.error ? esc(r.error) : `${r.added} ajoutée(s)`}</div>`).join('')}</div>`;
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
  $$('[data-del]').forEach((b) => b.onclick = async () => { await api('/channels/' + b.dataset.del, { method: 'DELETE' }); refreshStats(); renderChannels(); });
}

async function renderMcp() {
  const info = await api('/info');
  const http = `http://localhost:${info.port}/mcp`;
  const stdio = JSON.stringify({ mcpServers: { 'roblox-dev-hub': { command: 'node', args: [info.mcpPath] } } }, null, 2);
  const httpCfg = JSON.stringify({ mcpServers: { 'roblox-dev-hub': { type: 'http', url: http } } }, null, 2);
  view.innerHTML = `
    <h1 class="h1">Serveur MCP</h1>
    <p class="sub">Ta base est disponible pour n'importe quel client MCP (Claude Desktop, Cursor, VS Code, LM Studio…). Choisis le mode que ton client accepte.</p>
    <div class="panel">
      <h3>Mode HTTP — adresse du serveur</h3>
      <p>Pour les clients qui demandent une URL. L'app doit être ouverte pendant que tu l'utilises.</p>
      ${codeBox(http)}
      <p style="margin-top:14px">Exemple de configuration JSON :</p>
      ${jsonBox(httpCfg)}
    </div>
    <div class="panel">
      <h3>Mode stdio — commande</h3>
      <p>Pour les clients qui lancent une commande eux-mêmes. Fonctionne même si l'app est fermée.</p>
      ${codeBox(`node "${info.mcpPath}"`)}
      <p style="margin-top:14px">Exemple de configuration JSON (fichier de config <b>mcpServers</b> de ton client) :</p>
      ${jsonBox(stdio)}
    </div>
    <div class="panel">
      <h3>Outils exposés</h3>
      <div class="tags" style="gap:8px">${['search_resources — chercher', 'get_resource — détail + notes', 'list_categories', 'add_resource — ajouter', 'import_url — importer un lien', 'update_notes — écrire des notes', 'sync_channels — nouvelles vidéos'].map((t) => `<span class="tag" style="font-size:13px;padding:5px 10px">${t}</span>`).join('')}</div>
    </div>`;
  bindCopy();
}

function jsonBox(text) {
  return `<div class="code" style="align-items:start"><code style="white-space:pre">${esc(text)}</code><button class="btn small" data-copy="${esc(text)}">Copier</button></div>`;
}

function codeBox(text) {
  return `<div class="code"><code>${esc(text)}</code><button class="btn small" data-copy="${esc(text)}">Copier</button></div>`;
}
function bindCopy() {
  $$('[data-copy]').forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✓ Copié'; setTimeout(() => (b.textContent = 'Copier'), 1500); }
    catch { toast('Copie impossible, sélectionne le texte à la main', true); }
  });
}

async function renderSettings() {
  const s = await api('/settings');
  view.innerHTML = `
    <h1 class="h1">Réglages</h1>
    <p class="sub">Tout est stocké sur ton PC, dans le dossier <b>data</b> de l'application.</p>
    <div class="panel">
      <h3>Clé YouTube Data API (optionnelle)</h3>
      <p>Active la recherche YouTube directement dans l'app. Gratuite : console.cloud.google.com → créer un projet → activer « YouTube Data API v3 » → Identifiants → Créer une clé API.</p>
      <form class="row" id="key-form">
        <input class="input" id="key" style="flex:1;min-width:220px" placeholder="${s.hasKey ? 'Clé enregistrée ' + esc(s.youtubeApiKey) : 'Colle ta clé ici'}">
        <button class="btn primary">Enregistrer</button>
        ${s.hasKey ? '<button class="btn danger" type="button" id="key-del">Supprimer</button>' : ''}
      </form>
    </div>
    <div class="panel">
      <h3>Sauvegarde</h3>
      <p>Télécharge toute ta base (sans les fichiers du dossier media) au format JSON.</p>
      <a class="btn" href="/api/export" download="roblox-dev-hub.json">Exporter la base</a>
    </div>`;
  $('#key-form').onsubmit = async (e) => { e.preventDefault(); await api('/settings', { method: 'PUT', body: { youtubeApiKey: $('#key').value } }); toast('Clé enregistrée'); renderSettings(); };
  if ($('#key-del')) $('#key-del').onclick = async () => { await api('/settings', { method: 'PUT', body: { youtubeApiKey: '' } }); toast('Clé supprimée'); renderSettings(); };
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
    <div class="card-cat" style="--c:${c.color}"><span class="dot" style="background:${c.color}"></span>${esc(c.label)} · ${TYPE_LABEL[r.type]}</div>
    <h2 class="detail-title">${esc(r.title)}</h2>
    <p class="sub">${esc(r.author || '')}${r.description ? (r.author ? ' — ' : '') + esc(r.description) : ''}</p>
    <div class="row" style="margin-bottom:22px">
      ${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" ${r.file ? 'download' : ''}>${r.file ? 'Ouvrir / télécharger' : 'Ouvrir le lien'}</a>` : ''}
      <button class="btn" id="d-fav">${STAR}${r.favorite ? 'Retirer des favoris' : 'Favori'}</button>
      <button class="btn danger" id="d-del">Supprimer</button>
    </div>
    <form id="d-form">
      <div class="field"><label>Titre</label><input name="title" value="${esc(r.title)}"></div>
      <div class="two">
        <div class="field"><label>Catégorie</label><select name="category">${META.categories.map((x) => `<option value="${x.id}" ${x.id === r.category ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Type</label><select name="type">${META.types.map((t) => `<option value="${t}" ${t === r.type ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select></div>
        <div class="field"><label>Tags (séparés par des virgules)</label><input name="tags" value="${esc(r.tags.join(', '))}"></div>
        <div class="field"><label>Niveau</label><select name="level"><option value="">—</option>${Object.entries(LEVEL_LABEL).map(([k, v]) => `<option value="${k}" ${k === r.level ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Mes notes (lisibles via MCP)</label><textarea name="notes" placeholder="Résumé, code clé, timestamps…">${esc(r.notes)}</textarea></div>
      <button class="btn primary">Enregistrer</button>
    </form>`);
  $('#d-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await api('/resources/' + r.id, { method: 'PUT', body: data });
    toast('Enregistré'); closeModal(); refreshStats(); route();
  };
  $('#d-fav').onclick = async () => { await api('/resources/' + r.id, { method: 'PUT', body: { favorite: !r.favorite } }); closeModal(); refreshStats(); route(); };
  $('#d-del').onclick = async () => {
    if (!confirm('Supprimer « ' + r.title + ' » ?')) return;
    await api('/resources/' + r.id, { method: 'DELETE' });
    toast('Supprimé'); closeModal(); refreshStats(); route();
  };
}

// ---------- Ajout ----------
function openAdd(tab = 'link') {
  const catOpts = `<option value="">Catégorie auto</option>${META.categories.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}`;
  openModal(`
    <h2 class="detail-title">Ajouter à ta base</h2>
    <div class="tabs"><button data-tab="link">Lien / vidéo</button><button data-tab="file">Fichiers</button><button data-tab="manual">Note manuelle</button></div>
    <div data-pane="link">
      <p class="sub">Colle un lien YouTube, une chaîne, une page du DevForum, une doc… Titre et miniature sont récupérés tout seuls.</p>
      <form id="f-link">
        <div class="field"><label>Lien</label><input name="url" required placeholder="https://www.youtube.com/watch?v=…"></div>
        <div id="f-prev"></div>
        <div class="two"><div class="field"><label>Catégorie</label><select name="category">${catOpts}</select></div>
        <div class="field"><label>Tags</label><input name="tags" placeholder="slash, combat"></div></div>
        <button class="btn primary">Importer</button>
      </form>
    </div>
    <div data-pane="file">
      <p class="sub">Images, vidéos, scripts .lua, modèles .rbxm / .fbx / .blend… Ils sont copiés dans le dossier media de l'app.</p>
      <div class="field"><label>Catégorie</label><select id="f-cat">${catOpts}</select></div>
      <label class="drop" id="f-drop"><b>Glisse tes fichiers ici</b>ou clique pour choisir<input type="file" multiple hidden id="f-files"></label>
      <div id="f-prog" style="margin-top:12px"></div>
    </div>
    <div data-pane="manual">
      <form id="f-man">
        <div class="field"><label>Titre</label><input name="title" required placeholder="Astuce : hitbox avec GetPartBoundsInBox"></div>
        <div class="two"><div class="field"><label>Catégorie</label><select name="category">${META.categories.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select></div>
        <div class="field"><label>Lien (optionnel)</label><input name="url"></div></div>
        <div class="field"><label>Tags</label><input name="tags"></div>
        <div class="field"><label>Notes / code</label><textarea name="notes"></textarea></div>
        <button class="btn primary">Ajouter</button>
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
      $('#f-prev').innerHTML = '<div class="preview"><span class="spinner"></span> Lecture du lien…</div>';
      try {
        const p = await api('/preview', { method: 'POST', body: { url: urlIn.value } });
        $('#f-prev').innerHTML = `<div class="preview">${p.thumbnail ? `<img src="${esc(p.thumbnail)}" alt="">` : ''}<div><b>${esc(p.title)}</b><div class="sub" style="margin:0">${esc(p.author || '')} · ${TYPE_LABEL[p.type]} · ${esc(cat(p.category).label)}</div></div></div>`;
      } catch { $('#f-prev').innerHTML = ''; }
    }, 500);
  };
  $('#f-link').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Import…';
    try {
      const d = Object.fromEntries(new FormData(e.target));
      const r = await api('/import', { method: 'POST', body: d });
      toast('Ajouté : ' + r.title); closeModal(); refreshStats(); route();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Importer'; }
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
    toast('Ajouté'); closeModal(); refreshStats(); route();
  };
}

async function upload(files, category = '') {
  files = [...files];
  if (!files.length) return;
  const prog = $('#f-prog');
  let ok = 0;
  for (const [i, f] of files.entries()) {
    if (prog) prog.innerHTML = `<div class="row"><span class="spinner"></span> Envoi ${i + 1}/${files.length} : ${esc(f.name)}</div>`;
    try {
      await api(`/upload?${new URLSearchParams({ name: f.name, category })}`, { method: 'POST', body: f });
      ok++;
    } catch (e) { toast(f.name + ' : ' + e.message, true); }
  }
  toast(`${ok} fichier${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''}`);
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
  $('#side-cats').innerHTML = META.categories.map((c) => `
    <a href="#/library?cat=${c.id}" class="${active === c.id ? 'active' : ''}"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}<span class="n">${STATS.byCategory[c.id] || 0}</span></a>`).join('');
}

async function route() {
  const [p, qs] = location.hash.slice(1).split('?');
  const path = (p || '/').replace(/^\//, '') || 'home';
  const params = new URLSearchParams(qs || '');
  const name = path === 'library' && params.get('cat') ? '' : path;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $$('#side-cats a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/library?cat=' + params.get('cat')));
  document.body.classList.remove('menu');
  try {
    if (path === 'library') await renderLibrary(params);
    else if (path === 'favorites') await renderLibrary(params, true);
    else if (path === 'youtube') await renderYoutube(params);
    else if (path === 'channels') await renderChannels();
    else if (path === 'mcp') await renderMcp();
    else if (path === 'settings') await renderSettings();
    else await renderHome();
  } catch (e) {
    view.innerHTML = `<div class="empty"><b>Oups</b>${esc(e.message)}<br>Le serveur est-il lancé ?</div>`;
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
window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files') && $('#modal').hidden) { dragDepth++; $('#dropzone').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; $('#dropzone').hidden = true;
  if ($('#modal').hidden && e.dataTransfer.files.length) upload(e.dataTransfer.files);
});

window.addEventListener('hashchange', route);
(async () => {
  META = await api('/meta');
  await refreshStats();
  route();
})();
