// Étape 1 : Groq écrit l'histoire creepypasta, le titre, la description et
// les prompts d'images (une image par scène).
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const THEMES = [
  'un joueur qui ne se déconnecte jamais', 'un serveur vide à 3 h du matin', 'un ami ajouté par erreur',
  'un jeu retiré de la plateforme', 'un PNJ qui connaît ton vrai prénom', 'une place qui change à chaque visite',
  'un message privé envoyé depuis ton propre compte', 'un badge impossible à obtenir',
];

function buildPrompt(s) {
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const topic = s.topicPrompt ? s.topicPrompt.replaceAll('{theme}', theme) : `une histoire creepypasta Roblox sur : ${theme}`;
  return [
    {
      role: 'system',
      content:
        'Tu écris des scripts de YouTube Shorts creepypasta Roblox, racontés à la première personne. ' +
        'Accroche forte dans la première phrase, suspense, chute inattendue. 130 à 170 mots (≈ 50 s lues). ' +
        'Pas de gore explicite, adapté à YouTube. Réponds uniquement en JSON.',
    },
    {
      role: 'user',
      content:
        `Langue : ${s.language}. Sujet : ${topic}.\n` +
        'Format JSON : {"title": "titre accrocheur < 70 caractères", "description": "2 phrases", ' +
        '"hashtags": ["#roblox", ...], "scenes": [{"text": "phrase(s) lues", "image": "prompt image en anglais"}]}. ' +
        '5 à 8 scènes ; la concaténation des "text" forme le script complet.',
    },
  ];
}

async function writeStory(s) {
  if (!s.keys.groq) throw new Error('Clé Groq manquante (Réglages)');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.keys.groq}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: s.groqModel,
      messages: buildPrompt(s),
      temperature: 0.9,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status} : ${await res.text()}`);
  const data = await res.json();
  const story = JSON.parse(data.choices[0].message.content);
  if (!Array.isArray(story.scenes) || !story.scenes.length) throw new Error('Groq : histoire sans scènes');
  story.script = story.scenes.map((sc) => sc.text.trim()).join(' ');
  return story;
}

module.exports = { writeStory };
