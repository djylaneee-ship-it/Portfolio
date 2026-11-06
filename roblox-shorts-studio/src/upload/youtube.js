// Publication YouTube (Shorts = vidéo verticale < 60 s + #Shorts).
// Connexion OAuth une seule fois depuis l'app (Réglages → Connecter YouTube),
// le refresh token est gardé dans data/settings.json.
// On envoie la vidéo en « privée » avec publishAt : c'est YouTube qui la rend
// publique à l'heure prévue, même si le PC est éteint à ce moment-là.
const fs = require('fs');
const { google } = require('googleapis');
const config = require('../config');

const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', ANALYTICS_SCOPE];

function client(port) {
  const s = config.load();
  if (!s.youtube.clientId || !s.youtube.clientSecret) throw new Error('Identifiants OAuth YouTube manquants (Réglages)');
  const auth = new google.auth.OAuth2(s.youtube.clientId, s.youtube.clientSecret, `http://localhost:${port}/api/youtube/callback`);
  if (s.youtube.refreshToken) auth.setCredentials({ refresh_token: s.youtube.refreshToken });
  return auth;
}

function authUrl(port) {
  return client(port).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

async function handleCallback(port, code) {
  const { tokens } = await client(port).getToken(code);
  if (!tokens.refresh_token) throw new Error('Google n\'a pas renvoyé de refresh token : réessaie la connexion');
  // On garde les autorisations accordées : l'onglet Stats sait ainsi s'il faut se reconnecter.
  config.save({ youtube: { refreshToken: tokens.refresh_token, scopes: tokens.scope || '' } });
}

async function channel(port) {
  const yt = google.youtube({ version: 'v3', auth: client(port) });
  const { data } = await yt.channels.list({ part: ['snippet'], mine: true });
  return data.items?.[0]?.snippet?.title || null;
}

/** @returns {Promise<string>} l'ID de la vidéo YouTube */
async function upload(port, job, publishAt) {
  const s = config.load();
  const yt = google.youtube({ version: 'v3', auth: client(port) });
  const tags = [...new Set([...(s.youtube.tags || []), ...(job.hashtags || []).map((h) => h.replace('#', ''))])];
  const description = `${job.description || ''}\n\n${(job.hashtags || []).join(' ')} #Shorts`.trim();
  const scheduled = publishAt && new Date(publishAt) > new Date(Date.now() + 15 * 60e3);

  const { data } = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: (job.title || 'Roblox Creepypasta').slice(0, 100), description, tags, categoryId: '20' },
      status: {
        privacyStatus: scheduled ? 'private' : s.youtube.privacy,
        publishAt: scheduled ? new Date(publishAt).toISOString() : undefined,
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: fs.createReadStream(job.file) },
  });
  return data.id;
}

module.exports = { authUrl, handleCallback, channel, upload, client, ANALYTICS_SCOPE };
