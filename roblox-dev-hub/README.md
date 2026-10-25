# Roblox Dev Hub

Ta bibliothèque perso de ressources de dev Roblox : scripting, VFX, animation, GUI, GFX, modélisation, build, audio, game design et outils. Elle tourne sur ton PC et se relie à Claude.

- **Près de 70 ressources de départ** : docs officielles Roblox, outils (Blender, Rojo, Mixamo…) et recherches YouTube par thème.
- **Import en un clic** : colle un lien YouTube, une chaîne, une page du DevForum ou une doc. Le titre, l'auteur et la miniature sont récupérés tout seuls.
- **Tes fichiers** : glisse des images, vidéos, scripts `.lua`, modèles `.rbxm` / `.fbx` / `.blend` sur la page.
- **Veille YouTube** : suis des chaînes, leurs nouvelles vidéos arrivent dans ta base (sans clé).
- **Recherche YouTube intégrée** : avec une clé YouTube Data API gratuite (optionnelle).
- **Favoris, niveaux, tags et notes** : Claude peut lire tes notes.
- **Relié à Claude** (serveur MCP) : Claude cherche dans ta base, ajoute des tutos et résume des vidéos dans tes notes.

## Installation (Windows)

1. Installe **Node.js 18 ou plus récent** : https://nodejs.org (version LTS).
2. Télécharge ce dossier `roblox-dev-hub` sur ton PC (par exemple dans `Documents`).
3. Double-clique sur **`Lancer Roblox Dev Hub.bat`**. L'app s'ouvre sur http://localhost:4747.

Laisse la fenêtre noire ouverte tant que tu utilises l'app. Aucun `npm install` n'est nécessaire : l'app n'a aucune dépendance.

## Relier à Claude

Double-clique sur **`Relier a Claude.bat`**, ou tape dans un terminal :

```
claude mcp add --scope user roblox-dev-hub -- node "C:\chemin\vers\roblox-dev-hub\mcp.js"
```

La page **Relier à Claude** de l'app affiche la commande avec le bon chemin, prête à copier. Elle donne aussi la configuration pour l'application Claude Desktop.

Ensuite, lance `claude` et demande par exemple :

- « Cherche dans ma base Roblox Dev Hub des tutos sur les slash VFX »
- « Ajoute cette vidéo à ma base dans VFX : https://youtu.be/… »
- « Récupère les nouvelles vidéos de mes chaînes suivies »

Claude n'a pas besoin que l'app soit ouverte : il lit directement le fichier de la base.

## Où sont mes données ?

- `data/library.json` : toute ta base (ressources, chaînes, réglages).
- `media/` : les fichiers que tu as ajoutés.

Pour sauvegarder, copie ces deux dossiers. Ils ne sont jamais envoyés sur GitHub.

## Pourquoi l'app ne télécharge pas les vidéos YouTube

Télécharger et redistribuer les vidéos d'autres créateurs est interdit par YouTube. L'app enregistre donc les liens, les miniatures et les infos, et lit les vidéos YouTube directement dans l'app avec le lecteur intégré. Tes propres vidéos (captures Studio, etc.) peuvent être ajoutées comme fichiers.
