import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_ENROLMENT_LIMITS, ENROLMENT_DOCUMENT_KINDS, ENROLMENT_LEVELS, ENROLMENT_REQUIREMENTS, SimulatedKycAdapter, applyKycResult, checkEnrolmentSubmission,
  checkInitiation, checkLimits, enrolmentRoute, requiredLevelToInitiate,
} from '../src';
import type { EnrolmentLevel } from '../src';

// Lot X version 2 (X4) : enrôlement et plafonds, miroir de 0020_lotx2_x4.sql.
const sql = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0020_lotx2_x4.sql'), 'utf8');
const code = (f: () => unknown): string | undefined => { try { f(); return undefined; } catch (e) { return (e as { code?: string }).code; } };
const doc = (kind: string, uid = 'u1') => ({ kind, path: `${uid}/${kind.toLowerCase()}.jpg` });

describe('X4 : niveaux et initiation', () => {
  it('niveau requis : demandeur N1, prestataire N2, payeur N0 (parité avec _required_level)', () => {
    expect(requiredLevelToInitiate('REQUESTER')).toBe('N1');
    expect(requiredLevelToInitiate('PROVIDER')).toBe('N2');
    expect(requiredLevelToInitiate('PAYER')).toBe('N0');
    expect(sql).toContain("select case p_role when 'PROVIDER' then 'N2' when 'REQUESTER' then 'N1' else 'N0' end");
  });

  it('chaque niveau, chaque rôle : accepté exactement à partir du niveau requis', () => {
    for (const role of ['PAYER', 'REQUESTER', 'PROVIDER'] as const) {
      for (const level of ENROLMENT_LEVELS) {
        const ok = ENROLMENT_LEVELS.indexOf(level) >= ENROLMENT_LEVELS.indexOf(requiredLevelToInitiate(role));
        expect(code(() => checkInitiation(level, role))).toBe(ok ? undefined : 'ENROLMENT_REQUIRED');
      }
    }
    expect(code(() => checkInitiation(undefined, 'REQUESTER'))).toBe('ENROLMENT_REQUIRED');   // défaut N0
  });

  it('pièces exigées par niveau (parité avec _enrolment_required_kinds) et types connus du SQL', () => {
    for (const [level, kinds] of Object.entries(ENROLMENT_REQUIREMENTS)) {
      expect(sql).toContain(`when '${level}' then array[${kinds.map((k) => `'${k}'`).join(',')}]`);
    }
    expect(sql).toContain(`check (kind in (${ENROLMENT_DOCUMENT_KINDS.map((k) => `'${k}'`).join(',')}))`);
    expect(enrolmentRoute('N1')).toBe('KYC');
    expect(enrolmentRoute('N2')).toBe('KYC');
    expect(enrolmentRoute('N3')).toBe('MANUAL');
  });
});

