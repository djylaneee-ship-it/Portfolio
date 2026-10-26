// Moteur d'exploration : parcourt YouTube, le DevForum Roblox et Reddit pour référencer
// des milliers de vidéos, tutos et images. On ne stocke que des liens, titres et miniatures.
const { guessCategory, resolveChannel } = require('./web');
const quality = require('./quality');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// Cookies de consentement : sans eux, YouTube redirige les visiteurs européens vers une page d'accord.
const YT_COOKIE = 'CONSENT=YES+cb; SOCS=CAI';
const ROBLOX_RE = /roblox|rblx|luau|\bstudio\b|obby|\brbx/i;

const QUERIES = {
  scripting: ['roblox scripting tutorial', 'roblox studio scripting for beginners', 'roblox advanced scripting', 'roblox datastore tutorial', 'roblox remote events tutorial', 'roblox module scripts tutorial', 'roblox oop luau', 'roblox combat system tutorial', 'roblox hitbox tutorial', 'roblox inventory system tutorial', 'roblox pet system tutorial', 'roblox raycast tutorial', 'roblox npc ai pathfinding', 'tuto script roblox studio'],
  vfx: ['roblox vfx tutorial', 'roblox slash vfx', 'roblox anime vfx', 'roblox particle emitter tutorial', 'roblox beam vfx', 'roblox explosion vfx', 'roblox aura vfx', 'roblox lightning vfx', 'roblox vfx showcase', 'roblox flipbook vfx', 'roblox mesh vfx', 'tuto vfx roblox'],
  animation: ['roblox animation tutorial', 'moon animator 2 tutorial', 'roblox r6 animation', 'roblox combat animation', 'roblox walk animation tutorial', 'roblox animation showcase', 'roblox blender animation rig', 'roblox idle animation', 'tuto animation roblox'],
  cutscenes: ['roblox cutscene tutorial', 'roblox cinematic camera tutorial', 'roblox anime cutscene', 'roblox boss intro cutscene', 'roblox camera manipulation tutorial', 'roblox moon animator cutscene', 'tuto cutscene roblox'],
  gui: ['roblox ui design tutorial', 'roblox gui tutorial', 'roblox simulator ui', 'roblox shop gui tutorial', 'roblox ui tween animation', 'roblox hud tutorial', 'roblox loading screen tutorial', 'roblox ui showcase', 'tuto gui roblox'],
  gfx: ['roblox gfx tutorial', 'roblox gfx blender', 'roblox thumbnail tutorial', 'roblox game icon tutorial', 'roblox gfx speedart', 'roblox render blender lighting'],
  modeling: ['roblox blender modeling tutorial', 'roblox low poly modeling', 'roblox mesh import blender', 'roblox weapon modeling blender', 'roblox texture painting', 'roblox ugc modeling'],
  building: ['roblox building tutorial', 'roblox map building tips', 'roblox terrain tutorial', 'roblox lighting tutorial', 'roblox build showcase', 'roblox low poly map', 'roblox studio building speed build'],
  audio: ['roblox sound design', 'roblox music tutorial', 'roblox sound effects studio'],
  design: ['roblox game design tips', 'how to make a popular roblox game', 'roblox game monetization', 'roblox devlog', 'roblox game marketing', 'roblox player retention'],
  tools: ['best roblox studio plugins', 'roblox rojo tutorial', 'roblox studio tips and tricks', 'roblox studio shortcuts'],
};

// Recherches de chaînes : dev Roblox d'abord, puis tout le reste de l'univers Roblox.
const CHANNEL_QUERIES = {
  dev: ['roblox studio', 'roblox developer', 'roblox scripting', 'roblox vfx', 'roblox animator', 'roblox ui designer', 'roblox gfx', 'roblox builder', 'roblox modeler blender', 'roblox devlog', 'roblox game dev', 'luau', 'roblox tutorials', 'tuto roblox studio', 'roblox studio francais'],
  all: ['roblox', 'roblox gameplay', 'roblox youtuber', 'roblox funny', 'roblox news', 'roblox horror', 'roblox obby', 'roblox simulator', 'roblox tycoon', 'roblox anime game', 'roblox blox fruits', 'roblox adopt me', 'roblox brookhaven', 'roblox bedwars', 'roblox doors', 'roblox jailbreak', 'roblox piggy', 'roblox story', 'roblox shorts', 'roblox france', 'roblox fr', 'roblox espanol', 'roblox brasil', 'roblox deutsch', 'roblox tower defense', 'roblox pvp', 'roblox speedrun', 'roblox music video', 'roblox animation story', 'roblox memes'],
};

// Open source et systèmes gratuits.
const GITHUB_TOPICS = ['roblox', 'roblox-lua', 'luau', 'roblox-studio', 'roblox-game', 'roblox-plugin', 'roblox-library', 'roblox-framework', 'roblox-module', 'rojo', 'roblox-ts', 'wally'];
const GITHUB_QUERIES = ['roblox combat system', 'roblox inventory system', 'roblox datastore', 'roblox vfx', 'roblox ui library', 'roblox framework', 'roblox networking', 'roblox camera system', 'roblox character controller', 'roblox pathfinding', 'roblox anti cheat', 'roblox admin commands', 'roblox open source game', 'roblox animation', 'roblox building tools', 'roblox physics', 'roblox gun system', 'roblox pet system', 'roblox tycoon', 'roblox simulator'];
const STORE_MODELS = ['combat system', 'inventory system', 'pet system', 'datastore', 'admin commands', 'vfx pack', 'particles', 'sword', 'gun system', 'ui kit', 'shop gui', 'leaderboard', 'day night cycle', 'car chassis', 'door system', 'npc ai', 'tycoon kit', 'obby kit', 'simulator kit', 'round system', 'quest system', 'dialogue system', 'sprint stamina', 'emote system', 'loading screen', 'map', 'lighting preset', 'tree', 'house', 'low poly'];
const STORE_PLUGINS = ['animation', 'building', 'terrain', 'ui', 'vfx', 'scripting', 'lighting', 'modeling', 'rig', 'tween'];
const FORUM_RESOURCE_SEARCH = ['open source', 'open sourced', 'free system', 'module', 'framework', 'uncopylocked', 'free model', 'kit'];

