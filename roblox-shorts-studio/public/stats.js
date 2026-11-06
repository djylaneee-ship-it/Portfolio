// Onglet Stats : chaîne YouTube, chiffres de la période, graphiques et détail par vidéo.
// Utilise $, api, esc de app.js (scripts classiques : mêmes variables globales).
const nf = new Intl.NumberFormat('fr-FR');
const nfc = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const num = (v) => nf.format(Math.round(Number(v) || 0));
const pct = (v) => `${(Number(v) || 0).toFixed(1).replace('.', ',')} %`;
const dur = (sec) => { sec = Math.round(Number(sec) || 0); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const hours = (min) => `${(Number(min || 0) / 60).toFixed(1).replace('.', ',')} h`;
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

const TRAFFIC = {
  SHORTS: 'Flux Shorts', YT_SEARCH: 'Recherche YouTube', SUBSCRIBER: 'Abonnés (accueil, abonnements)',
  RELATED_VIDEO: 'Vidéos suggérées', YT_CHANNEL: 'Page de la chaîne', YT_OTHER_PAGE: 'Autres pages YouTube',
  EXT_URL: 'Sites externes', NO_LINK_OTHER: 'Direct ou inconnu', PLAYLIST: 'Playlists', NOTIFICATION: 'Notifications',
  END_SCREEN: 'Écrans de fin', HASHTAGS: 'Pages de hashtags', SOUND_PAGE: 'Pages de sons', ANNOTATION: 'Annotations',
  CAMPAIGN_CARD: 'Cartes', ADVERTISING: 'Publicités', YT_PLAYLIST_PAGE: 'Page de playlist', VIDEO_REMIXES: 'Remix',
  SHORTS_CONTENT_LINKS: 'Liens dans les Shorts', LIVE_REDIRECT: 'Redirections de live', NO_LINK_EMBEDDED: 'Lecteurs intégrés',
};

let statsDays = 28;
let statsData = null;
let sortKey = 'publishedAt';
let sortDir = -1;

// ---------- Graphiques (SVG, une seule série, survol avec info-bulle) ----------

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 4, 6, 8, 10].map((m) => m * p).find((m) => m >= v);
}

/**
 * @param {HTMLElement} el
 * @param {{label: string, value: number}[]} pts
 * @param {{kind?: 'line'|'bar', fmt?: (v:number)=>string, yMax?: number, xFmt?: (l:string)=>string}} o
 */
function chart(el, pts, o = {}) {
  const fmt = o.fmt || num;
  const xFmt = o.xFmt || ((l) => l);
  if (!pts.length) { el.innerHTML = '<p class="empty small">Pas encore de données sur cette période.</p>'; return; }
  const W = Math.max(280, el.clientWidth || 600), H = 200, L = 44, R = 12, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = o.yMax || niceMax(Math.max(...pts.map((p) => p.value)));
  const n = pts.length;
  const bar = o.kind === 'bar';
  const step = iw / (bar ? n : Math.max(1, n - 1));
  const x = (i) => L + (bar ? step * i + step / 2 : step * i);
  const y = (v) => T + ih - (v / max) * ih;

  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, yy = y(v);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/>`;
    g += `<text x="${L - 6}" y="${yy + 4}" class="axis" text-anchor="end">${o.fmt ? fmt(v) : nfc.format(v)}</text>`;
  }
  const every = Math.ceil(n / Math.max(2, Math.floor(iw / 70)));
  pts.forEach((p, i) => {
    if (i % every === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 6}" class="axis" text-anchor="middle">${esc(xFmt(p.label))}</text>`;
  });

  let marks = '';
  if (bar) {
    const bw = Math.max(2, Math.min(28, step - 2));
    pts.forEach((p, i) => {
      const h = Math.max(0, (p.value / max) * ih);
      if (h > 0) {
        const r = Math.min(4, bw / 2, h);
        const x0 = x(i) - bw / 2, y0 = T + ih - h;
        marks += `<path class="bar" d="M${x0},${T + ih} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${T + ih} Z"/>`;
      }
    });
  } else {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    marks += `<path class="area" d="${d} L${x(n - 1)},${T + ih} L${x(0)},${T + ih} Z"/><path class="line" d="${d}"/>`;
  }

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(o.title || '')}">
    ${g}${marks}
    <line class="cross" y1="${T}" y2="${T + ih}" style="display:none"/>
    <circle class="dot" r="5" style="display:none"/>
    <rect x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent" class="hit"/>
  </svg><div class="tip" hidden></div>`;

  const svg = el.querySelector('svg'), tip = el.querySelector('.tip');
  const cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot');
  svg.querySelector('.hit').addEventListener('mousemove', (e) => {
    const box = svg.getBoundingClientRect();
    const mx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(bar ? (mx - L - step / 2) / step : (mx - L) / step)));
    const p = pts[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
    if (!bar) { dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.value)); dot.style.display = ''; }
    tip.hidden = false;
    tip.innerHTML = `<span>${esc(xFmt(p.label))}</span><b>${fmt(p.value)}</b>`;
    const left = (x(i) / W) * box.width;
    tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, left - tip.offsetWidth / 2))}px`;
  });
  svg.querySelector('.hit').addEventListener('mouseleave', () => { tip.hidden = true; cross.style.display = 'none'; dot.style.display = 'none'; });
}

