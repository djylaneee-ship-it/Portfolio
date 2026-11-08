# Popverse Team — guide pour Claude et les devs

App interne de **Popverse Studio** (studio de jeux Roblox) : projets, tâches (Trello), tableaux (Milanote), chat (Discord), lore, progrès, stats Roblox, Copilot IA. PC (Electron), Android (Capacitor), web/iPhone (PWA sur GitHub Pages). Lis `README.md` pour l'installation.

## Règles

- JavaScript sans framework : `h('div.classe', { props }, ...enfants)` de `src/ui.js`. Pas de `innerHTML` avec des données utilisateur sauf via `md()` ou `sanitize()`.
- Toutes les données passent par `api` (`src/api.js`) : `select/get/insert/update/remove/subscribe/presence/upload/fn/rpc`. Toute nouvelle opération doit exister dans les DEUX moteurs (`createSupabase` et `src/local.js`).
- Tables `pt_*` dans `supabase/schema.sql` (idempotent, relançable). Nouvelle table = RLS + publication temps réel dans ce fichier.
- Un onglet de projet = `export default async function (box, { project, sub, query })` qui renvoie une fonction de nettoyage (désabonnements). `cleanup.onSub(sub, query)` pour changer de sous-route sans recharger.
- Textes de l'interface en français. Thème : variables de `www/css/base.css` (or : `--gold`, `--gold-grad`), un fichier CSS par module.
- Avant de commit : `npm run build` sans erreur, puis capture Playwright de la page touchée en mode démo (bureau 1440×900 et mobile 390×844), console sans erreur.
- Version : monter `package.json` `version` publie les apps (workflow `popverse-team.yml`).
