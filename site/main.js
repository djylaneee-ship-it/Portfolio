// Rovex Hub — site de présentation : langues (EN/FR), animations, démo, lien de téléchargement.
const DISCORD = 'https://discord.gg/mQauRN8DGj';
const REPO = 'djylaneee-ship-it/Portfolio';
const RELEASES = `https://github.com/${REPO}/releases/latest`;

const I18N = {
  en: {
    'nav.features': 'Features', 'nav.docs': 'Documentation', 'nav.download': 'Download', 'nav.faq': 'FAQ', 'nav.discord': 'Discord', 'nav.pricing': 'See pricing',
    'hero.t1': 'Your Claude.', 'hero.t2': 'Roblox expert.',
    'hero.lead': 'Rovex Hub gives Claude thousands of Roblox dev tutorials, validated scripts and open source systems — so it codes your game like a dev who knows Roblox by heart.',
    'hero.cta': 'Get Rovex Hub', 'hero.how': 'See how it works',
    'hero.proof': '<b>Thousands of Roblox resources</b> collected and updated every hour',
    'demo.s1': 'You ask', 'demo.s1b': 'in plain words', 'demo.s2': 'Rovex feeds Claude', 'demo.s2b': 'skill, examples, docs',
    'demo.s3': 'Claude builds', 'demo.s3b': 'clean Luau, ready to drop in',
    'demo.caption': 'Live demonstration of Rovex Hub with Claude.', 'demo.replay': 'Replay',
    'demo.b1': 'Prompt templates', 'demo.b2': 'VFX skill loaded', 'demo.b3': 'Validated example',
    'feat.eyebrow': 'Features', 'feat.t1': 'Everything Claude needs,', 'feat.t2': 'in one place.',
    'feat.sub': 'One desktop app that collects, sorts and serves Roblox knowledge to Claude through MCP. You stay in Claude, Rovex does the homework.',
    'f.library': 'Library', 'f.libraryP': 'Videos, docs, DevForum posts and tutorials for every category — scripting, VFX, animation, GUI, GFX, modeling, building, audio.',
    'f.skills': 'One skill per category', 'f.skillsP': 'Before a task, Claude loads the right skill: your rules, your validated examples and the best resources of that category.',
    'f.examples': 'Learning examples', 'f.examplesP': 'A request, the right code and why it is right. Claude follows them before writing code for your game.',
    'f.prompts': 'Prompt templates', 'f.promptsP': '“Using Rovex Hub, make me…” — 21 ready-made prompts. Fill the blanks, copy, paste into Claude.',
    'f.level': 'Claude level', 'f.levelP': 'Watch Claude get better at Roblox: XP, mastery per category, badges and level-ups.',
    'f.connect': 'Connects itself', 'f.connectP': 'Rovex Hub detects Claude Desktop and Claude Code and plugs itself in. No config file to edit.',
    'f.channels': 'Roblox YouTube channels', 'f.channelsP': 'Hundreds of Roblox dev channels followed automatically. Their new videos land in your library.',
    'f.os': 'Open source & free systems', 'f.osP': 'GitHub repos sorted by stars, free models and plugins — on their own page, separate from learning content.',
    'how.eyebrow': 'How it works', 'how.t1': 'Three steps.', 'how.t2': 'Zero setup.',
    'how.sub': 'No code to write, no server to host. Install, sign in, and ask Claude.',
    'how.1': 'Install the app', 'how.1p': 'Download Rovex Hub for Windows and install it in one click, like Discord.',
    'how.2': 'Sign in with your ID', 'how.2p': 'Enter the personal access ID you get on our Discord after buying a plan.',
    'how.3': 'Ask Claude', 'how.3p': 'Rovex connects to Claude by itself. Ask anything: <code>Using Rovex Hub, make me a pet system…</code>',
    'com.t1': 'When you get stuck,', 'com.t2': 'you’re never alone.',
    'com.sub': 'Every member gets access to our Discord: support, updates, new prompts and a community of Roblox creators building with Claude.',
    'com.card': 'Join the Rovex Discord', 'com.cardP': 'Support, announcements and plans — all in one place.',
    'com.l1': 'Fast help on the Discord when something does not work', 'com.l2': 'New features and updates installed automatically', 'com.l3': 'The library grows every hour, with no action from you',
    'price.eyebrow': 'Pricing', 'price.t1': 'One app.', 'price.t2': 'Pick your access.',
    'price.sub': 'Every plan unlocks the full app. Purchases happen on our Discord: you receive your personal access ID right there.',
    'plan.m': 'Monthly', 'plan.mD': 'Try everything, stop whenever you want.', 'plan.mP': '/ month', 'plan.mN': 'Renew each month',
    'plan.y': 'Yearly', 'plan.yD': 'A full year of Rovex Hub, for less.', 'plan.yP': '/ year', 'plan.yN': 'Save €121 vs monthly', 'plan.yTag': 'Save 29%',
    'plan.i': 'Immortal', 'plan.iD': 'Pay once. Your access never expires.', 'plan.iP': 'one time', 'plan.iN': 'Lifetime access + updates',
    'plan.buy': 'Buy on Discord', 'price.m': '€35', 'price.y': '€299', 'price.i': '€528.99',
    'inc.title': 'Included in every plan',
    'inc.1': 'Rovex Hub desktop app for Windows', 'inc.2': 'Full library, updated every hour', 'inc.3': 'Skills for every category', 'inc.4': 'Learning examples & prompt templates',
    'inc.5': 'Open source & free systems page', 'inc.6': 'Auto-connection to Claude Desktop & Claude Code', 'inc.7': 'All updates included', 'inc.8': 'Members’ Discord & support',
    'buy.title': 'How buying works', 'buy.1': 'Click <b>Buy on Discord</b> and join the Rovex server.', 'buy.2': 'Choose your plan with the team on the Discord.', 'buy.3': 'You receive your <b>personal access ID</b>. Enter it in Rovex Hub and you are in.',
    'buy.note': 'The app is free to download, but you need an access ID to sign in. A Claude subscription (Claude Desktop or Claude Code) is required and is not included.',
    'faq.t1': 'Frequently', 'faq.t2': 'asked questions.', 'faq.sub': 'If your question is not listed, ask us on the Discord.',
    'q1': 'How do I buy Rovex Hub?', 'a1': 'Click any “Buy on Discord” button: you join our Discord, choose your plan with the team, and receive your personal access ID. Enter it in the app and you are in.',
    'q2': 'Can I download the app for free?', 'a2': 'Yes. Anyone can download and install Rovex Hub. But to sign in you need an access ID, which you get after buying a plan on the Discord.',
    'q3': 'What is the difference between the plans?', 'a3': 'Nothing in the app: every plan unlocks everything. Only the duration changes — 1 month (€35), 1 year (€299) or forever with Immortal (€528.99, paid once).',
    'q4': 'What happens when my plan ends?', 'a4': 'Your ID stops working and the app asks you to sign in again. Renew on the Discord and you get your access back. Immortal never expires.',
    'q5': 'Which AI do I need?', 'a5': 'Claude, through Claude Desktop or Claude Code. Rovex Hub connects to them automatically through MCP. Your Claude subscription is not included.',
    'q6': 'Which systems are supported?', 'a6': 'Windows 10 and 11 (64-bit). A macOS version is not available yet.',
    'q7': 'Is my data private?', 'a7': 'Your library, notes and examples stay on your PC. Only your access ID is checked online when you sign in.',
    'q8': 'How do updates work?', 'a8': 'Automatically. Rovex Hub checks for new versions and installs them for you. The library itself is enriched every hour.',
    'q9': 'Can I share my access ID?', 'a9': 'No. Your ID is personal. Shared or leaked IDs can be blocked at any time.',
    'q10': 'Windows says “Windows protected your PC”. Is it safe?', 'a10': 'Yes. Windows shows this message for new apps that are not signed with a paid certificate yet. Click “More info”, then “Run anyway”.',
    'q11': 'I found a bug. How do I report it?', 'a11': 'Tell us on the Discord with a screenshot and what you were doing. We fix it and the update installs itself.',
    'final.t': 'Make Claude a Roblox expert.', 'final.p': 'Download Rovex Hub for free, then get your access ID on Discord.', 'final.dl': 'Download for Windows', 'final.buy': 'Buy on Discord',
    'foot.tag': 'The Roblox brain of your Claude.', 'foot.rights': 'Rovex Hub is not affiliated with Roblox Corporation or Anthropic.',
    'dl.t1': 'Install', 'dl.lead': 'Native desktop app for Windows. Light, fast, and it updates itself.', 'dl.start': 'Install and get started',
    'dl.win': 'Windows', 'dl.winP': 'Windows 10 or 11 · 64-bit', 'dl.winBtn': 'Download for Windows', 'dl.mac': 'macOS', 'dl.macP': 'Not available yet', 'dl.macBtn': 'Coming later',
    'dl.loading': 'Looking for the latest version…', 'dl.ver': 'Version {v} · {size} MB',
    'dl.noticeT': 'Free download — sign-in requires an access ID.', 'dl.notice': 'You can install Rovex Hub for free, but you need an access ID to use it. Get yours on our <a class="link" href="' + DISCORD + '" target="_blank" rel="noopener">Discord</a> after choosing a plan.',
    'dl.specs': 'Minimum requirements', 'dl.os': 'Operating system', 'dl.osV': 'Windows 10 or 11 (64-bit)', 'dl.ram': 'Memory (RAM)', 'dl.ramV': '4 GB minimum · 8 GB recommended',
    'dl.disk': 'Free disk space', 'dl.diskV': '500 MB', 'dl.net': 'Internet', 'dl.netV': 'Needed to sign in and to receive new resources', 'dl.ai': 'AI', 'dl.aiV': 'Claude Desktop or Claude Code (Claude subscription not included)',
    'dl.steps': 'Install in 1 minute',
    'dl.s1': '<b>Download</b> Rovex-Hub-Setup.exe and double-click it.', 'dl.s2': 'If Windows shows <b>“Windows protected your PC”</b>, click <b>More info</b> → <b>Run anyway</b>.',
    'dl.s3': 'Rovex Hub installs itself and adds an icon to your <b>desktop</b> and Start menu.', 'dl.s4': 'Enter your <b>access ID</b>. Rovex connects to Claude Desktop and Claude Code by itself.',
  },
  fr: {
    'nav.features': 'Fonctionnalités', 'nav.docs': 'Documentation', 'nav.download': 'Télécharger', 'nav.faq': 'FAQ', 'nav.discord': 'Discord', 'nav.pricing': 'Voir les tarifs',
    'hero.t1': 'Ton Claude.', 'hero.t2': 'Expert Roblox.',
    'hero.lead': 'Rovex Hub donne à Claude des milliers de tutos de dev Roblox, de scripts validés et de systèmes open source — pour qu’il code ton jeu comme un dev qui connaît Roblox par cœur.',
    'hero.cta': 'Obtenir Rovex Hub', 'hero.how': 'Voir comment ça marche',
    'hero.proof': '<b>Des milliers de ressources Roblox</b> collectées et mises à jour chaque heure',
    'demo.s1': 'Tu demandes', 'demo.s1b': 'avec tes mots', 'demo.s2': 'Rovex nourrit Claude', 'demo.s2b': 'skill, exemples, docs',
    'demo.s3': 'Claude construit', 'demo.s3b': 'du Luau propre, prêt à coller',
    'demo.caption': 'Démonstration de Rovex Hub avec Claude.', 'demo.replay': 'Rejouer',
    'demo.b1': 'Modèles de prompts', 'demo.b2': 'Skill VFX chargé', 'demo.b3': 'Exemple validé',
    'feat.eyebrow': 'Fonctionnalités', 'feat.t1': 'Tout ce dont Claude a besoin,', 'feat.t2': 'au même endroit.',
    'feat.sub': 'Une app de bureau qui collecte, trie et sert le savoir Roblox à Claude via MCP. Tu restes dans Claude, Rovex fait les devoirs.',
    'f.library': 'Bibliothèque', 'f.libraryP': 'Vidéos, docs, posts du DevForum et tutos pour chaque catégorie — scripting, VFX, animation, GUI, GFX, modélisation, build, audio.',
    'f.skills': 'Un skill par catégorie', 'f.skillsP': 'Avant une tâche, Claude charge le bon skill : tes règles, tes exemples validés et les meilleures ressources de la catégorie.',
    'f.examples': 'Exemples d’apprentissage', 'f.examplesP': 'Une demande, le bon code et pourquoi il est bon. Claude les suit avant d’écrire le code de ton jeu.',
    'f.prompts': 'Modèles de prompts', 'f.promptsP': '« En utilisant Rovex Hub, fais-moi… » — 21 prompts prêts à l’emploi. Remplis les trous, copie, colle dans Claude.',
    'f.level': 'Niveau de Claude', 'f.levelP': 'Regarde Claude progresser en Roblox : XP, maîtrise par catégorie, badges et level-up.',
    'f.connect': 'Se connecte tout seul', 'f.connectP': 'Rovex Hub détecte Claude Desktop et Claude Code et s’y branche. Aucun fichier de config à modifier.',
    'f.channels': 'Chaînes YouTube Roblox', 'f.channelsP': 'Des centaines de chaînes de dev Roblox suivies automatiquement. Leurs nouvelles vidéos arrivent dans ta bibliothèque.',
    'f.os': 'Open source & systèmes gratuits', 'f.osP': 'Dépôts GitHub triés par étoiles, modèles et plugins gratuits — sur leur propre page, séparés de l’apprentissage.',
    'how.eyebrow': 'Comment ça marche', 'how.t1': 'Trois étapes.', 'how.t2': 'Zéro réglage.',
    'how.sub': 'Pas de code à écrire, pas de serveur à héberger. Installe, connecte-toi, et demande à Claude.',
    'how.1': 'Installe l’app', 'how.1p': 'Télécharge Rovex Hub pour Windows et installe-le en un clic, comme Discord.',
    'how.2': 'Connecte-toi avec ton ID', 'how.2p': 'Entre l’ID d’accès personnel que tu reçois sur notre Discord après l’achat d’un plan.',
    'how.3': 'Demande à Claude', 'how.3p': 'Rovex se branche à Claude tout seul. Demande ce que tu veux : <code>En utilisant Rovex Hub, fais-moi un système de pets…</code>',
    'com.t1': 'Quand tu bloques,', 'com.t2': 'tu n’es jamais seul.',
    'com.sub': 'Chaque membre a accès à notre Discord : support, mises à jour, nouveaux prompts et une communauté de créateurs Roblox qui construisent avec Claude.',
    'com.card': 'Rejoins le Discord Rovex', 'com.cardP': 'Support, annonces et achats — tout au même endroit.',
    'com.l1': 'De l’aide rapide sur le Discord quand quelque chose bloque', 'com.l2': 'Nouveautés et mises à jour installées automatiquement', 'com.l3': 'La bibliothèque grandit chaque heure, sans rien faire',
    'price.eyebrow': 'Tarifs', 'price.t1': 'Une app.', 'price.t2': 'Choisis ton accès.',
    'price.sub': 'Chaque plan débloque toute l’app. L’achat se fait sur notre Discord : tu y reçois ton ID d’accès personnel.',
    'plan.m': 'Mensuel', 'plan.mD': 'Teste tout, arrête quand tu veux.', 'plan.mP': '/ mois', 'plan.mN': 'À renouveler chaque mois',
    'plan.y': 'Annuel', 'plan.yD': 'Une année complète de Rovex Hub, moins cher.', 'plan.yP': '/ an', 'plan.yN': '121 € d’économie vs mensuel', 'plan.yTag': '−29 %',
    'plan.i': 'Immortel', 'plan.iD': 'Paie une fois. Ton accès n’expire jamais.', 'plan.iP': 'une seule fois', 'plan.iN': 'Accès à vie + mises à jour',
    'plan.buy': 'Acheter sur Discord', 'price.m': '35 €', 'price.y': '299 €', 'price.i': '528,99 €',
    'inc.title': 'Inclus dans chaque plan',
    'inc.1': 'L’app de bureau Rovex Hub pour Windows', 'inc.2': 'Toute la bibliothèque, mise à jour chaque heure', 'inc.3': 'Des skills pour chaque catégorie', 'inc.4': 'Exemples d’apprentissage & modèles de prompts',
    'inc.5': 'Page open source & systèmes gratuits', 'inc.6': 'Connexion auto à Claude Desktop & Claude Code', 'inc.7': 'Toutes les mises à jour incluses', 'inc.8': 'Discord des membres & support',
    'buy.title': 'Comment acheter', 'buy.1': 'Clique sur <b>Acheter sur Discord</b> et rejoins le serveur Rovex.', 'buy.2': 'Choisis ton plan avec l’équipe sur le Discord.', 'buy.3': 'Tu reçois ton <b>ID d’accès personnel</b>. Entre-le dans Rovex Hub et c’est parti.',
    'buy.note': 'L’app se télécharge gratuitement, mais il faut un ID d’accès pour se connecter. Un abonnement Claude (Claude Desktop ou Claude Code) est nécessaire et n’est pas inclus.',
    'faq.t1': 'Questions', 'faq.t2': 'fréquentes.', 'faq.sub': 'Ta question n’est pas là ? Pose-la sur le Discord.',
    'q1': 'Comment acheter Rovex Hub ?', 'a1': 'Clique sur un bouton « Acheter sur Discord » : tu rejoins notre Discord, tu choisis ton plan avec l’équipe et tu reçois ton ID d’accès personnel. Entre-le dans l’app et c’est parti.',
    'q2': 'Je peux télécharger l’app gratuitement ?', 'a2': 'Oui. Tout le monde peut télécharger et installer Rovex Hub. Mais pour te connecter, il te faut un ID d’accès, que tu reçois après l’achat d’un plan sur le Discord.',
    'q3': 'Quelle différence entre les plans ?', 'a3': 'Aucune dans l’app : chaque plan débloque tout. Seule la durée change — 1 mois (35 €), 1 an (299 €) ou pour toujours avec Immortel (528,99 €, payé une fois).',
    'q4': 'Que se passe-t-il à la fin de mon plan ?', 'a4': 'Ton ID ne marche plus et l’app te demande de te reconnecter. Renouvelle sur le Discord et tu récupères ton accès. Immortel n’expire jamais.',
    'q5': 'Quelle IA me faut-il ?', 'a5': 'Claude, via Claude Desktop ou Claude Code. Rovex Hub s’y connecte automatiquement via MCP. Ton abonnement Claude n’est pas inclus.',
    'q6': 'Quels systèmes sont pris en charge ?', 'a6': 'Windows 10 et 11 (64 bits). Pas encore de version macOS.',
    'q7': 'Mes données sont-elles privées ?', 'a7': 'Ta bibliothèque, tes notes et tes exemples restent sur ton PC. Seul ton ID d’accès est vérifié en ligne à la connexion.',
    'q8': 'Comment marchent les mises à jour ?', 'a8': 'Automatiquement. Rovex Hub cherche les nouvelles versions et les installe pour toi. La bibliothèque, elle, s’enrichit chaque heure.',
    'q9': 'Je peux partager mon ID ?', 'a9': 'Non. Ton ID est personnel. Un ID partagé ou qui fuite peut être bloqué à tout moment.',
    'q10': 'Windows affiche « Windows a protégé votre ordinateur ». C’est sûr ?', 'a10': 'Oui. Windows affiche ce message pour les nouvelles apps qui ne sont pas encore signées avec un certificat payant. Clique sur « Informations complémentaires », puis « Exécuter quand même ».',
    'q11': 'J’ai trouvé un bug. Comment le signaler ?', 'a11': 'Dis-le-nous sur le Discord avec une capture d’écran et ce que tu faisais. On corrige et la mise à jour s’installe toute seule.',
    'final.t': 'Fais de Claude un expert Roblox.', 'final.p': 'Télécharge Rovex Hub gratuitement, puis récupère ton ID d’accès sur Discord.', 'final.dl': 'Télécharger pour Windows', 'final.buy': 'Acheter sur Discord',
    'foot.tag': 'Le cerveau Roblox de ton Claude.', 'foot.rights': 'Rovex Hub n’est affilié ni à Roblox Corporation ni à Anthropic.',
    'dl.t1': 'Installe', 'dl.lead': 'Application de bureau native pour Windows. Légère, rapide, et elle se met à jour toute seule.', 'dl.start': 'Installer et démarrer',
    'dl.win': 'Windows', 'dl.winP': 'Windows 10 ou 11 · 64 bits', 'dl.winBtn': 'Télécharger pour Windows', 'dl.mac': 'macOS', 'dl.macP': 'Pas encore disponible', 'dl.macBtn': 'Plus tard',
    'dl.loading': 'Recherche de la dernière version…', 'dl.ver': 'Version {v} · {size} Mo',
    'dl.noticeT': 'Téléchargement gratuit — la connexion demande un ID d’accès.', 'dl.notice': 'Tu peux installer Rovex Hub gratuitement, mais il te faut un ID d’accès pour l’utiliser. Récupère le tien sur notre <a class="link" href="' + DISCORD + '" target="_blank" rel="noopener">Discord</a> après avoir choisi un plan.',
    'dl.specs': 'Configuration minimale', 'dl.os': 'Système', 'dl.osV': 'Windows 10 ou 11 (64 bits)', 'dl.ram': 'Mémoire (RAM)', 'dl.ramV': '4 Go minimum · 8 Go recommandés',
    'dl.disk': 'Espace disque libre', 'dl.diskV': '500 Mo', 'dl.net': 'Internet', 'dl.netV': 'Nécessaire pour se connecter et recevoir les nouvelles ressources', 'dl.ai': 'IA', 'dl.aiV': 'Claude Desktop ou Claude Code (abonnement Claude non inclus)',
    'dl.steps': 'Installé en 1 minute',
    'dl.s1': '<b>Télécharge</b> Rovex-Hub-Setup.exe et double-clique dessus.', 'dl.s2': 'Si Windows affiche <b>« Windows a protégé votre ordinateur »</b>, clique sur <b>Informations complémentaires</b> → <b>Exécuter quand même</b>.',
    'dl.s3': 'Rovex Hub s’installe tout seul et ajoute une icône sur ton <b>bureau</b> et dans le menu Démarrer.', 'dl.s4': 'Entre ton <b>ID d’accès</b>. Rovex se connecte tout seul à Claude Desktop et Claude Code.',
  },
};

