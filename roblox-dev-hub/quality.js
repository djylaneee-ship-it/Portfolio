// Filtre qualité : garde ce qui parle de développement Roblox, écarte le troll, le gameplay,
// les mèmes et la triche (exploits, « free robux »…). Mots-clés en anglais, français,
// espagnol et portugais. Le titre compte double par rapport à la description.

// [motif, points]
const DEV = [
  [/\b(tutorial|tuto|tutoriel|tutorial(es)?|aula|guide|guía|explained|expliqu)/i, 3],
  [/\b(how to (make|script|create|build|code|animate|model)|comment (faire|cr[ée]er|scripter)|c[oó]mo (hacer|crear)|como (fazer|criar))\b/i, 3],
  [/\b(script(ing|eur|er)?s?|luau|lua|coding|code|programm(ing|ation)|programa(ci[oó]n|[cç][aã]o))\b/i, 3],
  [/\broblox studio\b|\bstudio\b/i, 2.5],
  [/\b(dev ?log|game ?dev|developer|d[ée]veloppeur|desarrollador|desenvolvedor|indie dev)\b/i, 3],
  [/\b(vfx|particle|particule|beam|trail|shader|flipbook)s?\b/i, 3],
  [/\b(module ?script|remote ?(event|function)|data ?store|tween(service)?|raycast|cframe|humanoid|pathfinding|hitbox|leaderstats)\b/i, 3],
  [/\b(gui|ui ?design|user interface|hud|screen ?gui|interface)\b/i, 2],
  [/\b(blender|modell?ing|mod[ée]lisation|low ?poly|mesh|uv|texturing|rig(ging)?|moon animator|animation editor)\b/i, 3],
  [/\b(plugin|rojo|wally|framework|open ?source|uncopylocked|kit)s?\b/i, 2.5],
  [/\b(system|syst[eè]me|sistema)s?\b/i, 2],
  [/\b(build(ing)? tips|terrain|lighting|[ée]clairage|level design|map making|showcase|speed ?build|commission|portfolio)\b/i, 1.5],
  [/\b(beginner|d[ée]butant|principiante|iniciante|advanced|avanc[ée]|tips|astuces|consejos|dicas|i made|j'ai (fait|cr[ée][ée])|making|create|build|make)\b/i, 1],
  [/\b(inventory|combat|npc|pet system|shop|quest|dialogue|round system|admin panel|leaderboard)\b/i, 1],
];

// Interdits : triche, arnaques. Rejet direct, même si le reste ressemble à du dev.
const BANNED = /\b(free robux|robux (gratuit|gr[aá]tis|free)|robux hack|exploit(s|ing|er)?|executor|krnl|synapse x|delta executor|fluxus|arceus|pastebin|keyless|auto ?farm|script hub|op script|hack(s|ed|ing)?|cheat(s|ing)?|scam|bypass(ed)?|aimbot|esp script)\b/i;

const NEG = [
  [/\b(troll(ing|ed|s)?|prank(s|ed|ing)?|bl[aá]gue|broma|pegadinha)\b/i, 5],
  [/\b(funny( moments)?|dr[oô]le|gracioso|engra[cç]ado|meme(s)?|mème(s)?|lol|xd|cringe|sus)\b/i, 4],
  [/\b(noob vs pro|admin abuse|abusing admin|rage|raging|toxic|oder|e-?(girl|boy)|bacon hair|got (banned|hacked))\b/i, 4],
  [/\b(story|histoire|historia|hist[oó]ria|movie|film|pel[ií]cula|sad|emotional|love story|brookhaven rp|roleplay|rp)\b/i, 3],
  [/\b(gameplay|let'?s play|playing|i played|j'ai jou[ée]|jugando|jogando|walkthrough|all endings|speedrun|1v1|pvp|vs\b|challenge|d[ée]fi|desaf[ií]o|reaction|r[ée]action|reagindo|reaccionando|live|stream|giveaway)\b/i, 2.5],
  [/\b(blox fruits|brookhaven|adopt me|pet simulator|doors|bedwars|bed wars|jailbreak|murder mystery|mm2|piggy|rainbow friends|grow a garden|99 nights|tsb|strongest battlegrounds|da hood|arsenal|tower of hell|natural disaster|dress to impress|steal a brainrot|brainrot|skibidi)\b/i, 2],
  [/#shorts?\b/i, 1],
];

function score(text, weight) {
  let pos = 0;
  let neg = 0;
  for (const [re, pts] of DEV) if (re.test(text)) pos += pts * weight;
  for (const [re, pts] of NEG) if (re.test(text)) neg += pts * weight;
  return { pos, neg };
}

// Renvoie { ok, score } pour une vidéo, un post ou une chaîne.
function check(item, { minScore = 3 } = {}) {
  const title = String(item.title || '');
  const rest = `${item.description || ''} ${item.author || ''}`;
  if (BANNED.test(title) || BANNED.test(rest)) return { ok: false, score: -99, reason: 'banned' };
  const a = score(title, 1);
  const b = score(rest, 0.5);
  const total = a.pos + b.pos - a.neg - b.neg;
  // Un titre de gameplay/troll n'est sauvé que par un vrai signal de dev dans le titre lui-même.
  if (a.neg >= 4 && a.pos < 3) return { ok: false, score: total, reason: 'offtopic' };
  return { ok: total >= minScore, score: total, reason: total >= minScore ? '' : 'weak' };
}

// Sources où tout est déjà du dev (DevForum, GitHub, Creator Store) : on n'écarte que la triche.
const isBanned = (item) => BANNED.test(`${item.title || ''} ${item.description || ''}`);

module.exports = { check, isBanned };

// Nettoie une base existante : retire les vidéos/posts hors sujet et les chaînes gameplay
// ajoutées automatiquement. Ne touche jamais aux favoris, aux notes ni aux ajouts manuels.
function purge(state) {
  const auto = new Set(['exploration', 'cloud', 'veille']);
  const before = state.resources.length;
  state.resources = state.resources.filter((r) => {
    if (!auto.has(r.source) || r.favorite || (r.notes && r.notes.trim())) return true;
    if (isBanned(r)) return false;
    if (r.type === 'chaine') return r.category !== 'gameplay';
    const social = r.type === 'video' || (r.tags || []).some((t) => t === 'youtube' || t === 'reddit');
    return social ? check(r).ok : true;
  });
  const chBefore = (state.channels || []).length;
  state.channels = (state.channels || []).filter((c) => !(c.auto && c.category === 'gameplay'));
  return { resources: before - state.resources.length, channels: chBefore - state.channels.length };
}

module.exports.purge = purge;
