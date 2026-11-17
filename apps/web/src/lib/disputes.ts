import { MIN_DECISION_TEXT } from '@diaspay/domain';
import type { DisputeOutcome, DisputeStatus } from '@diaspay/domain';

import type { DisputeRow } from './bo';

/** Litige en cours (lot X v2) : tout statut autre que RESOLVED (OPEN, AWAITING_RESPONSE, IN_MEDIATION). */
export const isOpenDispute = (status: DisputeStatus | string): boolean => status !== 'RESOLVED';

/**
 * Issues proposées pour un litige, miroir des refus de _resolve_dispute_v2 (0014) ; la base décide de toute façon.
 * Avant paiement : NO_ACTION seulement (lève la suspension). Après paiement (PAID, REFUNDED) : remboursement total ou partiel
 * tant qu’il reste un montant payé non remboursé ; libération ou retour des fonds en CONDITIONAL quand les fonds sont bloqués.
 */
export function availableOutcomes(r: Pick<DisputeRow, 'trancheStatus' | 'amountMinor' | 'refundedMinor' | 'settlementMode' | 'fundsState'>): DisputeOutcome[] {
  const out: DisputeOutcome[] = ['NO_ACTION'];
  const paid = r.trancheStatus === 'PAID' || r.trancheStatus === 'REFUNDED';
  if (!paid) return out;
  if (r.amountMinor - r.refundedMinor > 0) out.push('REFUND_FULL', 'REFUND_PARTIAL');
  if (r.settlementMode === 'CONDITIONAL' && r.fundsState === 'HELD') out.push('FUNDS_RELEASED', 'FUNDS_RETURNED');
  return out;
}

/**
 * Erreur de saisie d’une décision : note obligatoire (3 caractères) ; remboursement partiel : montant positif, au plus le
 * montant payé non encore remboursé (la base refuse au-delà).
 */
export function disputeInputError(d: { outcome: DisputeOutcome; note: string; amountMinor?: number | null; remainingMinor?: number }):
  'REASON_REQUIRED' | 'AMOUNT_INVALID' | 'REFUND_EXCEEDS_PAID' | null {
  if (d.note.trim().length < MIN_DECISION_TEXT) return 'REASON_REQUIRED';
  if (d.outcome !== 'REFUND_PARTIAL') return null;
  if (!(d.amountMinor && d.amountMinor > 0)) return 'AMOUNT_INVALID';
  if (d.remainingMinor !== undefined && d.amountMinor > d.remainingMinor) return 'REFUND_EXCEEDS_PAID';
  return null;
}
