# Rovex Hub

Le cerveau Roblox de ton Claude : une bibliothèque de ressources de dev Roblox (scripting, VFX, animation, GUI, GFX, modélisation, build, audio, game design, outils) et d'**exemples d'apprentissage** que Claude suit avant de coder. C'est une application Windows qui tourne sur ton PC et s'expose en serveur MCP.

- **Exemples d'apprentissage** : une demande, le bon code Luau et pourquoi il est bon. Les exemples validés sont servis en priorité à Claude (`list_examples`, `get_example`).
- **Connexion Claude** : config prête à copier, outils activables un par un, consignes envoyées à Claude, test d'une question et journal de son activité en direct.
- **Niveau de Claude** : niveau, XP, titre (Novice → Légende Roblox), maîtrise par catégorie, courbe de progression, badges et animation « LEVEL UP ». Le niveau mesure la connaissance Roblox que Rovex apporte à Claude (exemples validés, couverture des catégories) et à quel point il s'en sert : Claude lui-même ne se modifie pas.
- **Connexion automatique** : au lancement, l'app détecte Claude Desktop (et Claude Code) et y ajoute Rovex Hub tout seul, sans toucher aux autres serveurs (une copie de la config est gardée en `.rovex-backup`). Redémarre Claude Desktop pour qu'il le charge. Débranchable depuis **Connexion Claude**.
- **Interface animée** : transitions entre les pages, boutons qui grossissent et ondes au clic, halo qui suit la souris, compteurs animés.
- **Près de 70 ressources de départ** : docs officielles Roblox, outils (Blender, Rojo, Mixamo…) et recherches YouTube par thème.
- **Exploration automatique** : fouille YouTube, le DevForum Roblox et Reddit (r/robloxgamedev) pour référencer des milliers de vidéos, tutos et images, rangés par catégorie.
- **Toutes les chaînes Roblox** : découvre et relie automatiquement les chaînes YouTube Roblox (dev, VFX, gameplay, YouTubeurs FR/EN/ES…), puis récupère leurs nouvelles vidéos. La mise à jour peut être automatique (Réglages).
- **Open source et systèmes gratuits** (page à part, séparée de la bibliothèque d'apprentissage) : dépôts GitHub Roblox triés par étoiles, ressources communautaires du DevForum, modèles et plugins gratuits du Creator Store. Outil MCP `search_opensource`.
- **Filtre qualité** : avant d'ajouter une vidéo ou un post, Rovex vérifie qu'il parle vraiment de développement Roblox (mots-clés FR/EN/ES/PT). Le troll, le gameplay, les mèmes, les histoires et la triche (exploits, « robux gratuits ») sont écartés. Les bases existantes sont nettoyées une fois au démarrage (favoris et notes jamais touchés), et l'algo cloud nettoie son fichier à chaque passage.
- **Skills Claude** (page **Skills**) : un socle commun `rovex-core` + un skill par catégorie (Scripting, VFX, Animation, Cutscenes, GUI…). Avant une tâche, Claude identifie les domaines utiles (ex. une attaque = scripting + animation + vfx), appelle `load_skill` avec ces catégories et lit le socle, les règles de chaque skill, les exemples validés avec leur code, les meilleures ressources (avec tes notes) et l'open source, puis fait la tâche. Direction artistique : VFX en ParticleEmitter texturés, jamais Fire / Smoke / Sparkles. Les textes par défaut sont dans `skill-texts.js` (et `skill-pack/` pour VFX, Animation, GUI, Modeling et Building) et se modifient depuis la page.
- **Prompts — Prompt Booster** (page **Prompts**) : tu écris ta demande en vrac (« fais-moi un système de pets »), l'IA (**Groq**) la réécrit en prompt détaillé pour Claude : charger les skills des bonnes catégories (`load_skill`), chercher dans la base, lire les exemples validés, regarder l'open source, générer les images, bonnes pratiques Roblox, livrables et tests. Rovex envoie à Gemini le contenu de ta base (catégories, exemples validés, règles des skills). Les 15 derniers prompts améliorés sont gardés. Les modèles de prompts restent proposés dans Claude Desktop (menu **+** → Rovex Hub).
- **Textures de build** (page **Textures de build**, espace Création, groupes Ground / Wood / Stone) : textures de surfaces pour les builds (sable, herbe, bois, planches, clôture, pavés, roche). Claude les obtient avec l'outil MCP `find_build_textures`, qui renvoie les rbxassetid et lui montre les images ; le skill Building lui dit de s'en servir.
- **Apprentissage** (espace Création, page **Apprentissage**) : tu donnes à Claude des vidéos (timelapses de speed modeling, tutos VFX, animation, UI, scripting) ou des séries d'images. Rovex en tire des images clés (16 à 64), Claude les étudie (bouton « Faire étudier par Claude », qui passe par le Chat Claude, ou « étudie mes leçons Rovex en attente » dans Claude Desktop) et écrit une recette pas à pas (étapes, images de chaque étape, code Blender / Luau, astuces). Tu la relis, la corriges et la valides : ensuite Claude la retrouve tout seul (`find_lessons`, et dans `load_skill`) et la suit pour tes demandes. Un admin peut **partager une leçon à tous les membres** (lancer une fois `supabase/rovex-lessons.sql` dans Supabase).
- **Meshy AI** (page **Blender**, panneau 🧊 Meshy AI) : chaque membre colle sa propre clé API Meshy (`msy_…`, gardée seulement sur son PC) ; Claude reçoit alors les outils `meshy_text_to_3d`, `meshy_image_to_3d` (image de référence : fichier du PC ou lien), `meshy_remesh`, `meshy_task` et `meshy_balance`. Il fait une forme de base (sans texture par défaut, `lowpoly` possible), elle arrive directement dans Blender, puis il la retravaille avec les outils Blender. Le panneau montre les crédits restants et les derniers modèles ; les fichiers GLB / FBX sont dans le dossier `meshy` des données.
- **Co-work** (3e espace, bouton 🤝 en haut) : des projets partagés avec ton équipe. Onglet **Tâches** façon Trello (colonnes, cartes à glisser, personne assignée, échéance, étiquettes, checklist), onglet **Idées** façon Milanote (dossiers et sous-dossiers, notes de couleur, images, checklists, liens posés librement sur un grand tableau ; double-clic = nouvelle note, glisser une image pour l'ajouter), onglet **Membres** (inviter avec l'**ID Rovex** `RVX-…` affiché sur la page Projets, retirer, quitter, renommer, couleur, supprimer). « Mes tâches » regroupe ce qu'on t'a donné dans tous les projets. Tout se synchronise toutes les 4 s. À activer une fois : lancer `supabase/rovex-cowork.sql` dans Supabase (SQL Editor).
- **Mes dossiers** (espace Ressources, page **Mes dossiers**) : des dossiers et sous-dossiers à toi, où tu ranges des ressources de la bibliothèque (bouton 📁 de la fiche), des textures VFX (bouton 📁 au survol), et tes propres fichiers (images, vidéos, n'importe quel fichier, par bouton ou glisser-déposer). Données locales : `data/folders.json`, fichiers dans `media/folders/` (aperçus légers faits par l'interface, images clés pour une vidéo). Claude les ouvre avec l'outil MCP `rovex_folder`.
- **Directives dans les prompts** (Prompt Booster, Chat Claude, ou collées dans Claude Desktop ; boutons 📁 🧠 🛠 🎨 📖 sous la zone de texte) : `!reference: library/Épées/Feu/` (Claude ouvre ce dossier et suit ces références), `!skill: vfx, modeling` (il charge exactement ces skills), `!software: Roblox Studio, Blender` (il ne travaille que dans ces logiciels), `!texture: 10024120805 (Wood Planks), ToonFire` (il utilise exactement ces textures, VFX ou build, données par ID ou par nom ; bouton 🎨 avec recherche), `!recipe: Épée low poly, Slash de feu` (il ouvre ces recettes de l'Atelier d'apprentissage avec `lesson_get` et suit leurs étapes ; par ID ou par titre, bouton 📖). Lues par `directives.js` : vérifiées (dossier existant, skill connu), passées à Groq qui doit les respecter et les garder (elles sont rajoutées à la fin si elles manquent), et ajoutées en consignes aux messages du Chat Claude.
- **Studio IA** (page **Studio IA**) : Claude ne sait pas dessiner, Rovex le fait pour lui. Quand tu demandes « fais-moi un icône de couronne », Claude charge le skill, puis appelle `generate_image` : Rovex ajoute le style d'images du skill (modifiable dans Skills) et tes images de référence de la catégorie (favoris d'abord), génère l'image avec la clé OpenAI de l'admin (fonction Supabase `rovex-gen`, voir plus bas), range le PNG dans la bibliothèque (tag `ai`) et renvoie le chemin du fichier et un aperçu. Personne n'a de clé à fournir.
- **Import en un clic** : colle un lien YouTube, une chaîne, une page du DevForum ou une doc. Le titre, l'auteur et la miniature sont récupérés tout seuls.
- **Tes fichiers** : glisse des images, vidéos, scripts `.lua`, modèles `.rbxm` / `.fbx` / `.blend` sur la page.
- **Recherche YouTube intégrée**, sans clé (une clé YouTube Data API reste possible dans Réglages). Un jeton GitHub optionnel accélère la récupération de l'open source.
- **Favoris, niveaux, tags et notes**.
- **Serveur MCP** : n'importe quel client MCP peut chercher dans ta base, ajouter des tutos et écrire des notes.

