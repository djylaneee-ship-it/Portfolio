// Statistiques de la chaîne YouTube, affichées dans l'onglet Stats.
//   - YouTube Data API     : abonnés, vues totales, liste des vidéos et leurs compteurs
//   - YouTube Analytics API : vues par jour, durée de visionnage, % regardé, abonnés gagnés,
//                             sources de trafic, courbe de rétention d'une vidéo
// L'API Analytics demande l'autorisation yt-analytics.readonly (se reconnecter après la
// mise à jour 0.2.0) et l'activation de « YouTube Analytics API » dans le projet Google.
// Les chiffres Analytics arrivent avec 2 à 3 jours de retard côté YouTube.
const { google } = require('googleapis');
const youtube = require('./upload/youtube');

const CACHE_MS = 5 * 60e3;
const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

const day = (d) => d.toISOString().slice(0, 10);
function range(days) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400e3);
  return { startDate: day(start), endDate: day(end) };
}

// « PT1M5S » → 65
function isoSeconds(iso = '') {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso) || [];
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

// Réponse Analytics (en-têtes + lignes) → tableau d'objets.
function rows(res) {
  const names = (res.data.columnHeaders || []).map((h) => h.name);
  return (res.data.rows || []).map((r) => Object.fromEntries(r.map((v, i) => [names[i], v])));
}

// Erreur Analytics → code compréhensible par l'interface.
function analyticsError(e) {
  const msg = String(e?.errors?.[0]?.message || e?.message || e);
  if (/insufficient.*scope/i.test(msg)) return { code: 'scope', message: msg };
  if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg)) return { code: 'api', message: msg };
  return { code: 'other', message: msg };
}

const METRICS = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares';

async function channelAndVideos(port) {
  const yt = google.youtube({ version: 'v3', auth: youtube.client(port) });
  const { data } = await yt.channels.list({ part: ['snippet', 'statistics', 'contentDetails'], mine: true });
  const ch = data.items?.[0];
  if (!ch) throw new Error('Aucune chaîne YouTube sur ce compte Google');

  // Les 50 dernières vidéos de la chaîne (playlist « uploads »).
  const list = await yt.playlistItems.list({
    part: ['contentDetails'], playlistId: ch.contentDetails.relatedPlaylists.uploads, maxResults: 50,
  });
  const ids = (list.data.items || []).map((i) => i.contentDetails.videoId);
  let videos = [];
  if (ids.length) {
    const v = await yt.videos.list({ part: ['snippet', 'statistics', 'contentDetails', 'status'], id: ids });
    videos = (v.data.items || []).map((x) => ({
      id: x.id,
      title: x.snippet.title,
      publishedAt: x.status.publishAt || x.snippet.publishedAt,
      privacy: x.status.privacyStatus,
      thumb: x.snippet.thumbnails?.medium?.url || x.snippet.thumbnails?.default?.url,
      duration: isoSeconds(x.contentDetails.duration),
      views: Number(x.statistics.viewCount || 0),
      likes: Number(x.statistics.likeCount || 0),
      comments: Number(x.statistics.commentCount || 0),
    }));
  }
  return {
    channel: {
      id: ch.id,
      title: ch.snippet.title,
      thumb: ch.snippet.thumbnails?.default?.url,
      subscribers: Number(ch.statistics.subscriberCount || 0),
      hiddenSubscribers: ch.statistics.hiddenSubscriberCount,
      views: Number(ch.statistics.viewCount || 0),
      videoCount: Number(ch.statistics.videoCount || 0),
    },
    videos,
  };
}

async function channelAnalytics(port, days) {
  const ya = google.youtubeAnalytics({ version: 'v2', auth: youtube.client(port) });
  const base = { ids: 'channel==MINE', ...range(days) };
  const [totals, daily, byVideo, traffic] = await Promise.all([
    ya.reports.query({ ...base, metrics: METRICS }),
    ya.reports.query({ ...base, metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', dimensions: 'day', sort: 'day' }),
    ya.reports.query({ ...base, metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,subscribersGained', dimensions: 'video', sort: '-views', maxResults: 50 }),
    ya.reports.query({ ...base, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views' }),
  ]);
  return {
    range: { ...range(days), days },
    totals: rows(totals)[0] || {},
    daily: rows(daily),
    byVideo: Object.fromEntries(rows(byVideo).map((r) => [r.video, r])),
    traffic: rows(traffic),
  };
}

/** Vue d'ensemble : chaîne + vidéos + Analytics (ou l'erreur Analytics, sans bloquer le reste). */
async function overview(port, days = 28) {
  return cached(`overview:${days}`, async () => {
    const base = await channelAndVideos(port);
    let analytics = null, error = null;
    try { analytics = await channelAnalytics(port, days); } catch (e) { error = analyticsError(e); }
    return { ...base, analytics, analyticsError: error, fetchedAt: new Date().toISOString() };
  });
}

/** Détail d'une vidéo : jour par jour, rétention, sources de trafic. */
async function video(port, id, days = 28) {
  if (!/^[\w-]{6,20}$/.test(id)) throw new Error('ID de vidéo invalide');
  return cached(`video:${id}:${days}`, async () => {
    const ya = google.youtubeAnalytics({ version: 'v2', auth: youtube.client(port) });
    const base = { ids: 'channel==MINE', ...range(days), filters: `video==${id}` };
    try {
      const [totals, daily, retention, traffic] = await Promise.all([
        ya.reports.query({ ...base, metrics: METRICS }),
        ya.reports.query({ ...base, metrics: 'views,estimatedMinutesWatched', dimensions: 'day', sort: 'day' }),
        ya.reports.query({ ...base, metrics: 'audienceWatchRatio,relativeRetentionPerformance', dimensions: 'elapsedVideoTimeRatio' }),
        ya.reports.query({ ...base, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views' }),
      ]);
      return { id, totals: rows(totals)[0] || {}, daily: rows(daily), retention: rows(retention), traffic: rows(traffic) };
    } catch (e) {
      return { id, analyticsError: analyticsError(e) };
    }
  });
}

module.exports = { overview, video, clear: () => cache.clear() };
