// Algo d'exploration « cloud » : tourne sur GitHub Actions toutes les heures, sans jamais s'arrêter.
// Chaque passage reprend là où le précédent s'est arrêté et enregistre ses trouvailles dans
// cloud/library.json, que l'app Roblox Dev Hub récupère ensuite (Réglages → Source cloud).
//
// Usage local : node cloud-crawl.js [minutes]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { Crawler } = require('./crawler');

const OUT = path.join(__dirname, 'cloud', 'library.json');
const BUDGET_MIN = Number(process.argv[2] || process.env.CRAWL_MINUTES || 45);
// Tâches enchaînées en boucle, d'un passage à l'autre.
const CYCLE = [
  { mode: 'sync' },
  { mode: 'channels', scope: 'all', intensity: 'normal' },
  { mode: 'explore', intensity: 'normal' },
  { mode: 'sync' },
  { mode: 'opensource', intensity: 'normal' },
  { mode: 'explore', intensity: 'massif' },
];

function load() {
  if (!fs.existsSync(OUT)) return { version: 1, updatedAt: null, cursor: 0, runs: 0, resources: [], channels: [] };
  return JSON.parse(fs.readFileSync(OUT, 'utf8'));
}

function save(state) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  state.updatedAt = new Date().toISOString();
  // Une ligne par ressource : fichier compact et diffs Git lisibles.
  const lines = [
    '{"version":1,"updatedAt":' + JSON.stringify(state.updatedAt) + ',"cursor":' + state.cursor + ',"runs":' + state.runs + ',',
    '"channels":[', state.channels.map((c) => JSON.stringify(c)).join(',\n'), '],',
    '"resources":[', state.resources.map((r) => JSON.stringify(r)).join(',\n'), ']}',
  ];
  fs.writeFileSync(OUT + '.tmp', lines.join('\n'));
  fs.renameSync(OUT + '.tmp', OUT);
}

(async () => {
  const state = load();
  state.runs++;
  const deadline = Date.now() + BUDGET_MIN * 60e3;
  const crawler = new Crawler({
    getState: () => state,
    persist: () => save(state),
    upsert: (d) => db.upsert(state, d, { fresh: true }),
    newId: () => crypto.randomBytes(6).toString('hex'),
  });
  console.log(`Passage n°${state.runs} — ${state.resources.length} ressources, ${state.channels.length} chaînes — budget ${BUDGET_MIN} min`);

  // Arrêt propre à la fin du budget (GitHub coupe les tâches trop longues).
  const guard = setInterval(() => { if (Date.now() > deadline) crawler.stop(); }, 5000);

  while (Date.now() < deadline - 60e3) {
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
    console.log(`✔ ${task.mode} : +${st.added} ressources, +${st.channels} chaînes, ${st.errors} erreurs`);
    if (!st.cancel) state.cursor++; // tâche finie : on passe à la suivante au prochain tour
    save(state);
    if (st.cancel) break;
  }
  clearInterval(guard);
  save(state);
  console.log(`\nFin du passage : ${state.resources.length} ressources, ${state.channels.length} chaînes au total.`);
})().catch((e) => { console.error(e); process.exit(1); });
