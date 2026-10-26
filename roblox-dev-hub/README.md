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
- **Skills Claude** (page **Skills**) : un skill par catégorie (Scripting, VFX, Animation, GUI…). Avant une tâche, Claude identifie la catégorie, appelle `load_skill` et lit les règles du skill, les exemples validés avec leur code, les meilleures ressources (avec tes notes) et l'open source de la catégorie, puis fait la tâche. Les règles se modifient depuis la page.
- **Prompts — Prompt Booster** (page **Prompts**) : tu écris ta demande en vrac (« fais-moi un système de pets »), **Gemini** la réécrit en prompt détaillé pour Claude : charger les skills des bonnes catégories (`load_skill`), chercher dans la base, lire les exemples validés, regarder l'open source, générer les images, bonnes pratiques Roblox, livrables et tests. Rovex envoie à Gemini le contenu de ta base (catégories, exemples validés, règles des skills). Les 15 derniers prompts améliorés sont gardés. Les modèles de prompts restent proposés dans Claude Desktop (menu **+** → Rovex Hub).
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

## Génération d'images (ta clé OpenAI pour tous les membres)

Tous les membres génèrent des images avec **ta** clé OpenAI. Elle reste cachée sur ton Supabase (jamais dans l'app) ; chaque ID a une limite par jour (20 images par défaut, réglable dans **Studio IA**), les admins n'ont pas de limite.

Installation, une fois, dans ton projet Supabase :

1. **SQL Editor** → colle `supabase/rovex-gen.sql` → **Run**.
2. **Edge Functions** → **Deploy a new function** → **Via Editor** → nom `rovex-gen` → colle `supabase/functions/rovex-gen/index.ts` → **Deploy**.
3. Dans la fonction `rovex-gen` → **Details** : désactive **Verify JWT** (l'app envoie l'ID d'accès, la fonction le vérifie elle-même) → **Save**.
4. **Edge Functions** → **Secrets** : ajoute `OPENAI_API_KEY`. Facultatif : `OPENAI_IMAGE_MODEL` pour changer de modèle.

**Prompt Booster (Gemini, gratuit)** : lance aussi `supabase/rovex-ai-text.sql` dans **SQL Editor**, recolle la nouvelle version de `supabase/functions/rovex-gen/index.ts` dans la fonction `rovex-gen` (**Deploy**), puis ajoute le secret `GEMINI_API_KEY` (clé gratuite sur aistudio.google.com/apikey ; facultatif : `GEMINI_MODEL`). Limite par défaut : 50 prompts par jour et par ID, réglable sur la page Prompts. En gratuit, Google peut utiliser les textes envoyés pour améliorer ses modèles.

Conseil : fixe un plafond de dépense mensuel dans OpenAI (Settings → Limits), puisque toutes les générations des membres sont facturées sur ton compte.

## Langues

Le site est en **anglais** par défaut. Chaque visiteur choisit sa langue (English, Français, Español, Português) sur l'écran de connexion, dans la barre latérale ou dans Réglages ; le choix est gardé dans son navigateur. Les textes sont dans `public/i18n.js`.
- **Partager l'app** : envoie le lien de téléchargement et un ID ; chacun installe Rovex Hub sur son PC.

## Algo cloud (GitHub Actions)

`cloud-crawl.js` + `.github/workflows/roblox-crawler.yml` : GitHub lance l'algo **toutes les heures, sans fin**. Chaque passage (45 min) reprend le cycle : nouvelles vidéos des chaînes → découverte de chaînes → exploration → open source. Les trouvailles sont enregistrées dans `roblox-dev-hub/cloud/library.json`.

L'app récupère ce fichier toutes les 30 minutes (**Réglages → Source cloud**), même si ton PC était éteint pendant que l'algo cherchait.

- Lancer à la main : onglet **Actions** du dépôt → « Roblox Dev Hub — exploration continue » (nom du workflow) → **Run workflow**.
- Optionnel : un secret `YOUTUBE_API_KEY` (Settings → Secrets → Actions) pour la recherche de vidéos YouTube.
- GitHub désactive les tâches planifiées d'un dépôt public après 60 jours sans activité : les commits de l'algo comptent comme activité, mais s'il s'arrête, réactive-le dans l'onglet Actions.

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

- `data/library.json` : toute ta base (ressources, chaînes, réglages).
- `media/` : les fichiers que tu as ajoutés.

Pour sauvegarder, copie ces deux dossiers. Ils ne sont jamais envoyés sur GitHub.

## Pourquoi l'app ne télécharge pas les vidéos YouTube

Télécharger et redistribuer les vidéos d'autres créateurs est interdit par YouTube. L'app enregistre donc les liens, les miniatures et les infos, et lit les vidéos YouTube directement dans l'app avec le lecteur intégré. Tes propres vidéos (captures Studio, etc.) peuvent être ajoutées comme fichiers.
