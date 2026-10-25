// Modèles de prompts prêts à l'emploi pour bien utiliser Rovex Hub avec Claude.
// [[champ]] = trou à remplir ; le libellé de chaque champ est dans PROMPT_SLOTS.
// kind : create (créer), fix (corriger / améliorer), learn (apprendre), find (chercher), library (gérer la base).
const PROMPT_TEMPLATES = [
  {
    id: 'system', kind: 'create', cat: 'scripting', icon: '🧩',
    title: { en: 'Build a full system', fr: 'Créer un système complet', es: 'Crear un sistema completo', pt: 'Criar um sistema completo' },
    text: {
      en: 'Using Rovex Hub, make me a [[system]] system in Luau for Roblox.\nFeatures: [[details]].\nGive me every script (server, client, modules), where to put each one in the Explorer, and how to test it in Studio.',
      fr: 'En utilisant Rovex Hub, fais-moi un système de [[system]] en Luau pour Roblox.\nFonctionnalités : [[details]].\nDonne-moi tous les scripts (serveur, client, modules), où placer chacun dans l’Explorer, et comment le tester dans Studio.',
      es: 'Usando Rovex Hub, hazme un sistema de [[system]] en Luau para Roblox.\nFunciones: [[details]].\nDame todos los scripts (servidor, cliente, módulos), dónde va cada uno en el Explorer y cómo probarlo en Studio.',
      pt: 'Usando o Rovex Hub, faz pra mim um sistema de [[system]] em Luau para Roblox.\nFuncionalidades: [[details]].\nMe dá todos os scripts (servidor, cliente, módulos), onde colocar cada um no Explorer e como testar no Studio.',
    },
  },
  {
    id: 'save', kind: 'create', cat: 'scripting', icon: '💾',
    title: { en: 'Save player data', fr: 'Sauvegarder les données', es: 'Guardar los datos', pt: 'Salvar os dados' },
    text: {
      en: 'Using Rovex Hub, make me a player data save system for: [[data]].\nUse DataStoreService with pcall, retries, session locking and saving on PlayerRemoving and BindToClose. Show me how to read and change the data from other scripts.',
      fr: 'En utilisant Rovex Hub, fais-moi la sauvegarde des données joueur pour : [[data]].\nUtilise DataStoreService avec pcall, des réessais, un verrou de session et une sauvegarde sur PlayerRemoving et BindToClose. Montre-moi comment lire et modifier les données depuis d’autres scripts.',
      es: 'Usando Rovex Hub, hazme el guardado de datos del jugador para: [[data]].\nUsa DataStoreService con pcall, reintentos, bloqueo de sesión y guardado en PlayerRemoving y BindToClose. Enséñame a leer y cambiar los datos desde otros scripts.',
      pt: 'Usando o Rovex Hub, faz pra mim o salvamento de dados do jogador para: [[data]].\nUse DataStoreService com pcall, novas tentativas, trava de sessão e salvamento em PlayerRemoving e BindToClose. Mostra como ler e alterar os dados a partir de outros scripts.',
    },
  },
  {
    id: 'vfx', kind: 'create', cat: 'vfx', icon: '✨',
    title: { en: 'Create a VFX', fr: 'Créer un VFX', es: 'Crear un VFX', pt: 'Criar um VFX' },
    text: {
      en: 'Using Rovex Hub, create a [[effect]] VFX for Roblox, in a [[style]] style.\nGive me the ParticleEmitters, Beams and Trails with their exact properties (colors, size, lifetime, textures), how to build it in Studio, and the script that triggers it.',
      fr: 'En utilisant Rovex Hub, crée-moi un VFX de [[effect]] pour Roblox, dans un style [[style]].\nDonne-moi les ParticleEmitters, Beams et Trails avec leurs propriétés exactes (couleurs, taille, durée de vie, textures), comment le monter dans Studio, et le script qui le déclenche.',
      es: 'Usando Rovex Hub, créame un VFX de [[effect]] para Roblox, con estilo [[style]].\nDame los ParticleEmitters, Beams y Trails con sus propiedades exactas (colores, tamaño, duración, texturas), cómo montarlo en Studio y el script que lo activa.',
      pt: 'Usando o Rovex Hub, cria pra mim um VFX de [[effect]] para Roblox, no estilo [[style]].\nMe dá os ParticleEmitters, Beams e Trails com as propriedades exatas (cores, tamanho, duração, texturas), como montar no Studio e o script que dispara o efeito.',
    },
  },
  {
    id: 'anim', kind: 'create', cat: 'animation', icon: '🏃',
    title: { en: 'Play an animation', fr: 'Jouer une animation', es: 'Reproducir una animación', pt: 'Tocar uma animação' },
    text: {
      en: 'Using Rovex Hub, help me with a [[animation]] animation for [[target]] (R6 or R15).\nExplain how to make it (Animation Editor or Moon Animator), then give me the script that loads and plays it with the right priority, speed and smooth transitions.',
      fr: 'En utilisant Rovex Hub, aide-moi avec une animation de [[animation]] pour [[target]] (R6 ou R15).\nExplique comment la faire (Animation Editor ou Moon Animator), puis donne-moi le script qui la charge et la joue avec la bonne priorité, la bonne vitesse et des transitions fluides.',
      es: 'Usando Rovex Hub, ayúdame con una animación de [[animation]] para [[target]] (R6 o R15).\nExplica cómo hacerla (Animation Editor o Moon Animator) y dame el script que la carga y la reproduce con la prioridad, la velocidad y transiciones suaves.',
      pt: 'Usando o Rovex Hub, me ajuda com uma animação de [[animation]] para [[target]] (R6 ou R15).\nExplica como fazer (Animation Editor ou Moon Animator) e me dá o script que carrega e toca a animação com a prioridade certa, a velocidade e transições suaves.',
    },
  },
  {
    id: 'gui', kind: 'create', cat: 'gui', icon: '🖼️',
    title: { en: 'Design an interface', fr: 'Faire une interface', es: 'Hacer una interfaz', pt: 'Fazer uma interface' },
    text: {
      en: 'Using Rovex Hub, make me a [[ui]] interface in a [[style]] style.\nGive me the ScreenGui hierarchy (sizes in Scale, UIAspectRatioConstraint, UICorner, UIStroke), the Tween animations (open, close, hover, click) and the LocalScript. It must work on PC and mobile.',
      fr: 'En utilisant Rovex Hub, fais-moi une interface de [[ui]] dans un style [[style]].\nDonne-moi la hiérarchie du ScreenGui (tailles en Scale, UIAspectRatioConstraint, UICorner, UIStroke), les animations Tween (ouverture, fermeture, survol, clic) et le LocalScript. Ça doit marcher sur PC et mobile.',
      es: 'Usando Rovex Hub, hazme una interfaz de [[ui]] con estilo [[style]].\nDame la jerarquía del ScreenGui (tamaños en Scale, UIAspectRatioConstraint, UICorner, UIStroke), las animaciones Tween (abrir, cerrar, hover, clic) y el LocalScript. Debe funcionar en PC y móvil.',
      pt: 'Usando o Rovex Hub, faz pra mim uma interface de [[ui]] no estilo [[style]].\nMe dá a hierarquia do ScreenGui (tamanhos em Scale, UIAspectRatioConstraint, UICorner, UIStroke), as animações Tween (abrir, fechar, hover, clique) e o LocalScript. Tem que funcionar no PC e no celular.',
    },
  },
  {
    id: 'gfx', kind: 'create', cat: 'gfx', icon: '🎨',
    title: { en: 'Plan a GFX / thumbnail', fr: 'Préparer une GFX / miniature', es: 'Preparar un GFX / miniatura', pt: 'Preparar uma GFX / thumbnail' },
    text: {
      en: 'Using Rovex Hub, plan a GFX for [[subject]].\nGive me the composition, character poses, camera, lighting and render settings in Blender, then the editing steps (colors, text, effects) to make it stand out on the Roblox front page.',
      fr: 'En utilisant Rovex Hub, prépare-moi une GFX pour [[subject]].\nDonne-moi la composition, les poses des personnages, la caméra, l’éclairage et les réglages de rendu dans Blender, puis les étapes de retouche (couleurs, texte, effets) pour qu’elle ressorte sur la page d’accueil Roblox.',
      es: 'Usando Rovex Hub, prepárame un GFX para [[subject]].\nDame la composición, las poses, la cámara, la iluminación y los ajustes de render en Blender, y luego los pasos de edición (colores, texto, efectos) para que destaque en la portada de Roblox.',
      pt: 'Usando o Rovex Hub, prepara uma GFX para [[subject]].\nMe dá a composição, as poses, a câmera, a iluminação e as configurações de render no Blender, depois os passos de edição (cores, texto, efeitos) para ela chamar atenção na página inicial do Roblox.',
    },
  },
  {
    id: 'model', kind: 'create', cat: 'modeling', icon: '🧊',
    title: { en: 'Model an object', fr: 'Modéliser un objet', es: 'Modelar un objeto', pt: 'Modelar um objeto' },
    text: {
      en: 'Using Rovex Hub, guide me step by step to model [[object]] in low poly in Blender, then texture it and import it into Roblox (mesh size, triangle budget, collisions, PBR textures).',
      fr: 'En utilisant Rovex Hub, guide-moi étape par étape pour modéliser [[object]] en low poly dans Blender, puis le texturer et l’importer dans Roblox (taille du mesh, budget de triangles, collisions, textures PBR).',
      es: 'Usando Rovex Hub, guíame paso a paso para modelar [[object]] en low poly en Blender, texturizarlo e importarlo en Roblox (tamaño del mesh, presupuesto de triángulos, colisiones, texturas PBR).',
      pt: 'Usando o Rovex Hub, me guia passo a passo para modelar [[object]] em low poly no Blender, texturizar e importar no Roblox (tamanho do mesh, limite de triângulos, colisões, texturas PBR).',
    },
  },
  {
    id: 'map', kind: 'create', cat: 'building', icon: '🗺️',
    title: { en: 'Plan a map', fr: 'Concevoir une map', es: 'Diseñar un mapa', pt: 'Planejar um mapa' },
    text: {
      en: 'Using Rovex Hub, plan a [[theme]] map for my game.\nGive me the zones and their layout, the player path, the lighting setup (Lighting, Atmosphere, post effects), the Terrain work and how to keep it fast on mobile (StreamingEnabled, part count).',
      fr: 'En utilisant Rovex Hub, conçois-moi une map [[theme]] pour mon jeu.\nDonne-moi les zones et leur disposition, le chemin du joueur, l’éclairage (Lighting, Atmosphere, post-effets), le travail du Terrain et comment la garder fluide sur mobile (StreamingEnabled, nombre de parts).',
      es: 'Usando Rovex Hub, diséñame un mapa [[theme]] para mi juego.\nDame las zonas y su distribución, el recorrido del jugador, la iluminación (Lighting, Atmosphere, efectos), el Terrain y cómo mantenerlo fluido en móvil (StreamingEnabled, número de partes).',
      pt: 'Usando o Rovex Hub, planeja um mapa [[theme]] para o meu jogo.\nMe dá as zonas e a disposição, o caminho do jogador, a iluminação (Lighting, Atmosphere, efeitos), o Terrain e como deixar leve no celular (StreamingEnabled, número de parts).',
    },
  },
  {
    id: 'sound', kind: 'create', cat: 'audio', icon: '🔊',
    title: { en: 'Add sounds and music', fr: 'Ajouter sons et musique', es: 'Añadir sonidos y música', pt: 'Adicionar sons e música' },
    text: {
      en: 'Using Rovex Hub, set up the audio for [[sound]].\nUse SoundService and SoundGroups (music, effects, UI), 3D sounds where it makes sense, a volume setting for the player, and give me the scripts.',
      fr: 'En utilisant Rovex Hub, mets en place le son pour [[sound]].\nUtilise SoundService et des SoundGroups (musique, effets, interface), des sons 3D quand c’est utile, un réglage du volume pour le joueur, et donne-moi les scripts.',
      es: 'Usando Rovex Hub, configura el audio para [[sound]].\nUsa SoundService y SoundGroups (música, efectos, interfaz), sonidos 3D donde tenga sentido, un ajuste de volumen para el jugador, y dame los scripts.',
      pt: 'Usando o Rovex Hub, configura o áudio para [[sound]].\nUse SoundService e SoundGroups (música, efeitos, interface), sons 3D quando fizer sentido, um ajuste de volume para o jogador, e me dá os scripts.',
    },
  },
  {
    id: 'design', kind: 'create', cat: 'design', icon: '🎮',
    title: { en: 'Design the game loop', fr: 'Concevoir la boucle de jeu', es: 'Diseñar el bucle de juego', pt: 'Planejar o loop do jogo' },
    text: {
      en: 'Using Rovex Hub, design the game loop of a [[genre]] game on Roblox.\nDescribe the core loop, progression, economy (earn and spend), what brings players back each day, fair monetization (game passes, developer products), and the order to build it in.',
      fr: 'En utilisant Rovex Hub, conçois la boucle de jeu d’un jeu [[genre]] sur Roblox.\nDécris la boucle principale, la progression, l’économie (gagner et dépenser), ce qui fait revenir les joueurs chaque jour, une monétisation honnête (game passes, developer products), et dans quel ordre le développer.',
      es: 'Usando Rovex Hub, diseña el bucle de juego de un juego [[genre]] en Roblox.\nDescribe el bucle principal, la progresión, la economía (ganar y gastar), qué hace volver a los jugadores cada día, una monetización justa (game passes, developer products) y en qué orden desarrollarlo.',
      pt: 'Usando o Rovex Hub, planeja o loop de um jogo [[genre]] no Roblox.\nDescreve o loop principal, a progressão, a economia (ganhar e gastar), o que faz os jogadores voltarem todo dia, uma monetização justa (game passes, developer products) e em que ordem desenvolver.',
    },
  },
  {
    id: 'plugin', kind: 'create', cat: 'tools', icon: '🔧',
    title: { en: 'Write a Studio plugin', fr: 'Coder un plugin Studio', es: 'Programar un plugin de Studio', pt: 'Programar um plugin do Studio' },
    text: {
      en: 'Using Rovex Hub, write me a Roblox Studio plugin that [[feature]].\nInclude the toolbar button, the DockWidget interface, undo support with ChangeHistoryService, and how to install it as a local plugin.',
      fr: 'En utilisant Rovex Hub, code-moi un plugin Roblox Studio qui [[feature]].\nAvec le bouton dans la barre d’outils, l’interface en DockWidget, l’annulation avec ChangeHistoryService, et comment l’installer en plugin local.',
      es: 'Usando Rovex Hub, prográmame un plugin de Roblox Studio que [[feature]].\nCon el botón en la barra, la interfaz en DockWidget, deshacer con ChangeHistoryService y cómo instalarlo como plugin local.',
      pt: 'Usando o Rovex Hub, programa um plugin do Roblox Studio que [[feature]].\nCom o botão na barra de ferramentas, a interface em DockWidget, desfazer com ChangeHistoryService e como instalar como plugin local.',
    },
  },
  {
    id: 'fix', kind: 'fix', cat: 'scripting', icon: '🐛',
    title: { en: 'Fix a bug', fr: 'Corriger un bug', es: 'Corregir un bug', pt: 'Corrigir um bug' },
    text: {
      en: 'Using Rovex Hub, fix this Roblox script.\nProblem: [[problem]].\nExplain what was wrong, then give me the full corrected script.\n\n```lua\n[[code]]\n```',
      fr: 'En utilisant Rovex Hub, corrige ce script Roblox.\nProblème : [[problem]].\nExplique ce qui n’allait pas, puis donne-moi le script corrigé en entier.\n\n```lua\n[[code]]\n```',
      es: 'Usando Rovex Hub, corrige este script de Roblox.\nProblema: [[problem]].\nExplica qué fallaba y dame el script corregido completo.\n\n```lua\n[[code]]\n```',
      pt: 'Usando o Rovex Hub, corrige este script do Roblox.\nProblema: [[problem]].\nExplica o que estava errado e me dá o script corrigido inteiro.\n\n```lua\n[[code]]\n```',
    },
  },
  {
    id: 'review', kind: 'fix', cat: 'scripting', icon: '🛡️',
    title: { en: 'Review and optimize', fr: 'Relire et optimiser', es: 'Revisar y optimizar', pt: 'Revisar e otimizar' },
    text: {
      en: 'Using Rovex Hub, review this script like a senior Roblox developer: performance, server security (exploits, RemoteEvent checks), memory leaks and readability. List the problems by importance, then give me the improved version.\n\n```lua\n[[code]]\n```',
      fr: 'En utilisant Rovex Hub, relis ce script comme un dev Roblox expérimenté : performances, sécurité côté serveur (exploits, vérification des RemoteEvents), fuites de mémoire et lisibilité. Liste les problèmes par importance, puis donne-moi la version améliorée.\n\n```lua\n[[code]]\n```',
      es: 'Usando Rovex Hub, revisa este script como un dev senior de Roblox: rendimiento, seguridad en el servidor (exploits, validación de RemoteEvents), fugas de memoria y legibilidad. Enumera los problemas por importancia y dame la versión mejorada.\n\n```lua\n[[code]]\n```',
      pt: 'Usando o Rovex Hub, revisa este script como um dev sênior de Roblox: desempenho, segurança no servidor (exploits, validação de RemoteEvents), vazamentos de memória e legibilidade. Lista os problemas por importância e me dá a versão melhorada.\n\n```lua\n[[code]]\n```',
    },
  },
  {
    id: 'upgrade', kind: 'fix', cat: 'scripting', icon: '⬆️',
    title: { en: 'Add a feature to my code', fr: 'Ajouter une fonction à mon code', es: 'Añadir una función a mi código', pt: 'Adicionar uma função ao meu código' },
    text: {
      en: 'Using Rovex Hub, add this to my script: [[feature]].\nKeep my structure and naming, change only what is needed, and tell me exactly what you changed.\n\n```lua\n[[code]]\n```',
      fr: 'En utilisant Rovex Hub, ajoute ceci à mon script : [[feature]].\nGarde ma structure et mes noms, ne change que le nécessaire, et dis-moi exactement ce que tu as modifié.\n\n```lua\n[[code]]\n```',
      es: 'Usando Rovex Hub, añade esto a mi script: [[feature]].\nMantén mi estructura y mis nombres, cambia solo lo necesario y dime exactamente qué cambiaste.\n\n```lua\n[[code]]\n```',
      pt: 'Usando o Rovex Hub, adiciona isto ao meu script: [[feature]].\nMantém a minha estrutura e os nomes, muda só o necessário e me diz exatamente o que você alterou.\n\n```lua\n[[code]]\n```',
    },
  },
  {
    id: 'explain', kind: 'learn', cat: 'scripting', icon: '🎓',
    title: { en: 'Explain a concept', fr: 'M’expliquer une notion', es: 'Explicarme un concepto', pt: 'Me explicar um conceito' },
    text: {
      en: 'Using Rovex Hub, explain [[notion]] to me as if I were a beginner, with a short commented code example, common mistakes to avoid, and the best videos and docs from the library to go further.',
      fr: 'En utilisant Rovex Hub, explique-moi [[notion]] comme si j’étais débutant, avec un petit exemple de code commenté, les erreurs courantes à éviter, et les meilleures vidéos et docs de la base pour aller plus loin.',
      es: 'Usando Rovex Hub, explícame [[notion]] como si fuera principiante, con un ejemplo corto de código comentado, los errores típicos y los mejores vídeos y docs de la biblioteca para seguir aprendiendo.',
      pt: 'Usando o Rovex Hub, me explica [[notion]] como se eu fosse iniciante, com um exemplo curto de código comentado, os erros comuns e os melhores vídeos e docs da biblioteca para ir mais longe.',
    },
  },
  {
    id: 'path', kind: 'learn', cat: '', icon: '🧭',
    title: { en: 'Learning path', fr: 'Parcours d’apprentissage', es: 'Ruta de aprendizaje', pt: 'Trilha de aprendizado' },
    text: {
      en: 'Using Rovex Hub, build me a learning path in [[topic]], starting from [[level]] level, over [[duration]].\nSplit it into steps, give each step its videos and docs from the library, and a small project to practice.',
      fr: 'En utilisant Rovex Hub, fais-moi un parcours d’apprentissage en [[topic]], à partir du niveau [[level]], sur [[duration]].\nDécoupe-le en étapes, donne pour chaque étape les vidéos et docs de la base, et un petit projet pour pratiquer.',
      es: 'Usando Rovex Hub, hazme una ruta de aprendizaje de [[topic]], desde nivel [[level]], en [[duration]].\nDivídela en etapas, dame para cada una los vídeos y docs de la biblioteca y un pequeño proyecto para practicar.',
      pt: 'Usando o Rovex Hub, monta uma trilha de aprendizado em [[topic]], a partir do nível [[level]], em [[duration]].\nDivide em etapas, com os vídeos e docs da biblioteca para cada etapa e um pequeno projeto para praticar.',
    },
  },
  {
    id: 'example', kind: 'learn', cat: 'scripting', icon: '📘',
    title: { en: 'Learn from my examples', fr: 'Apprendre de mes exemples', es: 'Aprender de mis ejemplos', pt: 'Aprender com meus exemplos' },
    text: {
      en: 'Using Rovex Hub, go through my validated learning examples in [[topic]] and explain how each one works, which patterns they share, and how I can reuse them for [[goal]].',
      fr: 'En utilisant Rovex Hub, parcours mes exemples d’apprentissage validés en [[topic]] et explique comment chacun fonctionne, quels schémas ils ont en commun, et comment je peux les réutiliser pour [[goal]].',
      es: 'Usando Rovex Hub, repasa mis ejemplos validados de [[topic]] y explica cómo funciona cada uno, qué patrones comparten y cómo puedo reutilizarlos para [[goal]].',
      pt: 'Usando o Rovex Hub, passa pelos meus exemplos validados de [[topic]] e explica como cada um funciona, quais padrões eles têm em comum e como posso reutilizá-los para [[goal]].',
    },
  },
  {
    id: 'best', kind: 'find', cat: '', icon: '🔎',
    title: { en: 'Find the best tutorials', fr: 'Trouver les meilleurs tutos', es: 'Encontrar los mejores tutoriales', pt: 'Achar os melhores tutoriais' },
    text: {
      en: 'Using Rovex Hub, find the best resources (videos, docs, tutorials) about [[topic]], sort them by level from beginner to advanced, and tell me in one line what each one teaches.',
      fr: 'En utilisant Rovex Hub, trouve les meilleures ressources (vidéos, docs, tutos) sur [[topic]], classe-les par niveau du débutant à l’avancé, et dis-moi en une ligne ce que chacune apprend.',
      es: 'Usando Rovex Hub, encuentra los mejores recursos (vídeos, docs, tutoriales) sobre [[topic]], ordénalos por nivel de principiante a avanzado y dime en una línea qué enseña cada uno.',
      pt: 'Usando o Rovex Hub, acha os melhores recursos (vídeos, docs, tutoriais) sobre [[topic]], organiza por nível do iniciante ao avançado e me diz em uma linha o que cada um ensina.',
    },
  },
  {
    id: 'opensource', kind: 'find', cat: 'scripting', icon: '📦',
    title: { en: 'Find an open source module', fr: 'Trouver un module open source', es: 'Encontrar un módulo open source', pt: 'Achar um módulo open source' },
    text: {
      en: 'Using Rovex Hub, find open source modules or free systems for [[need]]. Compare the best ones (stars, maintenance, ease of use) and explain how to add the one you recommend to my game.',
      fr: 'En utilisant Rovex Hub, trouve des modules open source ou des systèmes gratuits pour [[need]]. Compare les meilleurs (étoiles, maintenance, facilité) et explique comment intégrer celui que tu recommandes dans mon jeu.',
      es: 'Usando Rovex Hub, encuentra módulos open source o sistemas gratis para [[need]]. Compara los mejores (estrellas, mantenimiento, facilidad) y explica cómo añadir a mi juego el que recomiendes.',
      pt: 'Usando o Rovex Hub, acha módulos open source ou sistemas gratuitos para [[need]]. Compara os melhores (estrelas, manutenção, facilidade) e explica como colocar no meu jogo o que você recomendar.',
    },
  },
  {
    id: 'explore', kind: 'library', cat: '', icon: '🌐', admin: true,
    title: { en: 'Fill the library on a topic', fr: 'Remplir la base sur un sujet', es: 'Llenar la biblioteca sobre un tema', pt: 'Encher a biblioteca sobre um tema' },
    text: {
      en: 'Using Rovex Hub, launch an exploration to add tutorials about [[topic]] to my library, then tell me what was added once it is done.',
      fr: 'En utilisant Rovex Hub, lance une exploration pour ajouter à ma base des tutos sur [[topic]], puis dis-moi ce qui a été ajouté quand c’est fini.',
      es: 'Usando Rovex Hub, lanza una exploración para añadir tutoriales sobre [[topic]] a mi biblioteca y dime qué se añadió cuando termine.',
      pt: 'Usando o Rovex Hub, inicia uma exploração para adicionar tutoriais sobre [[topic]] à minha biblioteca e me diz o que foi adicionado quando terminar.',
    },
  },
  {
    id: 'import', kind: 'library', cat: '', icon: '🔗', admin: true,
    title: { en: 'Add a link with a note', fr: 'Ajouter un lien avec une note', es: 'Añadir un enlace con una nota', pt: 'Adicionar um link com nota' },
    text: {
      en: 'Using Rovex Hub, add this link to my library in the right category: [[link]]\nThen write a short note on it summarizing what it teaches and when to use it.',
      fr: 'En utilisant Rovex Hub, ajoute ce lien à ma base dans la bonne catégorie : [[link]]\nPuis écris dessus une petite note qui résume ce qu’il apprend et quand s’en servir.',
      es: 'Usando Rovex Hub, añade este enlace a mi biblioteca en la categoría correcta: [[link]]\nLuego escribe una nota corta que resuma qué enseña y cuándo usarlo.',
      pt: 'Usando o Rovex Hub, adiciona este link à minha biblioteca na categoria certa: [[link]]\nDepois escreve uma nota curta resumindo o que ele ensina e quando usar.',
    },
  },
];

