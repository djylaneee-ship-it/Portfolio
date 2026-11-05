// Banque de gameplay : les enregistrements déposés dans data/gameplay/.
// On retient quels passages ont déjà servi (data/gameplay.json) pour ne pas
// remettre le même passage de fond deux jours de suite.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffprobe = require('ffprobe-static').path;
const { DIRS } = require('./config');

const INDEX = path.join(DIRS.data, 'gameplay.json');
const VIDEO = /\.(mp4|mov|mkv|webm)$/i;

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return {}; }
}
function writeIndex(idx) { fs.writeFileSync(INDEX, JSON.stringify(idx, null, 2)); }

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (err, out) =>
      err ? reject(err) : resolve(parseFloat(out)));
  });
}

// Met l'index à jour avec les fichiers présents dans le dossier.
async function scan() {
  const idx = readIndex();
  const files = fs.readdirSync(DIRS.gameplay).filter((f) => VIDEO.test(f));
  for (const f of files) {
    if (!idx[f]) idx[f] = { duration: await probeDuration(path.join(DIRS.gameplay, f)), used: [] };
  }
  for (const f of Object.keys(idx)) if (!files.includes(f)) delete idx[f];
  writeIndex(idx);
  return Object.entries(idx).map(([name, v]) => ({ name, duration: v.duration, uses: v.used.length }));
}

// Copie une vidéo importée depuis l'interface dans la banque.
function addClip(srcPath) {
  const name = `gameplay_${Date.now()}${path.extname(srcPath)}`;
  fs.copyFileSync(srcPath, path.join(DIRS.gameplay, name));
  return name;
}

// Choisit le clip le moins utilisé et un passage de `seconds` secondes
// qui ne chevauche pas un passage déjà utilisé (sinon le moins récent).
async function pickSegment(seconds) {
  await scan();
  const idx = readIndex();
  const clips = Object.entries(idx).filter(([, v]) => v.duration >= seconds);
  if (!clips.length) throw new Error(`Aucun gameplay d'au moins ${Math.ceil(seconds)} s dans ${DIRS.gameplay}`);
  clips.sort((a, b) => a[1].used.length - b[1].used.length || Math.random() - 0.5);
  const [name, info] = clips[0];

  const free = (s) => info.used.every(([a, b]) => s + seconds <= a || s >= b);
  let start = 0;
  for (let tries = 0; tries < 30; tries++) {
    start = Math.random() * (info.duration - seconds);
    if (free(start)) break;
  }
  info.used.push([start, start + seconds]);
  writeIndex(idx);
  return { file: path.join(DIRS.gameplay, name), start, duration: seconds };
}

module.exports = { scan, addClip, pickSegment };
