// Dossiers de données et réglages (data/settings.json).
// Les clés API restent sur le PC de l'utilisateur, jamais dans le dépôt.
const fs = require('fs');
const path = require('path');

const DATA = process.env.RSS_DATA || path.join(__dirname, '..', 'data');

const DIRS = {
  data: DATA,
  gameplay: path.join(DATA, 'gameplay'), // les ~50 enregistrements de gameplay
  jobs: path.join(DATA, 'jobs'),         // un dossier par Short en cours (script, voix, sous-titres)
  output: path.join(DATA, 'output'),     // les Shorts finis (.mp4)
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

const FILE = path.join(DATA, 'settings.json');

const DEFAULTS = {
  keys: { groq: '', elevenlabs: '' },
  voiceId: 'nPczCjzI2devNBz1zQrb', // voix ElevenLabs (Brian, grave, anglais américain)
  groqModel: 'openai/gpt-oss-120b',
  language: 'en',                // langue des vidéos (en / fr)
  topicPrompt: '',               // vide = thèmes creepypasta Roblox automatiques ; {theme} = thème aléatoire
  speed: 1.15,                   // accélération du Short (voix + gameplay)
  concurrent: 1,                 // Shorts générés en parallèle
  schedule: {
    enabled: false,
    perDay: 1,                   // nombre de vidéos publiées par jour
    times: ['18:00'],            // heures de publication (une par vidéo/jour)
    timezone: 'Europe/Paris',
    bufferDays: 2,               // garder d'avance N jours de Shorts déjà montés
  },
  youtube: {
    clientId: '', clientSecret: '', refreshToken: '',
    privacy: 'public',
    tags: ['roblox', 'creepypasta', 'shorts'],
  },
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] || {}, v) : v;
  }
  return out;
}

function load() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const s = merge(DEFAULTS, saved);
  // Les variables d'environnement (.env) servent de secours.
  s.keys.groq ||= process.env.GROQ_API_KEY || '';
  s.keys.elevenlabs ||= process.env.ELEVENLABS_API_KEY || '';
  s.voiceId ||= process.env.ELEVENLABS_VOICE_ID || '';
  s.youtube.clientId ||= process.env.YOUTUBE_CLIENT_ID || '';
  s.youtube.clientSecret ||= process.env.YOUTUBE_CLIENT_SECRET || '';
  return s;
}

function save(patch) {
  const next = merge(load(), patch);
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

// Réglages envoyés à l'interface : les secrets sont masqués.
function publicView(s = load()) {
  const mask = (v) => (v ? '••••' + String(v).slice(-4) : '');
  return {
    ...s,
    keys: { groq: mask(s.keys.groq), elevenlabs: mask(s.keys.elevenlabs) },
    youtube: { ...s.youtube, clientSecret: mask(s.youtube.clientSecret), refreshToken: s.youtube.refreshToken ? 'connecté' : '' },
  };
}

module.exports = { DIRS, load, save, publicView };
