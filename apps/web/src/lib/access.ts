/**
 * Règles d’accès du bureau de contrôle (fonction pure, testée dans test/access.test.ts).
 * Appliquées par le proxy à chaque requête, puis de nouveau par la mise en page des pages protégées.
 * Ce n’est qu’une première barrière : la base refuse elle-même tout accès (RLS, is_validator(), is_admin()
 * qui exigent aal2 quand app_config.require_staff_mfa = 'true').
 */

export type PlatformRole = 'USER' | 'VALIDATOR' | 'ADMIN';
export type Aal = 'aal1' | 'aal2';

export interface AccessInput {
  path: string;
  /** Utilisateur connecté (jeton vérifié), sinon null. */
  user: null | {
    role: PlatformRole;
    aal: Aal;
    /** Niveau atteignable : aal2 si l’utilisateur a un second facteur vérifié. */
    nextAal: Aal;
  };
  /** app_config.require_staff_mfa = 'true' (production). */
  requireMfa: boolean;
}

export type AccessDecision =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string };

/** Pages accessibles sans session. */
export const PUBLIC_PATHS = ['/connexion', '/mot-de-passe-oublie', '/auth/confirm'] as const;
/** Pages accessibles à un membre du personnel connecté au premier niveau (aal1), avant le second facteur. */
export const MFA_PATH = '/connexion/second-facteur';
/** Pages des administrateurs seulement. */
export const ADMIN_PATHS = ['/litiges'] as const;
export const HOME = '/dossiers';
export const DENIED = '/acces-refuse';

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export const isStaff = (role: PlatformRole): boolean => role === 'VALIDATOR' || role === 'ADMIN';

/** Le second facteur est exigé si la configuration le demande, ou si l’utilisateur en a déjà un. */
export function needsSecondFactor(u: NonNullable<AccessInput['user']>, requireMfa: boolean): boolean {
  return (requireMfa || u.nextAal === 'aal2') && u.aal !== 'aal2';
}

export function decideAccess({ path, user, requireMfa }: AccessInput): AccessDecision {
  const isPublic = PUBLIC_PATHS.some((p) => under(path, p)) && !under(path, MFA_PATH);
  if (!user) {
    if (isPublic) return { kind: 'allow' };
    const suite = path === '/' || under(path, MFA_PATH) || under(path, DENIED) || under(path, '/nouveau-mot-de-passe') ? '' : `?suite=${encodeURIComponent(path)}`;
    return { kind: 'redirect', to: `/connexion${suite}` };
  }
  // Réinitialisation du mot de passe : session ouverte par le lien reçu, quel que soit le rôle.
  if (under(path, '/nouveau-mot-de-passe') || under(path, '/auth/confirm')) return { kind: 'allow' };
  if (!isStaff(user.role)) {
    return under(path, DENIED) ? { kind: 'allow' } : { kind: 'redirect', to: DENIED };
  }
  if (needsSecondFactor(user, requireMfa)) {
    return under(path, MFA_PATH) ? { kind: 'allow' } : { kind: 'redirect', to: MFA_PATH };
  }
  if (isPublic || under(path, MFA_PATH) || path === '/') return { kind: 'redirect', to: HOME };
  if (user.role !== 'ADMIN' && ADMIN_PATHS.some((p) => under(path, p))) {
    return { kind: 'redirect', to: `${DENIED}?motif=admin` };
  }
  return { kind: 'allow' };
}

/** Destination après connexion : seulement un chemin interne (aucune redirection ouverte). */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return HOME;
  return raw;
}
