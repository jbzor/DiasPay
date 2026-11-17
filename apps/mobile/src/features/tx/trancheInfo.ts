import type { Tranche, Transaction } from '@diaspay/api-client';

// Écran de l’opération : ligne d’état d’une demande de paiement (logique pure, testée — lot X-C, T2).

/** Formateurs injectés par l’écran (useI18n) : dates locales, montants, clé i18n de repli d’un statut. */
export interface TrancheInfoFormat {
  date: (iso: string) => string;
  dateTime: (iso: string) => string;
  /** Montant dans la devise de l’opération. */
  money: (amountMinor: number) => string;
  /** Clé de repli : libellé générique du statut (trancheStatusKey de l’i18n). */
  statusKey: (s: Tranche['status']) => string;
}

/** Clé i18n (vide : rien à afficher) et paramètres de la ligne d’état. */
export interface TrancheInfo { key: string; params?: Record<string, string | number> }

/**
 * Ligne d’état sous le titre de la demande. Lot X-C (T2) : ACCEPTED, c’est un paiement en cours de confirmation
 * (tentative INITIATED ou PENDING) — hors démonstration, l’événement du partenaire, reçu par le temps réel,
 * fera passer la demande à PAID.
 */
export function trancheInfo(tx: Transaction, tr: Tranche, f: TrancheInfoFormat): TrancheInfo {
  const conditional = tx.settlementMode === 'CONDITIONAL';
  const held = conditional && tr.status === 'PAID' && tr.fundsState === 'HELD';
  return tr.onHold ? { key: 'disputed' }
    : tr.status === 'DRAFT' ? (tr.dueDate ? { key: 'plannedOn', params: { date: f.date(tr.dueDate) } } : { key: 'milestone' })
    : tr.status === 'SUBMITTED' ? (tr.dueDate ? { key: 'payBefore', params: { date: f.date(tr.dueDate) } } : { key: '' })
    : tr.status === 'ACCEPTED' ? { key: 'paymentPending' }
    : tr.status === 'PAID' && !conditional ? { key: 'paidOn', params: { date: tr.paidAt ? f.date(tr.paidAt) : '' } }
    : tr.status === 'REFUNDED' ? (tr.refundedMinor < tr.amountMinor
      ? { key: 'refundedPartial', params: { amount: f.money(tr.refundedMinor) } } : { key: 'refundedFull' })
    // Déblocage conditionnel : logique de confirmation et de délai de contestation, sur l’état des fonds.
    : tr.fundsState === 'RELEASED' ? { key: 'releasedOn', params: { date: tr.releasedAt ? f.date(tr.releasedAt) : '' } }
    : tr.fundsState === 'RETURNED' ? { key: 'fundsReturned' }
    : held && tr.confirmedAt ? (tr.contestEndsAt ? { key: 'confirmedAuto', params: { date: f.dateTime(tr.contestEndsAt) } } : { key: 'trPaid' })
    : held && tr.releaseMode === 'EVIDENCE_REVIEW' && tr.evidenceCount > 0 ? { key: 'evidencePending' }
    : held ? { key: tr.releaseMode === 'PAYER_CONFIRM' ? 'awaitingPayerConfirm' : 'awaitingProvider' }
    : { key: f.statusKey(tr.status) };
}