const INTENSITY = {
  rapide: { ytPages: 1, forumPages: 1, redditLimit: 25, expandChannels: 0, browsePages: 2, ghPages: 1, storePages: 1, deepPages: 3 },
  normal: { ytPages: 2, forumPages: 2, redditLimit: 50, expandChannels: 15, browsePages: 10, ghPages: 3, storePages: 2, deepPages: 10 },
  massif: { ytPages: 5, forumPages: 4, redditLimit: 100, expandChannels: 60, browsePages: 40, ghPages: 10, storePages: 5, deepPages: 25 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = (t) => (t ? t.simpleText || (t.runs || []).map((r) => r.text).join('') : '');

async function http(url, opts = {}, tries = 3) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8,fr;q=0.6', ...(/youtube\.com/.test(url) && { Cookie: YT_COOKIE }), ...opts.headers },
    signal: AbortSignal.timeout(20000),
  });
  // Trop de requêtes : on patiente puis on réessaie.
  if (res.status === 429 && tries > 1) {
    await sleep((Number(res.headers.get('retry-after')) || 20) * 1000);
    return http(url, opts, tries - 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// Parcourt un objet JSON et collecte toutes les valeurs d'une clé donnée.
function collect(obj, key, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) { for (const v of obj) collect(v, key, out); return out; }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) out.push(v);
    else collect(v, key, out);
  }
  return out;
}

function parseVideoRenderers(data) {
  return collect(data, 'videoRenderer').filter((v) => v && v.videoId).map((v) => {
    const owner = (v.ownerText || v.longBylineText || {}).runs?.[0] || {};
    return {
      title: text(v.title),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      author: owner.text || '',
      channelId: owner.navigationEndpoint?.browseEndpoint?.browseId || '',
      description: collect(v.detailedMetadataSnippets, 'snippetText').map(text).join(' ').slice(0, 300),
      duration: text(v.lengthText),
      views: text(v.viewCountText),
      published: text(v.publishedTimeText),
    };
  });
}

function parseChannelRenderers(data) {
  return collect(data, 'channelRenderer').filter((c) => c && c.channelId).map((c) => {
    const thumbs = c.thumbnail?.thumbnails || [];
    let avatar = thumbs[thumbs.length - 1]?.url || '';
    if (avatar.startsWith('//')) avatar = 'https:' + avatar;
    return {
      channelId: c.channelId, name: text(c.title), avatar,
      // YouTube place le @pseudo dans subscriberCountText et les abonnés dans videoCountText selon les versions.
      subscribers: [text(c.subscriberCountText), text(c.videoCountText)].find((t) => /abonn|subscri/i.test(t)) || '',
      handle: [text(c.subscriberCountText), text(c.videoCountText)].find((t) => t.startsWith('@')) || '',
      description: text(c.descriptionSnippet),
    };
  });
}

async function youtubeChannelSearch(query, pages) {
  const html = await (await http(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAg%253D%253D`)).text();
  const data = extractInitialData(html);
  const version = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || '2.20250101.00.00';
  let out = parseChannelRenderers(data);
  let token = collect(data, 'continuationCommand')[0]?.token;
  for (let p = 1; p < pages && token; p++) {
    await sleep(600);
    const more = await (await http('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: version, hl: 'en', gl: 'US' } }, continuation: token }),
    })).json();
    out = out.concat(parseChannelRenderers(more));
    token = collect(more, 'continuationCommand')[0]?.token;
  }
  return out;
}

function extractInitialData(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s) || html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s);
  if (!m) throw new Error('YouTube page unreadable (consent page or blocked?)');
  return JSON.parse(m[1]);
}

// Recherche YouTube sans clé : page de résultats, puis pages suivantes via l'API interne du site.
async function youtubeSearch(query, pages, apiKey) {
  if (apiKey) return youtubeApiSearch(query, pages, apiKey);
  const html = await (await http(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`)).text();
  const data = extractInitialData(html);
  const version = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1] || '2.20250101.00.00';
  let videos = parseVideoRenderers(data);
  let token = collect(data, 'continuationCommand')[0]?.token;
  for (let p = 1; p < pages && token; p++) {
    await sleep(600);
    const res = await http('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: version, hl: 'en', gl: 'US' } }, continuation: token }),
    });
    const more = await res.json();
    videos = videos.concat(parseVideoRenderers(more));
    token = collect(more, 'continuationCommand')[0]?.token;
  }
  return videos;
}

