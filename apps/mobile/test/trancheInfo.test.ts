import { describe, expect, it } from 'vitest';
import type { Tranche, Transaction } from '@diaspay/api-client';
import { trancheInfo } from '../src/features/tx/trancheInfo';
import type { TrancheInfoFormat } from '../src/features/tx/trancheInfo';
import { en, fr } from '../src/i18n/messages';

// Lot X-C (T2) : ligne d’état d’une demande sur l’écran de l’opération. Le cas central est ACCEPTED :
// tentative en cours (hors démonstration, l’événement du partenaire la confirmera par le temps réel).

const f: TrancheInfoFormat = {
  date: (iso) => `d:${iso}`,
  dateTime: (iso) => `h:${iso}`,
  money: (m) => `${m} XAF`,
  statusKey: (s) => `statut:${s}`,
};
const tx = (settlementMode: 'DIRECT' | 'CONDITIONAL') => ({ settlementMode }) as Transaction;
const tr = (over: Partial<Tranche>): Tranche => ({
  id: 'tr1', seq: 1, label: '', amountMinor: 180_000, status: 'SUBMITTED', releaseMode: 'PAYER_CONFIRM',
  contestHours: 0, evidenceCount: 0, fundsState: 'NONE', onHold: false, refundedMinor: 0, ...over,
}) as Tranche;

describe('ligne d’état d’une demande (trancheInfo)', () => {
  it('ACCEPTED : paiement en cours de confirmation, en règlement direct comme conditionnel', () => {
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'ACCEPTED' }), f)).toEqual({ key: 'paymentPending' });
    expect(trancheInfo(tx('CONDITIONAL'), tr({ status: 'ACCEPTED' }), f)).toEqual({ key: 'paymentPending' });
    expect(fr.paymentPending).toBeTruthy();
    expect(en.paymentPending).toBeTruthy();
  });

  it('litige d’abord, puis échéances et paiement', () => {
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'ACCEPTED', onHold: true }), f).key).toBe('disputed');
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'DRAFT', dueDate: '2026-12-01' }), f)).toEqual({ key: 'plannedOn', params: { date: 'd:2026-12-01' } });
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'DRAFT' }), f).key).toBe('milestone');
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'SUBMITTED', dueDate: '2026-12-01' }), f)).toEqual({ key: 'payBefore', params: { date: 'd:2026-12-01' } });
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'SUBMITTED' }), f).key).toBe('');
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'PAID', paidAt: '2026-11-16T10:00:00Z' }), f)).toEqual({ key: 'paidOn', params: { date: 'd:2026-11-16T10:00:00Z' } });
  });

  it('remboursements : partiel avec montant, total sans', () => {
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'REFUNDED', refundedMinor: 50_000 }), f)).toEqual({ key: 'refundedPartial', params: { amount: '50000 XAF' } });
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'REFUNDED', refundedMinor: 180_000 }), f).key).toBe('refundedFull');
  });

  it('déblocage conditionnel : fonds bloqués, confirmés, libérés ou rendus', () => {
    const c = tx('CONDITIONAL');
    expect(trancheInfo(c, tr({ status: 'PAID', fundsState: 'HELD' }), f).key).toBe('awaitingPayerConfirm');
    expect(trancheInfo(c, tr({ status: 'PAID', fundsState: 'HELD', releaseMode: 'PROVIDER_CONFIRM' }), f).key).toBe('awaitingProvider');
    expect(trancheInfo(c, tr({ status: 'PAID', fundsState: 'HELD', releaseMode: 'EVIDENCE_REVIEW', evidenceCount: 1 }), f).key).toBe('evidencePending');
    expect(trancheInfo(c, tr({ status: 'PAID', fundsState: 'HELD', confirmedAt: 'x', contestEndsAt: '2026-11-18T10:00:00Z' }), f))
      .toEqual({ key: 'confirmedAuto', params: { date: 'h:2026-11-18T10:00:00Z' } });
    expect(trancheInfo(c, tr({ status: 'PAID', fundsState: 'RELEASED', releasedAt: '2026-11-17' }), f)).toEqual({ key: 'releasedOn', params: { date: 'd:2026-11-17' } });
    expect(trancheInfo(c, tr({ status: 'PAID', fundsState: 'RETURNED' }), f).key).toBe('fundsReturned');
  });

  it('repli : clé générique du statut', () => {
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'REJECTED' }), f).key).toBe('statut:REJECTED');
    expect(trancheInfo(tx('DIRECT'), tr({ status: 'EXPIRED' }), f).key).toBe('statut:EXPIRED');
  });
});
