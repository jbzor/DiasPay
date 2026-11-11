import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@diaspay/api-client';
import { publicEnv } from '../env';

/** Client Supabase côté serveur (composants serveur, gestionnaires de route), avec le jeton de l’utilisateur. */
export async function serverClient() {
  const { url, anonKey } = publicEnv();
  const store = await cookies();
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Un composant serveur ne peut pas écrire de cookie : le proxy rafraîchit déjà la session.
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* lecture seule */ }
      },
    },
  });
}
