import { DomainError } from './types';
import type { Actor, FundsState, PaymentRequestStatus, TxRole } from './types';

// Lot X version 2 : le litige est un dossier distinct (K5, K7), jamais un statut de demande. Miroir de open_dispute et
// _resolve_dispute_v2 (0014).

export type DisputeStatus = 'OPEN' | 'AWAITING_RESPONSE' | 'IN_MEDIATION' | 'RESOLVED';
export const DISPUTE_STATUSES: readonly DisputeStatus[] = ['OPEN', 'AWAITING_RESPONSE', 'IN_MEDIATION', 'RESOLVED'];
export type DisputeOutcome = 'NO_ACTION' | 'REFUND_FULL' | 'REFUND_PARTIAL' | 'FUNDS_RELEASED' | 'FUNDS_RETURNED';
export const DISPUTE_OUTCOMES: readonly DisputeOutcome[] = ['NO_ACTION', 'REFUND_FULL', 'REFUND_PARTIAL', 'FUNDS_RELEASED', 'FUNDS_RETURNED'];

/**
 * Ouverture d’un litige par le payeur ou le prestataire. Avant paiement (SUBMITTED, INFO_REQUESTED, ACCEPTED) : la demande
 * est suspendue (on_hold) et l’opération passe en SUSPENDED. Après paiement (PAID, REFUNDED) : le statut ne change pas.
 */
export function disputeOpening(status: PaymentRequestStatus, roles: readonly TxRole[]): { beforePayment: boolean } {
  if (!roles.includes('PAYER') && !roles.includes('PROVIDER')) throw new DomainError('NOT_A_PARTY', 'Seuls le payeur et le prestataire ouvrent un litige');
  if (status === 'SUBMITTED' || status === 'INFO_REQUESTED' || status === 'ACCEPTED') return { beforePayment: true };
  if (status === 'PAID' || status === 'REFUNDED') return { beforePayment: false };
  throw new DomainError('DISPUTE_NOT_ALLOWED', `Litige impossible dans l’état ${status}`);
}

export function canOpenDispute(status: PaymentRequestStatus, roles: readonly TxRole[]): boolean {
  try { disputeOpening(status, roles); return true; } catch { return false; }
}

/**
 * Issue d’un litige (administrateur non partie). Renvoie le montant à rembourser (0 sans remboursement). Les remboursements
 * ne dépassent jamais « payé moins déjà remboursé ». FUNDS_RELEASED / FUNDS_RETURNED : fonds encore bloqués (CONDITIONAL).
 */
export function resolveDisputeDecision(
  input: { status: PaymentRequestStatus; fundsState: FundsState; paidMinor: number; refundedMinor: number },
  outcome: DisputeOutcome, actor: Actor, amountMinor?: number,
): { refundMinor: number; fundsState?: FundsState } {
  if (actor.kind !== 'USER' || !actor.isAdmin) throw new DomainError('ADMIN_ONLY', 'Seul un administrateur tranche un litige');
  if (actor.roles.length > 0) throw new DomainError('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas trancher');
  if (!DISPUTE_OUTCOMES.includes(outcome)) throw new DomainError('INVALID_OUTCOME', 'Issue invalide');
  const paid = input.status === 'PAID' || input.status === 'REFUNDED';
  if (outcome !== 'NO_ACTION' && !paid) throw new DomainError('INVALID_OUTCOME', 'Issue impossible avant paiement');
  if ((outcome === 'FUNDS_RELEASED' || outcome === 'FUNDS_RETURNED') && input.fundsState !== 'HELD') {
    throw new DomainError('INVALID_OUTCOME', 'Fonds non bloqués (règlement direct ou déjà traités)');
  }
  const remaining = input.paidMinor - input.refundedMinor;
  if (outcome === 'NO_ACTION') return { refundMinor: 0 };
  if (outcome === 'FUNDS_RELEASED') return { refundMinor: 0, fundsState: 'RELEASED' };
  if (outcome === 'REFUND_PARTIAL') {
    if (!amountMinor || amountMinor <= 0) throw new DomainError('AMOUNT_INVALID', 'Montant du remboursement partiel obligatoire');
    if (amountMinor > remaining) throw new DomainError('REFUND_EXCEEDS_PAID', 'Remboursement au-delà du montant payé');
    return { refundMinor: amountMinor };
  }
  if (remaining <= 0) throw new DomainError('REFUND_EXCEEDS_PAID', 'Rien à rembourser');
  // Remboursement intégral de fonds encore bloqués : ils reviennent au payeur (0019), comme FUNDS_RETURNED.
  return { refundMinor: remaining, fundsState: outcome === 'FUNDS_RETURNED' || input.fundsState === 'HELD' ? 'RETURNED' : undefined };
}
