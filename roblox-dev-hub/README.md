# Roblox Dev Hub

Ta bibliothèque perso de ressources de dev Roblox : scripting, VFX, animation, GUI, GFX, modélisation, build, audio, game design et outils. Elle tourne sur ton PC et s'expose en serveur MCP.

- **Près de 70 ressources de départ** : docs officielles Roblox, outils (Blender, Rojo, Mixamo…) et recherches YouTube par thème.
- **Exploration automatique** : fouille YouTube, le DevForum Roblox et Reddit (r/robloxgamedev) pour référencer des milliers de vidéos, tutos et images, rangés par catégorie.
- **Toutes les chaînes Roblox** : découvre et relie automatiquement les chaînes YouTube Roblox (dev, VFX, gameplay, YouTubeurs FR/EN/ES…), puis récupère leurs nouvelles vidéos. La mise à jour peut être automatique (Réglages).
- **Open source et systèmes gratuits** : dépôts GitHub Roblox (frameworks, modules, jeux open source), ressources communautaires du DevForum, modèles et plugins gratuits du Creator Store.
- **Import en un clic** : colle un lien YouTube, une chaîne, une page du DevForum ou une doc. Le titre, l'auteur et la miniature sont récupérés tout seuls.
- **Tes fichiers** : glisse des images, vidéos, scripts `.lua`, modèles `.rbxm` / `.fbx` / `.blend` sur la page.
- **Recherche YouTube intégrée**, sans clé (une clé YouTube Data API reste possible dans Réglages). Un jeton GitHub optionnel accélère la récupération de l'open source.
- **Favoris, niveaux, tags et notes**.
- **Serveur MCP** : n'importe quel client MCP peut chercher dans ta base, ajouter des tutos et écrire des notes.

## Installation (Windows) : un seul fichier

1. Télécharge **`Installer Roblox Dev Hub.bat`** (à la racine du dépôt).
2. Double-clique dessus. L'installateur :
   - vérifie Node.js et l'installe avec winget s'il manque ;
   - installe l'app dans `%LOCALAPPDATA%\RobloxDevHub` ;
   - crée le raccourci **Roblox Dev Hub** sur le Bureau et dans le menu Démarrer ;
   - ouvre l'app sur http://localhost:4747.

Pour mettre à jour, relance l'installateur : ta base et tes fichiers sont conservés. Pour désinstaller, lance `Desinstaller.bat` dans le dossier d'installation.

Laisse la petite fenêtre noire ouverte tant que tu utilises l'app.

Après une modification du code, régénère l'installateur avec `node build-installer.js`.

## Accès par ID et panneau admin

Le site demande un **ID d'accès** pour entrer.

- **Clé admin permanente** : créée au premier lancement, affichée dans la fenêtre noire et enregistrée dans `data/CLE-ADMIN.txt`. Elle n'expire jamais et ouvre le **panneau Admin**. Ne la partage pas.
- **IDs d'accès** (`RDH-XXXX-XXXX-XXXX`) : crée-les dans **Admin**, envoie-les. Ils donnent accès au site en lecture seule et se bloquent tout seuls après leur durée (1 mois par défaut). Tu peux les prolonger, les bloquer ou les supprimer.
- **Partager le site** : `Lancer en mode partage.bat` l'ouvre aux appareils de ton Wi-Fi. Pour internet, il faut un tunnel (ex. `cloudflared tunnel --url http://localhost:4747`) ou un hébergement.

## Algo cloud (GitHub Actions)

`cloud-crawl.js` + `.github/workflows/roblox-crawler.yml` : GitHub lance l'algo **toutes les heures, sans fin**. Chaque passage (45 min) reprend le cycle : nouvelles vidéos des chaînes → découverte de chaînes → exploration → open source. Les trouvailles sont enregistrées dans `roblox-dev-hub/cloud/library.json`.

L'app récupère ce fichier toutes les 30 minutes (**Réglages → Source cloud**), même si ton PC était éteint pendant que l'algo cherchait.

- Lancer à la main : onglet **Actions** du dépôt → « Roblox Dev Hub — exploration continue » → **Run workflow**.
- Optionnel : un secret `YOUTUBE_API_KEY` (Settings → Secrets → Actions) pour la recherche de vidéos YouTube.
- GitHub désactive les tâches planifiées d'un dépôt public après 60 jours sans activité : les commits de l'algo comptent comme activité, mais s'il s'arrête, réactive-le dans l'onglet Actions.

## Relier en MCP

L'app expose un serveur MCP, à brancher dans le client de ton choix (Claude Desktop, Cursor, VS Code, LM Studio…). La page **Serveur MCP** de l'app affiche les adresses exactes, prêtes à copier.

- **Mode HTTP** (l'app doit être ouverte) : `http://localhost:4747/mcp` — libre depuis ton PC ; depuis un autre appareil, ajoute l'en-tête `Authorization: Bearer <ID ou clé admin>`.
- **Mode stdio** (marche même app fermée) : `node "%LOCALAPPDATA%\RobloxDevHub\mcp.js"`

Outils exposés : `search_resources`, `get_resource`, `list_categories`, `add_resource`, `import_url`, `update_notes`, `explore_internet`, `explore_status`, `list_channels`, `sync_channels`.

## Où sont mes données ?

- `data/library.json` : toute ta base (ressources, chaînes, réglages).
- `media/` : les fichiers que tu as ajoutés.

Pour sauvegarder, copie ces deux dossiers. Ils ne sont jamais envoyés sur GitHub.

## Pourquoi l'app ne télécharge pas les vidéos YouTube

Télécharger et redistribuer les vidéos d'autres créateurs est interdit par YouTube. L'app enregistre donc les liens, les miniatures et les infos, et lit les vidéos YouTube directement dans l'app avec le lecteur intégré. Tes propres vidéos (captures Studio, etc.) peuvent être ajoutées comme fichiers.
