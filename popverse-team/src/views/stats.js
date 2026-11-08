// Stats d'un jeu : chiffres publics Roblox (joueurs, visites, favoris, votes) pris régulièrement par la fonction
// pt-roblox, + serveurs en direct et évènements envoyés par le script Luau installé dans le jeu.
import { api, dbConfig } from '../api.js';
import { h, clear, icon, fmtNum, fmtTime, fmtDate, timeAgo, toast, fail, empty, person } from '../ui.js';
import { editProject } from './project.js';
import luauScript from '../../roblox/PopverseTeamStats.server.luau';

const RANGES = [
  { id: '24h', label: '24 h', ms: 864e5 },
  { id: '7d', label: '7 jours', ms: 7 * 864e5 },
  { id: '30d', label: '30 jours', ms: 30 * 864e5 },
];

export default async function stats(box, { project: p }) {
  if (!p.roblox_place_id) {
    clear(box, h('div.panel', empty('chart', 'Relie ce projet à son jeu Roblox',
      'Colle le lien du jeu (roblox.com/games/…) dans les infos du projet : les joueurs en jeu, visites, favoris et votes s\'afficheront ici.',
      h('button.btn.primary', { onclick: () => editProject(p) }, icon('link'), 'Ajouter le lien du jeu'))), linkPanel(p));
    return;
  }

  let range = RANGES[0];
  let series = [];
  let servers = [];
  let events = [];
  const kpis = h('div.st-kpis');
  const chartPlaying = h('div.chart-box');
  const chartVisits = h('div.chart-box');
  const serverBox = h('div.panel.st-servers');
  const eventBox = h('div.panel.st-events');
  const rangeBar = h('div.seg');
  const updated = h('small.muted');

  clear(box,
    h('div.st-head',
      h('div', h('h2.st-title', icon('chart'), 'Stats en temps réel'), updated),
      h('div.row', rangeBar,
        h('button.btn.small', { onclick: () => refresh(true) }, icon('refresh'), 'Actualiser'),
        h('a.btn.small', { href: p.roblox_url || `https://www.roblox.com/games/${p.roblox_place_id}`, target: '_blank', rel: 'noopener' }, icon('play'), 'Roblox'))),
    kpis,
    h('div.st-charts',
      h('div.panel', h('h3', 'Joueurs en jeu'), h('p.muted.small', 'Chiffre public Roblox, relevé chaque minute quand l\'app est ouverte.'), chartPlaying),
      h('div.panel', h('h3', 'Visites cumulées'), h('p.muted.small', 'Total des visites du jeu depuis sa création.'), chartVisits)),
    h('div.st-grid', serverBox, eventBox),
    linkPanel(p));

  const drawRange = () => clear(rangeBar, RANGES.map(r => h('button' + (r.id === range.id ? '.on' : ''), { onclick: () => { range = r; drawRange(); load(); } }, r.label)));
  drawRange();

  async function load() {
    const since = new Date(Date.now() - range.ms).toISOString();
    [series, servers, events] = await Promise.all([
      api.select('pt_game_stats', { eq: { project_id: p.id }, gte: { at: since }, order: [['at', 'desc']], limit: 4000 }).then(r => r.reverse()),
      api.select('pt_game_servers', { eq: { project_id: p.id }, order: [['players', 'desc']] }),
      api.select('pt_game_events', { eq: { project_id: p.id }, order: [['at', 'desc']], limit: 80 }),
    ]);
    if (!series.length) {
      const last = await api.select('pt_game_stats', { eq: { project_id: p.id }, order: [['at', 'desc']], limit: 1 });
      series = last;
    }
    draw();
  }

  function draw() {
    const s = series[series.length - 1];
    const liveServers = servers.filter(x => Date.now() - new Date(x.updated_at) < 120e3);
    const livePlayers = liveServers.reduce((a, x) => a + (x.players || 0), 0);
    const votes = s && (s.likes || 0) + (s.dislikes || 0);
    const dayAgo = series.find(x => new Date(x.at) >= Date.now() - 864e5);
    const visitsDay = s && dayAgo ? s.visits - dayAgo.visits : null;
    const peak = series.reduce((m, x) => Math.max(m, x.playing || 0), 0);
    const revenue = events.filter(e => e.kind === 'purchase' && new Date(e.at) > Date.now() - 864e5).reduce((a, e) => a + (Number(e.value) || 0), 0);
    updated.textContent = s ? `Dernier relevé ${timeAgo(s.at)}` : 'Aucun relevé pour l\'instant';
    clear(kpis,
      kpi('users', 'En jeu', s?.playing, 'joueurs (Roblox)'),
      kpi('globe', 'Serveurs reliés', liveServers.length, liveServers.length ? `${livePlayers} joueurs en direct` : 'script non installé ?'),
      kpi('star', 'Pic sur la période', peak, range.label),
      kpi('eye', 'Visites', s?.visits, visitsDay !== null && visitsDay >= 0 ? `+${fmtNum(visitsDay)} en 24 h` : 'total'),
      kpi('heart', 'Favoris', s?.favorites, 'joueurs'),
      kpi('check', 'Note', votes ? Math.round((s.likes / votes) * 100) + ' %' : null, votes ? `${fmtNum(s.likes)} 👍 · ${fmtNum(s.dislikes)} 👎` : 'pas de votes'),
      kpi('crown', 'Robux (24 h)', revenue || null, 'achats suivis par le script'));
    lineChart(chartPlaying, series.map(x => ({ t: new Date(x.at), v: x.playing || 0 })), 'joueurs');
    lineChart(chartVisits, series.map(x => ({ t: new Date(x.at), v: Number(x.visits) || 0 })), 'visites');

    clear(serverBox, h('h3', icon('database'), 'Serveurs en direct'),
      liveServers.length ? h('div.table-wrap', h('table.st-table',
        h('thead', h('tr', ['Serveur', 'Joueurs', 'FPS', 'Ping', 'En ligne depuis', 'Version'].map(t => h('th', t)))),
        h('tbody', liveServers.map(x => h('tr',
          h('td', h('code', x.job_id.slice(0, 8))),
          h('td', h('div.fill', h('i', { style: { width: Math.min(100, ((x.players || 0) / (x.max_players || 1)) * 100) + '%' } })), `${x.players}/${x.max_players || '?'}`),
          h('td', x.fps ?? '—'), h('td', x.ping != null ? x.ping + ' ms' : '—'),
          h('td', x.uptime != null ? dur(x.uptime) : '—'), h('td', x.place_version ?? '—'))))))
        : h('p.muted', 'Aucun serveur ne s\'est signalé dans les 2 dernières minutes. Installe le script Luau (plus bas) pour voir chaque serveur en direct.'));

    clear(eventBox, h('h3', icon('bell'), 'Évènements du jeu'),
      events.length ? h('div.ev-list', events.slice(0, 40).map(e => h('div.ev',
        h('span.ev-kind.' + e.kind, evLabel(e.kind)),
        h('span.ev-text', e.user_id ? h('a', { href: `https://www.roblox.com/users/${e.user_id}/profile`, target: '_blank', rel: 'noopener' }, `joueur ${e.user_id}`) : '', e.value != null ? ` · ${fmtNum(e.value)}${e.kind === 'purchase' ? ' R$' : ''}` : '', e.data?.item || e.data?.id ? ` · ${e.data.item || e.data.id}` : ''),
        h('small.muted', fmtTime(e.at)))))
        : h('p.muted', 'Les arrivées, départs et achats envoyés par le script apparaîtront ici.'));
  }

  let lastRefresh = 0;
  async function refresh(manual) {
    if (Date.now() - lastRefresh < 20e3 && !manual) return;
    lastRefresh = Date.now();
    try {
      await api.fn('pt-roblox', { action: 'refresh', project_id: p.id });
      if (api.mode === 'demo' && manual) toast('Mode démo : les stats Roblox ont besoin de la base en ligne.', 'info');
      await load();
    } catch (e) { if (manual) fail(e); else console.warn(e); }
  }

  await load().catch(fail);
  refresh(false);
  const timer = setInterval(() => refresh(false), 60e3);
  const offs = [
    api.subscribe('pt_game_stats', { project_id: p.id }, ({ row }) => { if (row && !series.some(x => x.id === row.id)) { series.push(row); draw(); } }),
    api.subscribe('pt_game_servers', { project_id: p.id }, () => api.select('pt_game_servers', { eq: { project_id: p.id } }).then(s => { servers = s; draw(); })),
    api.subscribe('pt_game_events', { project_id: p.id }, ({ row }) => { if (row) { events.unshift(row); draw(); } }),
  ];
  const ro = new ResizeObserver(() => draw());
  ro.observe(chartPlaying);
  return () => { clearInterval(timer); offs.forEach(o => o()); ro.disconnect(); };
}

