// Algo d'exploration « cloud » : tourne sur GitHub Actions en continu (un passage par heure, ~52 min).
// Chaque passage reprend là où le précédent s'est arrêté. Les trouvailles partent au fil de l'eau dans la
// bibliothèque en ligne (Supabase, table rovex.library) ; les apps récupèrent les nouveautés toutes les 5 min.
// La mémoire de l'algo (curseurs, chaînes suivies, adresses déjà vues) reste dans cloud/state.json et
// cloud/seen.txt. Sans clé d'exploration (ROVEX_CRAWLER_KEY), on retombe sur l'ancien fichier
// cloud/library.json.
//
// Usage local : ROVEX_CRAWLER_KEY=… node cloud-crawl.js [minutes]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { Crawler } = require('./crawler');
const quality = require('./quality');
const cloud = require('./cloud');

const DIR = path.join(__dirname, 'cloud');
const LEGACY = path.join(DIR, 'library.json');
const STATE = path.join(DIR, 'state.json');
const SEEN = path.join(DIR, 'seen.txt');
const KEY = process.env.ROVEX_CRAWLER_KEY || '';
const BUDGET_MIN = Number(process.argv[2] || process.env.CRAWL_MINUTES || 52);

// Tâches enchaînées en boucle, d'un passage à l'autre. « fresh » (la première page de chaque source) revient
// souvent pour que les nouveautés arrivent vite ; « deep » descend chaque fois plus loin dans l'historique.
const CYCLE = [
  { mode: 'fresh' },
  { mode: 'deep', intensity: 'normal' },
  { mode: 'fresh' },
  { mode: 'sync' },
  { mode: 'fresh' },
  { mode: 'deep', intensity: 'massif' },
  { mode: 'fresh' },
  { mode: 'explore', intensity: 'normal', sources: ['youtube', 'devforum'] },
  { mode: 'fresh' },
  { mode: 'deep', intensity: 'normal' },
  { mode: 'opensource', intensity: 'normal' },
  { mode: 'fresh' },
  { mode: 'channels', scope: 'dev', intensity: 'normal' },
  { mode: 'deep', intensity: 'massif' },
];

const hash = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 14);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// Mémoire de l'algo : reprise de l'ancien fichier au premier passage.
const legacy = fs.existsSync(LEGACY) ? readJson(LEGACY, null) : null;
const state = readJson(STATE, null) || {
  version: 2, cursor: legacy ? legacy.cursor || 0 : 0, runs: legacy ? legacy.runs || 0 : 0,
  channels: legacy ? legacy.channels || [] : [], cursors: {}, migrated: false,
};
state.resources = []; // ressources trouvées et pas encore envoyées
const seenSet = new Set(fs.existsSync(SEEN) ? fs.readFileSync(SEEN, 'utf8').split('\n').filter(Boolean) : []);
if (!seenSet.size && legacy) for (const r of legacy.resources || []) if (r.url) seenSet.add(hash(r.url));
const seen = { has: (u) => seenSet.has(hash(u)), add: (u) => seenSet.add(hash(u)) };

function saveMemory() {
  fs.mkdirSync(DIR, { recursive: true });
  const { resources, ...rest } = state;
  fs.writeFileSync(STATE, JSON.stringify({ ...rest, updatedAt: new Date().toISOString() }, null, 1));
  fs.writeFileSync(SEEN, [...seenSet].sort().join('\n') + '\n');
}

// Ce qu'on envoie pour chaque ressource (sans les champs propres à une app).
const compact = (r) => ({
  title: r.title, url: r.url, thumbnail: r.thumbnail || '', author: r.author || '', category: r.category, type: r.type,
  description: String(r.description || '').slice(0, 400), tags: (r.tags || []).slice(0, 8), stars: r.stars || 0,
  createdAt: r.createdAt || new Date().toISOString(),
});

