// Étape 3 : montage FFmpeg en 1080×1920 : le passage de gameplay en plein écran
// (recadré au centre), les sous-titres ASS par-dessus et la voix off.
// La voix est accélérée de `speed` (atempo) ; les sous-titres sont déjà calés dessus.
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
 * @param {string} o.dir          dossier du job (cwd de FFmpeg : voice.mp3, subs.ass)
 * @param {{file,start}} o.gameplay
 * @param {number} o.voiceLength  durée de la voix (s, avant accélération)
 * @param {number} o.speed
 * @param {string} o.out          chemin du .mp4 final
 */
async function render(o, onProgress) {
  const total = o.voiceLength / o.speed + 0.4;
  const args = [
    '-ss', o.gameplay.start.toFixed(2), '-t', total.toFixed(2), '-i', o.gameplay.file,
    '-i', 'voice.mp3',
    '-filter_complex', [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,ass=subs.ass[v]',
      `[1:a]atempo=${o.speed}[aud]`,
    ].join(';'),
    '-map', '[v]', '-map', '[aud]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), '-movflags', '+faststart',
    o.out,
  ];
  await run(args, o.dir, onProgress, total);
  return o.out;
}

module.exports = { render };
