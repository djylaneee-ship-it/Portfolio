# Rovex Hub — guide pour Claude et les devs de l'équipe

Rovex Hub est une app Windows (Electron) qui rassemble le savoir de dev Roblox (tutos, open source, exemples validés, skills, textures VFX…) et le sert à Claude par MCP. Elle est vendue via Discord ; chaque membre se connecte avec un ID d'accès.

Tu travailles peut-être pour un autre dev que le propriétaire : lis ce guide en entier avant de modifier quoi que ce soit, garde les changements petits et ciblés, et ouvre une pull request.

## Lancer et tester

```bash
cd roblox-dev-hub
npm install
npm run app          # l'app de bureau (Electron)
node server.js       # seulement le serveur, dans le navigateur : http://localhost:4747
```

Variables utiles pour tester sans toucher à la vraie base :
- `ROVEX_DATA=/un/dossier` : dossier des données (sinon `%APPDATA%\Rovex Hub` dans l'app, ou le dossier du projet).
- `ROVEX_LOCAL_AUTH=1` : IDs locaux seulement (clé admin affichée au démarrage, dans `data/CLE-ADMIN.txt`).
- `ROVEX_NO_AUTOCONNECT=1` : ne pas écrire dans la config de Claude Desktop.
- `PORT=4790` : autre port.
- `ROVEX_STUDIO_CONTENT=/un/dossier` : faux dossier « content » de Roblox Studio (tests de l'import des packs d'assets).
- `ROVEX_SUPABASE_URL` / `ROVEX_SUPABASE_KEY` : une autre base Supabase (ou un faux serveur de test).

Avant chaque commit : `for f in *.js public/app.js; do node --check $f; done`. Pour l'interface, une capture Playwright de la page modifiée (`require('playwright')`, `chromium.launch()`).

## Publier une version

Le dépôt `djylaneee-ship-it/Portfolio` a une seule branche principale. Le workflow `.github/workflows/rovex-desktop.yml` construit l'installateur Windows et publie la release GitHub **quand `roblox-dev-hub/package.json` change** : pour sortir une version, monte `"version"` (2.11.0 → 2.12.0) dans la même PR. Toutes les apps se mettent à jour toutes seules (electron-updater, vérification toutes les heures).

Travail à plusieurs : une branche par dev (`dev/<pseudo>-<sujet>`), une PR, relue puis fusionnée par le propriétaire. Ne pousse jamais directement sur la branche principale sans accord. Le robot d'exploration y pousse aussi (`cloud/state.json`, `cloud/seen.txt`) : fais `git pull --rebase` avant de pousser.

## Architecture

| Fichier | Rôle |
|---|---|
| `electron.js` | Fenêtre, icône de la barre des tâches, mises à jour, démarrage du serveur. |
| `server.js` | Serveur HTTP local (API `/api/*`, MCP HTTP `/mcp`, médias). Contrôle d'accès : `USER_ROUTES` (lecture membres), `MEMBER_ACTIONS` (actions membres), le reste admin. |
| `mcp.js` | Serveur MCP (stdio pour Claude Desktop, HTTP via le serveur) : outils, prompts, journal d'activité (`data/activity.json`). |
| `db.js` | Bibliothèque locale : `data/library.json` (ressources de l'utilisateur, réglages) + `data/cloud-library.json` (bibliothèque en ligne, écrite en arrière-plan ; appelle `db.markCloudDirty()` quand tu modifies une ressource `source: 'cloud'`), catégories, recherche (textes normalisés en cache). |
| `auth.js` / `cloud.js` | IDs d'accès en ligne (Supabase, RPC `rovex_*`), un appareil par ID, contenu partagé par les admins. |
| `skills.js` / `skill-texts.js` / `skill-pack/` | Skills Claude (socle `rovex-core` + un par catégorie). Les skills VFX, Animation, GUI, Modeling et Building sont les textes complets de `skill-pack/*.txt` + une courte note d'outils Rovex (`ROVEX_NOTES`) ; monter leur numéro dans `SKILL_VERSIONS` quand le texte change. |
| `agents.js` | Chat Claude par MCP : une conversation de Claude Desktop écoute le chat (outils `chat_listen` / `chat_attachment` / `chat_reply` / `chat_status` de `mcp.js`) ; `agents.js` garde la conversation et les messages en attente, `/agent/*` (clé locale) et `/api/agents/*`. Images et vidéos de référence : préparées dans l'interface (images réduites, images clés pour une vidéo), rangées dans `media/chat/`, envoyées à Claude par `chat_listen` (le reste avec `chat_attachment`). |
| `folders.js` / `directives.js` | Dossiers de l'utilisateur (`data/folders.json`, fichiers dans `media/folders/`) : ressources, textures VFX et fichiers importés, outil MCP `rovex_folder`. Directives des prompts `!reference:` / `!skill:` / `!software:` / `!texture:` : lues, vérifiées, données à Groq (Prompt Booster) et à Claude (Chat Claude, instructions MCP). |
| `gen.js` | Studio IA (images gratuites : Cloudflare FLUX, sinon Pollinations ; détourage des icônes avec `nativeImage`) et Prompt Booster (texte), par la fonction Supabase `rovex-gen`. |
| `crawler.js` / `cloud-crawl.js` | Exploration (YouTube, DevForum, Bluesky, Reddit, Sketchfab, dev.to, Creator Store, GitHub) ; `cloud-crawl.js` tourne en continu sur GitHub Actions et remplit la bibliothèque en ligne. |
| `studio.js` / `place.js` / `rbxupload.js` | Pont vers le serveur MCP de Roblox Studio, scripts et réglages de la place ouverte, envoi d'images sur Roblox. |
| `rbxassets.js` / `roblox-assets/` | Packs d'assets (.rbxm) importés dans `ReplicatedStorage.RovexAssets` de chaque place ouverte : copie dans le dossier `content/rovex` de Studio puis `game:GetObjects("rbxasset://rovex/…")` par `execute_luau` ; résumé pour l'outil MCP `rovex_assets` (`data/rovex-assets.json`). Monter `VERSION` quand un pack change. |
| `blender.js` / `blender/` | Pont vers Blender : add-on Claude Blender MCP (source `blender/addon/`, boîte à outils `addon/rx.py`, vue multi-angles `addon/commands/modeling.py` ; TCP 127.0.0.1:9876, une ligne JSON par commande), schémas des 27 outils dans `blender/tools.json`, réglage `data/blender.json`. Après une modif de l'add-on : monter `version` dans `addon/blender_manifest.toml` et `ADDON_VERSION` dans `blender.js`, puis `python3 blender/build_addon.py`. Tests possibles sans Blender installé : `pip install bpy` (Python 3.13 pour Blender 5.2). |
| `vfx-textures.js` | Bibliothèque de textures VFX (IDs Roblox, grilles de flipbook, outil `find_vfx_textures`) et textures de build (section « Build Textures », kind `build`, outil `find_build_textures` qui montre leurs images à Claude) ; miniatures Roblox (`thumbs`). |
| `public/` | Interface : `index.html`, `app.js` (pages), `i18n.js` (textes en/fr/es/pt), `custom.js` (thèmes et fonds), `style.css`. |
| `supabase/` | SQL à lancer dans Supabase (SQL Editor) et la fonction Edge `rovex-gen`. |

Les pages de l'interface sont des fonctions `renderXxx()` dans `public/app.js`, branchées dans l'objet `pages` de `route()`. Deux espaces (sélecteur en haut) : `SPACES.create` et `SPACES.resources`.

## Règles

- **Textes de l'interface** : toujours par `t('cle')`, avec la clé ajoutée dans les **4 langues** de `public/i18n.js` (en, fr, es, pt).
- **Commentaires** en français, courts, comme le code existant. Pas de dépendance npm sans vraie raison.
- **Secrets** : aucune clé d'API dans le code ni dans les messages. Les clés partagées vivent dans les secrets Supabase (fonction `rovex-gen`) ou GitHub (`ROVEX_CRAWLER_KEY`).
- **Base Supabase** : le propriétaire lance lui-même les fichiers SQL. Une modif de base = un nouveau fichier `supabase/*.sql` qu'on peut relancer sans risque, et des fonctions de l'app qui marchent encore tant qu'il n'est pas lancé.
- **Sécurité** : les membres ne doivent jamais pouvoir faire une action d'admin ; vérifie `USER_ROUTES` / `MEMBER_ACTIONS` pour toute nouvelle route.
- **VFX** (direction artistique) : ParticleEmitter texturés, jamais Fire / Smoke / Sparkles.

## Changer l'apparence sans toucher au code

En mode développeur (Réglages → Mode développeur), Claude Desktop a l'outil `dev_set_custom` (thème, couleurs, fond animé image/GIF/vidéo, police, CSS libre) : l'app se met à jour en quelques secondes. `dev_app_info` renvoie ce guide et la personnalisation actuelle.
