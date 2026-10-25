// Niveau de Claude : mesure ce que Rovex Hub lui apporte (exemples validés, couverture des
// catégories) et à quel point il s'en sert (appels MCP). Claude ne se modifie pas lui-même :
// c'est sa base de connaissances Roblox qui grandit.
const { CATEGORIES, stats } = require('./db');

const DEV_CATS = CATEGORIES.map((c) => c.id).filter((id) => id !== 'gameplay');
const TITLES = [[1, 'novice'], [3, 'apprentice'], [5, 'scripter'], [8, 'developer'], [12, 'expert'], [17, 'legend']];

// XP nécessaire pour atteindre le niveau L : 150 · L·(L−1)/2.
const xpFor = (level) => (150 * level * (level - 1)) / 2;
const levelOf = (xp) => Math.floor((Math.sqrt(1 + (8 * xp) / 150) - 1) / 2) + 1;

function masteryOf({ examples, resources, uses }) {
  const ex = Math.min(50, examples * 12.5);
  const res = 30 * Math.min(1, Math.log10(resources + 1) / 3.5);
  const use = 20 * Math.min(1, uses / 25);
  return Math.round(ex + res + use);
}

function compute(state) {
  const s = stats(state);
  const ms = state.mcpStats || { calls: 0, byTool: {}, byCat: {}, examples: 0 };
  const validated = (state.examples || []).filter((e) => e.status === 'validated');

  const categories = DEV_CATS.map((id) => {
    const c = {
      id,
      examples: validated.filter((e) => e.category === id).length,
      resources: s.byCategory[id] || 0,
      uses: (ms.byCat || {})[id] || 0,
    };
    return { ...c, mastery: masteryOf(c) };
  });

  const overall = Math.round(categories.reduce((a, c) => a + c.mastery, 0) / categories.length);
  const xp = Math.round(categories.reduce((a, c) => a + c.mastery * 10, 0) + ms.calls * 3 + (ms.examples || 0) * 5 + validated.length * 40);
  const level = levelOf(xp);
  const title = TITLES.filter(([l]) => level >= l).pop()[1];
  const start = xpFor(level);
  const next = xpFor(level + 1);

  const covered = categories.filter((c) => c.mastery >= 40).length;
  const badges = [
    ['firstCall', ms.calls >= 1],
    ['calls50', ms.calls >= 50],
    ['calls500', ms.calls >= 500],
    ['examples5', validated.length >= 5],
    ['examples25', validated.length >= 25],
    ['resources1k', s.total >= 1000],
    ['resources10k', s.total >= 10000],
    ['allRounder', covered === categories.length],
    ['master', categories.some((c) => c.mastery >= 90)],
  ].map(([id, done]) => ({ id, done }));

  const sorted = [...categories].sort((a, b) => b.mastery - a.mastery);
  // Conseils : la catégorie la plus faible, et ce qui lui manque le plus.
  const weakest = sorted[sorted.length - 1];
  const tips = [];
  if (weakest.examples < 4) tips.push({ k: 'addExamples', p: { cat: weakest.id } });
  if (weakest.resources < 300) tips.push({ k: 'explore', p: { cat: weakest.id } });
  if (ms.calls < 25) tips.push({ k: 'useMore' });

  return {
    xp, level, title, levelStart: start, levelNext: next,
    progress: Math.round(((xp - start) / (next - start)) * 100),
    overall, categories, badges, tips,
    strongest: sorted[0].id, weakest: weakest.id,
    totals: { calls: ms.calls, examplesUsed: ms.examples || 0, validated: validated.length, resources: s.total, firstCall: ms.firstCall || null },
  };
}

// Garde une photo par jour du niveau, pour la courbe de progression (90 jours).
function snapshot(state, lv) {
  const day = new Date().toISOString().slice(0, 10);
  const h = (state.levelHistory = state.levelHistory || []);
  const last = h[h.length - 1];
  const point = { d: day, xp: lv.xp, level: lv.level, overall: lv.overall };
  if (last && last.d === day) {
    if (last.xp === point.xp && last.overall === point.overall) return false;
    h[h.length - 1] = point;
  } else {
    h.push(point);
  }
  if (h.length > 90) h.splice(0, h.length - 90);
  return true;
}

module.exports = { compute, snapshot };
