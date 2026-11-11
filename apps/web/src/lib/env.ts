import { assertPublicKey } from '@diaspay/api-client';

/**
 * Configuration publique du bureau de contrôle. Seules l’URL du projet et la clé publique sont lues :
 * la clé service_role n’a pas sa place ici (refusée par assertPublicKey).
 */
export function publicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis (voir apps/web/.env.example).');
  assertPublicKey(anonKey);
  return { url, anonKey };
}
