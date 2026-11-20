import { useSyncExternalStore } from 'react';
import { DomainError } from '@diaspay/domain';
import { API_MODE, CONFIGURED, createAuthApi } from './backend';
import type { AuthApi, Persona, PrimaryRole, Profile, Session } from '@diaspay/api-client';
import { applyLocale } from '../i18n';
import { getCurrentUser, mockApi, setCurrentUser, setPersona } from './api';
import { loadLocale, loadOnboardingSeen, loadSession, saveOnboardingSeen, saveSession } from './storage';

export interface AuthState {
  /** État chargé depuis l’appareil. */
  ready: boolean;
  session: Session | null;
  onboardingSeen: boolean;
}

// Implémentation choisie à la racine (EXPO_PUBLIC_API) : MockAuth ou SupabaseAuth, derrière AuthApi (bootstrap).
// Avant, ou sans configuration complète : toute opération échoue (CONFIG_MISSING), jamais de repli sur le simulateur.
let authApi: AuthApi = new Proxy({} as AuthApi, {
  get: () => () => Promise.reject(new DomainError('CONFIG_MISSING', 'Configuration du serveur manquante')),
});

let state: AuthState = { ready: false, session: null, onboardingSeen: false };
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
const getState = () => state;

/**
 * Simulateur seulement (démonstration) : profil de démonstration initial d’après le rôle principal. Lot A (T5) : les
 * écrans décident d’après la place de l’utilisateur dans chaque opération (placeIn), jamais d’après ce rôle.
 */
export const personaForRole = (role: PrimaryRole): Persona => (role === 'PROVIDER' ? 'PROVIDER' : 'PAYER');

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  const role = state.session?.profile?.primaryRole;
  if (role && mockApi) setPersona(personaForRole(role));
  // La simulation filtre les brouillons par utilisateur : à la déconnexion, plus aucun brouillon n’est visible.
  const s = state.session;
  const u = getCurrentUser();
  if (s?.userId !== u?.id || (role && role !== u?.role) || s?.profile?.fullName !== u?.name) {
    setCurrentUser(s ? { id: s.userId, role: role ?? 'PAYER', name: s.profile?.fullName } : null);
  }
  listeners.forEach((f) => f());
}

async function commit(session: Session | null): Promise<Session | null> {
  await saveSession(session);
  set({ session });
  return session;
}

let booting: Promise<void> | null = null;
/** Charge la session, la langue et le drapeau de présentation. Idempotent. */
export function bootstrap(): Promise<void> {
  booting ??= (async () => {
    // Simulateur seulement (EXPO_PUBLIC_API=mock) : son état (dossiers soumis, alertes, journal) est rechargé avant le
    // premier écran. En mode Supabase, rien du simulateur n’est chargé (lot A, T4).
    const [cached, onboardingSeen, locale] = await Promise.all([loadSession(), loadOnboardingSeen(), loadLocale(), mockApi?.hydrate().catch(() => false)]);
    if (locale) applyLocale(locale);
    if (!CONFIGURED) { set({ ready: true, session: null, onboardingSeen }); return; }
    authApi = createAuthApi(cached);
    let session = cached;
    if (API_MODE === 'supabase') {
      // Session Supabase (stockage chiffré) ; hors connexion, le dernier profil connu reste affiché.
      try { session = await authApi.getSession(); await saveSession(session); } catch { session = cached; }
    }
    set({ ready: true, session, onboardingSeen });
  })();
  return booting;
}

export function useSession(): AuthState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const requestOtp = (phone: string) => authApi.requestOtp(phone);
export const verifyOtp = async (phone: string, code: string) => commit(await authApi.verifyOtp(phone, code));
export const saveProfile = async (p: Profile) => commit(await authApi.saveProfile(p));
export const setBiometric = async (enabled: boolean) => commit(await authApi.setBiometric(enabled));
export const setPreferences = async (p: { biometricEnabled?: boolean; pushEnabled?: boolean }) => commit(await authApi.setPreferences(p));
export async function signOut() {
  await authApi.signOut();
  await commit(null);
}
export async function markOnboardingSeen() {
  await saveOnboardingSeen();
  set({ onboardingSeen: true });
}
