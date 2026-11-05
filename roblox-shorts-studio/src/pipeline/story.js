// Étape 1 : Groq écrit l'histoire creepypasta, le titre, la description et
// les hashtags. Les vidéos sont en anglais.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const THEMES = [
  'a player who never logs off', 'an empty server at 3 AM', 'a friend request from a deleted account',
  'a game that was taken down', 'an NPC that knows your real name', 'a place that changes every time you join',
  'a private message sent from your own account', 'a badge that is impossible to get', 'a glitched avatar that follows you',
  'an old 2008 game that still has one player online', 'a chat message that predicts what happens next',
  'a teleporter to a place that does not exist', 'an admin who bans everyone at midnight',
];

function buildPrompt(s) {
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const topic = s.topicPrompt ? s.topicPrompt.replaceAll('{theme}', theme) : `a Roblox creepypasta story about: ${theme}`;
  return [
    {
      role: 'system',
      content:
        'You write scripts for viral Roblox creepypasta YouTube Shorts, told in the first person. ' +
        'Hook the viewer in the very first sentence, build suspense, end with an unexpected twist. ' +
        '130 to 170 words (about 50 seconds read aloud). Simple spoken language, short sentences. ' +
        'No explicit gore, YouTube-safe. Answer only with JSON.',
    },
    {
      role: 'user',
      content:
        `Language of title, description and story: ${s.language === 'fr' ? 'French' : 'English'}. Topic: ${topic}.\n` +
        'JSON format: {"title": "catchy title under 70 characters", "description": "2 sentences", ' +
        '"hashtags": ["#roblox", ...], "script": "the full story read aloud"}.',
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
  story.script = String(story.script || '').replace(/\s+/g, ' ').trim();
  if (story.script.split(' ').length < 40) throw new Error('Groq : histoire trop courte');
  return story;
}

module.exports = { writeStory };
