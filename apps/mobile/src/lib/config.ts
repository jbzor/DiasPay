/**
 * Lot A (T4) : variables de configuration manquantes, par leur nom (jamais leur valeur). Vide = configuration complète.
 * EXPO_PUBLIC_API=mock (tests, démonstration) n’exige rien d’autre ; sinon EXPO_PUBLIC_API=supabase, l’URL du projet et
 * sa clé publique sont requises. Logique pure, testée (apps/mobile/test/lota.test.ts).
 */
export function missingConfig(env: { api?: string; url?: string; key?: string }): string[] {
  if (env.api === 'mock') return [];
  const missing: string[] = [];
  if (env.api !== 'supabase') missing.push('EXPO_PUBLIC_API');
  if (!env.url?.trim()) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!env.key?.trim()) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}
