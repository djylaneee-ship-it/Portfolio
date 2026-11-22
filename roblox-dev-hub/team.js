// Équipe IA : plusieurs IA branchées à Rovex par MCP (Claude Desktop, Claude Code, Cursor, Codex, Gemini CLI…)
// se retrouvent dans une même salle, se parlent et s'échangent des tâches. L'utilisateur (« user ») en fait partie
// depuis la page Équipe IA. Tout vit dans le serveur de l'app (data/team.json) ; les outils team_* de mcp.js
// y passent toujours (en stdio, par l'app ouverte).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const FILE = path.join(db.DATA_DIR, 'team.json');
const STATUSES = ['todo', 'doing', 'blocked', 'done'];
const PRIORITIES = ['low', 'normal', 'high'];
const ONLINE_MS = 90e3;

let T = { seq: 0, agents: [], tasks: [], events: [] };
try { T = { ...T, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
const waiting = new Map(); // id d'agent → réveil de son team_listen en cours

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(db.DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(T));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch {}
  }, 300);
}

const err = (message, key) => Object.assign(new Error(message), { key, code: 400 });
const slug = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
const clip = (s, n) => String(s || '').trim().slice(0, n);
const now = () => new Date().toISOString();
const agent = (id) => T.agents.find((a) => a.id === slug(id));
const online = (a) => waiting.has(a.id) || Date.now() - Date.parse(a.lastSeen || 0) < ONLINE_MS;
const nameOf = (id) => (id === 'user' ? 'user' : (agent(id) || {}).name || id);

// L'agent qui appelle un outil : il doit d'abord rejoindre l'équipe (team_join).
function me(id) {
  const a = agent(id);
  if (!a) throw err(`Unknown agent "${id}": call team_join first with your name.`, 'teamUnknown');
  a.lastSeen = now();
  return a;
}

// Destinataire : un agent (nom ou id), « all » ou « user ».
function target(to) {
  const s = slug(to);
  if (!s || s === 'all' || s === 'everyone' || s === 'tous') return 'all';
  if (s === 'user' || s === 'utilisateur') return 'user';
  const a = agent(s) || T.agents.find((x) => slug(x.name) === s);
  if (!a) throw err(`No agent named "${to}". Agents: ${T.agents.map((x) => x.name).join(', ') || 'none'}.`, 'teamNoAgent');
  return a.id;
}

// Chaque message ou changement de tâche est un évènement numéroté, livré à ses destinataires par team_listen.
function emit(ev) {
  const e = { seq: ++T.seq, t: now(), ...ev };
  T.events.push(e);
  if (T.events.length > 1500) T.events = T.events.slice(-1000);
  persist();
  for (const id of e.to.includes('all') ? [...waiting.keys()] : e.to) if (id !== e.from && waiting.has(id)) waiting.get(id)();
  return e;
}
const forMe = (e, id) => e.from !== id && (e.to.includes('all') || e.to.includes(id));

function brief(t) {
  return {
    id: t.id, title: t.title, status: t.status, priority: t.priority,
    from: nameOf(t.from), to: t.to ? nameOf(t.to) : 'anyone', ...(t.details && { details: t.details }),
    ...(t.result && { result: t.result }), ...(t.notes.length && { notes: t.notes.slice(-5).map((n) => `${nameOf(n.by)}: ${n.text}`) }),
    updatedAt: t.updatedAt,
  };
}
function roster() {
  return T.agents.map((a) => {
    const cur = T.tasks.find((t) => t.to === a.id && t.status === 'doing');
    return { name: a.name, id: a.id, role: a.role || undefined, app: a.app || undefined, online: online(a), listening: waiting.has(a.id), ...(cur && { working_on: cur.title }), lastSeen: a.lastSeen };
  });
}
function evView(e) {
  const out = { seq: e.seq, t: e.t, from: nameOf(e.from), kind: e.kind };
  if (e.kind === 'join') return { ...out, text: `joined the team${e.text ? ` (${e.text})` : ''}` };
  if (e.kind === 'msg') return { ...out, to: e.to.includes('all') ? 'all' : e.to.map(nameOf).join(', '), text: e.text };
  const t = T.tasks.find((x) => x.id === e.task);
  return { ...out, action: e.action, ...(e.text && { text: e.text }), task: t ? brief(t) : { id: e.task, deleted: true } };
}

// ---------- Outils MCP ----------
function join(a) {
  const name = clip(a.name, 40);
  const id = slug(name);
  if (!id || id === 'all' || id === 'user') throw err('Give a short unique name (e.g. "Builder" or "Claude Code").', 'teamName');
  let ag = agent(id);
  const fresh = !ag;
  if (!ag) { ag = { id, name, joinedAt: now(), seen: T.seq }; T.agents.push(ag); }
  Object.assign(ag, { name, ...(a.role !== undefined && { role: clip(a.role, 80) }), ...(a.app !== undefined && { app: clip(a.app, 40) }), lastSeen: now() });
  if (fresh) emit({ kind: 'join', from: id, to: ['all'], text: ag.role || '' });
  persist();
  return {
    you: { name: ag.name, id: ag.id, role: ag.role || undefined },
    team: roster().filter((x) => x.id !== id),
    open_tasks: T.tasks.filter((t) => t.status !== 'done' && (!t.to || t.to === id)).map(brief),
    how: `Pass me="${ag.id}" to every team_* tool. Loop on team_listen: it returns messages and tasks for you. Claim a task with team_task_update (status "doing"), do it with your own tools, then set status "done" with a result. Create tasks for other agents with team_task_create and talk with team_send (to an agent, "all" or "user").`,
  };
}