describe('X4 : soumission d’un dossier', () => {
  const base = { userId: 'u1', current: 'N0' as EnrolmentLevel, hasOpenCase: false };
  it('mêmes refus que submit_enrolment, dans le même ordre', () => {
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N9', documents: [] }))).toBe('VALIDATION');
    expect(code(() => checkEnrolmentSubmission({ ...base, current: 'N1', requested: 'N1', documents: [] }))).toBe('ALREADY_ENROLLED');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N2', documents: [doc('BUSINESS_REGISTRATION'), doc('ACTIVITY_PROOF')] }))).toBe('ENROLMENT_REQUIRED');
    expect(code(() => checkEnrolmentSubmission({ ...base, hasOpenCase: true, requested: 'N1', documents: [] }))).toBe('ENROLMENT_PENDING');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N1', documents: [] }))).toBe('VALIDATION');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N1', documents: [doc('ID_DOCUMENT', 'u2'), doc('SELFIE')] }))).toBe('VALIDATION');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N1', documents: [{ kind: 'SELFIE', path: 'u1/../u2/x.jpg' }, doc('ID_DOCUMENT')] }))).toBe('VALIDATION');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N1', documents: [{ ...doc('SELFIE'), contentHash: 'abc' }, doc('ID_DOCUMENT')] }))).toBe('HASH_INVALID');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N1', documents: [doc('ID_DOCUMENT')] }))).toBe('DOCUMENT_REQUIRED');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N1', documents: [doc('ID_DOCUMENT'), doc('SELFIE'), doc('PASSEPORT_VOLE')] }))).toBe('VALIDATION');
    expect(code(() => checkEnrolmentSubmission({ ...base, requested: 'N1', documents: [doc('ID_DOCUMENT'), doc('SELFIE')] }))).toBeUndefined();
    expect(code(() => checkEnrolmentSubmission({ ...base, current: 'N1', requested: 'N3', documents: [doc('LEGAL_DOCUMENTS'), doc('REPRESENTATIVE_MANDATE')] }))).toBeUndefined();
  });

  it('adaptateur KYC simulé : résultat configurable ; un dossier tranché ne change plus', async () => {
    const kyc = new SimulatedKycAdapter({ result: (i) => (i.userId === 'mauvais' ? 'REJECTED' : 'REVIEW') });
    expect((await kyc.check({ caseId: 'c', userId: 'u', level: 'N1', documents: [] })).result).toBe('REVIEW');
    const r = await kyc.check({ caseId: 'c', userId: 'mauvais', level: 'N1', documents: [] });
    expect(r).toMatchObject({ result: 'REJECTED', provider: 'SIMULATED' });
    expect(r.reason).toBeTruthy();
    expect((await new SimulatedKycAdapter().check({ caseId: 'c', userId: 'u', level: 'N2', documents: [] })).result).toBe('APPROVED');
    expect(applyKycResult('SUBMITTED', 'APPROVED')).toBe('APPROVED');
    expect(applyKycResult('SUBMITTED', 'REVIEW')).toBe('SUBMITTED');
    expect(applyKycResult('APPROVED', 'REJECTED')).toBe('APPROVED');
    expect(applyKycResult('REJECTED', 'APPROVED')).toBe('REJECTED');
  });
});

describe('X4 : plafonds (point ouvert 1)', () => {
  const ctx = { level: 'N1' as EnrolmentLevel, currency: 'XAF' as const, amountMinor: 1_000, usedTodayMinor: 0, usedThisMonthMinor: 0 };
  it('ligne absente : refus prudent, sauf réglage explicite ALLOW', () => {
    expect(code(() => checkLimits({ ...ctx, limit: undefined }))).toBe('LIMITS_NOT_CONFIGURED');
    expect(code(() => checkLimits({ ...ctx, limit: undefined, whenMissing: 'ALLOW' }))).toBeUndefined();
    expect(sql).toContain("coalesce((select value from app_config where key = 'limits_when_missing'), 'REFUSE') = 'ALLOW'");
  });
  it('par paiement, puis jour, puis mois ; valeur absente : pas de plafond', () => {
    const limit = { level: 'N1' as const, currency: 'XAF' as const, perOperationMinor: 1_000, perDayMinor: 1_500, perMonthMinor: 3_000 };
    expect(code(() => checkLimits({ ...ctx, limit }))).toBeUndefined();
    expect(code(() => checkLimits({ ...ctx, limit, amountMinor: 1_001 }))).toBe('LIMIT_EXCEEDED');
    expect(code(() => checkLimits({ ...ctx, limit, usedTodayMinor: 600 }))).toBe('LIMIT_EXCEEDED');
    expect(code(() => checkLimits({ ...ctx, limit, usedTodayMinor: 500 }))).toBeUndefined();
    expect(code(() => checkLimits({ ...ctx, limit, usedThisMonthMinor: 2_001 }))).toBe('LIMIT_EXCEEDED');
    expect(code(() => checkLimits({ ...ctx, limit: { level: 'N1', currency: 'XAF' }, amountMinor: 10 ** 12 }))).toBeUndefined();
  });
  it('lignes de développement : tous niveaux et devises, aucun nombre (comme l’amorçage mock_mode)', () => {
    expect(DEV_ENROLMENT_LIMITS).toHaveLength(12);
    expect(DEV_ENROLMENT_LIMITS.every((l) => l.devOnly && l.perOperationMinor === undefined && l.perDayMinor === undefined && l.perMonthMinor === undefined)).toBe(true);
    expect(sql).toContain("unnest(array['N0','N1','N2','N3']) l, unnest(array['XAF','EUR','USD']) c");
  });
});
