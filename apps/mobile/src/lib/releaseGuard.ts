/**
 * Garde de production du mode démonstration (logique pure, testée).
 * Un build de production (`!__DEV__`) avec EXPO_PUBLIC_DEMO=1 est une anomalie : l’application se bloque.
 * Seule exception : un build interne de démonstration ou de captures, qui doit le déclarer explicitement
 * avec EXPO_PUBLIC_ALLOW_DEMO_IN_RELEASE=1 (jamais pour un build destiné aux stores : voir docs/release-checklist.md).
 */
export function demoReleaseViolation(env: { dev: boolean; demo?: string; allow?: string }): boolean {
  return !env.dev && env.demo === '1' && env.allow !== '1';
}
