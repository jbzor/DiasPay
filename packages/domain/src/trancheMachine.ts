import { DomainError, TERMINAL_TRANCHE_STATUSES } from './types';
import type { Actor, ReleaseMode, TrancheStatus, TxRole } from './types';

/** Auteur d’une transition de tranche (rôle au dossier ou système). */
export type TrancheActor = TxRole | 'SYSTEM';
type Who = TrancheActor;

// Miroir de tranche_transitions (hors transitions réservées au validateur).
const TRANSITIONS: ReadonlyArray<readonly [TrancheStatus, TrancheStatus, readonly Who[]]> = [
  ['PLANNED', 'AWAITING_PAYMENT', ['SYSTEM']],
  ['AWAITING_PAYMENT', 'PAID_LOCKED', ['SYSTEM']],
  ['AWAITING_PAYMENT', 'EXPIRED', ['SYSTEM']],
  ['AWAITING_PAYMENT', 'CANCELLED', ['PAYER']],
  ['PAID_LOCKED', 'CONFIRMED', ['PROVIDER', 'PAYER', 'SYSTEM']],
  ['PAID_LOCKED', 'EVIDENCE_SUBMITTED', ['PROVIDER']],
  ['CONFIRMED', 'RELEASED', ['PAYER', 'SYSTEM']],
  // Lot X (X2) : décisions du payeur et réponse de l’initiateur (fonctions request_info, answer_info, reject_request).
  ['AWAITING_PAYMENT', 'INFO_REQUESTED', ['PAYER']],
  ['INFO_REQUESTED', 'AWAITING_PAYMENT', ['REQUESTER', 'PROVIDER']],
  ['AWAITING_PAYMENT', 'REJECTED', ['PAYER']],
  ['INFO_REQUESTED', 'REJECTED', ['PAYER']],
  // Paiement direct (mode IMMEDIATE seulement) : débloqué dès le paiement, sans verrouillage ni contestation.
  ['AWAITING_PAYMENT', 'RELEASED', ['SYSTEM']],
];

/** Toutes les transitions de tranche hors validateur, miroir de tranche_transitions (test de parité avec le SQL). */
export const TRANCHE_TRANSITIONS: ReadonlyArray<readonly [TrancheStatus, TrancheStatus, readonly TrancheActor[]]> = TRANSITIONS;

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
  if (!row) throw new DomainError('TRANSITION_UNKNOWN', `Transition de tranche ${tr.status} -> ${to} non autorisée`);
  const who = row[2];

  // Lot X : seul l’initiateur répond à une demande d’informations (même code qu’answer_info, avant le contrôle du rôle).
  if (tr.status === 'INFO_REQUESTED' && to === 'AWAITING_PAYMENT' && actor.kind === 'USER' && !actor.isCreator) {
    throw new DomainError('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande');
  }

  const allowed =
    actor.kind === 'SYSTEM' ? who.includes('SYSTEM') : actor.roles.some((r) => who.includes(r));
  if (!allowed) throw new DomainError('TRANSITION_FORBIDDEN', 'Rôle non autorisé pour cette transition');

  // Lot X : la demande d’informations vient d’un payeur qui n’est pas l’initiateur.
  if (tr.status === 'AWAITING_PAYMENT' && to === 'INFO_REQUESTED' && actor.kind === 'USER' && actor.isCreator) {
    throw new DomainError('TRANSITION_FORBIDDEN', 'Vous êtes l’initiateur de cette demande');
  }
  if (tr.status === 'AWAITING_PAYMENT' && to === 'RELEASED' && tr.releaseMode !== 'IMMEDIATE') {
    throw new DomainError('NOT_PAID', 'Seul un paiement débloque directement une tranche (mode IMMEDIATE)');
  }

  if (tr.status === 'PAID_LOCKED' && to === 'CONFIRMED' && actor.kind === 'USER') {
    const ok =
      (tr.releaseMode === 'PROVIDER_CONFIRM' && actor.roles.includes('PROVIDER')) ||
      (tr.releaseMode === 'PAYER_CONFIRM' && actor.roles.includes('PAYER'));
    if (!ok) throw new DomainError('WRONG_CONFIRMER', `Ce rôle ne peut pas confirmer cette tranche (mode ${tr.releaseMode})`);
  }
  if (tr.status === 'PAID_LOCKED' && to === 'EVIDENCE_SUBMITTED') {
    if (tr.releaseMode !== 'EVIDENCE_REVIEW') throw new DomainError('NO_EVIDENCE_NEEDED', 'Cette tranche ne requiert pas de preuve');
    if (!tr.hasEvidence) throw new DomainError('EVIDENCE_MISSING', 'Déposez au moins une pièce probante');
  }

  if (to === 'CONFIRMED' && tr.releaseMode !== 'EVIDENCE_REVIEW') {
    return { status: to, contestEndsAt: new Date(now.getTime() + tr.contestHours * 3_600_000) };
  }
  return { status: to, contestEndsAt: tr.contestEndsAt };
}

/**
 * Issue d’un paiement réussi (miroir de simulate_tranche_system, puis du webhook du partenaire) :
 * mode IMMEDIATE → débloquée directement (événement DIRECT_PAYMENT), sinon fonds verrouillés.
 */
export function paymentOutcome(releaseMode: ReleaseMode): 'RELEASED' | 'PAID_LOCKED' {
  return releaseMode === 'IMMEDIATE' ? 'RELEASED' : 'PAID_LOCKED';
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
 * Décision d’un litige (RG-09, miroir de resolve_dispute()) : réservée à un administrateur non partie au dossier.
 * Un validateur ne tranche pas. Libération → RELEASED (fonds remis au prestataire),
 * remboursement → CANCELLED (paiement remboursé au payeur).
 */
export function resolveDisputeTransition(tr: { status: TrancheStatus }, outcome: DisputeOutcome, actor: Actor): TrancheStatus {
  if (actor.kind !== 'USER' || !actor.isAdmin) throw new DomainError('ADMIN_ONLY', 'Seul un administrateur tranche un litige');
  if (actor.roles.length > 0) throw new DomainError('VALIDATOR_IS_PARTY', 'Un administrateur partie au dossier ne peut pas trancher');
  if (tr.status !== 'DISPUTED') throw new DomainError('NO_OPEN_DISPUTE', 'La tranche n’est pas en litige');
  return outcome === 'RELEASED' ? 'RELEASED' : 'CANCELLED';
}
