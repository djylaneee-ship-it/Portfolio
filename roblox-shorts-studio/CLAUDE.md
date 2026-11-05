# Roblox Shorts Studio — guide

App Windows (Electron) qui fabrique des YouTube Shorts Roblox « creepypasta » à partir d'une banque d'enregistrements de gameplay, puis les publie toute seule selon un planning (N vidéos par jour, aux heures choisies).

## Lancer

```bash
cd roblox-shorts-studio
npm install
npm run app      # app de bureau
npm start        # serveur seul : http://localhost:4800
npm run check    # vérification de syntaxe, avant chaque commit
```

Variables : `RSS_DATA=/un/dossier` (données, sinon `data/` ou `%APPDATA%\Roblox Shorts Studio\data` dans l'app), `PORT=4800`. Clés : onglet Réglages, ou `.env` (voir `.env.example`).

## Publier une version (installateur Windows)

Le workflow `.github/workflows/shorts-studio-desktop.yml` construit `Roblox-Shorts-Studio-Setup-x.y.z.exe` sur Windows et le publie dans la release fixe **`shorts-studio`** du dépôt **quand `roblox-shorts-studio/package.json` change**. Pour sortir une version : monter `"version"` (0.1.0 → 0.2.0). Les apps installées se mettent à jour toutes seules (electron-updater, fournisseur `generic` pointé sur cette release, vérification toutes les heures).

Ne jamais marquer cette release « Latest » ni la publier avec un tag `v*` : la release « Latest » du dépôt est celle de Rovex Hub, dont les mises à jour automatiques en dépendent.

## Chaîne d'un Short

```
gameplay/ (≈50 clips)      Groq             ElevenLabs                Pollinations        FFmpeg            YouTube
        │                    │                    │                          │                 │                 │
        │   1. story.js ─────┘  titre, description, hashtags, 5–8 scènes {texte, prompt image}
        │   2. voice.js ──────────────────────────┘  voice.mp3 + horodatage de chaque mot
        │   3. captions.js  sous-titres ASS (3 mots), début de chaque scène
        │   4. images.js ────────────────────────────────────────────────┘  une image 9:16 par scène
        └─► 5. library.js  passage de gameplay jamais utilisé, clip le moins utilisé d'abord
            6. render.js  ─────────────────────────────────────────────────────────────────┘  1080×1920 : images en haut, gameplay en bas, sous-titres, accéléré ×speed
            7. scheduler.js → upload/youtube.js ─────────────────────────────────────────────────────────────┘  privée + publishAt = créneau
```

Statuts d'un job : `queued → story → voice → images → render → ready → uploading → scheduled → published` (+ `paused`, `stopped`, `error`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `electron.js` | Fenêtre, icône de la barre des tâches, lancement au démarrage de Windows, mises à jour automatiques. Fermer = cacher (le planning continue). Données : `%APPDATA%\Roblox Shorts Studio\data`. |
| `server.js` | Serveur local 127.0.0.1 : interface, API `/api/*`, flux temps réel `/api/events`, OAuth YouTube. |
| `src/config.js` | Dossiers (`data/gameplay`, `data/jobs/<id>`, `data/output`) et réglages `data/settings.json` (secrets masqués vers l'interface). |
| `src/library.js` | Banque de gameplay, index des passages déjà utilisés (`data/gameplay.json`). |
| `src/pipeline/index.js` | File des jobs (`data/jobs.json`), parallélisme, pause/stop/retirer. |
| `src/pipeline/story.js` | Groq (API compatible OpenAI, sortie JSON). Modèle par défaut `openai/gpt-oss-120b` (Llama 3.3 n'est plus proposé). |
| `src/pipeline/voice.js` | ElevenLabs `text-to-speech/{voice}/with-timestamps`, liste des voix. |
| `src/pipeline/images.js` | Images Pollinations (gratuit, sans clé). Groq ne génère pas d'images. |
| `src/pipeline/captions.js` | Sous-titres ASS et calage des scènes. |
| `src/pipeline/render.js` | Commande FFmpeg (ffmpeg-static). |
| `src/scheduler.js` | Planning : créneaux des `bufferDays` prochains jours, génère ce qui manque, envoie les Shorts prêts avec `publishAt`. |
| `src/upload/youtube.js` | OAuth (refresh token gardé localement) et envoi `videos.insert`. |
| `public/` | Interface : Générateur, Planning, Gameplay, Réglages. |

## Points à connaître

- **Quota YouTube** : 10 000 unités/jour par projet Google, un envoi = 1 600 → 6 envois max par jour (`MAX_UPLOADS_PER_DAY`).
- **Projet Google non vérifié** : tant que l'app OAuth est en mode « Test », les vidéos envoyées par l'API peuvent rester bloquées en privé. Il faut demander l'audit de l'API YouTube pour publier en public.
- Grâce à `publishAt`, le PC n'a pas besoin d'être allumé à l'heure de publication, seulement assez longtemps pour préparer les `bufferDays` jours d'avance.
