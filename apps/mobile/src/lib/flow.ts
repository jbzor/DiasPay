import type { Session } from '@diaspay/api-client';

export type StartRoute = '/slides' | '/login' | '/profile-setup' | '/home';

/**
 * Destination après l’écran de lancement.
 * Première ouverture → présentation ; présentation vue sans session → connexion ;
 * session sans profil (abandon) → profil ; session avec profil → onglets.
 */
export function startRoute({ session, onboardingSeen }: { session: Session | null; onboardingSeen: boolean }): StartRoute {
  if (!session) return onboardingSeen ? '/login' : '/slides';
  return session.profile ? '/home' : '/profile-setup';
}

/** Accès aux écrans connectés (profil initial, biométrie). */
export const canSetup = (session: Session | null): boolean => !!session;
/** Accès aux onglets et aux écrans de transaction. */
export const canUseApp = (session: Session | null): boolean => !!session?.profile;
