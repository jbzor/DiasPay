import type { PaymentRequestStatus, TxStatus } from './types';
import { toIsoDate } from './need';

/**
 * Lot A (T6) : libellés de suivi du Dr (livrable 6, « Les 13 libellés »), calculés à partir du statut de la demande, de
 * celui de l’opération et d’événements datés, si bien qu’aucun ne peut contredire l’état réel. « Notification envoyée »
 * n’est jamais produit tant qu’aucun canal externe n’existe (lot 6) : la demande reste « soumise ».
 * « En retard » est un indicateur à côté du libellé, jamais un statut.
 * Lot A (T8b) : « Programmée » (SCHEDULED, livrable 6, indicateurs des échéanciers) : échéance encore en brouillon d’une
 * opération déjà soumise, qui sera soumise automatiquement (activation_lead_days avant sa date, ou après le jalon précédent).
 */
export const TRACKING_LABELS = [
  'DRAFT', 'SUBMITTED', 'RECEIVED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'AWAITING_VALIDATION', 'ACCEPTED', 'PAYMENT_IN_PROGRESS',
  'PAID', 'DISPUTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'SCHEDULED',
] as const;
export type TrackingLabel = (typeof TRACKING_LABELS)[number];

export interface TrackingInput {
  status: PaymentRequestStatus;
  /** Statut de l’opération : en revue (PENDING_REVIEW, IN_REVIEW) → « En attente de validation ». */
  txStatus: TxStatus;
  amountMinor: number;
  refundedMinor: number;
  dueDate?: string;
  /** Première ouverture de la demande par le payeur (tranches.first_viewed_at, REQUEST_VIEWED). */
  firstViewedAt?: string;
  /** Première consultation d’une pièce de l’opération par le payeur (DOCUMENT_VIEWED, 0034). */
  payerDocumentsViewedAt?: string;
  /** Litige non résolu sur la demande (dossier distinct : le statut financier ne change pas). */
  disputeOpen: boolean;
  /**
   * Demande acceptée avec une tentative lancée ou en attente. Le serveur ne garde ACCEPTED qu’avec une tentative en cours
   * (accept_and_pay ; un échec ramène la demande à SUBMITTED) : vrai par défaut.
   */
  attemptInProgress?: boolean;
}

export interface Tracking {
  label: TrackingLabel;
  /** Échéance impayée, non finale, dont la date est passée. */
  overdue: boolean;
  /** Remboursement partiel (libellé REFUNDED). */
  partialRefund: boolean;
}

/** Opération soumise dont les échéances en brouillon attendent leur soumission automatique. */
const SCHEDULING_TX: readonly TxStatus[] = ['PENDING_REVIEW', 'IN_REVIEW', 'ACTIVE'];

/** Demande sans paiement ni décision finale : encore « due ». */
const UNPAID_OPEN: readonly PaymentRequestStatus[] = ['SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED'];

export function isOverdue(status: PaymentRequestStatus, dueDate: string | undefined, now: Date): boolean {
  return !!dueDate && UNPAID_OPEN.includes(status) && dueDate < toIsoDate(now);
}

export function trackingLabel(r: TrackingInput, now: Date): Tracking {
  const overdue = isOverdue(r.status, r.dueDate, now);
  const partialRefund = r.status === 'REFUNDED' && r.refundedMinor > 0 && r.refundedMinor < r.amountMinor;
  return { label: labelOf(r), overdue, partialRefund };
}

function labelOf(r: TrackingInput): TrackingLabel {
  // Échéance en brouillon : « Programmée » si l’opération est soumise (soumission automatique à venir), sinon « Brouillon ».
  if (r.status === 'DRAFT') return SCHEDULING_TX.includes(r.txStatus) ? 'SCHEDULED' : 'DRAFT';
  // Un litige ouvert prime : y compris sur une demande payée (le statut financier, lui, reste PAID).
  if (r.disputeOpen) return 'DISPUTED';
  switch (r.status) {
    case 'REJECTED': return 'REJECTED';
    case 'EXPIRED': return 'EXPIRED';
    case 'CANCELLED': return 'CANCELLED';
    case 'REFUNDED': return 'REFUNDED';
    case 'PAID': return 'PAID';
    case 'ACCEPTED': return r.attemptInProgress === false ? 'ACCEPTED' : 'PAYMENT_IN_PROGRESS';
    case 'INFO_REQUESTED': return 'INFO_REQUESTED';
    default: break;
  }
  // SUBMITTED : opération en revue, puis événements datés du payeur.
  if (r.txStatus === 'PENDING_REVIEW' || r.txStatus === 'IN_REVIEW') return 'AWAITING_VALIDATION';
  if (r.payerDocumentsViewedAt) return 'UNDER_REVIEW';
  if (r.firstViewedAt) return 'RECEIVED';
  return 'SUBMITTED';
}