## Installation (Windows) : une vraie application

1. Télécharge **`Rovex-Hub-Setup-x.y.z.exe`** dans les [releases du dépôt](https://github.com/djylaneee-ship-it/Portfolio/releases/latest).
2. Double-clique dessus : l'app s'installe toute seule (comme Discord), crée l'icône **Rovex Hub** sur le Bureau et dans le menu Démarrer, puis s'ouvre. Pas de navigateur, pas de terminal, pas besoin de Node.js.
   - Windows peut afficher « Windows a protégé votre ordinateur » (l'app n'est pas signée) : clique **Informations complémentaires** → **Exécuter quand même**.
3. Les mises à jour se téléchargent et s'installent toutes seules.

Fermer la fenêtre garde Rovex Hub dans la zone de notification (à côté de l'heure), pour que Claude reste connecté. Clic droit sur l'icône : ouvrir, lancer au démarrage de Windows, chercher une mise à jour, quitter.

Les données (base, exemples, clé admin) sont dans `%APPDATA%\Rovex Hub` : elles sont gardées lors des mises à jour. Au premier lancement, l'app reprend la base de l'ancienne version (`%LOCALAPPDATA%\RobloxDevHub`).

**Sortir une nouvelle version** : augmente `version` dans `package.json` et pousse. Le workflow `.github/workflows/rovex-desktop.yml` construit l'installeur sur Windows et le publie dans les releases ; les apps installées se mettent à jour d'elles-mêmes. En développement : `npm install` puis `npm run app` (ou `npm start` pour le serveur seul).

## Accès par ID et panneau admin

L'app demande un **ID d'accès** pour entrer. Les IDs sont gardés **en ligne** (base Supabase du projet `rovex-hub`, créée avec `supabase/rovex.sql`) : un ID créé sur ton PC marche sur n'importe quel PC qui a Rovex Hub et internet.

- **Clé admin permanente** : créée au premier lancement et enregistrée dans `%APPDATA%\Rovex Hub\data\CLE-ADMIN.txt`. Le premier PC admin qui se connecte avec sa clé l'enregistre en ligne comme clé principale (et envoie en ligne les IDs créés avant). Elle n'expire jamais et ouvre le **panneau Admin**. Ne la partage pas.
- **IDs d'accès** (`RDH-XXXX-XXXX-XXXX`) : crée-les dans **Admin**, puis envoie le message tout prêt (ID + lien de téléchargement). Ils donnent accès en lecture seule et se bloquent tout seuls après leur durée (1 jour, 7 jours, 1 mois, 3 mois, 1 an) ou sont **permanents** (∞). Tu peux les prolonger, les rendre permanents, les bloquer ou les supprimer ; un ID bloqué est déconnecté en moins de 10 minutes.
- **Un appareil à la fois** : un ID ne peut être connecté que sur un seul PC. S'il se connecte sur un autre, l'ancien est déconnecté en moins d'une minute (avec un message qui explique pourquoi). Dans **Admin**, chaque ID montre l'appareil connecté, le nombre d'appareils qui ont essayé de s'y connecter (avec leur nom et leurs connexions) et un bouton **Déconnecter**. La clé admin principale n'est pas limitée. À installer une fois : `supabase/rovex-devices.sql` dans **SQL Editor**.
- **Co-admin** : coche « 👑 Droits admin » en créant un ID pour lui donner le panneau Admin (choisis « ∞ Permanent »). Seule la clé principale peut être régénérée.
- **Contenu partagé** : les exemples d'apprentissage, les skills et les prompts créés par les admins sont publiés en ligne et arrivent chez tous les membres (toutes les 15 minutes et à chaque connexion). La bibliothèque, elle, vient de l'algo cloud GitHub.
- **Sans internet** : la clé admin de ce PC marche encore (mode hors ligne), mais la gestion des IDs demande internet.

## Génération d'images (gratuite, pour tous les membres)

Les images (icônes, UI, miniatures, textures, sprites VFX) sont faites **gratuitement** par **Cloudflare Workers AI** (modèle FLUX, environ 100 images par jour offertes par Cloudflare). Les clés restent cachées sur ton Supabase (jamais dans l'app) ; chaque ID a une limite par jour (20 images par défaut, réglable dans **Studio IA**), les admins n'ont pas de limite. Les icônes sont demandées sur fond blanc puis **détourées par l'app** (PNG transparent, sans liseré). Sans compte Cloudflare, la fonction essaie Pollinations (gratuit sans clé, mais souvent saturé).

Installation, une fois, dans ton projet Supabase :

1. **SQL Editor** → colle `supabase/rovex-gen.sql` → **Run**.
2. **Edge Functions** → **Deploy a new function** → **Via Editor** → nom `rovex-gen` → colle `supabase/functions/rovex-gen/index.ts` → **Deploy** (pour une mise à jour : ouvre `rovex-gen` → **Code**, remplace tout, **Deploy**).
3. Dans la fonction `rovex-gen` → **Details** : désactive **Verify JWT** (l'app envoie l'ID d'accès, la fonction le vérifie elle-même) → **Save**.
4. Compte **Cloudflare** gratuit (dash.cloudflare.com, sans carte) : copie ton **Account ID** (page **Workers AI** ou colonne de droite de l'accueil), puis **My Profile → API Tokens → Create Token → modèle « Workers AI »** → copie le jeton.
5. **Edge Functions** → **Secrets** : ajoute `CF_ACCOUNT_ID` et `CF_API_TOKEN`. Facultatif : `CF_IMAGE_MODEL` (par défaut `@cf/black-forest-labs/flux-1-schnell`). Pour revenir à OpenAI (payant) : `OPENAI_API_KEY` + `IMAGE_PROVIDER=openai`.

**Prompt Booster (Groq, gratuit)** : lance aussi `supabase/rovex-ai-text.sql` dans **SQL Editor**, recolle la nouvelle version de `supabase/functions/rovex-gen/index.ts` dans la fonction `rovex-gen` (**Deploy**), puis ajoute le secret `GROQ_API_KEY` (clé gratuite sur console.groq.com/keys ; facultatif : `GROQ_MODEL`, par défaut `openai/gpt-oss-120b`, avec repli automatique sur d'autres modèles Groq). Sans clé Groq, la fonction utilise `GEMINI_API_KEY` si elle existe. Limite par défaut : 50 prompts par jour et par ID, réglable sur la page Prompts.

**Roblox Studio** (page **Roblox Studio**) : Rovex se branche sur le serveur MCP de Roblox Studio et repasse ses outils à Claude avec le préfixe `studio_` (lire les scripts et la structure de la place ouverte, lancer du Luau, tester…). Dans Studio : **Assistant → ⋯ → Manage MCP Servers → Enable Studio as MCP server**. Dans Rovex : la config officielle est pré-remplie (`cmd.exe /c %LOCALAPPDATA%\Roblox\mcp.bat` sur Windows, `StudioMCP` sur macOS) ; on peut coller n'importe quel JSON MCP en `command` + `args`. La config reste sur le PC (`data/studio.json`) ; le serveur MCP lancé par Claude la relit et prévient Claude quand les outils changent.

**La place dans Rovex** : quand Studio est connecté, chaque place ouverte apparaît dans le menu (section **Roblox Studio**, via `list_roblox_studios`). Sa page a deux onglets : **Scripts** (tous les scripts du jeu ; on clique, on lit, on modifie et on enregistre, ça change dans Studio par `execute_luau` + `ScriptEditorService:UpdateSourceAsync`, annulable par Ctrl+Z dans Studio) et **Réglages du jeu** (les valeurs simples écrites dans le code, `local swordDamage = 5`, `Config = { Sword = { Damage = 25 } }`, modifiables en un champ sans ouvrir le script). Code : `place.js`.

**Assets Rovex dans les places** : quand Rovex est connecté à Roblox Studio, chaque place ouverte reçoit les packs du dossier `roblox-assets/` dans `ReplicatedStorage.RovexAssets`, rangés par thème : `Environment` (arbres, plantes, rochers, nuages stylisés), `VFX/Combat` et `VFX/Fire` (130+ modèles de VFX, renommés `Combat_001`…, `Fire_001`…), `UI/StudUI` (HUD et fenêtres style stud). Les scripts des packs sont désactivés (modèles). Claude les liste avec l'outil MCP `rovex_assets`. Import automatique une fois par session (seulement si la version manque), ou bouton **Importer maintenant** sur la page Roblox Studio. Code : `rbxassets.js`.

**Images en jeu** : l'outil MCP `upload_image_to_roblox` envoie une image (de `generate_image`, de la bibliothèque ou une URL) sur Roblox par l'outil `upload_image` de Studio (lien local temporaire `/share/…`, servi seulement à ce PC), ou sinon par Open Cloud avec la clé de l'utilisateur (page Roblox Studio), puis la pose dans la place (`Image` d'un ImageLabel/ImageButton, `Texture` d'un Decal, ou un Decal sur une Part). Code : `rbxupload.js`.

**Bibliothèque en ligne (exploration continue)** : le workflow `roblox-crawler.yml` tourne ~52 min chaque heure. Il lit en profondeur (curseurs gardés d'un passage à l'autre) le DevForum (scripting/building/art/game design support, creations feedback, tutoriels, ressources, annonces), Bluesky, Reddit (souvent bloqué depuis GitHub), Sketchfab, dev.to, le Creator Store (images, meshes, modèles, plugins), YouTube et GitHub, et envoie ses trouvailles au fil de l'eau dans Supabase (`supabase/rovex-library.sql`, table `rovex.library`, clé `ROVEX_CRAWLER_KEY` en secret GitHub). Chaque app récupère les nouveautés toutes les 5 minutes (`rovex_lib_since`). Garde-fou : `library_max` (700 000 par défaut, pour rester dans les 500 Mo du plan gratuit). X/Twitter n'a pas d'accès gratuit en lecture : pas de collecte.

**Textures VFX** (page **Textures VFX**) : plus de 1000 IDs Roblox de textures (flipbooks de particules feu, fumée, slash, burst, foudre, fissures, eau, glace ; decals de vent, étoiles, glows ; textures diverses), rangés par groupe avec leur grille de flipbook. La page affiche les miniatures (API thumbnails de Roblox, en cache 7 jours), joue les flipbooks au survol et copie `rbxassetid://ID` au clic. Claude les retrouve avec l'outil MCP `find_vfx_textures` (avec FlipbookLayout / FlipbookMode / FlipbookFramerate conseillés). Les admins peuvent coller d'autres listes (partagées avec les membres une fois `rovex-library.sql` lancé). Liste de base : `vfx-textures.js`.

**Personnaliser** (icône palette en haut) : 9 thèmes, couleurs libres, fond d'écran animé (aurore, dégradé animé, image/GIF ou vidéo importée ou par lien), assombrir / flou / verre des panneaux, police, taille du texte, arrondis, animations, CSS libre ; export / import de thème en JSON. Gardé sur le PC (`settings.custom`) et appliqué sans flash (`public/custom.js`).

**Deux espaces** (sélecteur en haut) : **Création** (exemples, textures VFX, skills, prompts, Studio IA, niveau, connexion Claude, Roblox Studio, développeur) et **Ressources** (bibliothèque, open source, chaînes, YouTube, favoris, exploration, catégories).

**Mode développeur** (Réglages, admins) : page **Développeur** pour travailler à plusieurs sur Rovex (chaque dev avec son Claude Code, sur une branche, pull request, version publiée à la fusion) et outils MCP `dev_app_info` / `dev_set_custom` pour changer l'apparence en direct. Le guide pour tout Claude qui modifie le code : `CLAUDE.md`.

**Connexion Claude** : ouverte aux membres pour brancher Claude Desktop / Claude Code sur leur PC ; les outils MCP et les consignes restent réservés aux admins.


## Langues

Le site est en **anglais** par défaut. Chaque visiteur choisit sa langue (English, Français, Español, Português) sur l'écran de connexion, dans la barre latérale ou dans Réglages ; le choix est gardé dans son navigateur. Les textes sont dans `public/i18n.js`.
- **Partager l'app** : envoie le lien de téléchargement et un ID ; chacun installe Rovex Hub sur son PC.

## Algo cloud (GitHub Actions)

`cloud-crawl.js` + `.github/workflows/roblox-crawler.yml` : GitHub lance l'algo **toutes les heures, sans fin**. Chaque passage (45 min) reprend le cycle : nouvelles vidéos des chaînes → découverte de chaînes → exploration → open source. Les trouvailles sont enregistrées dans `roblox-dev-hub/cloud/library.json`.

L'app récupère ce fichier toutes les 30 minutes (**Réglages → Source cloud**), même si ton PC était éteint pendant que l'algo cherchait.

- Lancer à la main : onglet **Actions** du dépôt → « Roblox Dev Hub — exploration continue » (nom du workflow) → **Run workflow**.
- Optionnel : un secret `YOUTUBE_API_KEY` (Settings → Secrets → Actions) pour la recherche de vidéos YouTube.
- GitHub désactive les tâches planifiées d'un dépôt public après 60 jours sans activité : les commits de l'algo comptent comme activité, mais s'il s'arrête, réactive-le dans l'onglet Actions.

## Chat Claude (ton Claude Desktop relié par MCP)

La page **Chat Claude** permet de parler à Claude **dans Rovex, avec ton abonnement Claude**, seulement par MCP : une conversation de Claude Desktop écoute le chat avec l'outil `chat_listen` (attend le prochain message, 40 s au plus), répond avec `chat_reply` et annonce ses étapes avec `chat_status`, puis réécoute. On discute dans Rovex, Claude Desktop reste réduit.

- **Connecter Claude Desktop** ouvre une nouvelle conversation avec la consigne déjà écrite (aussi en prompt MCP `rovex-chat`, menu **+**). La première fois, choisir « Toujours autoriser » pour les trois outils du chat.
- **✨ Améliorer et envoyer** (ou Ctrl+Entrée) : Groq (Prompt Booster, `/api/gen/enhance`) réécrit le message en prompt précis pour Claude, puis l'envoie.
- Les messages écrits quand Claude n'écoute pas l'attendent. Si la conversation s'arrête (fermée ou trop longue), on la rebranche : l'historique reste dans Rovex (`data/agent-chat.json`).
- Code : `agents.js` (conversation, file d'attente, requête longue `/agent/inbox`, clé locale `data/agent.json`) et les outils `chat_*` de `mcp.js`. Le chat ne marche que sur le PC où Rovex est installé.

## Blender (modélisation et animations R6)

La page **Blender** branche Claude sur Blender grâce à l'add-on **Claude Blender MCP** (inclus : `blender/claude_blender_mcp-0.2.1.zip`, Blender 4.2+, testé sur 4.5 et 5.2 ; source dans `blender/addon/`, zip refait par `python3 blender/build_addon.py`). L'add-on écoute sur `127.0.0.1:9876` (une ligne JSON par commande) ; Rovex lui parle directement (`blender.js`, pas besoin de Python) et donne ses 27 outils à Claude quand on active l'interrupteur. `blender_execute_python` donne un accès complet (bpy, bmesh, numpy ; variables gardées d'un appel à l'autre ; avec l'interface, le code tourne dans le contexte de la vue 3D, donc les opérateurs marchent) et la boîte à outils `rx` (`addon/rx.py`) : primitives, Edit Mode par bmesh (extrude, inset, biseau, loop cut…), modificateurs, 12 pinceaux de sculpt (numpy, symétrie, traits), couleurs par face, UV, armature + poids (auto, rigide, proche), IK, clés et actions (compatibles Blender 5), stats et export FBX pour Roblox. `blender_view` montre le modèle sous plusieurs angles en une image (Workbench, solide / argile / fil de fer / rayons X), `blender_mesh_stats` donne le polycount. Plus `blender_viewport_screenshot`, `blender_scene_info`… et les outils d'animation R6 (`r6_create_animation`, `r6_preview`, `r6_analyze`, `r6_export` vers Roblox Studio…). Schémas des outils : `blender/tools.json`. Exports dans `blender-exports/` (dossier des données). La page prévient quand l'add-on installé est plus ancien que celui de Rovex.

Installation : bouton **Montrer l'add-on** → Blender **Edit › Preferences › Get Extensions › ⌄ › Install from Disk…** → cocher **Claude Blender MCP** → dans le .blend, **N › onglet Claude** affiche *Running on 127.0.0.1:9876* → activer l'interrupteur dans Rovex.

## Relier en MCP

L'app expose un serveur MCP (`rovex-hub`), à brancher dans Claude ou tout autre client MCP. La page **Connexion Claude** affiche la config exacte, prête à copier, et la commande Claude Code : `claude mcp add --transport http rovex-hub http://localhost:4747/mcp`.

- **Mode HTTP** (l'app doit être ouverte) : `http://localhost:4747/mcp` — libre depuis ton PC ; depuis un autre appareil, ajoute l'en-tête `Authorization: Bearer <ID ou clé admin>`.
- **Mode stdio** (marche même app fermée) : Claude Desktop lance `Rovex Hub.exe` en mode Node sur `resources\app\mcp.js` (variable `ELECTRON_RUN_AS_NODE=1`). L'app écrit cette config toute seule.

Outils exposés (activables dans **Connexion Claude**) : `load_skill`, `list_skills`, `generate_image`, `search_opensource`, `search_resources`, `list_examples`, `get_example`, `get_resource`, `list_categories`, `add_resource`, `import_url`, `update_notes`, `explore_internet`, `explore_status`, `list_channels`, `sync_channels`.

### Skills

- **Automatique** : les instructions du serveur MCP demandent à Claude d'appeler `load_skill` avant toute tâche Roblox.
- **Claude Desktop** : chaque skill est aussi un prompt MCP (`rovex-scripting`, `rovex-vfx`…) dans le menu **+**. Tu peux aussi télécharger un skill en `.zip` depuis la page Skills et l'ajouter dans Paramètres → Capacités → Skills.
- **Claude Code** : l'app écrit les skills dans `~/.claude/skills/rovex-<catégorie>/` au démarrage et à chaque modification (bouton « Installer pour Claude Code » sur la page Skills).

## Où sont mes données ?

- `data/library.json` : ta base (tes ressources, chaînes, exemples, réglages).
- `data/cloud-library.json` : la grande bibliothèque en ligne (ressources trouvées par l'exploration), dans son propre fichier écrit en arrière-plan pour que l'app reste fluide.
- `media/` : les fichiers que tu as ajoutés.

Pour sauvegarder, copie ces deux dossiers. Ils ne sont jamais envoyés sur GitHub.

## Pourquoi l'app ne télécharge pas les vidéos YouTube

Télécharger et redistribuer les vidéos d'autres créateurs est interdit par YouTube. L'app enregistre donc les liens, les miniatures et les infos, et lit les vidéos YouTube directement dans l'app avec le lecteur intégré. Tes propres vidéos (captures Studio, etc.) peuvent être ajoutées comme fichiers.
