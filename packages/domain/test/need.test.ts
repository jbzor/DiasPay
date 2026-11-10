import { describe, expect, it } from 'vitest';
import {
  DomainError, MAX_FILE_BYTES, REQUIRED_DOCUMENTS, buildInstallmentsPlan, buildPartialPlan, buildRecurringPlan, buildSinglePlan,
  checkFile, defaultInstallmentDates, describeRelease, firstInvalidStep, formatAmountInput, missingRequiredDocuments, parseAmountInput,
  planSum, shouldActivateTranche, validateNeed, validateStep,
} from '../src';
import type { DraftDocument, NeedContext, NeedDraft } from '../src';

const ctx: NeedContext = { today: '2026-11-10', creatorRole: 'PAYER' };
const doc = (kind: DraftDocument['kind'], status: DraftDocument['status'] = 'UPLOADED'): DraftDocument =>
  ({ id: `d-${kind}`, kind, name: `${kind}.pdf`, mimeType: 'application/pdf', sizeBytes: 1000, status });

const health = (over: Partial<NeedDraft> = {}): NeedDraft => ({
  id: 'n1', vertical: 'HEALTH', amountMinor: 180_000, currency: 'XAF', purpose: 'Opération du genou', beneficiaryName: 'Rose M.',
  desiredDate: '2026-11-15', provider: { id: 'p-hc', name: 'Hôpital Central' }, planType: 'SINGLE',
  tranches: [{ label: 'Soins', amountMinor: 180_000, dueDate: '2026-11-15' }],
  documents: [doc('QUOTE'), doc('BENEFICIARY_ID')], updatedAt: '2026-11-10T08:00:00Z', ...over,
});
const codes = (d: NeedDraft, step: Parameters<typeof validateStep>[0], c = ctx) => validateStep(step, d, c).map((i) => i.code);

describe('saisie du montant', () => {
  it('lit les séparateurs selon la langue', () => {
    expect(parseAmountInput('180 000', 'XAF', 'fr')).toBe(180_000);
    expect(parseAmountInput('1 250,50', 'EUR', 'fr')).toBe(125_050);
    expect(parseAmountInput('1,250.5', 'USD', 'en')).toBe(125_050);
    expect(parseAmountInput('12.5', 'EUR', 'fr')).toBe(1_250);
  });
  it('FCFA sans décimale, EUR et USD jusqu’à 2 décimales', () => {
    expect(() => parseAmountInput('100,5', 'XAF', 'fr')).toThrow(expect.objectContaining({ code: 'AMOUNT_DECIMALS' }));
    expect(() => parseAmountInput('10,123', 'EUR', 'fr')).toThrow(expect.objectContaining({ code: 'AMOUNT_DECIMALS' }));
    expect(parseAmountInput('100,00', 'XAF', 'fr')).toBe(100);
  });
  it('refuse vide, zéro, négatif et texte', () => {
    for (const bad of ['', '0', '-5', 'abc', '1,2,3']) {
      expect(() => parseAmountInput(bad, 'EUR', 'fr')).toThrow(expect.objectContaining({ code: 'AMOUNT_INVALID' }));
    }
  });
  it('formate pour la saisie', () => {
    expect(formatAmountInput(180_000, 'XAF', 'fr').replace(/\s/g, ' ')).toBe('180 000');
    expect(formatAmountInput(125_050, 'EUR', 'en')).toBe('1,250.5');
  });
});

describe('étape 1 : type', () => {
  it('exige une verticale de la vague 1', () => {
    expect(codes({ ...health(), vertical: undefined }, 'type')).toEqual(['VERTICAL_REQUIRED']);
    expect(codes(health({ vertical: 'LAND' }), 'type')).toEqual(['VERTICAL_UNAVAILABLE']);
    expect(codes(health(), 'type')).toEqual([]);
  });
});

describe('étape 2 : détails', () => {
  it('montant entier strictement positif', () => {
    expect(codes(health({ amountMinor: undefined }), 'details')).toContain('AMOUNT_REQUIRED');
    expect(codes(health({ amountMinor: 0 }), 'details')).toContain('AMOUNT_INVALID');
    expect(codes(health({ amountMinor: 10.5 }), 'details')).toContain('AMOUNT_INVALID');
  });
  it('objectif entre 3 et 500 caractères', () => {
    expect(codes(health({ purpose: ' ab ' }), 'details')).toEqual(['PURPOSE_TOO_SHORT']);
    expect(codes(health({ purpose: 'x'.repeat(501) }), 'details')).toEqual(['PURPOSE_TOO_LONG']);
    expect(codes(health({ purpose: 'x'.repeat(500) }), 'details')).toEqual([]);
  });
  it('bénéficiaire obligatoire', () => {
    expect(codes(health({ beneficiaryName: '  ' }), 'details')).toEqual(['BENEFICIARY_REQUIRED']);
  });
  it('date souhaitée facultative, pas dans le passé', () => {
    expect(codes(health({ desiredDate: undefined }), 'details')).toEqual([]);
    expect(codes(health({ desiredDate: '2026-11-09' }), 'details')).toEqual(['DATE_IN_PAST']);
    expect(codes(health({ desiredDate: '2026-11-10' }), 'details')).toEqual([]);
    expect(codes(health({ desiredDate: '2026-02-30' }), 'details')).toEqual(['DATE_INVALID']);
  });
  it('un demandeur indique le téléphone du payeur, normalisé comme à la connexion', () => {
    const req = { ...ctx, creatorRole: 'REQUESTER' as const };
    expect(codes(health(), 'details', req)).toEqual(['PAYER_PHONE_REQUIRED']);
    expect(codes(health({ counterpartyPhone: '0612345678' }), 'details', req)).toEqual(['PHONE_INVALID']);
    expect(codes(health({ counterpartyPhone: '+33 6 12 34 56 78' }), 'details', req)).toEqual([]);
  });
});