async function youtubeApiSearch(query, pages, key) {
  let out = [];
  let pageToken = '';
  for (let p = 0; p < pages; p++) {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.search = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '50', q: query, key, ...(pageToken && { pageToken }) }).toString();
    const j = await (await http(u.toString())).json();
    out = out.concat(j.items.map((it) => ({
      title: decode(it.snippet.title), url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${it.id.videoId}/hqdefault.jpg`, author: it.snippet.channelTitle,
      channelId: it.snippet.channelId, description: decode(it.snippet.description), published: it.snippet.publishedAt,
    })));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

function parseChannelFeed(xml) {
  return xml.split('<entry>').slice(1).map((e) => {
    const pick = (re) => decode((e.match(re) || [])[1] || '');
    const id = pick(/<yt:videoId>([^<]+)</);
    return {
      title: pick(/<title>([^<]*)<\/title>/), url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, author: pick(/<name>([^<]*)<\/name>/),
      description: pick(/<media:description>([\s\S]*?)<\/media:description>/).slice(0, 300), published: pick(/<published>([^<]+)</),
    };
  }).filter((v) => v.title && !v.url.endsWith('='));
}

async function channelFeed(channelId) {
  return parseChannelFeed(await (await http(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)).text());
}

// DevForum (Discourse) : API JSON publique.
const FORUM = 'https://devforum.roblox.com';
function forumTopic(t) {
  let img = t.image_url || '';
  if (img && img.startsWith('/')) img = FORUM + img;
  return {
    title: decode(t.fancy_title || t.title), url: `${FORUM}/t/${t.slug}/${t.id}`, thumbnail: img,
    author: 'DevForum', description: t.excerpt ? decode(t.excerpt).replace(/<[^>]+>/g, '').slice(0, 300) : '',
    views: t.views ? `${t.views} vues` : '',
  };
}
async function forumSearch(query, pages) {
  let out = [];
  for (let p = 1; p <= pages; p++) {
    const j = await (await http(`${FORUM}/search.json?q=${encodeURIComponent(query)}&page=${p}`, { headers: { Accept: 'application/json' } })).json();
    const topics = j.topics || [];
    const blurbs = Object.fromEntries((j.posts || []).map((x) => [x.topic_id, x.blurb]));
    out = out.concat(topics.map((t) => forumTopic({ ...t, excerpt: t.excerpt || blurbs[t.id] })));
    if (!j.grouped_search_result?.more_full_page_results && topics.length < 20) break;
    await sleep(800);
  }
  return out;
}
async function forumBrowse(slug, pages, onPage) {
  for (let p = 0; p < pages; p++) {
    const j = await (await http(`${FORUM}/c/${slug}/l/latest.json?page=${p}`, { headers: { Accept: 'application/json' } })).json();
    const topics = j.topic_list?.topics || [];
    if (!topics.length) break;
    await onPage(topics.map(forumTopic), p);
    await sleep(800);
  }
}

// Reddit : r/robloxgamedev (captures, VFX, UI, builds…).
function parseReddit(j) {
  return (j.data?.children || []).map((c) => c.data).filter((d) => d && !d.over_18).map((d) => {
    const preview = d.preview?.images?.[0]?.source?.url;
    const isImg = d.post_hint === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(d.url || '');
    const thumb = decode(preview || (isImg ? d.url : '') || (/^https?:/.test(d.thumbnail) ? d.thumbnail : ''));
    return {
      title: decode(d.title), url: `https://www.reddit.com${d.permalink}`, thumbnail: thumb,
      author: 'r/' + d.subreddit, type: isImg ? 'image' : d.is_video ? 'video' : 'article',
      description: decode(d.selftext || '').slice(0, 300), views: d.score ? `${d.score} votes` : '',
    };
  });
}
async function redditSearch(query, limit) {
  const u = `https://www.reddit.com/r/robloxgamedev/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=all&limit=${limit}`;
  return parseReddit(await (await http(u, { headers: { Accept: 'application/json' } })).json());
}

// GitHub : API de recherche publique (10 requêtes/min sans jeton, 30 avec).
function githubRepo(r) {
  return {
    title: r.full_name, url: r.html_url,
    thumbnail: `https://opengraph.githubassets.com/1/${r.full_name}`,
    author: r.owner?.login || '', type: 'opensource', stars: r.stargazers_count || 0,
    description: [r.description, r.stargazers_count != null && `★ ${r.stargazers_count}`, r.language, r.license?.spdx_id].filter(Boolean).join(' · ').slice(0, 400),
    tags: (r.topics || []).slice(0, 6),
  };
}
async function githubSearch(q, page, token) {
  const u = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`;
  const res = await fetch(u, {
    headers: { 'User-Agent': 'roblox-dev-hub', Accept: 'application/vnd.github+json', ...(token && { Authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached (add a GitHub token in Settings)');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return { total: j.total_count || 0, items: (j.items || []).filter((r) => !r.fork || r.stargazers_count > 5).map(githubRepo) };
}

// Creator Store Roblox : modèles et plugins gratuits.
const STORE_CAT = { model: 10, plugin: 38 };
async function storeSearch(keyword, kind, pages) {
  let ids = [];
  let cursor = '';
  for (let p = 0; p < pages; p++) {
    const u = `https://apis.roblox.com/toolbox-service/v1/marketplace/${STORE_CAT[kind]}?keyword=${encodeURIComponent(keyword)}&limit=30${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
    const j = await (await http(u, { headers: { Accept: 'application/json' } })).json();
    ids = ids.concat((j.data || []).map((d) => d.id));
    cursor = j.nextPageCursor;
    if (!cursor) break;
    await sleep(500);
  }
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const [details, thumbs] = await Promise.all([
      http(`https://apis.roblox.com/toolbox-service/v1/items/details?assetIds=${chunk.join(',')}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()),
      http(`https://thumbnails.roblox.com/v1/assets?assetIds=${chunk.join(',')}&size=420x420&format=Png`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).catch(() => ({ data: [] })),
    ]);
    const img = Object.fromEntries((thumbs.data || []).map((t) => [t.targetId, t.imageUrl]));
    for (const d of details.data || []) {
      const a = d.asset || {};
      if (!a.id) continue;
      const votes = d.voting ? `👍 ${d.voting.upVotes ?? ''}` : '';
      out.push({
        title: a.name, url: `https://create.roblox.com/store/asset/${a.id}`, thumbnail: img[a.id] || '',
        author: d.creator?.name || '', type: 'asset',
        description: [kind === 'plugin' ? 'Plugin' : 'Modèle gratuit', votes, (a.description || '').slice(0, 250)].filter(Boolean).join(' · '),
        tags: [kind === 'plugin' ? 'plugin' : 'modele'],
      });
    }
    await sleep(500);
  }
  return out;
}

