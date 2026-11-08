// État partagé : liste des projets (gardée à jour en temps réel), navigation, journal d'activité.
import { api } from './api.js';

const listeners = new Set();
export const state = { projects: [], loaded: false };

export function onProjects(cb) { listeners.add(cb); return () => listeners.delete(cb); }
const emit = () => listeners.forEach(cb => cb(state.projects));

let unsub = null;
export async function loadProjects() {
  state.projects = await api.select('pt_projects', { order: [['archived', 'asc'], ['position', 'asc'], ['created_at', 'asc']] });
  state.loaded = true;
  emit();
  if (!unsub) unsub = api.subscribe('pt_projects', null, ({ type, row, old }) => {
    if (type === 'INSERT' && !state.projects.some(p => p.id === row.id)) state.projects.push(row);
    if (type === 'UPDATE') state.projects = state.projects.map(p => (p.id === row.id ? row : p));
    if (type === 'DELETE') state.projects = state.projects.filter(p => p.id !== old.id);
    emit();
  });
  return state.projects;
}
export const project = id => state.projects.find(p => p.id === id);
export function upsertLocal(p) {
  const i = state.projects.findIndex(x => x.id === p.id);
  i < 0 ? state.projects.push(p) : (state.projects[i] = p);
  emit();
}

export const go = path => { location.hash = '#' + path; };

// Journal d'activité du projet (affiché sur l'accueil et la vue d'ensemble).
export function logActivity(project_id, kind, text, link) {
  const me = api.me;
  if (!me) return;
  api.insert('pt_activity', { project_id, actor: me.id, kind, text, link: link || null }).catch(() => {});
}

export const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', color: '#FF5C5C' },
  { value: 'high', label: 'Haute', color: '#FF9F43' },
  { value: 'medium', label: 'Moyenne', color: '#F5C242' },
  { value: 'low', label: 'Basse', color: '#5FB3A1' },
];
export const prio = v => PRIORITIES.find(p => p.value === v);

export const isAdmin = () => ['owner', 'admin'].includes(api.me?.role);