function hbars(rows) {
  if (!rows.length) return '<p class="empty small">Pas encore de données sur cette période.</p>';
  const total = rows.reduce((a, r) => a + Number(r.views), 0) || 1;
  const max = Math.max(...rows.map((r) => Number(r.views))) || 1;
  return rows.map((r) => `<div class="hbar">
      <div class="hbar-label"><span>${esc(TRAFFIC[r.insightTrafficSourceType] || r.insightTrafficSourceType)}</span>
      <span class="muted">${num(r.views)} · ${pct((r.views / total) * 100)}</span></div>
      <div class="hbar-track"><div style="width:${(r.views / max) * 100}%"></div></div></div>`).join('');
}

const tile = (label, value, sub = '') => `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;

function tiles(t) {
  const net = Number(t.subscribersGained || 0) - Number(t.subscribersLost || 0);
  return [
    tile('Vues', num(t.views)),
    tile('Durée de visionnage', hours(t.estimatedMinutesWatched)),
    tile('Durée moyenne vue', dur(t.averageViewDuration)),
    tile('% moyen regardé', pct(t.averageViewPercentage), 'Au-delà de 100 % = revisionnages'),
    tile('Abonnés', `${net >= 0 ? '+' : ''}${num(net)}`, `+${num(t.subscribersGained)} / −${num(t.subscribersLost)}`),
    tile("J'aime", num(t.likes)),
    tile('Commentaires', num(t.comments)),
    tile('Partages', num(t.shares)),
  ].join('');
}

// ---------- Page ----------

function analyticsNotice(d) {
  const e = d.analyticsError;
  if (!e) return '';
  if (e.code === 'scope' || !d.analyticsScope) {
    return `<div class="notice">Pour les stats détaillées (vues par jour, durée de visionnage, rétention, sources de trafic), reconnecte YouTube :
      <b>Réglages → YouTube → Connecter YouTube</b> et accepte l'accès « Afficher les rapports YouTube Analytics ».</div>`;
  }
  if (e.code === 'api') {
    return `<div class="notice">Active <a href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com" target="_blank">YouTube Analytics API</a>
      dans ton projet Google Cloud (bouton « Activer »), attends une minute puis clique sur Actualiser.</div>`;
  }
  return `<div class="notice">Stats détaillées indisponibles : ${esc(e.message)}</div>`;
}