const kpi = (ic, label, v, hint) => h('div.st-kpi', h('span.tile-ic', icon(ic)), h('div', h('small', label), h('b', typeof v === 'string' ? v : fmtNum(v)), h('span.muted', hint)));
const dur = s => (s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? (s / 3600).toFixed(1).replace('.', ',') + ' h' : Math.round(s / 86400) + ' j');
const evLabel = k => ({ join: 'Arrivée', leave: 'Départ', purchase: 'Achat', gamepass: 'Game Pass' }[k] || k);

function axisNum(v, step) {
  const a = Math.abs(v);
  const d = (unit, big) => (step >= big ? 0 : step >= big / 10 ? 1 : 2);
  if (a >= 1e6) return (v / 1e6).toFixed(d('M', 1e6)).replace('.', ',') + ' M';
  if (a >= 1e4) return (v / 1e3).toFixed(d('k', 1e3)).replace('.', ',') + ' k';
  return Math.round(v).toLocaleString('fr-FR');
}

// Courbe d'une seule série (aire dorée + ligne 2px), réticule et info-bulle au survol / au doigt.
function lineChart(el, pts, unit) {
  clear(el);
  if (pts.length < 2) { el.append(h('p.muted.chart-empty', pts.length ? `Un seul relevé (${fmtNum(pts[0].v)} ${unit}) : la courbe apparaîtra avec les prochains.` : 'Pas encore de données sur cette période.')); return; }
  const W = Math.max(280, el.clientWidth || 600), H = 220, L = 48, R = 12, T = 12, B = 26;
  const t0 = +pts[0].t, t1 = +pts[pts.length - 1].t;
  let min = Math.min(...pts.map(p => p.v)), max = Math.max(...pts.map(p => p.v));
  if (unit === 'joueurs') min = 0;
  if (max === min) max = min + 1;
  const pad = (max - min) * 0.08;
  const lo = unit === 'joueurs' ? 0 : min - pad, hi = max + pad;
  const x = t => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Évolution des ${unit}`);
  const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
  const defs = mk('defs', {});
  defs.innerHTML = `<linearGradient id="g-${unit}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5B935" stop-opacity=".32"/><stop offset="1" stop-color="#F5B935" stop-opacity="0"/></linearGradient>`;
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' });
    const tx = mk('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' });
    tx.textContent = axisNum(v, (hi - lo) / 4);
  }
  const span = t1 - t0;
  for (let i = 0; i <= 4; i++) {
    const t = t0 + (span * i) / 4;
    const tx = mk('text', { x: x(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle', class: 'axis' });
    tx.textContent = span < 2 * 864e5 ? fmtTime(t) : fmtDate(t);
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(+p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  mk('path', { d: `${d}L${x(t1)},${y(lo)}L${x(t0)},${y(lo)}Z`, fill: `url(#g-${unit})` });
  mk('path', { d, class: 'line' });
  const last = pts[pts.length - 1];
  mk('circle', { cx: x(t1), cy: y(last.v), r: 4, class: 'dot' });
  const hair = mk('line', { y1: T, y2: H - B, class: 'hair', visibility: 'hidden' });
  const hov = mk('circle', { r: 5, class: 'dot hov', visibility: 'hidden' });
  const tip = h('div.chart-tip', { hidden: true });
  el.append(svg, tip);
  const move = e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - L) / (W - L - R)) * span;
    let best = pts[0];
    for (const p of pts) if (Math.abs(+p.t - t) < Math.abs(+best.t - t)) best = p;
    const cx = x(+best.t), cy = y(best.v);
    hair.setAttribute('x1', cx); hair.setAttribute('x2', cx); hair.setAttribute('visibility', 'visible');
    hov.setAttribute('cx', cx); hov.setAttribute('cy', cy); hov.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren(h('b', fmtNum(best.v) + ' ' + unit), h('small', `${fmtDate(best.t)} · ${fmtTime(best.t)}`));
    const left = (cx / W) * r.width;
    tip.style.left = Math.min(Math.max(left, 70), r.width - 70) + 'px';
    tip.style.top = Math.max(0, (cy / H) * r.height - 58) + 'px';
  };
  const leave = () => { hair.setAttribute('visibility', 'hidden'); hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

// Panneau « Relier le jeu » : URL d'envoi, clé du projet, script Luau prêt à coller.
function linkPanel(p) {
  const base = dbConfig()?.url;
  const endpoint = base ? `${base}/functions/v1/pt-roblox` : 'https://VOTRE-PROJET.supabase.co/functions/v1/pt-roblox';
  const script = luauScript.replace('https://VOTRE-PROJET.supabase.co/functions/v1/pt-roblox', endpoint).replace('COLLE-ICI-LA-CLE-D-ENVOI-DU-PROJET', p.ingest_key || 'CLE-INDISPONIBLE-EN-MODE-DEMO');
  const copy = (txt, what) => navigator.clipboard.writeText(txt).then(() => toast(`${what} copié`, 'ok')).catch(() => toast('Copie impossible', 'error'));
  return h('details.panel.link-panel',
    h('summary', h('h3', icon('link'), 'Relier le jeu (stats en direct dans chaque serveur)'), h('span.muted.small', 'cliquer pour ouvrir')),
    h('ol.steps',
      h('li', 'Dans Roblox Studio : ', h('b', 'Game Settings › Security › Allow HTTP Requests'), ' = activé.'),
      h('li', 'Crée un ', h('b', 'Script'), ' dans ', h('b', 'ServerScriptService'), ', nomme-le ', h('code', 'PopverseTeamStats'), ' et colle le script ci-dessous (l\'URL et la clé du projet sont déjà dedans).'),
      h('li', 'Publie le jeu : chaque serveur se signale toutes les 30 s (joueurs, FPS, ping) et envoie les achats.')),
    h('div.kv', h('span', 'URL d\'envoi'), h('code', endpoint), h('button.icon-btn', { onclick: () => copy(endpoint, 'URL'), title: 'Copier' }, icon('copy'))),
    h('div.kv', h('span', 'Clé d\'envoi'), h('code', p.ingest_key || '—'), h('button.icon-btn', { onclick: () => copy(p.ingest_key || '', 'Clé'), title: 'Copier' }, icon('copy'))),
    h('div.row',
      h('button.btn.primary.small', { onclick: () => copy(script, 'Script') }, icon('copy'), 'Copier le script Luau'),
      h('button.btn.small', { onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([script], { type: 'text/plain' })), download: 'PopverseTeamStats.server.luau' }); a.click(); } }, icon('download'), 'Télécharger')),
    h('pre.code-block', script));
}
