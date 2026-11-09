import { describe, expect, it } from 'vitest';
import type { ReferenceInfo } from '@diaspay/api-client';
import { linkDestination } from '../src/features/links/destination';

const NOW = Date.parse('2026-11-08T10:00:00Z');
const REF = '4f9a2c71b8e01d3ca9';
const info = (over: Partial<ReferenceInfo> = {}): ReferenceInfo => ({
  trancheId: 'tr-2', txId: 'tx-1', label: 'T1', amountMinor: 1, currency: 'XAF', status: 'AWAITING_PAYMENT',
  expiresAt: '2026-11-15T10:00:00Z', used: false, providerName: 'P', beneficiaryName: 'B', purpose: 'X', seq: 2, contestHours: 72, ...over,
});

describe('destination d’un lien /t/<référence>', () => {
  it('payeur + à payer → paiement', () => expect(linkDestination(info(), REF, 'PAYER', NOW)).toEqual({ kind: 'pay', trancheId: 'tr-2' }));
  it('prestataire + payée → confirmation', () => expect(linkDestination(info({ status: 'PAID_LOCKED' }), REF, 'PROVIDER', NOW)).toEqual({ kind: 'confirm', reference: REF }));
  it('autre état → détail de la transaction', () => {
    expect(linkDestination(info({ status: 'PAID_LOCKED' }), REF, 'PAYER', NOW)).toEqual({ kind: 'detail', txId: 'tx-1', trancheId: 'tr-2' });
    expect(linkDestination(info({ status: 'AWAITING_PAYMENT' }), REF, 'PROVIDER', NOW)).toMatchObject({ kind: 'detail' });
    expect(linkDestination(info({ status: 'CONFIRMED', used: true }), REF, 'PROVIDER', NOW)).toMatchObject({ kind: 'detail' });
    expect(linkDestination(info({ status: 'PAID_LOCKED', used: true }), REF, 'PROVIDER', NOW)).toMatchObject({ kind: 'detail' });
  });
  it('référence expirée → écran d’information', () => {
    expect(linkDestination(info({ expiresAt: '2026-11-08T09:59:59Z' }), REF, 'PAYER', NOW)).toEqual({ kind: 'invalid' });
  });
});
