import { trackingLabel } from '@diaspay/domain';
import type { Tracking, TrackingLabel } from '@diaspay/domain';
import type { Tranche, Transaction } from '@diaspay/api-client';

// Lot A (T6) : libellé de suivi d’une demande (correspondance du livrable 6), et sa couleur. Logique pure, testée.

export function trackingOf(tx: Transaction, tr: Tranche, now: Date): Tracking {
  return trackingLabel({
    status: tr.status, txStatus: tx.status, amountMinor: tr.amountMinor, refundedMinor: tr.refundedMinor, dueDate: tr.dueDate,
    firstViewedAt: tr.firstViewedAt, payerDocumentsViewedAt: tx.payerDocumentsViewedAt, disputeOpen: !!tr.disputeOpen,
  }, now);
}

/** Clé i18n du libellé (remboursement partiel : libellé dédié). */
export function trackingKey(t: Tracking): string {
  return t.label === 'REFUNDED' && t.partialRefund ? 'track_REFUNDED_PARTIAL' : `track_${t.label}`;
}

export type TrackingKind = 'active' | 'pending' | 'draft' | 'error';
const KIND: Record<TrackingLabel, TrackingKind> = {
  DRAFT: 'draft', SUBMITTED: 'pending', RECEIVED: 'pending', UNDER_REVIEW: 'pending', INFO_REQUESTED: 'pending',
  AWAITING_VALIDATION: 'pending', ACCEPTED: 'pending', PAYMENT_IN_PROGRESS: 'pending', PAID: 'active', DISPUTED: 'error',
  REJECTED: 'error', EXPIRED: 'draft', CANCELLED: 'draft', REFUNDED: 'draft',
};
export const trackingKind = (t: Tracking): TrackingKind => (t.overdue ? 'error' : KIND[t.label]);
