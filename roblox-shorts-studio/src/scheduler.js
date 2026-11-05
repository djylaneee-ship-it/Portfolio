// Planning automatique. Toutes les minutes :
//   1. calcule les créneaux des `bufferDays` prochains jours (perDay × times, fuseau choisi) ;
//   2. lance assez de Shorts pour remplir les créneaux libres ;
//   3. envoie chaque Short prêt sur YouTube avec publishAt = son créneau ;
//   4. passe en « publié » ceux dont l'heure est passée.
// Comme YouTube publie lui-même à l'heure prévue, le PC n'a besoin d'être
// allumé qu'un moment par jour pour monter et envoyer les suivants.
const config = require('./config');
const pipeline = require('./pipeline');
const youtube = require('./upload/youtube');

// Quota API YouTube : 10 000 unités/jour, un envoi = 1 600 → 6 envois max par jour.
const MAX_UPLOADS_PER_DAY = 6;

function tzOffset(t, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
}

// « 2026-11-05 18:00 dans ce fuseau » → Date
function zoned(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz); // second passage : changement d'heure
  return new Date(t);
}

function upcomingSlots(sch, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: sch.timezone }).format(now); // AAAA-MM-JJ
  const [y, m, d] = today.split('-').map(Number);
  const times = [...sch.times].sort().slice(0, sch.perDay);
  const slots = [];
  for (let day = 0; day <= sch.bufferDays; day++) {
    for (const hm of times) {
      const [hh, mm] = hm.split(':').map(Number);
      const date = zoned(y, m, d + day, hh, mm, sch.timezone); // Date.UTC gère le passage au mois suivant
      if (date > now) slots.push(date.toISOString());
    }
  }
  return slots;
}

let busy = false;
let uploadsToday = { day: '', count: 0 };
let port = 0;
let lastError = null;

async function tick() {
  const s = config.load();
  if (!s.schedule.enabled || busy) return;
  busy = true;
  try {
    const jobs = pipeline.list();
    const now = new Date();

    for (const j of jobs) {
      if (j.status === 'scheduled' && new Date(j.publishAt) <= now) pipeline.update(j, { status: 'published' });
    }

    const taken = new Set(jobs.filter((j) => j.publishAt && j.status !== 'error').map((j) => j.publishAt));
    const free = upcomingSlots(s.schedule, now).filter((t) => !taken.has(t));

    // Assez de Shorts en préparation pour les créneaux libres ?
    const coming = jobs.filter((j) => !j.publishAt && ['queued', 'story', 'voice', 'images', 'render', 'paused', 'ready'].includes(j.status));
    if (free.length > coming.length) pipeline.enqueue(free.length - coming.length);

    // Envoi des Shorts prêts sur les créneaux libres, dans l'ordre.
    const day = now.toISOString().slice(0, 10);
    if (uploadsToday.day !== day) uploadsToday = { day, count: 0 };
    const ready = jobs.filter((j) => j.status === 'ready' && !j.publishAt);
    for (const [i, job] of ready.entries()) {
      if (!free[i] || uploadsToday.count >= MAX_UPLOADS_PER_DAY) break;
      pipeline.update(job, { status: 'uploading', publishAt: free[i] });
      try {
        const id = await youtube.upload(port, job, free[i]);
        uploadsToday.count++;
        pipeline.update(job, { status: 'scheduled', youtubeId: id, url: `https://youtube.com/shorts/${id}` });
      } catch (e) {
        pipeline.update(job, { status: 'ready', publishAt: null, error: `YouTube : ${e.message}` });
        throw e;
      }
    }
    lastError = null;
  } catch (e) {
    lastError = e.message;
  } finally {
    busy = false;
  }
}

function start(serverPort) {
  port = serverPort;
  tick();
  setInterval(tick, 60e3);
}

function status() {
  const s = config.load();
  return { enabled: s.schedule.enabled, next: upcomingSlots(s.schedule).slice(0, 5), uploadsToday, lastError };
}

module.exports = { start, tick, status, upcomingSlots };