// Script de la démo (ce que « tape » Claude à gauche), par étape.
const DEMO = {
  en: [
    [['you', 'Using Rovex Hub, make me a sword slash VFX, anime style'], ['sub', 'Claude · thinking…']],
    [['tool', 'load_skill(category: "vfx", query: "sword slash")'], ['sub', 'rules · 1 validated example · 742 resources · open source'], ['tool', 'search_resources("slash beam trail")'], ['sub', '12 results · 3 tutorials with your notes']],
    [['tool', 'Writing SlashVFX.client.lua'], ['sub', 'ParticleEmitter + Beam + Trail, from your validated example'], ['ok', '✓ Done — 3 Rovex sources cited']],
  ],
  fr: [
    [['you', 'En utilisant Rovex Hub, fais-moi un VFX de slash d’épée, style anime'], ['sub', 'Claude · réflexion…']],
    [['tool', 'load_skill(category: "vfx", query: "slash épée")'], ['sub', 'règles · 1 exemple validé · 742 ressources · open source'], ['tool', 'search_resources("slash beam trail")'], ['sub', '12 résultats · 3 tutos avec tes notes']],
    [['tool', 'Écriture de SlashVFX.client.lua'], ['sub', 'ParticleEmitter + Beam + Trail, d’après ton exemple validé'], ['ok', '✓ Terminé — 3 sources Rovex citées']],
  ],
};

