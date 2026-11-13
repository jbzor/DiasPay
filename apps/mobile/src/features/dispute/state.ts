import type { DisputeView, Tranche } from '@diaspay/api-client';
import type { DisputeOutcome } from '@diaspay/domain';

// Suivi de litige (H10) : logique pure. Testée. Lot X version 2 : le litige est un dossier distinct (OPEN,
// AWAITING_RESPONSE, IN_MEDIATION, RESOLVED) avec une issue ; il ne change jamais le statut d’une tranche payée.

export type DisputeStepKey = 'opened' | 'providerNotified' | 'review' | 'decision';
export interface DisputeStep {
  key: DisputeStepKey;
  done: boolean;
  /** Instant à afficher (ISO) si l’étape est accomplie. */
  at?: string;
  /** Pour une étape non accomplie : en cours ou à venir. */
  pending?: 'inProgress' | 'upcoming';
  /** Affichage du jour seul (examen) ou du jour et de l’heure. */
  dayOnly?: boolean;
}

/** Résolu seulement à RESOLVED ; OPEN, AWAITING_RESPONSE et IN_MEDIATION sont des litiges en cours. */
export const isResolved = (d: DisputeView): boolean => d.status === 'RESOLVED';

/** Déroulement en quatre étapes : ouverture et information du prestataire immédiates ; examen et décision à la résolution. */
export function disputeSteps(d: DisputeView): DisputeStep[] {
  const resolved = isResolved(d);
  return [
    { key: 'opened', done: true, at: d.openedAt },
    { key: 'providerNotified', done: true, at: d.openedAt },
    resolved ? { key: 'review', done: true, at: d.resolvedAt, dayOnly: true } : { key: 'review', done: false, pending: 'inProgress' },
    resolved ? { key: 'decision', done: true, at: d.resolvedAt } : { key: 'decision', done: false, pending: 'upcoming' },
  ];
}

const REFUND_OUTCOMES: readonly DisputeOutcome[] = ['REFUND_FULL', 'REFUND_PARTIAL', 'FUNDS_RETURNED'];

/** Clé i18n et couleur du statut : point jaune en cours, vert une fois résolu (libellé selon l’issue). */
export function disputeStatus(d: DisputeView): { key: string; kind: 'pending' | 'active' } {
  if (!isResolved(d)) return { key: 'disputeInReview', kind: 'pending' };
  if (d.outcome === 'FUNDS_RELEASED') return { key: 'disputeResolvedReleased', kind: 'active' };
  if (d.outcome && REFUND_OUTCOMES.includes(d.outcome)) return { key: 'disputeResolvedRefunded', kind: 'active' };
  return { key: 'disputeResolvedNoAction', kind: 'active' };
}

/** Montant de la décision : remboursé (remboursement ou fonds rendus), remis au prestataire, ou rien (sans suite). */
export function resolutionAmount(d: DisputeView, trancheAmountMinor: number): { key: 'refundedAmount' | 'releasedAmount'; amountMinor: number } | null {
  if (!isResolved(d) || !d.outcome || d.outcome === 'NO_ACTION') return null;
  if (d.outcome === 'FUNDS_RELEASED') return { key: 'releasedAmount', amountMinor: trancheAmountMinor };
  return { key: 'refundedAmount', amountMinor: d.refundAmountMinor ?? trancheAmountMinor };
}

/**
 * Décisions proposées par la démonstration (administrateur simulé), seulement celles que le serveur accepte : « sans suite »
 * toujours ; avant paiement rien d’autre ; fonds bloqués (CONDITIONAL) : remis au prestataire ou rendus au payeur ;
 * paiement direct exécuté : remboursement total de ce qui reste.
 */
export function demoOutcomes(tr: Pick<Tranche, 'status' | 'fundsState' | 'amountMinor' | 'refundedMinor'>): {
  release?: DisputeOutcome; refund?: DisputeOutcome; noAction: DisputeOutcome;
} {
  const paid = tr.status === 'PAID' || tr.status === 'REFUNDED';
  if (paid && tr.fundsState === 'HELD') return { release: 'FUNDS_RELEASED', refund: 'FUNDS_RETURNED', noAction: 'NO_ACTION' };
  if (paid && tr.refundedMinor < tr.amountMinor) return { refund: 'REFUND_FULL', noAction: 'NO_ACTION' };
  return { noAction: 'NO_ACTION' };
}

/** Le litige porte-t-il sur une tranche encore suspendue (ouvert avant paiement, non résolu) ? */
export const suspendsTranche = (d: DisputeView): boolean => d.beforePayment && !isResolved(d);

/** Libellé du motif : code stable (NOT_DELIVERED…) ou ancien texte libre. */
export const DISPUTE_REASONS = ['NOT_DELIVERED', 'INCOMPLETE', 'WRONG_AMOUNT', 'OTHER'] as const;
export const reasonKey = (r: string): string | null => ((DISPUTE_REASONS as readonly string[]).includes(r) ? `disputeReason_${r}` : null);
