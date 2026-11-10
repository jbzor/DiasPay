import { useSyncExternalStore } from 'react';
import { MockAuth } from '@diaspay/api-client';
import type { AuthApi, Persona, PrimaryRole, Profile, Session } from '@diaspay/api-client';
import { applyLocale } from '../i18n';
import { api, setPersona } from './api';
import { loadLocale, loadOnboardingSeen, loadSession, saveOnboardingSeen, saveSession } from './storage';

export interface AuthState {
  /** État chargé depuis l’appareil. */
  ready: boolean;
  session: Session | null;
  onboardingSeen: boolean;
}

// Implémentation simulée derrière AuthApi ; Supabase Auth la remplacera au lot 4.
let authApi: AuthApi = new MockAuth();

let state: AuthState = { ready: false, session: null, onboardingSeen: false };
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
const getState = () => state;

/** Payeur → PAYER, prestataire → PROVIDER, demandeur → PAYER pour l’instant (pas encore d’écrans dédiés). */
export const personaForRole = (role: PrimaryRole): Persona => (role === 'PROVIDER' ? 'PROVIDER' : 'PAYER');

function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  const role = state.session?.profile?.primaryRole;
  if (role) setPersona(personaForRole(role));
  // La simulation filtre les brouillons par utilisateur : à la déconnexion, plus aucun brouillon n’est visible.
  const s = state.session;
  if (s?.userId !== api.user?.id || (role && role !== api.user?.role) || s?.profile?.fullName !== api.user?.name) {
    api.setUser(s ? { id: s.userId, role: role ?? 'PAYER', name: s.profile?.fullName } : null);
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
    // L’état de la simulation (dossiers soumis, alertes, journal) est rechargé avant le premier écran.
    const [session, onboardingSeen, locale] = await Promise.all([loadSession(), loadOnboardingSeen(), loadLocale(), api.hydrate().catch(() => false)]);
    if (locale) applyLocale(locale);
    authApi = new MockAuth({ session });
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
