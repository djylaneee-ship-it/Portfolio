// Connexion à la base en ligne (Supabase). Une fois le projet Supabase créé et `supabase/schema.sql` lancé,
// colle ici l'URL du projet et sa clé publique (« publishable » / anon). Ces deux valeurs sont publiques :
// la sécurité vient des règles RLS du fichier SQL, pas du secret de la clé.
// Sans ces valeurs, l'app tourne en MODE DÉMO : tout est gardé dans ce navigateur seulement.
export const SUPABASE_URL = 'https://lkthgkrajobugnzrfnls.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_h339xj-ATROXi5j6a2fxJA_Usn9vymh';

export const STUDIO = {
  name: 'Popverse Studio',
  app: 'Popverse Team',
  site: 'https://popversestudio.com',
};

// Lien de téléchargement des installateurs (release GitHub mise à jour à chaque version).
export const DOWNLOADS = 'https://github.com/djylaneee-ship-it/Portfolio/releases/tag/popverse-team-latest';
// Version web (GitHub Pages) : à ouvrir dans Safari sur iPhone puis « Sur l'écran d'accueil ».
export const WEB_URL = 'https://djylaneee-ship-it.github.io/Portfolio/team/';
