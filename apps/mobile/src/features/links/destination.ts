// Où mène un lien /t/<référence> selon le profil de l’utilisateur et l’état de la tranche (logique pure).
import type { Persona, ReferenceInfo } from '@diaspay/api-client';

export type LinkDestination =
  | { kind: 'pay'; trancheId: string }
  | { kind: 'confirm'; reference: string }
  | { kind: 'detail'; txId: string; trancheId: string }
  | { kind: 'invalid' };

export function linkDestination(info: ReferenceInfo, reference: string, persona: Persona, now: number): LinkDestination {
  if (now > new Date(info.expiresAt).getTime()) return { kind: 'invalid' };
  if (persona === 'PAYER' && info.status === 'AWAITING_PAYMENT') return { kind: 'pay', trancheId: info.trancheId };
  if (persona === 'PROVIDER' && info.status === 'PAID_LOCKED' && !info.used) return { kind: 'confirm', reference };
  return { kind: 'detail', txId: info.txId, trancheId: info.trancheId };
}
