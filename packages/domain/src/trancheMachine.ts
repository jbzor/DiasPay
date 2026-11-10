import { DomainError, TERMINAL_TRANCHE_STATUSES } from './types';
import type { Actor, ReleaseMode, TrancheStatus, TxRole } from './types';

type Who = TxRole | 'SYSTEM';

// Miroir de tranche_transitions (hors transitions réservées au validateur).
const TRANSITIONS: ReadonlyArray<readonly [TrancheStatus, TrancheStatus, readonly Who[]]> = [
  ['PLANNED', 'AWAITING_PAYMENT', ['SYSTEM']],
  ['AWAITING_PAYMENT', 'PAID_LOCKED', ['SYSTEM']],
  ['AWAITING_PAYMENT', 'EXPIRED', ['SYSTEM']],
  ['AWAITING_PAYMENT', 'CANCELLED', ['PAYER']],
  ['PAID_LOCKED', 'CONFIRMED', ['PROVIDER', 'PAYER', 'SYSTEM']],
  ['PAID_LOCKED', 'EVIDENCE_SUBMITTED', ['PROVIDER']],
  ['CONFIRMED', 'RELEASED', ['PAYER', 'SYSTEM']],
];

export interface TrancheState {
  status: TrancheStatus;
  releaseMode: ReleaseMode;
  contestHours: number;
  contestEndsAt?: Date;
  hasEvidence?: boolean;
}

export interface TrancheResult {
  status: TrancheStatus;
  contestEndsAt?: Date;
}

/**
 * Transition d'une tranche par un utilisateur ou le système.
 * Les décisions de validateurs passent par evidenceOutcome() (voir rules.ts).
 */
export function transitionTranche(
  tr: TrancheState,
  to: TrancheStatus,
  actor: Actor,
  now: Date = new Date(),
): TrancheResult {
  const row = TRANSITIONS.find(([f, t]) => f === tr.status && t === to);
  if (!row) throw new DomainError('TR_TRANSITION_UNKNOWN', `Transition de tranche ${tr.status} -> ${to} non autorisée`);
  const who = row[2];

  const allowed =
    actor.kind === 'SYSTEM' ? who.includes('SYSTEM') : actor.roles.some((r) => who.includes(r));
  if (!allowed) throw new DomainError('TR_TRANSITION_FORBIDDEN', 'Rôle non autorisé pour cette transition');

  if (tr.status === 'PAID_LOCKED' && to === 'CONFIRMED' && actor.kind === 'USER') {
    const ok =
      (tr.releaseMode === 'PROVIDER_CONFIRM' && actor.roles.includes('PROVIDER')) ||
      (tr.releaseMode === 'PAYER_CONFIRM' && actor.roles.includes('PAYER'));
    if (!ok) throw new DomainError('TR_WRONG_CONFIRMER', `Ce rôle ne peut pas confirmer cette tranche (mode ${tr.releaseMode})`);
  }
  if (tr.status === 'PAID_LOCKED' && to === 'EVIDENCE_SUBMITTED') {
    if (tr.releaseMode !== 'EVIDENCE_REVIEW') throw new DomainError('TR_NO_EVIDENCE_NEEDED', 'Cette tranche ne requiert pas de preuve');
    if (!tr.hasEvidence) throw new DomainError('TR_EVIDENCE_MISSING', 'Déposez au moins une pièce probante');
  }

  if (to === 'CONFIRMED' && tr.releaseMode !== 'EVIDENCE_REVIEW') {
    return { status: to, contestEndsAt: new Date(now.getTime() + tr.contestHours * 3_600_000) };
  }
  return { status: to, contestEndsAt: tr.contestEndsAt };
}

/** Une tranche confirmée est débloquée automatiquement une fois le délai écoulé (jamais en mode preuve). */
export function isAutoReleasable(tr: TrancheState, now: Date): boolean {
  return (
    tr.status === 'CONFIRMED' &&
    tr.releaseMode !== 'EVIDENCE_REVIEW' &&
    tr.contestEndsAt !== undefined &&
    tr.contestEndsAt.getTime() <= now.getTime()
  );
}

/** Règle d'ouverture de litige (miroir de open_dispute()). */
export function canOpenDispute(tr: TrancheState, roles: readonly TxRole[], now: Date): boolean {
  const isPayer = roles.includes('PAYER');
  const isProvider = roles.includes('PROVIDER');
  if (!isPayer && !isProvider) return false;
  if (tr.status === 'PAID_LOCKED' || tr.status === 'EVIDENCE_SUBMITTED') return true;
  return (
    tr.status === 'CONFIRMED' && isPayer &&
    tr.contestEndsAt !== undefined && now.getTime() <= tr.contestEndsAt.getTime()
  );
}

/** La transaction se clôt quand toutes ses tranches sont terminées. */
export function shouldCloseTransaction(trancheStatuses: readonly TrancheStatus[]): boolean {
  return trancheStatuses.length > 0 && trancheStatuses.every((s) => TERMINAL_TRANCHE_STATUSES.includes(s));
}

export type DisputeOutcome = 'RELEASED' | 'REFUNDED';

/**
 * Décision d’un litige par un administrateur (miroir de resolve_dispute(), réservée au validateur non partie) :
 * libération → RELEASED (fonds remis au prestataire), remboursement → CANCELLED (paiement remboursé au payeur).
 */
export function resolveDisputeTransition(tr: { status: TrancheStatus }, outcome: DisputeOutcome, actor: Actor): TrancheStatus {
  if (tr.status !== 'DISPUTED') throw new DomainError('TR_NOT_DISPUTED', 'La tranche n’est pas en litige');
  if (actor.kind !== 'USER' || !actor.isValidator || actor.roles.length > 0) {
    throw new DomainError('TR_TRANSITION_FORBIDDEN', 'Seul un validateur non partie tranche un litige');
  }
  return outcome === 'RELEASED' ? 'RELEASED' : 'CANCELLED';
}
