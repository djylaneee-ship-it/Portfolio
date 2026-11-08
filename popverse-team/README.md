# Popverse Team

L'application interne des développeurs de **Popverse Studio** : un seul endroit pour organiser, construire et suivre tous les jeux Roblox du studio.

| Module | Ce qu'il fait |
|---|---|
| **Projets** | Un projet par jeu (lien Roblox, image, statut, genre). Import des jeux depuis popversestudio.com. |
| **Tâches** | Kanban façon Trello : colonnes, glisser-déposer (souris et doigt), étiquettes, priorités, membres, échéances, checklists, pièces jointes, commentaires en direct, filtres, vue liste. |
| **Tableaux** | Toile libre façon Milanote : notes, titres, images, flèches, tableaux, checklists, liens, zones. Zoom, déplacement, temps réel. |
| **Lore** | Wiki du jeu : univers, personnages, lieux, objets, mécaniques… avec éditeur riche (titres, images, tableaux). |
| **Progrès** | Fil des avancées de l'équipe : posts avec images et vidéos, likes, commentaires, versions et jalons. |
| **Stats** | Joueurs en jeu, visites, favoris, votes (API Roblox) + serveurs en direct et achats (script Luau dans le jeu). |
| **Messages** | Chat façon Discord : salons d'équipe et par projet, messages privés, réponses, réactions, mentions, images, « en train d'écrire ». |
| **Copilot** | Assistant IA qui connaît le jeu par cœur (lore, tâches, tableaux, progrès, stats) et crée des tâches ou des pages de lore pour toi. `Ctrl+J` partout. |
| **Équipe** | Membres, rôles (fondateur, admin, membre), présence, code d'équipe pour inviter. |

Comptes : e-mail + mot de passe. **Le premier compte créé devient le fondateur** ; les suivants doivent saisir le **code d'équipe** (visible par les admins dans *Équipe*).

## Télécharger

- **PC Windows** et **Android** : [page de téléchargement](https://github.com/djylaneee-ship-it/Portfolio/releases/tag/popverse-team-latest) (`Popverse-Team-Setup.exe`, `Popverse-Team.apk`).
- **iPhone / iPad** : ouvrir <https://djylaneee-ship-it.github.io/Portfolio/team/> dans Safari › Partager › *Sur l'écran d'accueil*.

## Mise en route (une seule fois)

Sans base en ligne, l'app tourne en **mode démo** (tout reste sur l'appareil). Pour travailler en équipe :

1. **Créer un projet Supabase** (gratuit) sur <https://supabase.com/dashboard>, nommé par exemple `popverse-team` (région Paris `eu-west-3`).
2. **SQL Editor** › coller tout `supabase/schema.sql` › *Run*.
3. **Authentication › Sign In / Providers › Email** : désactiver *Confirm email* (sinon chaque membre doit cliquer un lien reçu par e-mail ; l'envoi gratuit de Supabase est limité à quelques e-mails par heure).
4. **Edge Functions** : créer deux fonctions avec le code de `supabase/functions/pt-ai/index.ts` et `supabase/functions/pt-roblox/index.ts`.
   Pour `pt-roblox`, décocher *Verify JWT* (la fonction vérifie elle-même ; les jeux Roblox l'appellent sans compte).
5. **Edge Functions › Secrets** : ajouter `GROQ_API_KEY` (clé gratuite sur <https://console.groq.com>) pour le Copilot.
   Ou `ANTHROPIC_API_KEY` pour utiliser Claude à la place (payant, meilleur). Optionnel : `GROQ_MODEL`, `ANTHROPIC_MODEL`.
6. **Project Settings › API** : copier l'URL du projet et la clé publique (*publishable* ou *anon*) dans `src/config.js` (`SUPABASE_URL`, `SUPABASE_KEY`), puis monter la version dans `package.json` pour republier les apps.
   (Pour tester tout de suite sans republier : dans l'app, *Mode démo › Brancher la base*.)
7. (Optionnel) `supabase/cron.sql` : relevé des stats Roblox toutes les 5 minutes même app fermée.

### Relier un jeu Roblox

Projet › **Stats** › *Relier le jeu* : copier le script (l'URL et la clé du projet sont déjà dedans) dans un **Script** de `ServerScriptService`, activer *Allow HTTP Requests* dans Game Settings › Security, publier. Chaque serveur envoie alors ses joueurs, FPS, ping et les achats toutes les 30 s. Événements perso : `_G.PopverseStats.track("boss_kill", player, 1, { boss = "Kraken" })`.

## Développement

```bash
cd popverse-team
npm install
npm run build        # src/ → www/app.js
npm run serve        # http://localhost:5173 (version web)
npm run app          # fenêtre Windows (Electron)
npm run watch        # reconstruit à chaque modification
```

Structure :

| Dossier | Rôle |
|---|---|
| `src/app.js` | Coquille : connexion, barre latérale, routes `#/…`, panneau Copilot. |
| `src/api.js` / `src/local.js` | Accès aux données : Supabase (en ligne, temps réel) ou démo (localStorage), même interface. |
| `src/ui.js` | Outils d'interface (éléments, icônes, fenêtres, menus, markdown, avatars, envoi d'images). |
| `src/views/*.js` | Une vue par page / onglet. |
| `www/` | Page, styles (`css/`), images. `app.js` et `sw.js` sont générés. |
| `electron/main.cjs` | App Windows + mises à jour automatiques. |
| `supabase/` | Base (`schema.sql`), fonctions edge (`pt-ai`, `pt-roblox`), relevés automatiques (`cron.sql`). |
| `roblox/` | Script Luau des stats en direct. |
| `resources/` | Icône de l'app Android. |

## Publier une version

Monter `"version"` dans `package.json`. Le workflow `.github/workflows/popverse-team.yml` construit l'`.exe` (Windows) et l'`.apk` (Android) et les met dans la release `popverse-team-latest`. La version web est publiée par `.github/workflows/rovex-site.yml` dans `/team/` du site GitHub Pages.

> L'APK doit toujours être signé avec la même clé, sinon Android refuse la mise à jour. Crée une clé une fois
> (`keytool -genkeypair -keystore popverse.keystore -alias popverse -keyalg RSA -keysize 2048 -validity 10000`)
> et mets-la dans les secrets GitHub du dépôt : `ANDROID_KEYSTORE_B64` (`base64 -w0 popverse.keystore`) et
> `ANDROID_KEYSTORE_PASSWORD`. Sans ces secrets, chaque version a une clé temporaire (désinstaller l'ancienne app avant).