// --- Sources supplémentaires (exploration en profondeur) ---

// Une page de la liste « latest » d'une catégorie du DevForum.
async function forumPage(slug, page) {
  const j = await (await http(`${FORUM}/c/${slug}/l/latest.json?page=${page}`, { headers: { Accept: 'application/json' } })).json();
  return (j.topic_list?.topics || []).map(forumTopic);
}

// Bluesky : recherche publique de posts (images et vidéos de devs Roblox).
async function blueskySearch(q, cursor) {
  const u = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=100&sort=latest${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
  const j = await (await http(u, { headers: { Accept: 'application/json' } })).json();
  const items = (j.posts || []).map((p) => {
    const e = p.embed || {};
    const media = e.media || e;
    const img = (media.images || [])[0];
    const thumb = img ? img.thumb || img.fullsize : media.thumbnail || (media.external && media.external.thumb) || '';
    const handle = p.author?.handle || '';
    const txt = String(p.record?.text || '').trim();
    return {
      title: (txt.split('\n')[0] || `${p.author?.displayName || handle} on Bluesky`).slice(0, 140),
      url: `https://bsky.app/profile/${handle}/post/${String(p.uri || '').split('/').pop()}`,
      thumbnail: thumb, author: p.author?.displayName || handle,
      type: img ? 'image' : media.thumbnail ? 'video' : 'article',
      description: txt.slice(0, 300), views: p.likeCount ? `${p.likeCount} likes` : '', published: p.record?.createdAt || '',
    };
  });
  return { items, cursor: j.cursor || '' };
}

// Reddit (souvent bloqué depuis les serveurs : l'erreur est simplement notée).
async function redditNew(sub, after) {
  const j = await (await http(`https://www.reddit.com/r/${sub}/new.json?limit=100${after ? '&after=' + after : ''}`, { headers: { Accept: 'application/json' } })).json();
  return { items: parseReddit(j), cursor: j.data?.after || '' };
}

// Sketchfab : modèles 3D Roblox (miniatures).
async function sketchfabSearch(q, cursor) {
  const j = await (await http(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(q)}&count=24${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, { headers: { Accept: 'application/json' } })).json();
  const items = (j.results || []).map((m) => {
    const imgs = (m.thumbnails?.images || []).sort((a, b) => Math.abs(a.width - 640) - Math.abs(b.width - 640));
    return {
      title: m.name, url: m.viewerUrl || `https://sketchfab.com/3d-models/${m.uid}`, thumbnail: imgs[0]?.url || '',
      author: m.user?.displayName || m.user?.username || '', type: 'image',
      description: String(m.description || '').replace(/\s+/g, ' ').slice(0, 300), views: m.likeCount ? `${m.likeCount} likes` : '',
    };
  });
  return { items, cursor: j.cursors?.next || '' };
}

// dev.to : articles par tag.
async function devtoTag(tag, page) {
  const j = await (await http(`https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&per_page=100&page=${page}`, { headers: { Accept: 'application/json' } })).json();
  return (Array.isArray(j) ? j : []).map((a) => ({
    title: a.title, url: a.url, thumbnail: a.cover_image || a.social_image || '', author: a.user?.name || '',
    type: 'article', description: String(a.description || '').slice(0, 300), published: a.published_at || '',
  }));
}

// Creator Store : images (decals) et meshes, page par page avec curseur.
const STORE_KIND = { decal: 13, mesh: 40 };
async function storePage(keyword, kind, cursor) {
  const u = `https://apis.roblox.com/toolbox-service/v1/marketplace/${STORE_KIND[kind]}?keyword=${encodeURIComponent(keyword)}&limit=30${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
  const j = await (await http(u, { headers: { Accept: 'application/json' } })).json();
  const ids = (j.data || []).map((d) => d.id);
  if (!ids.length) return { items: [], cursor: '' };
  const [details, thumbs] = await Promise.all([
    http(`https://apis.roblox.com/toolbox-service/v1/items/details?assetIds=${ids.join(',')}`, { headers: { Accept: 'application/json' } }).then((r) => r.json()),
    http(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids.join(',')}&size=420x420&format=Png`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).catch(() => ({ data: [] })),
  ]);
  const img = Object.fromEntries((thumbs.data || []).map((t) => [t.targetId, t.imageUrl]));
  const items = (details.data || []).filter((d) => d.asset && d.asset.id).map((d) => ({
    title: d.asset.name, url: `https://create.roblox.com/store/asset/${d.asset.id}`, thumbnail: img[d.asset.id] || '',
    author: d.creator?.name || '', type: kind === 'decal' ? 'image' : 'asset',
    description: [kind === 'decal' ? 'Image (Decal)' : 'Mesh', (d.asset.description || '').slice(0, 250)].filter(Boolean).join(' · '),
    tags: [kind === 'decal' ? 'image' : 'mesh'],
  }));
  return { items, cursor: j.nextPageCursor || '' };
}

