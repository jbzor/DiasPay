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
