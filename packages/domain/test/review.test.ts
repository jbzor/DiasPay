import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DomainError, assertNoError, disputeDecisionError, evidenceDecisionError, validatorDecisionError } from '../src';

describe('décisions du bureau de contrôle (miroir de decide_tx, decide_tranche, resolve_dispute)', () => {
  it('dossier : approbation seulement avec la case de vérification du montant (D6)', () => {
    expect(validatorDecisionError({ approved: true, amountChecked: false })).toBe('AMOUNT_NOT_CHECKED');
    expect(validatorDecisionError({ approved: true, amountChecked: true })).toBeNull();
  });
  it('dossier : rejet seulement avec un motif de 3 caractères (espaces ignorés)', () => {
    expect(validatorDecisionError({ approved: false, amountChecked: true, reason: '  ' })).toBe('REASON_REQUIRED');
    expect(validatorDecisionError({ approved: false, amountChecked: false, reason: ' ok ' })).toBe('REASON_REQUIRED');
    expect(validatorDecisionError({ approved: false, amountChecked: false, reason: 'Devis illisible' })).toBeNull();
  });
  it('preuve : motif obligatoire au rejet', () => {
    expect(evidenceDecisionError({ approved: false, reason: '' })).toBe('REASON_REQUIRED');
    expect(evidenceDecisionError({ approved: true })).toBeNull();
  });
  it('litige : issue connue et note obligatoire', () => {
    expect(disputeDecisionError({ outcome: 'PARTAGE', note: 'Note' })).toBe('INVALID_OUTCOME');
    expect(disputeDecisionError({ outcome: 'REFUND_FULL', note: '' })).toBe('REASON_REQUIRED');
    expect(disputeDecisionError({ outcome: 'FUNDS_RELEASED', note: 'Prestation attestée' })).toBeNull();
    // Lot X v2 : les anciennes issues n’existent plus.
    expect(disputeDecisionError({ outcome: 'REFUND_PAYER', note: 'Note' })).toBe('INVALID_OUTCOME');
  });
  it('assertNoError lève une DomainError au code stable', () => {
    expect(() => assertNoError('AMOUNT_NOT_CHECKED')).toThrow(DomainError);
    expect(() => assertNoError(null)).not.toThrow();
  });
  it('mêmes seuils et codes que la base (0006_lot5.sql)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0006_lot5.sql'), 'utf8');
    expect(sql).toMatch(/if not p_approved and coalesce\(length\(v_reason\), 0\) < 3 then perform _err\('REASON_REQUIRED'/);
    expect(sql).toMatch(/if p_approved and not coalesce\(p_amount_checked, false\) then\s+perform _err\('AMOUNT_NOT_CHECKED'/);
  });
});
