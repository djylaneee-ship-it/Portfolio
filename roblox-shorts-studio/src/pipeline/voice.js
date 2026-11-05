// Étape 2 : ElevenLabs lit le script. L'endpoint « with-timestamps » renvoie
// aussi l'heure de chaque caractère : on s'en sert pour caler les sous-titres
// et les changements d'image, sans passer par une transcription.
const fs = require('fs');

async function speak(s, text, outFile) {
  if (!s.keys.elevenlabs) throw new Error('Clé ElevenLabs manquante (Réglages)');
  if (!s.voiceId) throw new Error('Voix ElevenLabs non choisie (Réglages)');
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${s.voiceId}/with-timestamps?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': s.keys.elevenlabs, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} : ${await res.text()}`);
  const data = await res.json();
  fs.writeFileSync(outFile, Buffer.from(data.audio_base64, 'base64'));
  return toWords(data.alignment);
}

// Caractères horodatés → mots horodatés [{word, start, end}].
function toWords(al) {
  const words = [];
  let cur = null;
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) words.push(cur); cur = null; return; }
    if (!cur) cur = { word: '', start: al.character_start_times_seconds[i] };
    cur.word += ch;
    cur.end = al.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);
  return words;
}

// Voix du compte, pour la liste déroulante des Réglages.
async function listVoices(s) {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': s.keys.elevenlabs } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  const { voices } = await res.json();
  return voices.map((v) => ({ id: v.voice_id, name: v.name }));
}

module.exports = { speak, listVoices };
