/**
 * Garde de production du mode démonstration (logique pure, testée).
 * Un build de production (`!__DEV__`) avec EXPO_PUBLIC_DEMO=1 est une anomalie : l’application se bloque.
 * Seule exception : un build interne de démonstration ou de captures, qui doit le déclarer explicitement
 * avec EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1 (jamais pour un build destiné aux stores : voir docs/release-checklist.md).
 */
export function demoReleaseViolation(env: { dev: boolean; demo?: string; allow?: string }): boolean {
  return !env.dev && env.demo === '1' && env.allow !== '1';
}

/**
 * Lot X-C (T9) : un build de production sans EXPO_PUBLIC_API=supabase tourne sur le simulateur de l’appareil (défaut
 * « mock ») : même anomalie, même blocage. Valeur absente ou autre que « supabase » : bloqué, sauf build interne déclaré
 * (EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1, jamais pour un build destiné aux stores).
 */
export function apiReleaseViolation(env: { dev: boolean; api?: string; allow?: string }): boolean {
  return !env.dev && env.api !== 'supabase' && env.allow !== '1';
}

/**
 * Lot A (T8b) : ce qui bloque exactement, pour le texte de l’écran (jamais « simulateur » si ce n’est pas le cas).
 * mock : le simulateur de l’appareil est demandé ; missing : EXPO_PUBLIC_API absente ou vide ; other : valeur inattendue.
 */
export type ApiReleaseReason = 'mock' | 'missing' | 'other';
export function apiReleaseReason(api: string | undefined): ApiReleaseReason {
  const v = (api ?? '').trim();
  return v === '' ? 'missing' : v === 'mock' ? 'mock' : 'other';
}

/**
 * Lot A (T10) : EXPO_PUBLIC_WEB_SKIP_DEVICE_AUTH=1 (paiement sans vérification de l’appareil dans un navigateur) ne doit
 * jamais figurer dans un build ou un export déployé : même blocage, sauf build interne déclaré (l’export web des tests de
 * bout en bout, scripts/e2e-supabase.mjs, qui pose aussi EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1).
 */
export function deviceAuthReleaseViolation(env: { dev: boolean; skip?: string; allow?: string }): boolean {
  return !env.dev && env.skip === '1' && env.allow !== '1';
}
