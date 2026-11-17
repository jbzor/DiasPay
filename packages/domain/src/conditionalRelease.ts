import { DomainError } from './types';
import type { FundsState, PaymentRequestStatus, ReleaseMode, SettlementMode, TxRole } from './types';

// Lot X version 2 : libération conditionnelle (séquestre), utilisée seulement quand settlement_mode = CONDITIONAL.
// Ancienne logique des tranches (confirmation, délai de contestation, preuves, double validation), portée par funds_state
// au lieu des anciens statuts PAID_LOCKED, CONFIRMED, RELEASED, EVIDENCE_SUBMITTED. Miroir des fonctions de 0014.

export interface ConditionalState {
  settlementMode: SettlementMode;
  status: PaymentRequestStatus;
  fundsState: FundsState;
  releaseMode: ReleaseMode;
  contestHours: number;
  confirmedAt?: Date;
  contestEndsAt?: Date;
  evidenceSubmittedAt?: Date;
  hasEvidence?: boolean;
  /** Litige en cours (non résolu). */
  disputeOpen?: boolean;
  /** Lot X-C (T6) : opération suspendue (litige avant paiement sur une autre demande du dossier). */
  txSuspended?: boolean;
}

/** Issue d’un paiement confirmé par le partenaire : PAID ; fonds bloqués en CONDITIONAL, aucun en DIRECT. */
export function paymentOutcome(mode: SettlementMode): { status: 'PAID'; fundsState: 'NONE' | 'HELD' } {
  return { status: 'PAID', fundsState: mode === 'CONDITIONAL' ? 'HELD' : 'NONE' };
}

/** Contrôles communs (miroir de _conditional_tranche) : règlement conditionnel, demande payée, fonds bloqués, pas de litige. */
function checkHeld(s: ConditionalState): void {
  if (s.settlementMode !== 'CONDITIONAL') throw new DomainError('WRONG_MODE', 'Règlement direct : ni confirmation ni libération');
  if (s.status !== 'PAID' || s.fundsState !== 'HELD') throw new DomainError('NOT_PAID', 'Demande non payée ou fonds déjà traités');
  if (s.disputeOpen) throw new DomainError('DISPUTE_OPEN', 'Un litige est en cours sur cette demande');
}

/**
 * Confirmation de la prestation : par le prestataire (scan, PROVIDER_CONFIRM) ou par le payeur (PAYER_CONFIRM).
 * Renvoie la fin du délai de contestation.
 */
export function confirmService(s: ConditionalState, by: { roles: readonly TxRole[]; via: 'SCAN' | 'PAYER' }, now: Date = new Date()): Date {
  checkHeld(s);
  const ok = (by.via === 'SCAN' && s.releaseMode === 'PROVIDER_CONFIRM' && by.roles.includes('PROVIDER'))
    || (by.via === 'PAYER' && s.releaseMode === 'PAYER_CONFIRM' && by.roles.includes('PAYER'));
  if (!ok) throw new DomainError(by.via === 'SCAN' ? 'WRONG_MODE' : 'WRONG_CONFIRMER', `Ce rôle ne peut pas confirmer cette demande (mode ${s.releaseMode})`);
  if (s.confirmedAt) throw new DomainError('ALREADY_CONFIRMED', 'Prestation déjà confirmée');
  return new Date(now.getTime() + s.contestHours * 3_600_000);
}

/** Dépôt des preuves par le prestataire (EVIDENCE_REVIEW), examinées ensuite par le bureau. */
export function checkSubmitEvidence(s: ConditionalState, roles: readonly TxRole[]): void {
  checkHeld(s);
  if (!roles.includes('PROVIDER')) throw new DomainError('PROVIDER_ONLY', 'Réservé au prestataire');
  if (s.releaseMode !== 'EVIDENCE_REVIEW') throw new DomainError('NO_EVIDENCE_NEEDED', 'Cette demande ne requiert pas de preuve');
  if (!s.hasEvidence) throw new DomainError('EVIDENCE_MISSING', 'Déposez au moins une pièce probante');
}

/** Libération anticipée par le payeur, après confirmation. */
export function checkApproveRelease(s: ConditionalState, roles: readonly TxRole[]): void {
  checkHeld(s);
  if (!roles.includes('PAYER')) throw new DomainError('PAYER_ONLY', 'Seul le payeur peut approuver la libération anticipée');
  if (!s.confirmedAt) throw new DomainError('NOT_CONFIRMED', 'La prestation n’est pas encore confirmée');
}

/**
 * Libération automatique à la fin du délai de contestation (jamais en mode preuve, jamais pendant un litige,
 * jamais pour une opération suspendue — lot X-C, T6 ; miroir de release_due_tranches, 0027).
 */
export function isAutoReleasable(s: ConditionalState, now: Date): boolean {
  return s.settlementMode === 'CONDITIONAL' && s.status === 'PAID' && s.fundsState === 'HELD' && s.releaseMode !== 'EVIDENCE_REVIEW'
    && !!s.confirmedAt && !!s.contestEndsAt && s.contestEndsAt.getTime() <= now.getTime() && !s.disputeOpen && !s.txSuspended;
}