// Toutes les sources lues en profondeur : chacune a un curseur gardé d'un passage à l'autre.
const FORUM_FEEDS = [
  ['help-and-feedback/scripting-support', 'scripting', 'article'], ['help-and-feedback/building-support', 'building', 'article'],
  ['help-and-feedback/art-design-support', 'gfx', 'article'], ['help-and-feedback/game-design-support', 'design', 'article'],
  ['help-and-feedback/creations-feedback', '', 'article'], ['resources/community-tutorials', '', 'article'],
  ['resources/community-resources', '', 'opensource'], ['updates/announcements', 'tools', 'article'],
];
const BSKY_QUERIES = ['roblox studio', 'robloxdev', 'roblox dev', 'roblox vfx', 'roblox ui design', 'roblox gfx', 'roblox animation', 'roblox build', 'roblox modeling', 'luau', 'roblox scripting', 'roblox game dev', 'roblox showcase'];
const REDDIT_SUBS = ['robloxgamedev', 'RobloxDevelopers', 'ROBLOXStudio', 'RobloxGFX', 'robloxdev'];
const SKETCH_QUERIES = ['roblox', 'roblox low poly', 'roblox ugc', 'roblox map', 'roblox weapon', 'roblox character', 'roblox building', 'roblox pet'];
const DEVTO_TAGS = ['roblox', 'luau', 'robloxdev', 'gamedev'];
const STORE_DEEP = [
  ...['ui', 'icon', 'button', 'frame', 'background', 'texture', 'particle', 'vfx', 'slash', 'smoke', 'fire', 'glow', 'sparkle', 'aura', 'gradient', 'logo', 'emoji', 'sky', 'grass', 'stone', 'wood', 'brick', 'anime', 'cartoon'].map((k) => [k, 'decal']),
  ...['sword', 'gun', 'tree', 'rock', 'house', 'car', 'pet', 'egg', 'crystal', 'chest', 'weapon', 'low poly', 'furniture'].map((k) => [k, 'mesh']),
];
const DEEP_FEEDS = [
  ...FORUM_FEEDS.map(([slug, cat, type]) => ({ id: 'forum:' + slug, src: 'devforum', cat, type, label: 'DevForum ' + slug.split('/').pop(), page: (c) => forumPage(slug, c || 0).then((items) => ({ items, cursor: items.length ? (c || 0) + 1 : 0 })) })),
  ...BSKY_QUERIES.map((q) => ({ id: 'bsky:' + q, src: 'bluesky', cat: '', type: 'article', label: 'Bluesky ' + q, social: true, page: (c) => blueskySearch(q, c) })),
  ...REDDIT_SUBS.map((sub) => ({ id: 'reddit:' + sub, src: 'reddit', cat: '', type: 'article', label: 'r/' + sub, social: true, page: (c) => redditNew(sub, c) })),
  ...SKETCH_QUERIES.map((q) => ({ id: 'sketchfab:' + q, src: 'sketchfab', cat: 'modeling', type: 'image', label: 'Sketchfab ' + q, page: (c) => sketchfabSearch(q, c) })),
  ...DEVTO_TAGS.map((tag) => ({ id: 'devto:' + tag, src: 'devto', cat: '', type: 'article', label: 'dev.to #' + tag, social: tag === 'gamedev', page: (c) => devtoTag(tag, (c || 0) + 1).then((items) => ({ items, cursor: items.length ? (c || 0) + 1 : 0 })) })),
  ...STORE_DEEP.map(([k, kind]) => ({ id: `store:${kind}:${k}`, src: 'store', cat: kind === 'decal' ? 'gui' : 'modeling', type: kind === 'decal' ? 'image' : 'asset', label: `Store ${kind} ${k}`, page: (c) => storePage(k, kind, c) })),
];

const LOG_EN = {
  stopping: 'Stopping…', error: 'Error: {msg}', done: 'Done: {added} new resources, {channels} new channels, {rejected} off-topic rejected.',
  chanQuery: '"{q}": {found} channels found, +{n} linked', query: '"{q}": +{n}', forumRes: 'DevForum resources page {page}: +{n}',
  storeModels: 'Store models "{q}": +{n}', storePlugins: 'Store plugins "{q}": +{n}', syncStart: 'Fetching videos from {n} channels…',
  chanVideos: '{name}: +{n} videos', fail: '{label}: {msg}', expandStart: 'Exploring {n} discovered Roblox channels…',
  forumTutStart: 'Browsing DevForum community tutorials…', forumTut: 'DevForum tutorials page {page}: +{n}',
  feed: '{label}: +{n} ({pages} pages)', feedEnd: '{label}: end reached, starting over', feedSkip: '{label}: skipped ({msg})',
};
const fmt = (k, p = {}) => (LOG_EN[k] || k).replace(/\{(\w+)\}/g, (_, v) => p[v] ?? '');

class Crawler {
  // seen (facultatif) : ensemble { has, add } des adresses déjà connues, quand la base n'est pas en mémoire.
  constructor({ getState, persist, upsert, newId, seen }) {
    Object.assign(this, { getState, persist, upsert, newId, seen });
    this.status = { running: false };
  }

  // Journal : clé + paramètres (traduits par l'interface) et texte anglais pour la console.
  log(k, p = {}, err) {
    const l = this.status.log;
    l.unshift({ t: new Date().toISOString(), k, p, msg: fmt(k, p), err: Boolean(err) });
    if (l.length > 80) l.length = 80;
  }

  add(items, { category, type, source, tags, social: forceSocial }) {
    let added = 0;
    for (const it of items) {
      if (!it.title || !it.url) continue;
      this.status.found++;
      if (this.urls.has(it.url)) continue;
      // Filtre qualité : YouTube et Reddit doivent parler de dev Roblox ; ailleurs on écarte la triche.
      const social = forceSocial ?? (source === 'youtube' || source === 'reddit');
      if (social ? !quality.check(it).ok : quality.isBanned(it)) { this.status.rejected++; continue; }
      this.urls.add(it.url);
      const cat = category || guessCategory(it.title);
      this.upsert({
        title: it.title, url: it.url, thumbnail: it.thumbnail, author: it.author, category: cat, stars: it.stars,
        type: it.type || type, description: [it.description, it.duration && `Durée ${it.duration}`, it.views, it.published].filter(Boolean).join(' · '),
        tags: [...tags, ...(it.tags || []), source], source: 'exploration',
      });
      added++;
    }
    this.status.added += added;
    return added;
  }