let LANG = (() => {
  try { const l = localStorage.getItem('rovex-site-lang'); if (I18N[l]) return l; } catch {}
  return /^fr/i.test(navigator.language || '') ? 'fr' : 'en';
})();
const t = (k, vars = {}) => String((I18N[LANG] && I18N[LANG][k]) ?? I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function applyLang() {
  document.documentElement.lang = LANG;
  $$('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
  $$('[data-lang-block]').forEach((el) => el.classList.toggle('on', el.dataset.langBlock === LANG));
  $$('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === LANG));
  $$('[data-discord]').forEach((a) => { a.href = DISCORD; a.target = '_blank'; a.rel = 'noopener'; });
  if (window.__dlInfo) showRelease(window.__dlInfo);
}

function setLang(l) {
  LANG = l;
  try { localStorage.setItem('rovex-site-lang', l); } catch {}
  applyLang();
  if ($('#demo')) startDemo();
}

// ---------- Démo animée ----------
let demoTimers = [];
function startDemo() {
  const box = $('#term');
  if (!box) return;
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
  box.innerHTML = '';
  const shots = $$('#screen img');
  const steps = $$('.step');
  const badge = $('#screen .badge');
  const script = DEMO[LANG] || DEMO.en;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DUR = 5200;
  steps.forEach((s) => { s.classList.remove('on', 'done'); s.style.setProperty('--dur', DUR + 'ms'); });
  const later = (fn, ms) => demoTimers.push(setTimeout(fn, reduced ? 0 : ms));
  script.forEach((lines, i) => {
    later(() => {
      steps.forEach((s, j) => { s.classList.toggle('on', j === i); s.classList.toggle('done', j < i); });
      shots.forEach((img, j) => img.classList.toggle('on', j === i));
      if (badge) badge.textContent = t('demo.b' + (i + 1));
      lines.forEach(([kind, text], k) => later(() => {
        const caret = $('.caret', box);
        if (caret) caret.remove();
        const div = document.createElement('div');
        div.className = 'l ' + kind;
        div.textContent = text;
        box.append(div);
        const c = document.createElement('span');
        c.className = 'caret';
        box.append(c);
        box.scrollTop = box.scrollHeight;
      }, 350 + k * 900));
    }, i * DUR);
  });
  later(() => steps.forEach((s) => { s.classList.remove('on'); s.classList.add('done'); }), script.length * DUR);
  later(startDemo, script.length * DUR + 4000);
}

// ---------- Lien de téléchargement : dernière version publiée sur GitHub ----------
function showRelease(info) {
  $$('[data-download]').forEach((a) => { a.href = info.url; });
  const meta = $('#dl-meta');
  if (meta) meta.textContent = info.version ? t('dl.ver', { v: info.version, size: info.size }) : '';
}
async function loadRelease() {
  window.__dlInfo = { url: RELEASES };
  showRelease(window.__dlInfo);
  const meta = $('#dl-meta');
  if (meta) meta.textContent = t('dl.loading');
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    const rel = await r.json();
    const exe = (rel.assets || []).find((a) => /\.exe$/i.test(a.name) && !/blockmap/i.test(a.name));
    if (!exe) throw new Error('no exe');
    window.__dlInfo = { url: exe.browser_download_url, version: String(rel.tag_name || '').replace(/^v/, ''), size: Math.round(exe.size / 1048576) };
  } catch { /* on garde le lien vers la page des releases */ }
  showRelease(window.__dlInfo);
}

// ---------- Interactions ----------
function init() {
  applyLang();
  $$('.lang button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  const nav = $('.nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', scrollY > 10);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const mb = $('.menu-btn');
  if (mb) mb.addEventListener('click', () => nav.classList.toggle('open'));
  $$('.nav-links a').forEach((a) => a.addEventListener('click', () => nav.classList.remove('open')));
  // Onde au clic sur les boutons.
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const s = Math.max(r.width, r.height);
    const w = document.createElement('span');
    w.className = 'ripple';
    Object.assign(w.style, { width: s + 'px', height: s + 'px', left: e.clientX - r.left - s / 2 + 'px', top: e.clientY - r.top - s / 2 + 'px' });
    b.append(w);
    setTimeout(() => w.remove(), 650);
  });
  // Apparition au défilement.
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));
  // Doc : rubrique active dans le sommaire.
  const links = $$('.docs aside a[href^="#"]');
  if (links.length) {
    const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((a) => a.classList.remove('on'));
      const a = map.get(en.target.id);
      if (a) a.classList.add('on');
    }), { rootMargin: '-20% 0px -70% 0px' });
    $$('.doc [id]').forEach((h) => { if (map.has(h.id)) spy.observe(h); });
  }
  // Doc en français : les liens #install, #signin… pointent vers les titres #fr-install, #fr-signin…
  const h = decodeURIComponent(location.hash.slice(1));
  if (LANG === 'fr' && h && !h.startsWith('fr-') && document.getElementById('fr-' + h)) {
    setTimeout(() => document.getElementById('fr-' + h).scrollIntoView(), 50);
  }
  const replay = $('#replay');
  if (replay) replay.addEventListener('click', startDemo);
  if ($('#demo')) startDemo();
  if ($('[data-download]')) loadRelease();
  const y = $('#year');
  if (y) y.textContent = new Date().getFullYear();
}
document.addEventListener('DOMContentLoaded', init);
