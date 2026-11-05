// Étape 4 : sous-titres façon Shorts (2–3 mots à la fois, gros, centrés)
// au format ASS, que FFmpeg incruste directement.

function ts(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = (t % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
}

function toAss(words, { perLine = 3, speed = 1 } = {}) {
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginV',
    'Style: Main, Arial Black, 96, &H00FFFFFF, &H00000000, &H80000000, -1, 7, 3, 5, 0', '',
    '[Events]', 'Format: Layer, Start, End, Style, Text',
  ];
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) {
    const chunk = words.slice(i, i + perLine);
    const start = chunk[0].start / speed;
    const end = (words[i + perLine]?.start ?? chunk.at(-1).end) / speed;
    lines.push(`Dialogue: 0, ${ts(start)}, ${ts(end)}, Main, ${chunk.map((w) => w.word.toUpperCase()).join(' ')}`);
  }
  return header.concat(lines).join('\n') + '\n';
}

module.exports = { toAss };
