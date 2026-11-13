import { DomainError } from './types';
import type { Actor, FundsState, PaymentRequestStatus } from './types';

// Lot X version 2 : machine d’états d’une demande de paiement (modèle cible, section 3.2). Miroir de tranche_transitions
// (0014). Qui : INITIATOR (initiateur de l’opération), PAYER, SYSTEM. Les tentatives de paiement (INITIATED, PENDING,
// CONFIRMED, FAILED) ne changent la demande que par des événements du partenaire.

export type RequestActor = 'INITIATOR' | 'PAYER' | 'SYSTEM';

export const PAYMENT_REQUEST_TRANSITIONS: ReadonlyArray<readonly [PaymentRequestStatus, PaymentRequestStatus, readonly RequestActor[]]> = [
  ['DRAFT', 'SUBMITTED', ['INITIATOR', 'SYSTEM']],
  ['SUBMITTED', 'INFO_REQUESTED', ['PAYER']],
  ['INFO_REQUESTED', 'SUBMITTED', ['INITIATOR']],
  ['SUBMITTED', 'ACCEPTED', ['PAYER']],
  ['ACCEPTED', 'PAID', ['SYSTEM']],
  ['ACCEPTED', 'SUBMITTED', ['SYSTEM']],
  ['SUBMITTED', 'REJECTED', ['PAYER']],
  ['INFO_REQUESTED', 'REJECTED', ['PAYER']],
  ['DRAFT', 'CANCELLED', ['INITIATOR']],
  ['SUBMITTED', 'CANCELLED', ['INITIATOR']],
  ['INFO_REQUESTED', 'CANCELLED', ['INITIATOR']],
  ['SUBMITTED', 'EXPIRED', ['SYSTEM']],
  ['INFO_REQUESTED', 'EXPIRED', ['SYSTEM']],
  ['PAID', 'REFUNDED', ['SYSTEM']],
];

export interface RequestContext {
  /** Litige ouvert avant paiement : la demande est suspendue (K7). */
  onHold?: boolean;
}

function whoOf(actor: Actor): RequestActor[] {
  if (actor.kind === 'SYSTEM') return ['SYSTEM'];
  const out: RequestActor[] = [];
  if (actor.isCreator) out.push('INITIATOR');
  if (actor.roles.includes('PAYER')) out.push('PAYER');
  return out;
}

export function canTransitionPaymentRequest(from: PaymentRequestStatus, to: PaymentRequestStatus, actor: Actor): boolean {
  const row = PAYMENT_REQUEST_TRANSITIONS.find(([f, t]) => f === from && t === to);
  return !!row && whoOf(actor).some((w) => row[2].includes(w));
}

/**
 * Transition d’une demande (pure). Codes : TRANSITION_UNKNOWN ; réponse à une demande d’informations par un autre que
 * l’initiateur : INITIATOR_ONLY ; rôle non autorisé : TRANSITION_FORBIDDEN ; demande d’informations par le payeur qui est
 * aussi l’initiateur : TRANSITION_FORBIDDEN ; demande suspendue par un litige : REQUEST_ON_HOLD.
 */
export function transitionPaymentRequest(status: PaymentRequestStatus, to: PaymentRequestStatus, actor: Actor, ctx: RequestContext = {}): PaymentRequestStatus {
  const row = PAYMENT_REQUEST_TRANSITIONS.find(([f, t]) => f === status && t === to);
  if (!row) throw new DomainError('TRANSITION_UNKNOWN', `Transition de demande ${status} -> ${to} inconnue`);
  if (status === 'INFO_REQUESTED' && to === 'SUBMITTED' && actor.kind === 'USER' && !actor.isCreator) {
    throw new DomainError('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande');
  }
  if (!canTransitionPaymentRequest(status, to, actor)) throw new DomainError('TRANSITION_FORBIDDEN', 'Rôle non autorisé pour cette transition');
  if (status === 'SUBMITTED' && to === 'INFO_REQUESTED' && actor.kind === 'USER' && actor.isCreator) {
    throw new DomainError('TRANSITION_FORBIDDEN', 'Vous êtes l’initiateur de cette demande');
  }
  if (ctx.onHold && (to === 'INFO_REQUESTED' || to === 'ACCEPTED')) throw new DomainError('REQUEST_ON_HOLD', 'Demande suspendue par un litige');
  return to;
}

/** Demande dans un état final (clôture de l’opération) : en CONDITIONAL, une demande payée attend la fin de ses fonds. */
export function isRequestFinal(status: PaymentRequestStatus, fundsState: FundsState = 'NONE'): boolean {
  if (status === 'REFUNDED' || status === 'REJECTED' || status === 'CANCELLED' || status === 'EXPIRED') return true;
  return status === 'PAID' && fundsState !== 'HELD';
}

/** L’opération active se clôt quand toutes ses demandes sont finales (miroir de _close_operation_if_done). */
export function shouldCloseOperation(requests: ReadonlyArray<{ status: PaymentRequestStatus; fundsState?: FundsState }>): boolean {
  return requests.length > 0 && requests.every((r) => isRequestFinal(r.status, r.fundsState));
}