function renderStats(d) {
  const c = d.channel, a = d.analytics;
  const byVideo = a?.byVideo || {};
  const videos = d.videos.map((v) => ({ ...v, ...(byVideo[v.id] ? {
    pctViewed: Number(byVideo[v.id].averageViewPercentage), avgDur: Number(byVideo[v.id].averageViewDuration),
    minutes: Number(byVideo[v.id].estimatedMinutesWatched), subs: Number(byVideo[v.id].subscribersGained),
  } : {}) }));
  videos.sort((x, y) => {
    const a1 = x[sortKey] ?? -1, b1 = y[sortKey] ?? -1;
    return (a1 > b1 ? 1 : a1 < b1 ? -1 : 0) * sortDir;
  });

  const col = (key, label) => `<th data-sort="${key}" class="${sortKey === key ? 'sorted' : ''}">${label}${sortKey === key ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`;

  $('statsBody').innerHTML = `
    <div class="channel">
      ${c.thumb ? `<img src="${esc(c.thumb)}" alt="">` : ''}
      <div class="channel-name"><h2>${esc(c.title)}</h2><span class="muted">Mis à jour ${new Date(d.fetchedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="hero"><b>${c.hiddenSubscribers ? '—' : num(c.subscribers)}</b><span>abonnés</span></div>
      <div class="hero"><b>${num(c.views)}</b><span>vues au total</span></div>
      <div class="hero"><b>${num(c.videoCount)}</b><span>vidéos</span></div>
    </div>
    ${analyticsNotice(d)}
    ${a ? `
      <p class="muted small">Du ${dayLabel(a.range.startDate)} au ${dayLabel(a.range.endDate)} · YouTube publie ces chiffres avec 2 à 3 jours de retard.</p>
      <div class="tiles">${tiles(a.totals)}</div>
      <div class="charts">
        <div class="panel grow"><h3>Vues par jour</h3><div class="chart" id="chViews"></div></div>
        <div class="panel grow"><h3>Abonnés gagnés par jour</h3><div class="chart" id="chSubs"></div></div>
      </div>
      <div class="panel"><h3>D'où viennent les vues</h3>${hbars(a.traffic)}</div>` : ''}
    <div class="panel">
      <h3>Vidéos <span class="muted small">(${videos.length} dernières · clique sur une vidéo pour le détail)</span></h3>
      <div class="table-wrap"><table class="videos">
        <thead><tr><th></th>${col('title', 'Titre')}${col('publishedAt', 'Publication')}${col('views', 'Vues')}${col('likes', "J'aime")}${col('comments', 'Comm.')}
          ${a ? col('pctViewed', '% regardé') + col('avgDur', 'Durée moy.') + col('subs', 'Abonnés') : ''}</tr></thead>
        <tbody>${videos.map((v) => `<tr data-id="${v.id}">
          <td>${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : ''}</td>
          <td class="title">${esc(v.title)}${v.fromApp ? ' <span class="tag">App</span>' : ''}${v.privacy !== 'public' ? ` <span class="tag warn">${v.privacy === 'private' ? 'Privée' : 'Non répertoriée'}</span>` : ''}</td>
          <td>${new Date(v.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
          <td class="n">${num(v.views)}</td><td class="n">${num(v.likes)}</td><td class="n">${num(v.comments)}</td>
          ${a ? `<td class="n">${v.pctViewed != null ? pct(v.pctViewed) : '—'}</td><td class="n">${v.avgDur != null ? dur(v.avgDur) : '—'}</td><td class="n">${v.subs != null ? `+${num(v.subs)}` : '—'}</td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div id="videoDetail"></div>`;

  if (a) {
    chart($('chViews'), a.daily.map((r) => ({ label: r.day, value: Number(r.views) })), { xFmt: dayLabel, title: 'Vues par jour' });
    chart($('chSubs'), a.daily.map((r) => ({ label: r.day, value: Number(r.subscribersGained) })), { kind: 'bar', xFmt: dayLabel, title: 'Abonnés gagnés par jour' });
  }
}

async function showVideo(id) {
  const v = statsData.videos.find((x) => x.id === id);
  const box = $('videoDetail');
  box.innerHTML = `<div class="panel"><p class="muted">Chargement de « ${esc(v.title)} »…</p></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const d = await api(`/api/stats/video/${id}?days=${statsDays}`).catch((e) => ({ analyticsError: { message: e.message } }));
  box.innerHTML = `<div class="panel detail">
    <div class="detail-head">
      ${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : ''}
      <div><h3>${esc(v.title)}</h3>
        <span class="muted">${new Date(v.publishedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} · ${dur(v.duration)}</span><br>
        <a class="button" href="https://youtube.com/shorts/${v.id}" target="_blank">Voir sur YouTube</a>
        <a class="button" href="https://studio.youtube.com/video/${v.id}/analytics" target="_blank">YouTube Studio</a>
      </div>
    </div>
    ${d.analyticsError ? `<div class="notice">Stats détaillées indisponibles : ${esc(d.analyticsError.message)}</div>` : `
      <div class="tiles">${tiles(d.totals)}</div>
      <div class="charts">
        <div class="panel grow"><h3>Rétention de l'audience</h3><p class="muted small">Part des spectateurs encore là à chaque moment de la vidéo (plus de 100 % = la vidéo est revue en boucle).</p><div class="chart" id="chRet"></div></div>
        <div class="panel grow"><h3>Vues par jour</h3><div class="chart" id="chVDaily"></div></div>
      </div>
      <div class="panel"><h3>D'où viennent les vues</h3>${hbars(d.traffic)}</div>`}
  </div>`;
  if (!d.analyticsError) {
    chart($('chRet'), d.retention.map((r) => ({ label: dur(Number(r.elapsedVideoTimeRatio) * v.duration), value: Number(r.audienceWatchRatio) * 100 })),
      { fmt: (val) => `${Math.round(val)} %`, title: "Rétention de l'audience" });
    chart($('chVDaily'), d.daily.map((r) => ({ label: r.day, value: Number(r.views) })), { xFmt: dayLabel, title: 'Vues par jour' });
  }
}

async function loadStats(fresh) {
  $('statsBody').innerHTML = '<p class="muted">Chargement des stats YouTube…</p>';
  try {
    statsData = await api(`/api/stats?days=${statsDays}${fresh ? '&fresh=1' : ''}`);
    renderStats(statsData);
  } catch (e) {
    $('statsBody').innerHTML = `<div class="notice">${esc(e.message)}</div>`;
  }
}

$('statsBody').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    sortDir = sortKey === th.dataset.sort ? -sortDir : -1;
    sortKey = th.dataset.sort;
    return renderStats(statsData);
  }
  const tr = e.target.closest('tr[data-id]');
  if (tr) showVideo(tr.dataset.id);
});
document.querySelectorAll('#statsRange button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#statsRange button').forEach((x) => x.classList.toggle('active', x === b));
  statsDays = Number(b.dataset.days);
  loadStats();
}));
$('statsRefresh').onclick = () => loadStats(true);
document.querySelector('nav button[data-tab="stats"]').addEventListener('click', () => { if (!statsData) loadStats(); });
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => statsData && $('stats').classList.contains('active') && renderStats(statsData), 200); });