// Attente longue : renvoie les évènements pour cet agent depuis son dernier appel, sinon attend (40 s par défaut).
async function listen(a) {
  const ag = me(a.me);
  const wait = Math.max(0, Math.min(55, a.wait === undefined ? 40 : Number(a.wait) || 0)) * 1000;
  const pick = () => T.events.filter((e) => e.seq > (ag.seen || 0) && forMe(e, ag.id));
  let list = pick();
  if (!list.length && wait) {
    if (waiting.has(ag.id)) waiting.get(ag.id)(); // ancienne attente : libérée
    await new Promise((resolve) => {
      const timer = setTimeout(done, wait);
      function done() { clearTimeout(timer); if (waiting.get(ag.id) === done) waiting.delete(ag.id); resolve(); }
      waiting.set(ag.id, done);
    });
    list = pick();
  }
  ag.seen = T.seq;
  ag.lastSeen = now();
  persist();
  if (!list.length) return { events: [], next: 'Nothing new: call team_listen again.' };
  return { events: list.map(evView), next: 'Handle these (claim and do tasks meant for you or for anyone that fit your role, answer messages with team_send), then call team_listen again.' };
}

function send(a, from) {
  const by = from || me(a.me).id;
  const text = clip(a.text, 20000);
  if (!text) throw err('Empty message', 'chatEmpty');
  const e = emit({ kind: 'msg', from: by, to: [target(a.to)], text });
  return { sent: true, seq: e.seq };
}

function createTask(a, from) {
  const by = from || me(a.me).id;
  const title = clip(a.title, 200);
  if (!title) throw err('A task needs a title', 'teamTitle');
  const to = a.to && target(a.to) !== 'all' ? target(a.to) : '';
  if (to === 'user' && by === 'user') throw err('Assign the task to an agent or to anyone', 'teamTitle');
  const t = {
    id: crypto.randomBytes(4).toString('hex'), title, details: clip(a.details, 20000), from: by, to,
    status: 'todo', priority: PRIORITIES.includes(a.priority) ? a.priority : 'normal', notes: [], result: '', createdAt: now(), updatedAt: now(),
  };
  T.tasks.unshift(t);
  if (T.tasks.length > 400) T.tasks = T.tasks.filter((x, i) => i < 300 || x.status !== 'done');
  emit({ kind: 'task', action: 'created', from: by, to: [to || 'all'], task: t.id });
  return { created: brief(t) };
}

function listTasks(a) {
  const id = a.me ? slug(a.me) : '';
  return T.tasks.filter((t) => (!a.status || t.status === a.status) && (!a.mine || (id && (t.to === id || t.from === id))))
    .slice(0, Math.min(100, Number(a.limit) || 40)).map(brief);
}

// Changer l'état d'une tâche : « doing » la prend (si elle est libre), « done » avec un résultat, une note, une réassignation.
function updateTask(a, from) {
  const by = from || me(a.me).id;
  const t = T.tasks.find((x) => x.id === String(a.id || '').trim());
  if (!t) throw err('Task not found', 'notFound');
  const changes = [];
  if (a.to !== undefined) {
    const to = a.to ? target(a.to) : '';
    t.to = to === 'all' ? '' : to;
    changes.push('assigned');
  }
  if (a.status !== undefined) {
    if (!STATUSES.includes(a.status)) throw err('Status must be one of ' + STATUSES.join(', '), 'teamStatus');
    if (a.status === 'doing' && t.to && t.to !== by && by !== 'user' && t.status === 'doing') throw err(`${nameOf(t.to)} is already doing this task.`, 'teamTaken');
    if (a.status === 'doing' && !t.to && by !== 'user') t.to = by;
    t.status = a.status;
    changes.push(a.status === 'doing' ? 'claimed' : a.status);
  }
  if (a.result !== undefined) t.result = clip(a.result, 20000);
  const note = clip(a.note, 4000);
  if (note) { t.notes.push({ by, text: note, t: now() }); if (t.notes.length > 60) t.notes = t.notes.slice(-50); }
  if (!changes.length && !note && a.result === undefined) throw err('Nothing to change', 'teamNothing');
  t.updatedAt = now();
  const to = [...new Set([t.from, t.to].filter((x) => x && x !== by))];
  emit({ kind: 'task', action: changes[changes.length - 1] || 'note', from: by, to: to.length ? to : ['user'], task: t.id, text: note || (t.status === 'done' ? t.result.slice(0, 500) : '') });
  return { updated: brief(t) };
}

// ---------- Page Équipe IA (l'utilisateur) ----------
function view() {
  return {
    agents: roster(),
    tasks: T.tasks.map((t) => ({ ...t, fromName: nameOf(t.from), toName: t.to ? nameOf(t.to) : '' })),
    events: T.events.slice(-150).map(evView),
  };
}
function removeAgent(id) {
  T.agents = T.agents.filter((a) => a.id !== slug(id));
  for (const t of T.tasks) if (t.to === slug(id) && t.status !== 'done') { t.to = ''; t.status = 'todo'; }
  persist();
  return { ok: true };
}
function removeTask(id) {
  T.tasks = T.tasks.filter((t) => t.id !== id);
  persist();
  return { ok: true };
}
function clear() {
  T.events = [];
  T.tasks = T.tasks.filter((t) => t.status !== 'done');
  persist();
  return { ok: true };
}

module.exports = { join, listen, send, createTask, listTasks, updateTask, roster, view, removeAgent, removeTask, clear, STATUSES };
