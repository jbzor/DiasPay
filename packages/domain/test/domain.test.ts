import { describe, expect, it } from 'vitest';
import {
  DomainError, RELEASE_RULES, addMonths, evidenceOutcome, formatMoney, generateRecurringTranches, requiredValidations, validatePlan,
} from '../src';
// Lot X version 2 : les machines d’états de l’opération et de la demande sont testées dans lotx2.test.ts.

describe('plan de tranches', () => {
  it('accepte une somme exacte', () => {
    expect(() => validatePlan(900, [{ label: 'a', amountMinor: 300 }, { label: 'b', amountMinor: 600 }])).not.toThrow();
  });
  it('refuse une somme différente', () => {
    expect(() => validatePlan(900, [{ label: 'a', amountMinor: 300 }])).toThrow(/doit égaler/);
  });
  it('refuse un plan vide ou un montant nul', () => {
    expect(() => validatePlan(100, [])).toThrow(DomainError);
    expect(() => validatePlan(100, [{ label: 'a', amountMinor: 0 }])).toThrow(DomainError);
  });
  it('génère des tranches mensuelles, le reste va à la dernière', () => {
    const t = generateRecurringTranches({ totalMinor: 1000, frequency: 'MONTHLY', installments: 3, startDate: '2026-11-15' });
    expect(t.map((x) => x.amountMinor)).toEqual([333, 333, 334]);
    expect(t.map((x) => x.dueDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(() => validatePlan(1000, t)).not.toThrow();
  });
  it('plafonne au dernier jour du mois à partir de la date d’origine', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });
  it('gère le passage d’année et les échéances hebdomadaires et trimestrielles', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    const w = generateRecurringTranches({ totalMinor: 400, frequency: 'WEEKLY', installments: 2, startDate: '2026-12-28' });
    expect(w[1]?.dueDate).toBe('2027-01-04');
    const q = generateRecurringTranches({ totalMinor: 400, frequency: 'QUARTERLY', installments: 2, startDate: '2026-11-15' });
    expect(q[1]?.dueDate).toBe('2027-02-15');
  });
  it('refuse un nombre d’échéances hors limites', () => {
    expect(() => generateRecurringTranches({ totalMinor: 1000, frequency: 'MONTHLY', installments: 1, startDate: '2026-01-01' })).toThrow();
    expect(() => generateRecurringTranches({ totalMinor: 1000, frequency: 'MONTHLY', installments: 61, startDate: '2026-01-01' })).toThrow();
  });
});



describe('double validation', () => {
  it('immobilier et terrain exigent toujours deux validateurs', () => {
    expect(requiredValidations('REAL_ESTATE', 'XAF', 1000)).toBe(2);
    expect(requiredValidations('LAND', 'EUR', 1)).toBe(2);
  });
  it('deux validateurs au-dessus du seuil de la devise', () => {
    expect(requiredValidations('EDUCATION', 'EUR', 499_999)).toBe(1);
    expect(requiredValidations('EDUCATION', 'EUR', 500_000)).toBe(2);
    expect(requiredValidations('HEALTH', 'XAF', 3_000_000)).toBe(2);
  });
  it('résultat de décision', () => {
    expect(evidenceOutcome({ approved: false, approverIds: [], required: 2 })).toBe('REJECTED');
    expect(evidenceOutcome({ approved: true, approverIds: ['a'], required: 2 })).toBe('PARTIAL');
    expect(evidenceOutcome({ approved: true, approverIds: ['a', 'a'], required: 2 })).toBe('PARTIAL');
    expect(evidenceOutcome({ approved: true, approverIds: ['a', 'b'], required: 2 })).toBe('APPROVED');
  });
  it('les règles par verticale correspondent au cahier des charges', () => {
    expect(RELEASE_RULES.EDUCATION.contestHours).toBe(72);
    expect(RELEASE_RULES.HEALTH.contestHours).toBe(48);
    expect(RELEASE_RULES.AGRO.releaseMode).toBe('PAYER_CONFIRM');
    expect(RELEASE_RULES.LAND.releaseMode).toBe('EVIDENCE_REVIEW');
  });
});

describe('montants', () => {
  it('formate le FCFA sans décimales et l’euro avec deux décimales', () => {
    expect(formatMoney({ amountMinor: 300000, currency: 'XAF' }).replace(/\s/g, ' ')).toMatch(/^300.000 FCFA$/);
    expect(formatMoney({ amountMinor: 45700, currency: 'EUR' })).toMatch(/457,00 €$/);
  });
});
