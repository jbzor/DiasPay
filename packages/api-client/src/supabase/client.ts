import { createClient } from '@supabase/supabase-js';
import type { DiasPayClient } from './api';
import type { Database } from './database.types';

/** Stockage de la session (interface de supabase-js). L’application fournit un stockage chiffré (SecureStore + AES). */
export interface SessionStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface ClientConfig {
  url: string;
  /** Clé publique (« publishable » / anon). Jamais la clé service_role. */
  anonKey: string;
  storage?: SessionStorage;
  /** Navigateur : la session est lue dans l’URL après une redirection ; jamais en natif. */
  detectSessionInUrl?: boolean;
}

/** Refus explicite d’une clé de service : elle ne doit jamais atteindre l’application. */
export function assertPublicKey(key: string): void {
  if (/^sb_secret_/.test(key)) throw new Error('Clé secrète Supabase refusée : seule la clé publique est permise côté client.');
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
      const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
      if ((JSON.parse(json) as { role?: string }).role === 'service_role') {
        throw new Error('Clé service_role refusée : seule la clé publique est permise côté client.');
      }
    } catch (e) {
      if (e instanceof Error && /refusée/.test(e.message)) throw e;
    }
  }
}

/**
 * Client Supabase de DiasPay (recommandations Supabase pour Expo : stockage persistant, rafraîchissement
 * automatique, pas de lecture de session dans l’URL en natif ; le rafraîchissement est suspendu en arrière-plan
 * par l’application via startAutoRefresh / stopAutoRefresh).
 */
export function createDiasPayClient(cfg: ClientConfig): DiasPayClient {
  if (!cfg.url || !cfg.anonKey) throw new Error('EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY sont requis en mode supabase.');
  assertPublicKey(cfg.anonKey);
  return createClient<Database>(cfg.url, cfg.anonKey, {
    auth: {
      ...(cfg.storage ? { storage: cfg.storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: cfg.detectSessionInUrl ?? false,
    },
  });
}
