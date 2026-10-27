// ============================================================================
//  CONFIGURATION — le seul fichier à modifier pour brancher votre Supabase
// ============================================================================
//  Supabase > Project Settings > API :
//    - SUPABASE_URL      : « Project URL »
//    - SUPABASE_ANON_KEY : clé « anon / publishable » (publique, protégée par les règles RLS)
//  ⚠ Ne JAMAIS mettre ici la clé « service_role ».
//
//  Laissez les deux champs vides pour lancer le MODE DÉMO (données fictives,
//  stockées uniquement dans le navigateur, mot de passe : demo).
// ============================================================================
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  DOMAINE_EMAIL: 'big-france.com',
  NOM_APPLI: 'BIG Prospection',
  VERSION: '1.0.0',
};

export const MODE_DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;