// Libellé (et exemple) de chaque champ, par langue.
const PROMPT_SLOTS = {
  system: { en: 'which system? e.g. pets, inventory, combat', fr: 'quel système ? ex. pets, inventaire, combat', es: '¿qué sistema? ej. mascotas, inventario, combate', pt: 'qual sistema? ex. pets, inventário, combate' },
  details: { en: 'what it must do', fr: 'ce qu’il doit faire', es: 'lo que debe hacer', pt: 'o que ele deve fazer' },
  data: { en: 'which data? e.g. coins, level, inventory', fr: 'quelles données ? ex. pièces, niveau, inventaire', es: '¿qué datos? ej. monedas, nivel, inventario', pt: 'quais dados? ex. moedas, nível, inventário' },
  effect: { en: 'which effect? e.g. sword slash, fireball', fr: 'quel effet ? ex. slash d’épée, boule de feu', es: '¿qué efecto? ej. corte de espada, bola de fuego', pt: 'qual efeito? ex. corte de espada, bola de fogo' },
  style: { en: 'style, e.g. anime, cartoon, realistic', fr: 'style, ex. anime, cartoon, réaliste', es: 'estilo, ej. anime, cartoon, realista', pt: 'estilo, ex. anime, cartoon, realista' },
  animation: { en: 'which animation? e.g. idle, sprint, attack', fr: 'quelle animation ? ex. idle, sprint, attaque', es: '¿qué animación? ej. idle, sprint, ataque', pt: 'qual animação? ex. idle, sprint, ataque' },
  target: { en: 'for who? e.g. the player, an NPC', fr: 'pour qui ? ex. le joueur, un PNJ', es: '¿para quién? ej. el jugador, un NPC', pt: 'para quem? ex. o jogador, um NPC' },
  ui: { en: 'which UI? e.g. shop, inventory, main menu', fr: 'quelle interface ? ex. boutique, inventaire, menu', es: '¿qué interfaz? ej. tienda, inventario, menú', pt: 'qual interface? ex. loja, inventário, menu' },
  subject: { en: 'which game or scene?', fr: 'quel jeu ou quelle scène ?', es: '¿qué juego o escena?', pt: 'qual jogo ou cena?' },
  object: { en: 'which object? e.g. a sword, a house', fr: 'quel objet ? ex. une épée, une maison', es: '¿qué objeto? ej. una espada, una casa', pt: 'qual objeto? ex. uma espada, uma casa' },
  theme: { en: 'theme, e.g. medieval, sci-fi, lobby', fr: 'thème, ex. médiéval, sci-fi, lobby', es: 'tema, ej. medieval, sci-fi, lobby', pt: 'tema, ex. medieval, sci-fi, lobby' },
  sound: { en: 'what? e.g. my lobby, the combat, the UI', fr: 'quoi ? ex. mon lobby, le combat, l’interface', es: '¿qué? ej. mi lobby, el combate, la interfaz', pt: 'o quê? ex. meu lobby, o combate, a interface' },
  genre: { en: 'genre, e.g. simulator, tycoon, obby', fr: 'genre, ex. simulator, tycoon, obby', es: 'género, ej. simulator, tycoon, obby', pt: 'gênero, ex. simulator, tycoon, obby' },
  feature: { en: 'what should it do?', fr: 'qu’est-ce qu’il doit faire ?', es: '¿qué debe hacer?', pt: 'o que deve fazer?' },
  problem: { en: 'what goes wrong? paste the error', fr: 'qu’est-ce qui bug ? colle l’erreur', es: '¿qué falla? pega el error', pt: 'o que dá errado? cola o erro' },
  code: { en: 'paste your code here', fr: 'colle ton code ici', es: 'pega tu código aquí', pt: 'cola o seu código aqui' },
  notion: { en: 'which concept? e.g. RemoteEvents, CFrame', fr: 'quelle notion ? ex. RemoteEvents, CFrame', es: '¿qué concepto? ej. RemoteEvents, CFrame', pt: 'qual conceito? ex. RemoteEvents, CFrame' },
  topic: { en: 'topic, e.g. scripting, VFX, UI', fr: 'sujet, ex. scripting, VFX, UI', es: 'tema, ej. scripting, VFX, UI', pt: 'tema, ex. scripting, VFX, UI' },
  level: { en: 'beginner / intermediate / advanced', fr: 'débutant / intermédiaire / avancé', es: 'principiante / intermedio / avanzado', pt: 'iniciante / intermediário / avançado' },
  duration: { en: 'how long? e.g. 4 weeks', fr: 'combien de temps ? ex. 4 semaines', es: '¿cuánto tiempo? ej. 4 semanas', pt: 'quanto tempo? ex. 4 semanas' },
  goal: { en: 'my project', fr: 'mon projet', es: 'mi proyecto', pt: 'meu projeto' },
  need: { en: 'what for? e.g. saving, UI, combat', fr: 'pour quoi ? ex. sauvegarde, UI, combat', es: '¿para qué? ej. guardado, UI, combate', pt: 'para quê? ex. salvamento, UI, combate' },
  link: { en: 'paste the link', fr: 'colle le lien', es: 'pega el enlace', pt: 'cola o link' },
};

