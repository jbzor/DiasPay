import { describe, expect, it } from 'vitest';
import { tokenReissueClosed } from '../src';

// Lot A (T2) : miroir de _token_reissue_closed (0032).
describe('tokenReissueClosed (lot A, T2)', () => {
  it('refuse toute demande terminée, quel que soit le mode', () => {
    for (const s of ['REJECTED', 'EXPIRED', 'CANCELLED', 'REFUNDED'] as const) {
      expect(tokenReissueClosed(s, 'DIRECT', 'NONE')).toBe(true);
      expect(tokenReissueClosed(s, 'CONDITIONAL', 'HELD')).toBe(true);
    }
  });
  it('DIRECT : payée = terminée', () => {
    expect(tokenReissueClosed('PAID', 'DIRECT', 'NONE')).toBe(true);
  });
  it('CONDITIONAL : payée, fonds bloqués = confirmation en cours (réémission permise) ; fonds traités = terminée', () => {
    expect(tokenReissueClosed('PAID', 'CONDITIONAL', 'HELD')).toBe(false);
    expect(tokenReissueClosed('PAID', 'CONDITIONAL', 'RELEASED')).toBe(true);
    expect(tokenReissueClosed('PAID', 'CONDITIONAL', 'RETURNED')).toBe(true);
  });
  it('avant paiement : permise', () => {
    for (const s of ['SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED'] as const) expect(tokenReissueClosed(s, 'DIRECT', 'NONE')).toBe(false);
  });
});

// Lot A (T6) : libellés de suivi du Dr (livrable 6).
import { TRACKING_LABELS, isOverdue, trackingLabel } from '../src';
import type { TrackingInput } from '../src';

describe('trackingLabel (lot A, T6)', () => {
  const now = new Date(2026, 10, 19, 12);   // 19 novembre 2026, heure locale
  const base: TrackingInput = { status: 'SUBMITTED', txStatus: 'ACTIVE', amountMinor: 1000, refundedMinor: 0, disputeOpen: false };
  const L = (over: Partial<TrackingInput>) => trackingLabel({ ...base, ...over }, now).label;

  it('chaque libellé', () => {
    expect(L({ status: 'DRAFT', txStatus: 'DRAFT' })).toBe('DRAFT');
    expect(L({})).toBe('SUBMITTED');
    expect(L({ firstViewedAt: '2026-11-18T10:00:00Z' })).toBe('RECEIVED');
    expect(L({ firstViewedAt: '2026-11-18T10:00:00Z', payerDocumentsViewedAt: '2026-11-18T11:00:00Z' })).toBe('UNDER_REVIEW');
    expect(L({ status: 'INFO_REQUESTED' })).toBe('INFO_REQUESTED');
    expect(L({ txStatus: 'PENDING_REVIEW' })).toBe('AWAITING_VALIDATION');
    expect(L({ txStatus: 'IN_REVIEW', firstViewedAt: '2026-11-18T10:00:00Z' })).toBe('AWAITING_VALIDATION');
    expect(L({ status: 'ACCEPTED', attemptInProgress: false })).toBe('ACCEPTED');
    expect(L({ status: 'ACCEPTED' })).toBe('PAYMENT_IN_PROGRESS');
    expect(L({ status: 'PAID' })).toBe('PAID');
    expect(L({ disputeOpen: true })).toBe('DISPUTED');
    expect(L({ status: 'REJECTED' })).toBe('REJECTED');
    expect(L({ status: 'EXPIRED' })).toBe('EXPIRED');
    expect(L({ status: 'CANCELLED' })).toBe('CANCELLED');
    expect(L({ status: 'REFUNDED', refundedMinor: 1000 })).toBe('REFUNDED');
  });
  it('« Notification envoyée » n’existe pas : sans canal externe, la demande reste soumise', () => {
    expect(TRACKING_LABELS).not.toContain('NOTIFICATION_SENT');
    expect(TRACKING_LABELS).toHaveLength(15);   // 14 du lot A (T6) + « Programmée » (T8b)
  });
  it('litige sur une demande payée : « Contestée », le statut reste payé', () => {
    const r = trackingLabel({ ...base, status: 'PAID', disputeOpen: true }, now);
    expect(r).toEqual({ label: 'DISPUTED', overdue: false, partialRefund: false });
    expect(L({ status: 'DRAFT', txStatus: 'DRAFT', disputeOpen: true })).toBe('DRAFT');
  });
  it('en retard : impayée, non finale, échéance passée', () => {
    expect(trackingLabel({ ...base, dueDate: '2026-11-18' }, now)).toMatchObject({ label: 'SUBMITTED', overdue: true });
    expect(trackingLabel({ ...base, dueDate: '2026-11-19' }, now).overdue).toBe(false);   // le jour même : pas encore
    expect(trackingLabel({ ...base, status: 'INFO_REQUESTED', dueDate: '2026-11-01' }, now).overdue).toBe(true);
    expect(trackingLabel({ ...base, status: 'ACCEPTED', dueDate: '2026-11-01' }, now).overdue).toBe(true);
    for (const s of ['PAID', 'REFUNDED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'DRAFT'] as const) expect(isOverdue(s, '2026-11-01', now), s).toBe(false);
    expect(isOverdue('SUBMITTED', undefined, now)).toBe(false);
  });
  it('remboursement partiel ou total', () => {
    expect(trackingLabel({ ...base, status: 'REFUNDED', refundedMinor: 400 }, now)).toMatchObject({ label: 'REFUNDED', partialRefund: true });
    expect(trackingLabel({ ...base, status: 'REFUNDED', refundedMinor: 1000 }, now).partialRefund).toBe(false);
  });
});

// Lot A (T8b) : « Programmée » (livrable 6, indicateurs des échéanciers).
describe('trackingLabel : échéance programmée (lot A, T8b)', () => {
  const now = new Date(2026, 10, 19, 12);
  const draft: TrackingInput = { status: 'DRAFT', txStatus: 'ACTIVE', amountMinor: 1000, refundedMinor: 0, disputeOpen: false, dueDate: '2027-01-15' };
  it('échéance en brouillon d’une opération soumise : « Programmée », jamais en retard', () => {
    expect(trackingLabel(draft, now)).toEqual({ label: 'SCHEDULED', overdue: false, partialRefund: false });
    expect(trackingLabel({ ...draft, txStatus: 'PENDING_REVIEW' }, now).label).toBe('SCHEDULED');
    expect(trackingLabel({ ...draft, txStatus: 'IN_REVIEW' }, now).label).toBe('SCHEDULED');
    expect(trackingLabel({ ...draft, dueDate: undefined }, now).label).toBe('SCHEDULED');   // jalon après le précédent
    expect(trackingLabel({ ...draft, dueDate: '2026-11-01' }, now).overdue).toBe(false);
  });
  it('opération encore en brouillon (ou suspendue, close, annulée) : « Brouillon »', () => {
    for (const s of ['DRAFT', 'SUSPENDED', 'CLOSED', 'CANCELLED'] as const) expect(trackingLabel({ ...draft, txStatus: s }, now).label, s).toBe('DRAFT');
  });
  it('une échéance soumise n’est plus programmée', () => {
    expect(trackingLabel({ ...draft, status: 'SUBMITTED' }, now).label).toBe('SUBMITTED');
  });
});
