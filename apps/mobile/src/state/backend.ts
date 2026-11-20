import { AppState, Platform } from 'react-native';
import { MockAuth, SupabaseApi, SupabaseAuth, createDiasPayClient } from '@diaspay/api-client';
import type { AuthApi, DiasPayClient, Session } from '@diaspay/api-client';
import { DEMO_REVIEW } from '@/lib/env';
import { missingConfig } from '@/lib/config';
import { contentHasher } from '@/lib/contentHash';
import { nativeUploader } from '@/lib/uploader';
import { sessionStorage } from './sessionStorage';
import { devicePrefs } from './storage';

/**
 * Choix de l’implémentation à la racine de l’application. Lot A (T4) : Supabase est le fonctionnement normal ;
 * le simulateur sur l’appareil (MockApi) n’est utilisé que si EXPO_PUBLIC_API=mock est écrit explicitement (tests,
 * démonstration). Sans configuration complète, l’application l’affiche (CONFIG_MISSING) au lieu de basculer en silence
 * sur le simulateur. Les écrans ne connaissent que TransactionApi / AuthApi ; ils n’importent jamais supabase-js.
 */
export type ApiMode = 'mock' | 'supabase';
export const API_MODE: ApiMode = process.env.EXPO_PUBLIC_API === 'mock' ? 'mock' : 'supabase';

export const MISSING_CONFIG: readonly string[] = missingConfig({
  api: process.env.EXPO_PUBLIC_API, url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

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
    // Hors démonstration (EXPO_PUBLIC_DEMO absent), un paiement reste « en cours » jusqu’à l’événement du partenaire,
    // reçu par le temps réel (tranches) ; sur le projet de développement, le simulateur du serveur l’envoie (lot A, T3).
    demoSettle: DEMO_REVIEW,
  });
  return supabaseApi;
}

export function createAuthApi(restored: Session | null): AuthApi {
  return API_MODE === 'supabase' ? new SupabaseAuth(getClient(), devicePrefs) : new MockAuth({ session: restored });
}
/** Configuration complète : sinon l’application n’ouvre ni le client Supabase ni le simulateur. */
export const CONFIGURED = MISSING_CONFIG.length === 0;

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
