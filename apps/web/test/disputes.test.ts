import { describe, expect, it } from 'vitest';
import { DISPUTE_OUTCOMES, DISPUTE_STATUSES } from '@diaspay/domain';
import { availableOutcomes, disputeInputError, isOpenDispute } from '@/lib/disputes';
import { tMaybe } from '@/i18n';

const paid = { trancheStatus: 'PAID', amountMinor: 300_000, refundedMinor: 0, settlementMode: 'DIRECT', fundsState: 'NONE' };

describe('litiges (lot X v2) : issues proposées, miroir de _resolve_dispute_v2', () => {
  it('« ouvert » couvre OPEN, AWAITING_RESPONSE et IN_MEDIATION', () => {
    expect(DISPUTE_STATUSES.filter(isOpenDispute)).toEqual(['OPEN', 'AWAITING_RESPONSE', 'IN_MEDIATION']);
  });
  it('avant paiement : clôture sans suite seulement', () => {
    for (const s of ['SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED']) expect(availableOutcomes({ ...paid, trancheStatus: s })).toEqual(['NO_ACTION']);
  });
  it('règlement direct payé : remboursement total ou partiel, jamais de libération ni de retour des fonds', () => {
    expect(availableOutcomes(paid)).toEqual(['NO_ACTION', 'REFUND_FULL', 'REFUND_PARTIAL']);
    expect(availableOutcomes({ ...paid, trancheStatus: 'REFUNDED', refundedMinor: 300_000 })).toEqual(['NO_ACTION']);
    expect(availableOutcomes({ ...paid, refundedMinor: 100_000 })).toContain('REFUND_PARTIAL');
  });
  it('règlement conditionnel, fonds bloqués : libération ou retour des fonds en plus ; fonds déjà libérés : non', () => {
    const held = { ...paid, settlementMode: 'CONDITIONAL', fundsState: 'HELD' };
    expect(availableOutcomes(held)).toEqual(['NO_ACTION', 'REFUND_FULL', 'REFUND_PARTIAL', 'FUNDS_RELEASED', 'FUNDS_RETURNED']);
    expect(availableOutcomes({ ...held, fundsState: 'RELEASED' })).not.toContain('FUNDS_RELEASED');
  });
  it('saisie : note obligatoire, montant du remboursement partiel positif et au plus le restant', () => {
    expect(disputeInputError({ outcome: 'NO_ACTION', note: ' a ' })).toBe('REASON_REQUIRED');
    expect(disputeInputError({ outcome: 'REFUND_FULL', note: 'Remboursement' })).toBeNull();
    expect(disputeInputError({ outcome: 'REFUND_PARTIAL', note: 'Partiel', amountMinor: null })).toBe('AMOUNT_INVALID');
    expect(disputeInputError({ outcome: 'REFUND_PARTIAL', note: 'Partiel', amountMinor: 400_000, remainingMinor: 300_000 })).toBe('REFUND_EXCEEDS_PAID');
    expect(disputeInputError({ outcome: 'REFUND_PARTIAL', note: 'Partiel', amountMinor: 100_000, remainingMinor: 300_000 })).toBeNull();
  });
  it('chaque statut et chaque issue a ses libellés', () => {
    for (const s of DISPUTE_STATUSES) expect(tMaybe(`litiges.status.${s}`)).not.toBeNull();
    for (const o of DISPUTE_OUTCOMES) {
      for (const k of ['outcome', 'result', 'confirmTitle', 'confirm', 'confirmWord', 'done']) expect(tMaybe(`litiges.${k}.${o}`), `${k}.${o}`).not.toBeNull();
    }
  });
});
