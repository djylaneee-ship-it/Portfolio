// File des Shorts : chaque job passe par
//   story → voice → render → ready → (scheduled → uploaded)
// État gardé dans data/jobs.json pour survivre à un redémarrage de l'app.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const library = require('../library');
const { writeStory } = require('./story');
const { speak } = require('./voice');
const { toAss } = require('./captions');
const { render } = require('./render');

const FILE = path.join(config.DIRS.data, 'jobs.json');
const STEPS = { story: [0, 15], voice: [15, 35], render: [35, 100] };
const active = (status) => Boolean(STEPS[status]) || status === 'paused';

let jobs = [];
try { jobs = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
// Un job coupé en plein travail (app fermée) repart de zéro.
for (const j of jobs) if (active(j.status)) Object.assign(j, { status: 'queued', progress: 0 });
// Un envoi YouTube coupé : le Short redevient « prêt » et repassera au prochain tour.
for (const j of jobs) if (j.status === 'uploading') Object.assign(j, { status: 'ready', publishAt: null });

const listeners = new Set();
const control = new Map(); // id → 'pause' | 'stop'
let running = 0;

function persist() {
  fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2));
  for (const fn of listeners) fn(jobs);
}
function update(job, patch) { Object.assign(job, patch); persist(); }
function stepProgress(job, step, frac) {
  const [a, b] = STEPS[step];
  update(job, { status: step, progress: Math.round(a + (b - a) * frac) });
}

async function checkpoint(job) {
  while (control.get(job.id) === 'pause') {
    if (job.status !== 'paused') update(job, { pausedFrom: job.status, status: 'paused' });
    await new Promise((r) => setTimeout(r, 500));
  }
  if (job.status === 'paused') update(job, { status: job.pausedFrom });
  if (control.get(job.id) === 'stop') throw Object.assign(new Error('Arrêté'), { stopped: true });
}

async function build(job) {
  const s = config.load();
  const dir = path.join(config.DIRS.jobs, job.id);
  fs.mkdirSync(dir, { recursive: true });

  stepProgress(job, 'story', 0);
  const story = await writeStory(s);
  fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(story, null, 2));
  update(job, { title: story.title, description: story.description, hashtags: story.hashtags });
  await checkpoint(job);

  stepProgress(job, 'voice', 0);
  const words = await speak(s, story.script, path.join(dir, 'voice.mp3'));
  const voiceLength = words.at(-1).end;
  fs.writeFileSync(path.join(dir, 'subs.ass'), toAss(words, { speed: s.speed }));
  await checkpoint(job);

  stepProgress(job, 'render', 0);
  const gameplay = await library.pickSegment(voiceLength / s.speed + 1);
  const out = path.join(config.DIRS.output, `${job.id}.mp4`);
  await render(
    { dir, gameplay, voiceLength, speed: s.speed, out },
    (f) => stepProgress(job, 'render', f),
  );
  update(job, { status: 'ready', progress: 100, file: out, gameplay: path.basename(gameplay.file) });
}

async function pump() {
  const max = Math.max(1, config.load().concurrent);
  while (running < max) {
    const job = jobs.find((j) => j.status === 'queued');
    if (!job) return;
    running++;
    build(job)
      .catch((e) => update(job, e.stopped ? { status: 'stopped' } : { status: 'error', error: e.message }))
      .finally(() => { running--; control.delete(job.id); pump(); });
  }
}

// API utilisée par le serveur et le planificateur.
module.exports = {
  list: () => jobs,
  get: (id) => jobs.find((j) => j.id === id),
  onChange: (fn) => listeners.add(fn),
  enqueue(n = 1) {
    const created = [];
    for (let i = 0; i < n; i++) {
      const job = { id: `${Date.now()}${i}`, status: 'queued', progress: 0, createdAt: new Date().toISOString() };
      jobs.push(job);
      created.push(job);
    }
    persist();
    pump();
    return created;
  },
  pause: (id) => control.set(id, 'pause'),
  resume: (id) => control.delete(id),
  stop: (id) => control.set(id, 'stop'),
  remove(id) {
    const job = jobs.find((j) => j.id === id);
    if (!job || active(job.status)) return false; // on n'enlève pas un job en cours : l'arrêter d'abord
    fs.rmSync(path.join(config.DIRS.jobs, id), { recursive: true, force: true });
    if (job.file && job.status !== 'uploaded') fs.rmSync(job.file, { force: true });
    jobs = jobs.filter((j) => j !== job);
    persist();
    return true;
  },
  update,
  pump,
};
