import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BENEFICIARY_REFERENCE_RE, DEFAULT_MODULES, checkBeneficiary, checkModule, findModule, isAllowedKind, isSensitiveKind } from '../src';

// Lot X version 2 (X6, K13) : bénéficiaire selon le module, pièces prévues, sensibilité. Miroir de 0022_lotx2_x6.sql.
const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0022_lotx2_x6.sql'), 'utf8');
const code = (f: () => unknown): string | undefined => { try { f(); return undefined; } catch (e) { return (e as { code?: string }).code; } };
const health = findModule('HEALTH');
const education = findModule('EDUCATION');

describe('X6 : bénéficiaire (K13)', () => {
  it('santé : référence seulement (majuscules), jamais un nom ; scolarité : nom', () => {
    expect(health?.beneficiaryMode).toBe('REFERENCE_ONLY');
    expect(checkBeneficiary(health, { reference: ' jd-07 ' })).toEqual({ reference: 'JD-07' });
    expect(code(() => checkBeneficiary(health, { name: 'Jean Dupont' }))).toBe('BENEFICIARY_NAME_NOT_ALLOWED');
    expect(code(() => checkBeneficiary(health, { reference: 'Jean Dupont' }))).toBe('BENEFICIARY_REFERENCE_INVALID');
    expect(code(() => checkBeneficiary(health, { reference: 'X'.repeat(17) }))).toBe('BENEFICIARY_REFERENCE_INVALID');
    expect(checkBeneficiary(education, { name: ' Awa ', reference: 'IGNORÉE' })).toEqual({ name: 'Awa' });
    expect(checkBeneficiary({ ...education!, beneficiaryMode: 'NONE' }, { reference: 'X1' })).toEqual({});
    expect(code(() => checkBeneficiary({ ...education!, beneficiaryMode: 'NONE' }, { name: 'Awa' }))).toBe('BENEFICIARY_NAME_NOT_ALLOWED');
  });
  it('même motif que la contrainte SQL', () => {
    expect(sql).toContain(`check (beneficiary_reference ~ '${BENEFICIARY_REFERENCE_RE.source}')`);
  });
});

describe('X6 : pièces prévues et sensibles', () => {
  it('santé : devis seul (sensible) ; pièce d’identité et certificat médical refusés', () => {
    expect(health?.requiredDocuments.map((d) => [d.kind, d.required, d.sensitivity])).toEqual([['QUOTE', true, 'SENSITIVE']]);
    expect(isAllowedKind(health, 'QUOTE')).toBe(true);
    expect(isAllowedKind(health, 'BENEFICIARY_ID')).toBe(false);
    expect(isAllowedKind(health, 'MEDICAL_CERTIFICATE')).toBe(false);
    expect(isAllowedKind(findModule('LAND'), 'EVIDENCE')).toBe(true);   // preuve de jalon (0023)
    expect(isSensitiveKind(health, 'QUOTE')).toBe(true);
    expect(isSensitiveKind(education, 'ENROLMENT_CERTIFICATE')).toBe(false);
    expect(isAllowedKind({ ...education!, requiredDocuments: [] }, 'N_IMPORTE_QUOI')).toBe(true);   // module sans liste
  });
  it('module invalide : sensibilité, mode de bénéficiaire ou durée de conservation inconnus', () => {
    const m = DEFAULT_MODULES[0]!;
    expect(code(() => checkModule({ ...m, beneficiaryMode: 'FULL_NAME' as never }))).toBe('VALIDATION');
    expect(code(() => checkModule({ ...m, retentionDays: 0 }))).toBe('VALIDATION');
    expect(code(() => checkModule({ ...m, requiredDocuments: [{ ...m.requiredDocuments[0]!, sensitivity: 'SECRET' as never }] }))).toBe('VALIDATION');
    expect(DEFAULT_MODULES.every((x) => x.retentionDays === undefined)).toBe(true);   // point ouvert 6
  });
});
