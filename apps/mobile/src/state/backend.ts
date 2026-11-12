import { AppState, Platform } from 'react-native';
import { MockAuth, SupabaseApi, SupabaseAuth, createDiasPayClient } from '@diaspay/api-client';
import type { AuthApi, DiasPayClient, Session } from '@diaspay/api-client';
import { DEMO_REVIEW } from '@/lib/env';
import { contentHasher } from '@/lib/contentHash';
import { nativeUploader } from '@/lib/uploader';
import { sessionStorage } from './sessionStorage';
import { devicePrefs } from './storage';

/**
 * Choix de l’implémentation à la racine de l’application : EXPO_PUBLIC_API = « mock » (défaut, simulateur
 * sur l’appareil) ou « supabase » (projet désigné par EXPO_PUBLIC_SUPABASE_URL et la clé publique).
 * Les écrans ne connaissent que TransactionApi / AuthApi ; ils n’importent jamais supabase-js.
 */
export type ApiMode = 'mock' | 'supabase';
export const API_MODE: ApiMode = process.env.EXPO_PUBLIC_API === 'supabase' ? 'supabase' : 'mock';

let client: DiasPayClient | null = null;
let supabaseApi: SupabaseApi | null = null;

/** Client Supabase (mode supabase uniquement). Le rafraîchissement du jeton est suspendu en arrière-plan. */
export function getClient(): DiasPayClient {
  if (!client) {
    client = createDiasPayClient({
      url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
      anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      storage: sessionStorage,
      detectSessionInUrl: false,
    });
    if (Platform.OS !== 'web') {
      const c = client;
      // Recommandation Supabase (React Native) : enregistré une seule fois.
      AppState.addEventListener('change', (s) => {
        if (s === 'active') void c.auth.startAutoRefresh(); else void c.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}

export function getSupabaseApi(): SupabaseApi {
  supabaseApi ??= new SupabaseApi(getClient(), {
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    uploader: nativeUploader,
    hashFile: contentHasher,
  });
  return supabaseApi;
}

export function createAuthApi(restored: Session | null): AuthApi {
  return API_MODE === 'supabase' ? new SupabaseAuth(getClient(), devicePrefs) : new MockAuth({ session: restored });
}

/**
 * Fonctions de démonstration (« Simuler : valider », litige, réinitialisation) : simulateur toujours ;
 * Supabase seulement si EXPO_PUBLIC_DEMO=1 ET si le serveur est en mock_mode (sinon il les refuse : DEMO_DISABLED).
 */
let serverDemo: Promise<boolean> | null = null;
export function demoAvailable(): Promise<boolean> {
  if (API_MODE === 'mock') return Promise.resolve(DEMO_REVIEW);
  if (!DEMO_REVIEW) return Promise.resolve(false);
  serverDemo ??= getSupabaseApi().serverMockMode().catch(() => { serverDemo = null; return false; });
  return serverDemo;
}
