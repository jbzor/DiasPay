import { describe, expect, it } from 'vitest';
import {
  DomainError, RELEASE_RULES, addMonths, canOpenDispute, canTransitionTx, evidenceOutcome,
  formatMoney, generateRecurringTranches, isAutoReleasable, requiredValidations,
  shouldCloseTransaction, transitionTranche, transitionTx, validatePlan,
} from '../src';
import type { Actor, TrancheState } from '../src';

const payer: Actor = { kind: 'USER', roles: ['PAYER'], isValidator: false };
const requester: Actor = { kind: 'USER', roles: ['REQUESTER'], isValidator: false };
const provider: Actor = { kind: 'USER', roles: ['PROVIDER'], isValidator: false };
const validator: Actor = { kind: 'USER', roles: [], isValidator: true };
const validatorAndParty: Actor = { kind: 'USER', roles: ['PAYER'], isValidator: true };
const system: Actor = { kind: 'SYSTEM' };

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

describe('machine d’états de la transaction', () => {
  const ctx = { totalMinor: 900, tranches: [{ label: 'a', amountMinor: 900 }], hasSupportingDocument: true };
  it('soumet un brouillon valide', () => {
    expect(transitionTx('DRAFT', 'SUBMITTED', requester, ctx)).toBe('SUBMITTED');
  });
  it('refuse la soumission sans pièce ou sans plan cohérent', () => {
    expect(() => transitionTx('DRAFT', 'SUBMITTED', payer, { ...ctx, hasSupportingDocument: false })).toThrow(/pièce/);
    expect(() => transitionTx('DRAFT', 'SUBMITTED', payer, { ...ctx, totalMinor: 1000 })).toThrow(/doit égaler/);
    expect(() => transitionTx('DRAFT', 'SUBMITTED', payer)).toThrow(DomainError);
  });
  it('le prestataire ne soumet pas', () => {
    expect(() => transitionTx('DRAFT', 'SUBMITTED', provider, ctx)).toThrow(/non autorisé/);
  });
  it('seul un validateur non partie décide', () => {
    expect(transitionTx('IN_REVIEW', 'VALIDATED', validator)).toBe('VALIDATED');
    expect(() => transitionTx('IN_REVIEW', 'VALIDATED', validatorAndParty)).toThrow(DomainError);
    expect(() => transitionTx('IN_REVIEW', 'VALIDATED', payer)).toThrow(DomainError);
  });
  it('un dossier rejeté peut être corrigé', () => {
    expect(transitionTx('REJECTED', 'DRAFT', requester)).toBe('DRAFT');
  });
  it('les étapes système sont réservées au système', () => {
    expect(transitionTx('VALIDATED', 'TOKEN_ISSUED', system)).toBe('TOKEN_ISSUED');
    expect(transitionTx('TOKEN_ISSUED', 'IN_PROGRESS', system)).toBe('IN_PROGRESS');
    expect(canTransitionTx('VALIDATED', 'TOKEN_ISSUED', payer)).toBe(false);
  });
  it('refuse les sauts d’étape', () => {
    expect(() => transitionTx('DRAFT', 'VALIDATED', system)).toThrow(/non autorisée/);
    expect(() => transitionTx('CLOSED', 'DRAFT', requester)).toThrow(DomainError);
  });
});

describe('machine d’états de la tranche', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const base = (over: Partial<TrancheState> = {}): TrancheState => ({
    status: 'PAID_LOCKED', releaseMode: 'PROVIDER_CONFIRM', contestHours: 72, ...over,
  });
  it('le prestataire confirme et le délai de contestation démarre', () => {
    const r = transitionTranche(base(), 'CONFIRMED', provider, now);
    expect(r.status).toBe('CONFIRMED');
    expect(r.contestEndsAt?.toISOString()).toBe('2026-11-13T12:00:00.000Z');
  });
  it('le payeur ne confirme pas une tranche à confirmation prestataire', () => {
    expect(() => transitionTranche(base(), 'CONFIRMED', payer, now)).toThrow(/ne peut pas confirmer/);
  });
  it('en agro, le payeur confirme et pas le prestataire', () => {
    const agro = base({ releaseMode: 'PAYER_CONFIRM' });
    expect(transitionTranche(agro, 'CONFIRMED', payer, now).status).toBe('CONFIRMED');
    expect(() => transitionTranche(agro, 'CONFIRMED', provider, now)).toThrow(DomainError);
  });
  it('une preuve exige le mode preuve et une pièce déposée', () => {
    expect(() => transitionTranche(base(), 'EVIDENCE_SUBMITTED', provider, now)).toThrow(/ne requiert pas/);
    const re = base({ releaseMode: 'EVIDENCE_REVIEW', contestHours: 0 });
    expect(() => transitionTranche(re, 'EVIDENCE_SUBMITTED', provider, now)).toThrow(/pièce/);
    expect(transitionTranche({ ...re, hasEvidence: true }, 'EVIDENCE_SUBMITTED', provider, now).status).toBe('EVIDENCE_SUBMITTED');
  });
  it('seul le payeur approuve un déblocage anticipé', () => {
    const c = base({ status: 'CONFIRMED', contestEndsAt: new Date('2026-11-13T12:00:00Z') });
    expect(transitionTranche(c, 'RELEASED', payer, now).status).toBe('RELEASED');
    expect(() => transitionTranche(c, 'RELEASED', provider, now)).toThrow(DomainError);
  });
  it('le paiement est une étape système', () => {
    const w = base({ status: 'AWAITING_PAYMENT' });
    expect(transitionTranche(w, 'PAID_LOCKED', system, now).status).toBe('PAID_LOCKED');
    expect(() => transitionTranche(w, 'PAID_LOCKED', payer, now)).toThrow(DomainError);
  });
  it('déblocage automatique après le délai, jamais en mode preuve', () => {
    const c = base({ status: 'CONFIRMED', contestEndsAt: new Date('2026-11-10T11:00:00Z') });
    expect(isAutoReleasable(c, now)).toBe(true);
    expect(isAutoReleasable({ ...c, contestEndsAt: new Date('2026-11-11T00:00:00Z') }, now)).toBe(false);
    expect(isAutoReleasable({ ...c, releaseMode: 'EVIDENCE_REVIEW' }, now)).toBe(false);
  });
  it('règles d’ouverture de litige', () => {
    const open = new Date('2026-11-12T00:00:00Z');
    const late = new Date('2026-11-14T00:00:00Z');
    const c = base({ status: 'CONFIRMED', contestEndsAt: new Date('2026-11-13T12:00:00Z') });
    expect(canOpenDispute(base(), ['PROVIDER'], now)).toBe(true);
    expect(canOpenDispute(c, ['PAYER'], open)).toBe(true);
    expect(canOpenDispute(c, ['PAYER'], late)).toBe(false);
    expect(canOpenDispute(c, ['PROVIDER'], open)).toBe(false);
    expect(canOpenDispute(base(), ['REQUESTER'], now)).toBe(false);
  });
  it('clôture la transaction quand toutes les tranches sont terminées', () => {
    expect(shouldCloseTransaction(['RELEASED', 'CANCELLED'])).toBe(true);
    expect(shouldCloseTransaction(['RELEASED', 'PLANNED'])).toBe(false);
    expect(shouldCloseTransaction(['DISPUTED'])).toBe(false);
    expect(shouldCloseTransaction([])).toBe(false);
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
