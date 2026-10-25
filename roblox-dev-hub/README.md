# Roblox Dev Hub

Ta bibliothèque perso de ressources de dev Roblox : scripting, VFX, animation, GUI, GFX, modélisation, build, audio, game design et outils. Elle tourne sur ton PC et s'expose en serveur MCP.

- **Près de 70 ressources de départ** : docs officielles Roblox, outils (Blender, Rojo, Mixamo…) et recherches YouTube par thème.
- **Import en un clic** : colle un lien YouTube, une chaîne, une page du DevForum ou une doc. Le titre, l'auteur et la miniature sont récupérés tout seuls.
- **Tes fichiers** : glisse des images, vidéos, scripts `.lua`, modèles `.rbxm` / `.fbx` / `.blend` sur la page.
- **Veille YouTube** : suis des chaînes, leurs nouvelles vidéos arrivent dans ta base (sans clé).
- **Recherche YouTube intégrée** : avec une clé YouTube Data API gratuite (optionnelle).
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

## Relier en MCP

L'app expose un serveur MCP, à brancher dans le client de ton choix (Claude Desktop, Cursor, VS Code, LM Studio…). La page **Serveur MCP** de l'app affiche les adresses exactes, prêtes à copier.

- **Mode HTTP** (l'app doit être ouverte) : `http://localhost:4747/mcp`
- **Mode stdio** (marche même app fermée) : `node "%LOCALAPPDATA%\RobloxDevHub\mcp.js"`

Outils exposés : `search_resources`, `get_resource`, `list_categories`, `add_resource`, `import_url`, `update_notes`, `sync_channels`.

## Où sont mes données ?

- `data/library.json` : toute ta base (ressources, chaînes, réglages).
- `media/` : les fichiers que tu as ajoutés.

Pour sauvegarder, copie ces deux dossiers. Ils ne sont jamais envoyés sur GitHub.

## Pourquoi l'app ne télécharge pas les vidéos YouTube

Télécharger et redistribuer les vidéos d'autres créateurs est interdit par YouTube. L'app enregistre donc les liens, les miniatures et les infos, et lit les vidéos YouTube directement dans l'app avec le lecteur intégré. Tes propres vidéos (captures Studio, etc.) peuvent être ajoutées comme fichiers.
