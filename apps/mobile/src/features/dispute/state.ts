import type { DisputeView } from '@diaspay/api-client';

// Suivi de litige (H10) : logique pure. Testée.

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

export const isResolved = (d: DisputeView): boolean => d.status !== 'OPEN';

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

/** Clé i18n et couleur du statut : point jaune en cours, vert une fois résolu. */
export function disputeStatus(d: DisputeView): { key: string; kind: 'pending' | 'active' } {
  if (d.status === 'OPEN') return { key: 'disputeInReview', kind: 'pending' };
  return { key: d.status === 'RELEASED_TO_PROVIDER' ? 'disputeResolvedReleased' : 'disputeResolvedRefunded', kind: 'active' };
}

/** « Voir le reçu » seulement si les fonds ont été remis au prestataire. */
export const canViewReceipt = (d: DisputeView): boolean => d.status === 'RELEASED_TO_PROVIDER';

/** Libellé du motif : code stable (NOT_DELIVERED…) ou ancien texte libre. */
export const DISPUTE_REASONS = ['NOT_DELIVERED', 'INCOMPLETE', 'WRONG_AMOUNT', 'OTHER'] as const;
export const reasonKey = (r: string): string | null => ((DISPUTE_REASONS as readonly string[]).includes(r) ? `disputeReason_${r}` : null);
