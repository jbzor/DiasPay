// Logique pure du jeton : état (valide, expiré, utilisé) et décompte lisible.
export const DAY_MS = 24 * 3_600_000;

export type TokenState =
  | { kind: 'used' }
  | { kind: 'expired' }
  | { kind: 'valid'; msLeft: number; countdown: Countdown | null };

export interface Countdown { hours: number; minutes: number }

export interface TokenLike { expiresAt: string; usedAt?: string }

/** Décompte affiché sous 24 h, arrondi à la minute supérieure (jamais « 0 min » tant que le jeton est valide). */
export function countdown(msLeft: number): Countdown | null {
  if (msLeft <= 0 || msLeft >= DAY_MS) return null;
  const totalMin = Math.ceil(msLeft / 60_000);
  return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60 };
}

export function tokenState(token: TokenLike, now: Date): TokenState {
  if (token.usedAt) return { kind: 'used' };
  const msLeft = new Date(token.expiresAt).getTime() - now.getTime();
  if (msLeft <= 0) return { kind: 'expired' };
  return { kind: 'valid', msLeft, countdown: countdown(msLeft) };
}