describe('étape 3 : prestataire', () => {
  it('choisi ou invité par téléphone valide', () => {
    expect(codes(health({ provider: undefined }), 'provider')).toEqual(['PROVIDER_REQUIRED']);
    expect(codes(health({ provider: { name: 'Dr Mbe', invitedPhone: '+237 699 00 11 22' } }), 'provider')).toEqual([]);
    expect(codes(health({ provider: { name: 'Dr Mbe', invitedPhone: '699' } }), 'provider')).toEqual(['PHONE_INVALID']);
    expect(codes(health({ provider: { name: ' ', invitedPhone: '+237699001122' } }), 'provider')).toEqual(['PROVIDER_NAME_REQUIRED']);
  });
});

describe('étape 4 : plan', () => {
  it('contrôle la somme avec l’écart', () => {
    const issues = validateStep('plan', health({ tranches: [{ label: 'Soins', amountMinor: 170_000, dueDate: '2026-11-15' }] }), ctx);
    expect(issues).toEqual([{ path: 'tranches', code: 'PLAN_SUM_MISMATCH', params: { sum: 170_000, total: 180_000, gap: 10_000 } }]);
  });
  it('dates en ordre croissant, la première pas dans le passé, toutes renseignées', () => {
    const t = (a: string, b: string) => [{ label: 'A', amountMinor: 90_000, dueDate: a }, { label: 'B', amountMinor: 90_000, dueDate: b }];
    expect(codes(health({ planType: 'PARTIAL', tranches: t('2026-12-01', '2026-11-20') }), 'plan')).toEqual(['DATES_NOT_ASCENDING']);
    expect(codes(health({ planType: 'PARTIAL', tranches: t('2026-11-01', '2026-11-20') }), 'plan')).toEqual(['FIRST_DATE_IN_PAST']);
    expect(codes(health({ planType: 'PARTIAL', tranches: [{ label: 'A', amountMinor: 180_000 }] }), 'plan'))
      .toEqual(expect.arrayContaining(['PLAN_PARTIAL_MIN', 'TRANCHE_DATE_REQUIRED']));
  });
  it('nombre de tranches selon le type', () => {
    const two = [{ label: 'A', amountMinor: 90_000, dueDate: '2026-11-20' }, { label: 'B', amountMinor: 90_000, dueDate: '2026-12-20' }];
    expect(codes(health({ planType: 'SINGLE', tranches: two }), 'plan')).toEqual(['PLAN_SINGLE_ONE']);
    expect(codes(health({ planType: 'INSTALLMENTS', tranches: two }), 'plan')).toEqual([]);
    expect(codes(health({ planType: 'RECURRING', tranches: two, recurrence: { frequency: 'MONTHLY', installments: 61, startDate: '2026-11-20' } }), 'plan'))
      .toEqual(['PLAN_BAD_COUNT']);
    expect(codes(health({ planType: undefined }), 'plan')).toEqual(['PLAN_TYPE_REQUIRED']);
    expect(codes(health({ tranches: [] }), 'plan')).toEqual(['PLAN_EMPTY']);
  });
  it('libellé obligatoire', () => {
    expect(codes(health({ tranches: [{ label: ' ', amountMinor: 180_000, dueDate: '2026-11-15' }] }), 'plan')).toEqual(['TRANCHE_LABEL_REQUIRED']);
  });
});