let pushed = 0;
let full = false;
async function pushBatch(items) {
  for (let i = 0; i < items.length; i += 400) {
    const out = await cloud.rpc('rovex_lib_push', { p_key: KEY, p_items: items.slice(i, i + 400).map(compact) });
    if (!out.ok) {
      if (out.err === 'libraryFull') { full = true; return false; }
      throw new Error('rovex_lib_push: ' + out.err);
    }
    pushed += out.added || 0;
  }
  return true;
}

// Envoi au fil de l'eau (toutes les ~90 s ou 400 trouvailles).
let lastFlush = Date.now();
let flushing = null;
async function flush(force) {
  if (flushing) return flushing;
  if (!state.resources.length || (!force && state.resources.length < 400 && Date.now() - lastFlush < 90e3)) return null;
  const batch = state.resources.splice(0);
  lastFlush = Date.now();
  flushing = (async () => {
    if (!KEY) { if (legacy) legacy.resources = batch.concat(legacy.resources || []); return; }
    try { await pushBatch(batch); } catch (e) {
      console.log('  ✗ envoi : ' + e.message);
      state.resources.unshift(...batch); // on réessaiera
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

(async () => {
  if (!KEY) console.log('⚠ Pas de ROVEX_CRAWLER_KEY : les trouvailles vont dans cloud/library.json (ancien mode).');
  // Premier passage avec la clé : on envoie toute l'ancienne bibliothèque.
  if (KEY && !state.migrated && legacy && (legacy.resources || []).length) {
    console.log(`Transfert de l'ancienne bibliothèque : ${legacy.resources.length} ressources…`);
    try { await pushBatch(legacy.resources); state.migrated = true; console.log(`✔ transférée (+${pushed})`); } catch (e) { console.log('✗ transfert : ' + e.message); }
  }
  state.runs++;
  const deadline = Date.now() + BUDGET_MIN * 60e3;
  const crawler = new Crawler({
    getState: () => state,
    persist: () => { flush(false); },
    upsert: (d) => db.upsert(state, d, { fresh: true }),
    newId: () => crypto.randomBytes(6).toString('hex'),
    seen,
  });
  console.log(`Passage n°${state.runs} — ${seenSet.size} adresses connues, ${state.channels.length} chaînes — budget ${BUDGET_MIN} min`);
  const guard = setInterval(() => { if (Date.now() > deadline) crawler.stop(); }, 5000);

  while (Date.now() < deadline - 60e3 && !full) {
    const task = CYCLE[state.cursor % CYCLE.length];
    console.log(`\n▶ ${task.mode} (${task.intensity || ''})`);
    crawler.start({ ...task, syncAfter: false, githubToken: process.env.GITHUB_TOKEN || '', apiKey: process.env.YOUTUBE_API_KEY || '' });
    let shown = 0;
    const tick = setInterval(() => {
      const log = crawler.status.log || [];
      for (const l of log.slice(0, log.length - shown).reverse()) console.log((l.err ? '  ✗ ' : '  · ') + l.msg);
      shown = log.length;
    }, 3000);
    await crawler.done;
    clearInterval(tick);
    const st = crawler.status;
    console.log(`✔ ${task.mode} : +${st.added} trouvailles, +${st.channels} chaînes, ${st.rejected} écartées, ${st.errors} erreurs`);
    if (!st.cancel) state.cursor++;
    await flush(true);
    saveMemory();
    if (st.cancel) break;
  }
  clearInterval(guard);
  await flush(true);
  if (flushing) await flushing;
  saveMemory();
  if (!KEY && legacy) {
    legacy.updatedAt = new Date().toISOString();
    legacy.channels = state.channels;
    fs.writeFileSync(LEGACY, JSON.stringify(legacy));
  }
  if (full) console.log('⚠ Bibliothèque en ligne pleine (limite library_max) : augmente-la ou passe à un plan Supabase supérieur.');
  console.log(`\nFin du passage : +${pushed} ressources envoyées en ligne, ${seenSet.size} adresses connues.`);
})().catch((e) => { console.error(e); process.exit(1); });