  // Ajoute une chaîne aux chaînes suivies (sans doublon). Renvoie true si elle est nouvelle.
  follow(ch, category) {
    const st = this.getState();
    if (!ch.channelId || st.channels.some((c) => c.channelId === ch.channelId)) return false;
    st.channels.push({
      id: this.newId(), handle: ch.handle || ch.channelId, name: ch.name, avatar: ch.avatar || '',
      channelId: ch.channelId, category: category || '', subscribers: ch.subscribers || '',
      lastFetch: null, auto: true,
    });
    const url = `https://www.youtube.com/channel/${ch.channelId}`;
    if (this.urls.has(url)) return true;
    this.urls.add(url);
    this.upsert({
      title: ch.name, url, type: 'chaine', author: ch.name,
      thumbnail: ch.avatar, category: category || guessCategory(ch.name + ' ' + (ch.description || '')),
      description: [ch.subscribers, ch.description].filter(Boolean).join(' · '), tags: ['chaine', 'youtube'], source: 'exploration',
    });
    this.status.channels = (this.status.channels || 0) + 1;
    return true;
  }

  // Progression par source (barres de la page Exploration).
  plan(src, total, add) {
    const p = this.status.progress[src] || { done: 0, total: 0 };
    p.total = add ? p.total + total : total;
    this.status.progress[src] = p;
  }

  tick(src) {
    const p = this.status.progress[src];
    if (p) p.done = Math.min(p.total, p.done + 1);
  }

  stop() { if (this.status.running) { this.status.cancel = true; this.log('stopping'); } }

  start(opts = {}) {
    if (this.status.running) throw Object.assign(new Error('A task is already running'), { key: 'jobRunning' });
    const mode = opts.mode || 'explore';
    const level = INTENSITY[opts.intensity] || INTENSITY.normal;
    this.status = {
      running: true, cancel: false, mode, startedAt: new Date().toISOString(), finishedAt: null,
      intensity: opts.intensity || 'normal', step: 0, steps: 1, current: null, found: 0, added: 0, channels: 0, rejected: 0, errors: 0, log: [], progress: {},
    };
    this.urls = this.seen || new Set(this.getState().resources.map((r) => r.url).filter(Boolean));
    let job;
    if (mode === 'channels') {
      const queries = CHANNEL_QUERIES.dev.concat(opts.scope === 'all' ? CHANNEL_QUERIES.all : []);
      this.status.steps = queries.length + (opts.syncAfter ? 1 : 0);
      this.plan('youtube', queries.length);
      job = this.discover(queries, level, opts);
    } else if (mode === 'opensource') {
      const src = opts.sources && opts.sources.length ? opts.sources : ['github', 'devforum', 'store'];
      this.status.sources = src;
      if (src.includes('github')) this.plan('github', GITHUB_TOPICS.length + GITHUB_QUERIES.length);
      if (src.includes('devforum')) this.plan('devforum', FORUM_RESOURCE_SEARCH.length + 1);
      if (src.includes('store')) this.plan('store', STORE_MODELS.length + STORE_PLUGINS.length);
      this.status.steps = (src.includes('github') ? GITHUB_TOPICS.length + GITHUB_QUERIES.length : 0)
        + (src.includes('devforum') ? FORUM_RESOURCE_SEARCH.length + 1 : 0)
        + (src.includes('store') ? STORE_MODELS.length + STORE_PLUGINS.length : 0);
      job = this.openSource(src, level, opts.githubToken);
    } else if (mode === 'sync') {
      job = this.sync();
    } else if (mode === 'deep' || mode === 'fresh') {
      // deep : chaque source reprend à son curseur et avance de plusieurs pages ; fresh : la première page de tout.
      const feeds = DEEP_FEEDS.filter((f) => !opts.sources || !opts.sources.length || opts.sources.includes(f.src));
      this.status.sources = [...new Set(feeds.map((f) => f.src))];
      this.status.steps = feeds.length;
      for (const src of this.status.sources) this.plan(src, feeds.filter((f) => f.src === src).length);
      job = this.deep(feeds, mode === 'fresh' ? 1 : opts.pages || level.deepPages, mode === 'fresh');
    } else {
      const cats = (opts.categories && opts.categories.length ? opts.categories : Object.keys(QUERIES)).filter((c) => QUERIES[c]);
      const sources = opts.sources && opts.sources.length ? opts.sources : ['youtube', 'devforum', 'reddit'];
      const jobs = cats.flatMap((c) => QUERIES[c].map((q) => ({ c, q })));
      this.status.sources = sources;
      this.status.steps = jobs.length + (sources.includes('youtube') && level.expandChannels ? 1 : 0) + (sources.includes('devforum') ? 1 : 0);
      for (const src of sources) this.plan(src, jobs.length + (src === 'devforum' ? 1 : 0) + (src === 'youtube' && level.expandChannels ? 1 : 0));
      job = this.run(jobs, sources, level, opts.apiKey);
    }
    this.done = job.catch((e) => this.log('error', { msg: e.message }, true)).finally(() => {
      this.status.running = false;
      this.status.finishedAt = new Date().toISOString();
      this.status.current = null;
      this.persist();
      this.log('done', { added: this.status.added, channels: this.status.channels, rejected: this.status.rejected });
    });
    return this.status;
  }