describe('constructeurs de plan', () => {
  it('unique : une tranche, échéance = date souhaitée', () => {
    expect(buildSinglePlan(180_000, '2026-11-15', 'Paiement')).toEqual([{ label: 'Paiement', amountMinor: 180_000, dueDate: '2026-11-15' }]);
  });
  it('partiel : acompte et solde, somme = total', () => {
    const p = buildPartialPlan({ totalMinor: 900_000, depositMinor: 300_000, depositDate: '2026-11-15', balanceDate: '2027-01-15', labels: ['Acompte', 'Solde'] });
    expect(p.map((t) => t.amountMinor)).toEqual([300_000, 600_000]);
    expect(buildPartialPlan({ totalMinor: 100, depositMinor: 500, labels: ['A', 'S'] }).map((t) => t.amountMinor)).toEqual([100, 0]);
  });
  it('échelonné : montants égaux, le reste sur la dernière', () => {
    const p = buildInstallmentsPlan(1_000, ['2026-11-15', '2026-12-15', '2027-01-15'], 'Tranche');
    expect(p.map((t) => t.amountMinor)).toEqual([333, 333, 334]);
    expect(p.map((t) => t.label)).toEqual(['Tranche 1', 'Tranche 2', 'Tranche 3']);
    expect(planSum(p)).toBe(1_000);
    expect(() => buildInstallmentsPlan(1_000, ['2026-11-15'], 'T')).toThrow(expect.objectContaining({ code: 'PLAN_BAD_COUNT' }));
    expect(() => buildInstallmentsPlan(1_000, Array(13).fill('2026-11-15'), 'T')).toThrow(DomainError);
  });
  it('dates par défaut mensuelles, plafonnées en fin de mois', () => {
    expect(defaultInstallmentDates('2027-01-31', 4)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });
  it('récurrent : hebdomadaire, mensuel, trimestriel', () => {
    const m = buildRecurringPlan(1_800_000, { frequency: 'MONTHLY', installments: 12, startDate: '2026-12-31' }, 'Loyer');
    expect(m).toHaveLength(12);
    expect(m[1]?.dueDate).toBe('2027-01-31');
    expect(m[2]?.dueDate).toBe('2027-02-28');
    expect(planSum(m)).toBe(1_800_000);
    expect(buildRecurringPlan(1_000, { frequency: 'WEEKLY', installments: 3, startDate: '2026-11-10' }, 'S').map((t) => t.dueDate))
      .toEqual(['2026-11-10', '2026-11-17', '2026-11-24']);
    expect(buildRecurringPlan(1_000, { frequency: 'QUARTERLY', installments: 2, startDate: '2026-11-30' }, 'T')[1]?.dueDate).toBe('2027-02-28');
  });
});

describe('pièces requises', () => {
  it('par verticale', () => {
    const req = (v: keyof typeof REQUIRED_DOCUMENTS) => REQUIRED_DOCUMENTS[v].filter((d) => d.required).map((d) => d.kind);
    expect(req('HEALTH')).toEqual(['QUOTE', 'BENEFICIARY_ID']);
    expect(req('EDUCATION')).toEqual(['ENROLMENT_CERTIFICATE']);
    expect(req('RENT')).toEqual(['LEASE']);
    for (const v of ['AGRO', 'REAL_ESTATE', 'LAND'] as const) expect(req(v)).toEqual(['SUPPORTING_DOCUMENT']);
  });
  it('une pièce en échec ou en cours ne compte pas', () => {
    expect(missingRequiredDocuments('HEALTH', [doc('QUOTE'), doc('BENEFICIARY_ID', 'FAILED')])).toEqual(['BENEFICIARY_ID']);
    expect(codes(health({ documents: [doc('QUOTE')] }), 'documents')).toEqual(['DOCUMENT_REQUIRED']);
    expect(validateStep('documents', health({ documents: [] }), ctx).map((i) => i.params?.kind)).toEqual(['QUOTE', 'BENEFICIARY_ID']);
    expect(codes(health({ documents: [doc('QUOTE'), doc('BENEFICIARY_ID'), doc('MEDICAL_CERTIFICATE', 'UPLOADING')] }), 'documents'))
      .toEqual(['DOCUMENT_UPLOADING']);
  });
  it('limites de fichier : JPEG, PNG, PDF, 10 Mo', () => {
    expect(checkFile({ name: 'a.PDF', sizeBytes: 1 })).toBe('application/pdf');
    expect(checkFile({ name: 'photo', mimeType: 'image/jpg', sizeBytes: MAX_FILE_BYTES })).toBe('image/jpeg');
    expect(() => checkFile({ name: 'a.heic', mimeType: 'image/heic', sizeBytes: 10 })).toThrow(expect.objectContaining({ code: 'FILE_TYPE' }));
    expect(() => checkFile({ name: 'a.png', sizeBytes: MAX_FILE_BYTES + 1 })).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
    expect(() => checkFile({ name: 'a.png', sizeBytes: 0 })).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
  });
});

describe('dossier complet', () => {
  it('valide un dossier de santé complet', () => {
    expect(validateNeed(health(), ctx)).toEqual([]);
    expect(firstInvalidStep(health(), ctx)).toBe('recap');
    expect(firstInvalidStep(health({ provider: undefined }), ctx)).toBe('provider');
  });
});

describe('RG-12 et règle de déblocage', () => {
  it('active la première tranche si l’échéance tombe dans les 7 jours', () => {
    expect(shouldActivateTranche('2026-11-17', '2026-11-10')).toBe(true);
    expect(shouldActivateTranche('2026-11-18', '2026-11-10')).toBe(false);
    expect(shouldActivateTranche(undefined, '2026-11-10')).toBe(true);
  });
  it('décrit la règle de la verticale', () => {
    expect(describeRelease('HEALTH')).toEqual({ releaseMode: 'PROVIDER_CONFIRM', contestHours: 48, dualValidation: false });
    expect(describeRelease('LAND').releaseMode).toBe('EVIDENCE_REVIEW');
  });
});
