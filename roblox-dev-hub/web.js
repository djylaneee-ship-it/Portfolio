// Récupération d'infos sur internet : métadonnées de liens, chaînes YouTube (RSS), recherche YouTube.
const { youtubeId, youtubeThumb } = require('./db');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function get(url, accept = 'text/html') {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'fr,en;q=0.8', ...(/youtube\.com/.test(url) && { Cookie: 'CONSENT=YES+cb; SOCS=CAI' }) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res;
}

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']*)["']/i);
  return c ? decode(c[1]) : '';
}

// Devine une catégorie à partir du texte (utilisé à l'import).
const GUESS = [
  ['vfx', /vfx|particle|particule|beam|trail|slash|explosion|aura|effect|effet/i],
  ['cutscenes', /cutscene|cinematic|cin[ée]matique|camera shot|plan cam[ée]ra/i],
  ['animation', /anim|moon animator|rig|r6|r15|keyframe|emote/i],
  ['gui', /\bgui\b|\bui\b|interface|hud|menu|button|bouton|screengui/i],
  ['gfx', /gfx|thumbnail|miniature|render|icon|icône|poster/i],
  ['modeling', /blender|model|mesh|uv|texture|sculpt|low ?poly/i],
  ['building', /build|map|terrain|lighting|éclairage|level design/i],
  ['audio', /sound|audio|music|musique|sfx/i],
  ['design', /game design|monetiz|monétis|retention|gamepass|devproduct/i],
  ['scripting', /script|luau|lua|code|datastore|remote|module|tween|oop/i],
];

function guessCategory(text) {
  for (const [cat, re] of GUESS) if (re.test(text)) return cat;
  return 'tools';
}

async function importUrl(url) {
  url = String(url).trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const vid = youtubeId(url);
  if (vid) {
    const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, 'application/json');
    const j = await res.json();
    return {
      title: j.title, url, type: 'video', author: j.author_name,
      thumbnail: youtubeThumb(url), category: guessCategory(j.title), source: 'youtube',
    };
  }
  if (/youtube\.com\/(@|channel\/|c\/)/i.test(url)) {
    const info = await resolveChannel(url);
    return { title: info.name, url, type: 'chaine', author: info.name, thumbnail: info.avatar, category: guessCategory(info.name), source: 'youtube' };
  }
  const res = await get(url);
  const type = res.headers.get('content-type') || '';
  if (type.startsWith('image/')) {
    return { title: url.split('/').pop(), url, type: 'image', thumbnail: url, category: 'gfx', source: 'web' };
  }
  const html = (await res.text()).slice(0, 400000);
  const title = meta(html, 'og:title') || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || url);
  const description = meta(html, 'og:description') || meta(html, 'description');
  return {
    title: title.trim(), url, description: description.slice(0, 400),
    thumbnail: meta(html, 'og:image'), author: meta(html, 'og:site_name'),
    type: /docs?|documentation|create\.roblox\.com/i.test(url) ? 'doc' : 'article',
    category: guessCategory(`${title} ${description} ${url}`), source: 'web',
  };
}

// Transforme @pseudo / URL de chaîne en identifiant UC... (nécessaire pour le flux RSS).
async function resolveChannel(input) {
  input = String(input).trim();
  let url;
  if (/^UC[\w-]{22}$/.test(input)) url = `https://www.youtube.com/channel/${input}`;
  else if (/^https?:\/\//i.test(input)) url = input;
  else url = `https://www.youtube.com/@${input.replace(/^@/, '')}`;
  const html = await (await get(url)).text();
  const id = (html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/) || html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
  if (!id) throw Object.assign(new Error('Channel not found: ' + input), { key: 'channelNotFound', vars: { name: input } });
  return {
    channelId: id,
    name: meta(html, 'og:title') || input,
    avatar: meta(html, 'og:image'),
    url: `https://www.youtube.com/channel/${id}`,
  };
}

// Les 15 dernières vidéos d'une chaîne via le flux RSS public (pas de clé API).
async function channelVideos(channelId) {
  const xml = await (await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, 'application/xml')).text();
  const entries = xml.split('<entry>').slice(1);
  return entries.map((e) => {
    const pick = (re) => decode((e.match(re) || [])[1] || '');
    const id = pick(/<yt:videoId>([^<]+)</);
    return {
      title: pick(/<title>([^<]*)<\/title>/),
      url: `https://www.youtube.com/watch?v=${id}`,
      author: pick(/<name>([^<]*)<\/name>/),
      description: pick(/<media:description>([\s\S]*?)<\/media:description>/).slice(0, 400),
      published: pick(/<published>([^<]+)</),
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }).filter((v) => v.title);
}

// Recherche YouTube : nécessite une clé YouTube Data API v3 (gratuite) dans les réglages.
async function youtubeSearch(query, apiKey, max = 20) {
  if (!apiKey) throw new Error('Ajoute une clé YouTube Data API dans Réglages pour chercher depuis l\'app.');
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.search = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: String(max), q: query, key: apiKey }).toString();
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.items.map((it) => ({
    title: decode(it.snippet.title),
    url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
    author: it.snippet.channelTitle,
    description: decode(it.snippet.description),
    published: it.snippet.publishedAt,
    thumbnail: `https://i.ytimg.com/vi/${it.id.videoId}/hqdefault.jpg`,
  }));
}

module.exports = { importUrl, resolveChannel, channelVideos, youtubeSearch, guessCategory };