  // Cherche des chaînes Roblox sur YouTube et les suit automatiquement.
  async discover(queries, level, opts) {
    const pages = Math.max(2, level.ytPages);
    for (const q of queries) {
      if (this.status.cancel) return;
      this.status.step++;
      this.status.current = { k: 'channels', p: { q } };
      const found = await this.safe(`Channels "${q}"`, () => youtubeChannelSearch(q, pages));
      this.tick('youtube');
      if (found) {
        // Recherche « roblox … » : YouTube renvoie des chaînes Roblox. Sinon on exige « roblox » dans la fiche.
        const keep = /roblox/i.test(q) ? found : found.filter((c) => ROBLOX_RE.test(`${c.name} ${c.handle} ${c.description}`));
        const gameplay = CHANNEL_QUERIES.all.includes(q);
        this.status.found += found.length;
        let n = 0;
        for (const c of keep) {
          if (quality.check({ title: c.name, description: c.description }, { minScore: -2 }).score <= -3) { this.status.rejected++; continue; }
          const cat = gameplay ? 'gameplay' : guessCategory(`${c.name} ${c.description} ${q}`);
          if (this.follow(c, cat)) n++;
        }
        this.log('chanQuery', { q, found: found.length, n });
      }
      this.persist();
      await sleep(800);
    }
    if (opts.syncAfter && !this.status.cancel) { this.status.step++; await this.sync(true); }
  }

  // Dépôts open source, ressources communautaires et modèles/plugins gratuits.
  async openSource(src, level, token) {
    const gap = token ? 2200 : 6500; // respecte la limite de recherche GitHub
    if (src.includes('github')) {
      const qs = GITHUB_TOPICS.map((t) => ({ q: `topic:${t}`, label: `topic ${t}` }))
        .concat(GITHUB_QUERIES.map((q) => ({ q: `${q} in:name,description,readme`, label: q })));
      for (const { q, label } of qs) {
        if (this.status.cancel) return;
        this.status.step++;
        let n = 0;
        for (let p = 1; p <= level.ghPages; p++) {
          if (this.status.cancel) return;
          this.status.current = { k: 'github', p: { q: label, page: p } };
          const res = await this.safe(`GitHub "${label}"`, () => githubSearch(q, p, token));
          await sleep(gap);
          if (!res) break;
          for (const r of res.items) n += this.add([r], { category: guessCategory(`${r.title} ${r.description} ${r.tags.join(' ')}`), type: 'opensource', source: 'github', tags: ['open source', ...r.tags] });
          if (res.items.length < 100 || p * 100 >= Math.min(res.total, 1000)) break;
        }
        this.log('query', { q: 'GitHub ' + label, n });
        this.tick('github');
        this.persist();
      }
    }
    if (src.includes('devforum') && !this.status.cancel) {
      for (const q of FORUM_RESOURCE_SEARCH) {
        if (this.status.cancel) return;
        this.status.step++;
        this.status.current = { k: 'query', p: { q: 'DevForum ' + q } };
        const topics = await this.safe(`DevForum "${q}"`, () => forumSearch(`${q} #resources:community-resources`, level.forumPages));
        this.tick('devforum');
        if (topics) this.log('query', { q: 'DevForum ' + q, n: this.add(topics.map((t) => ({ ...t, type: 'opensource' })), { category: '', type: 'opensource', source: 'devforum', tags: ['open source', 'ressource'] }) });
        this.persist();
        await sleep(800);
      }
      this.status.step++;
      this.tick('devforum');
      await this.safe('DevForum resources', () => forumBrowse('resources/community-resources', level.browsePages, async (topics, p) => {
        if (this.status.cancel) throw new Error('stopped');
        this.status.current = { k: 'forumRes', p: { page: p + 1 } };
        const n = this.add(topics.map((t) => ({ ...t, type: 'opensource' })), { category: '', type: 'opensource', source: 'devforum', tags: ['open source', 'ressource'] });
        this.log('forumRes', { page: p + 1, n });
        this.persist();
      }));
    }
    if (src.includes('store') && !this.status.cancel) {
      const jobs = STORE_MODELS.map((k) => ({ k, kind: 'model' })).concat(STORE_PLUGINS.map((k) => ({ k, kind: 'plugin' })));
      for (const { k, kind } of jobs) {
        if (this.status.cancel) return;
        this.status.step++;
        this.status.current = { k: kind === 'plugin' ? 'storePlugins' : 'storeModels', p: { q: k } };
        const items = await this.safe(`Store "${k}"`, () => storeSearch(k, kind, level.storePages));
        this.tick('store');
        if (items) {
          const cat = kind === 'plugin' ? 'tools' : '';
          this.log(kind === 'plugin' ? 'storePlugins' : 'storeModels', { q: k, n: this.add(items, { category: cat, type: 'asset', source: 'creator-store', tags: [k, 'gratuit'] }) });
        }
        this.persist();
        await sleep(600);
      }
    }
  }

  // Récupère les dernières vidéos de toutes les chaînes suivies (flux RSS publics).
  async sync(nested) {
    const chans = this.getState().channels;
    if (!nested) this.status.steps = chans.length;
    else this.status.steps += chans.length;
    this.plan('youtube', chans.length, nested);
    this.log('syncStart', { n: chans.length });
    for (const ch of chans) {
      if (this.status.cancel) return;
      this.status.step++;
      this.status.current = { k: 'videosOf', p: { name: ch.name || ch.handle } };
      this.tick('youtube');
      if (!ch.channelId) {
        const info = await this.safe(`Channel ${ch.handle}`, () => resolveChannel(ch.handle));
        if (!info) continue;
        Object.assign(ch, { channelId: info.channelId, name: ch.name || info.name, avatar: info.avatar });
      }
      const feed = await this.safe(`Channel ${ch.name}`, () => channelFeed(ch.channelId));
      if (feed) {
        const n = this.add(feed, { category: ch.category || '', type: 'video', source: 'youtube', tags: [ch.name || ch.handle] });
        ch.lastFetch = new Date().toISOString();
        if (n) this.log('chanVideos', { name: ch.name, n });
      }
      if (this.status.step % 10 === 0) this.persist();
      await sleep(350);
    }
    this.persist();
  }