// Ligne ajoutée à la fin du prompt pour que Claude charge le bon skill avant de commencer.
const PROMPT_REMIND = {
  en: { cat: 'First load the {skill} skill with load_skill, rely on my validated examples and the open source of that category, and cite the Rovex resources you use.', any: 'First load the matching Rovex skill with load_skill, rely on my validated examples, and cite the Rovex resources you use.' },
  fr: { cat: 'Charge d’abord le skill {skill} avec load_skill, appuie-toi sur mes exemples validés et l’open source de cette catégorie, et cite les ressources Rovex que tu utilises.', any: 'Charge d’abord le skill Rovex qui correspond avec load_skill, appuie-toi sur mes exemples validés, et cite les ressources Rovex que tu utilises.' },
  es: { cat: 'Primero carga el skill {skill} con load_skill, apóyate en mis ejemplos validados y el open source de esa categoría, y cita los recursos de Rovex que uses.', any: 'Primero carga el skill de Rovex que corresponda con load_skill, apóyate en mis ejemplos validados y cita los recursos de Rovex que uses.' },
  pt: { cat: 'Primeiro carrega o skill {skill} com load_skill, usa os meus exemplos validados e o open source dessa categoria, e cita os recursos do Rovex que você usar.', any: 'Primeiro carrega o skill do Rovex certo com load_skill, usa os meus exemplos validados e cita os recursos do Rovex que você usar.' },
};

// Remplit un modèle : les champs vides restent visibles entre crochets.
function fillPrompt(text, vals, { lang = 'en', cat = '', remind = true } = {}) {
  const label = (s) => (PROMPT_SLOTS[s] && (PROMPT_SLOTS[s][lang] || PROMPT_SLOTS[s].en)) || s;
  let out = text.replace(/\[\[([^\]\n]{1,40})\]\]/g, (_, s) => String(vals[s] || '').trim() || `[${label(s)}]`);
  if (remind) {
    const r = PROMPT_REMIND[lang] || PROMPT_REMIND.en;
    out += '\n\n' + (cat && cat !== 'gameplay' ? r.cat.replace('{skill}', 'rovex-' + cat) : r.any);
  }
  return out;
}
