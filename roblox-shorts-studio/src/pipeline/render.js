// Étape 5 : montage FFmpeg en 1080×1920.
//   haut  : illustrations IA (une par scène, calées sur la voix)
//   bas   : passage de gameplay
//   milieu: sous-titres ASS
// Le tout accéléré de `speed` (voix via atempo, durées divisées d'autant).
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');

function run(args, cwd, onProgress, total) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', ...args], { cwd });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.stdout.on('data', (d) => {
      const m = /out_time_ms=(\d+)/.exec(String(d));
      if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
    });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg : ${err.slice(-500)}`))));
  });
}

/**
 * @param {object} o
 * @param {string} o.dir          dossier du job (cwd de FFmpeg : voice.mp3, subs.ass, img_*.png)
 * @param {{file,start}} o.gameplay
 * @param {string[]} o.images     noms de fichiers dans o.dir
 * @param {number[]} o.starts     début de chaque image (s, avant accélération)
 * @param {number} o.voiceLength  durée de la voix (s, avant accélération)
 * @param {number} o.speed
 * @param {string} o.out          chemin du .mp4 final
 */
async function render(o, onProgress) {
  const total = o.voiceLength / o.speed + 0.4;
  const durs = o.starts.map((s, i) => ((o.starts[i + 1] ?? o.voiceLength) - (i === 0 ? 0 : s)) / o.speed);
  durs[durs.length - 1] += 0.4;

  const args = ['-ss', o.gameplay.start.toFixed(2), '-t', total.toFixed(2), '-i', o.gameplay.file];
  o.images.forEach((img, i) => args.push('-loop', '1', '-t', durs[i].toFixed(2), '-i', img));
  const audioIdx = o.images.length + 1;
  args.push('-i', 'voice.mp3');

  const half = 'scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=30';
  const f = [`[0:v]${half}[gp]`];
  o.images.forEach((_, i) => f.push(`[${i + 1}:v]${half}[im${i}]`));
  f.push(`${o.images.map((_, i) => `[im${i}]`).join('')}concat=n=${o.images.length}:v=1:a=0[ill]`);
  f.push('[ill][gp]vstack[stk]', '[stk]ass=subs.ass[v]');
  f.push(`[${audioIdx}:a]atempo=${o.speed}[aud]`);

  args.push(
    '-filter_complex', f.join(';'),
    '-map', '[v]', '-map', '[aud]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), '-movflags', '+faststart',
    o.out,
  );
  await run(args, o.dir, onProgress, total);
  return o.out;
}

module.exports = { render };