  async deep(feeds, pages, fresh) {
    const st = this.getState();
    const cursors = (st.cursors = st.cursors || {});
    const blocked = new Set(); // source qui refuse l'accès : ignorée pour la fin du passage
    for (const f of feeds) {
      if (this.status.cancel) return;
      this.status.step++;
      this.status.current = { k: 'query', p: { q: f.label } };
      this.tick(f.src);
      if (blocked.has(f.src)) continue;
      let c = fresh ? undefined : cursors[f.id];
      let n = 0;
      let done = 0;
      for (let i = 0; i < pages; i++) {
        if (this.status.cancel) break;
        let res;
        try { res = await f.page(c); } catch (e) {
          this.status.errors++;
          if (/HTTP (401|403|451)/.test(e.message)) blocked.add(f.src);
          this.log('feedSkip', { label: f.label, msg: e.message }, true);
          break;
        }
        done++;
        n += this.add(res.items, { category: f.cat, type: f.type, source: f.src, tags: [f.src], social: Boolean(f.social) });
        if (!res.cursor || !res.items.length) {
          if (!fresh) { delete cursors[f.id]; this.log('feedEnd', { label: f.label }); }
          break;
        }
        c = res.cursor;
        if (!fresh) cursors[f.id] = c;
        await sleep(f.src === 'devforum' ? 900 : 600);
      }
      this.log('feed', { label: f.label, n, pages: done });
      this.persist();
    }
  }

  async safe(label, fn) {
    try { return await fn(); }
    catch (e) { this.status.errors++; this.log('fail', { label, msg: e.message }, true); return null; }
  }

  async run(jobs, sources, level, apiKey) {
    const channels = new Map(); // channelId -> { n, cats }
    for (const { c, q } of jobs) {
      if (this.status.cancel) return;
      this.status.step++;
      this.status.current = { k: 'query', p: { q } };
      const plain = q.replace(/\broblox( studio)?\b/gi, '').trim() || q;
      let n = 0;
      if (sources.includes('youtube')) {
        const vids = await this.safe(`YouTube "${q}"`, () => youtubeSearch(q, level.ytPages, apiKey));
        this.tick('youtube');
        if (vids) {
          const keep = vids.filter((v) => ROBLOX_RE.test(v.title + ' ' + v.author));
          for (const v of keep) {
            if (!v.channelId) continue;
            const ch = channels.get(v.channelId) || { n: 0, cats: {}, name: v.author };
            ch.n++; ch.cats[c] = (ch.cats[c] || 0) + 1;
            channels.set(v.channelId, ch);
          }
          n += this.add(keep, { category: c, type: 'video', source: 'youtube', tags: [plain] });
        }
        await sleep(700);
      }
      if (sources.includes('devforum') && !this.status.cancel) {
        const topics = await this.safe(`DevForum "${plain}"`, () => forumSearch(plain, level.forumPages));
        this.tick('devforum');
        if (topics) n += this.add(topics, { category: c, type: 'article', source: 'devforum', tags: [plain] });
        await sleep(700);
      }
      if (sources.includes('reddit') && !this.status.cancel) {
        const posts = await this.safe(`Reddit "${plain}"`, () => redditSearch(plain, level.redditLimit));
        this.tick('reddit');
        if (posts) n += this.add(posts, { category: c, type: 'article', source: 'reddit', tags: [plain] });
        await sleep(1200);
      }
      this.log('query', { q, n });
      this.persist();
    }

    // Les chaînes qui reviennent souvent sont des chaînes Roblox : on récupère aussi leurs dernières vidéos.
    if (sources.includes('youtube') && level.expandChannels && !this.status.cancel) {
      this.status.step++;
      const top = [...channels.entries()].filter(([, v]) => v.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, level.expandChannels);
      this.log('expandStart', { n: top.length });
      this.tick('youtube');
      for (const [id, info] of top) {
        if (this.status.cancel) return;
        this.status.current = { k: 'videosOf', p: { name: info.name } };
        this.follow({ channelId: id, name: info.name }, Object.entries(info.cats).sort((a, b) => b[1] - a[1])[0][0]);
        const feed = await this.safe(`Channel ${info.name}`, () => channelFeed(id));
        if (feed) {
          const main = Object.entries(info.cats).sort((a, b) => b[1] - a[1])[0][0];
          const keep = feed.filter((v) => ROBLOX_RE.test(v.title + ' ' + v.description));
          const n = this.add(keep, { category: '', type: 'video', source: 'youtube', tags: [info.name] });
          // Catégorie : devinée depuis le titre, sinon la catégorie dominante de la chaîne.
          for (const v of keep) {
            const r = this.getState().resources.find((x) => x.url === v.url && x.source === 'exploration');
            if (r && r.category === 'tools' && !/plugin|tool|outil/i.test(v.title)) r.category = main;
          }
          if (n) this.log('chanVideos', { name: info.name, n });
        }
        await sleep(500);
      }
      this.persist();
    }

    // Parcours des tutoriels communautaires du DevForum, page par page.
    if (sources.includes('devforum') && !this.status.cancel) {
      this.status.step++;
      this.log('forumTutStart');
      this.tick('devforum');
      await this.safe('DevForum tutorials', () => forumBrowse('resources/community-tutorials', level.browsePages, async (topics, p) => {
        if (this.status.cancel) throw new Error('stopped');
        this.status.current = { k: 'forumTut', p: { page: p + 1 } };
        const n = this.add(topics, { category: '', type: 'article', source: 'devforum', tags: ['tutoriel'] });
        this.log('forumTut', { page: p + 1, n });
        this.persist();
      }));
    }
  }
}

module.exports = { DEEP_FEEDS, blueskySearch, sketchfabSearch, devtoTag, storePage, forumPage, redditNew, githubRepo, githubSearch, storeSearch, Crawler, youtubeSearch, QUERIES, CHANNEL_QUERIES, INTENSITY, parseVideoRenderers, parseChannelRenderers, parseChannelFeed, parseReddit, forumTopic, extractInitialData };
