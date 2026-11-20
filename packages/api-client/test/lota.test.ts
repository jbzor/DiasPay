import { describe, expect, it } from 'vitest';
import { filterTransactions, isSent, isToPay, nextPayment, placeIn } from '../src';
import type { Transaction } from '../src';

const tx = (id: string, over: Partial<Transaction>): Transaction => ({
  id, vertical: 'HEALTH', settlementMode: 'DIRECT', purpose: '', amount: { amountMinor: 1000, currency: 'XAF' }, status: 'ACTIVE',
  providerName: '', beneficiaryName: '', createdAt: '2026-11-19T00:00:00.000Z',
  tranches: [{ id: `${id}-1`, seq: 1, label: '', amountMinor: 1000, status: 'SUBMITTED', releaseMode: 'PROVIDER_CONFIRM', contestHours: 0,
    evidenceCount: 0, fundsState: 'NONE', onHold: false, refundedMinor: 0 }],
  ...over,
});

// Lot A (T5) : place de l’utilisateur dans chaque opération, d’après ses parties (myRoles) et l’initiateur.
describe('placeIn (lot A, T5)', () => {
  const me = 'u-1';
  const sent = tx('a', { myRoles: ['REQUESTER'], initiatorId: me });
  const toPay = tx('b', { myRoles: ['PAYER'], initiatorId: 'u-2' });
  const own = tx('c', { myRoles: ['PAYER'], initiatorId: me });
  const provided = tx('d', { myRoles: ['PROVIDER'], initiatorId: 'u-2' });

  it('distingue initiateur, payeur et prestataire', () => {
    expect(placeIn(sent, me)).toEqual({ payer: false, initiator: true, provider: false });
    expect(placeIn(toPay, me)).toEqual({ payer: true, initiator: false, provider: false });
    expect(placeIn(own, me)).toEqual({ payer: true, initiator: true, provider: false });
    expect(placeIn(provided, me)).toEqual({ payer: false, initiator: false, provider: true });
    expect(placeIn(tx('e', {}), me)).toEqual({ payer: false, initiator: false, provider: false });   // aucune ligne : aucune action
    expect(placeIn(sent, undefined).initiator).toBe(false);
  });
  it('« À payer » et « Envoyées »', () => {
    const all = [sent, toPay, own, provided];
    expect(filterTransactions(all, 'TO_PAY', me).map((x) => x.id)).toEqual(['b', 'c']);
    expect(filterTransactions(all, 'SENT', me).map((x) => x.id)).toEqual(['a']);
    expect(isToPay(own, me) && !isSent(own, me)).toBe(true);
  });
  it('« À faire » de l’accueil : seulement les demandes à payer par l’utilisateur', () => {
    expect(nextPayment([sent, provided].filter((x) => isToPay(x, me)))).toBeUndefined();
    expect(nextPayment([sent, toPay].filter((x) => isToPay(x, me)))?.tx.id).toBe('b');
  });
});
