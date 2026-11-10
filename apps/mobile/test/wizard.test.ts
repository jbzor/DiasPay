import { describe, expect, it } from 'vitest';
import { emptyDraft } from '@diaspay/domain';
import type { DraftDocument, NeedContext, NeedDraft } from '@diaspay/domain';
import {
  canContinue, compressedSize, defaultPlan, planGap, prevStep, resumeStep, stepIndex, wizardReducer,
} from '../src/features/need/wizard';
import type { PlanLabels, WizardAction, WizardState } from '../src/features/need/wizard';

const today = '2026-11-10';
const ctx: NeedContext = { today, creatorRole: 'PAYER' };
const labels: PlanLabels = { single: 'Paiement', deposit: 'Acompte', balance: 'Solde', installment: 'Tranche', recurring: 'Échéance', extra: 'Tranche' };
const T0 = new Date('2026-11-10T09:00:00');
const doc = (kind: DraftDocument['kind']): DraftDocument => ({ id: `d-${kind}`, kind, name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, status: 'UPLOADED' });

const run = (st: WizardState, ...actions: WizardAction[]) => actions.reduce(wizardReducer, st);
const start = (): WizardState => ({ draft: emptyDraft('need-1', T0), step: 'type' });
const patch = (p: Partial<NeedDraft>): WizardAction => ({ type: 'patch', patch: p, labels, today });

/** Dossier de santé valide jusqu’à l’étape demandée. */
function filledHealth(): WizardState {
  return run(start(),
    patch({ vertical: 'HEALTH' }), { type: 'next', ctx },
    patch({ amountMinor: 180_000, currency: 'XAF', purpose: 'Opération du genou', beneficiaryName: 'Rose M.' }), { type: 'next', ctx },
    patch({ provider: { id: 'pv-hopital-central', name: 'Hôpital Central' } }), { type: 'next', ctx },
    { type: 'setPlanType', planType: 'SINGLE', labels, today }, { type: 'next', ctx },
    { type: 'upsertDocument', doc: doc('QUOTE') }, { type: 'upsertDocument', doc: doc('BENEFICIARY_ID') }, { type: 'next', ctx },
  );
}

describe('assistant : validité par étape et navigation', () => {
  it('« Continuer » reste bloqué tant que l’étape est invalide', () => {
    const s = start();
    expect(canContinue(s, ctx)).toBe(false);
    expect(run(s, { type: 'next', ctx })).toBe(s); // pas d’avance
    expect(canContinue(run(s, patch({ vertical: 'LAND' })), ctx)).toBe(false); // vague 2 désactivée
    const ok = run(s, patch({ vertical: 'EDUCATION' }));
    expect(canContinue(ok, ctx)).toBe(true);
    expect(run(ok, { type: 'next', ctx }).step).toBe('details');
  });
  it('parcourt les six étapes et enregistre l’étape dans le brouillon', () => {
    const s = filledHealth();
    expect(s.step).toBe('recap');
    expect(s.draft.step).toBe('recap');
    expect(stepIndex(s.step)).toBe(6);
    expect(canContinue(s, ctx)).toBe(true);
  });
  it('revient en arrière sans perdre la saisie', () => {
    const s = run(filledHealth(), { type: 'back' }, { type: 'back' }, { type: 'back' });
    expect(s.step).toBe('provider');
    expect(s.draft).toMatchObject({ amountMinor: 180_000, purpose: 'Opération du genou', provider: { name: 'Hôpital Central' } });
    expect(s.draft.documents).toHaveLength(2);
    expect(prevStep('type')).toBeNull();
    expect(run(start(), { type: 'back' }).step).toBe('type');
  });
  it('changer de type de besoin efface le prestataire (propre à la verticale)', () => {
    const s = run(filledHealth(), patch({ vertical: 'RENT' }));
    expect(s.draft.provider).toBeUndefined();
    expect(run(filledHealth(), patch({ vertical: 'HEALTH' })).draft.provider).toBeDefined();
  });
  it('un demandeur doit indiquer le téléphone du payeur', () => {
    const req = { ...ctx, creatorRole: 'REQUESTER' as const };
    const s = run(start(), patch({ vertical: 'HEALTH', amountMinor: 1, currency: 'XAF', purpose: 'abc', beneficiaryName: 'R' }), { type: 'goto', step: 'details' });
    expect(canContinue(s, req)).toBe(false);
    expect(canContinue(run(s, patch({ counterpartyPhone: '+237 699 00 11 22' })), req)).toBe(true);
  });
});

describe('assistant : plan de paiement', () => {
  const base = () => run(start(), patch({ vertical: 'EDUCATION', amountMinor: 900_000, currency: 'XAF', desiredDate: '2026-11-15' }), { type: 'goto', step: 'plan' });
  it('construit chaque type de plan par le domaine', () => {
    expect(defaultPlan(base().draft, 'SINGLE', labels, today).tranches).toEqual([{ label: 'Paiement', amountMinor: 900_000, dueDate: '2026-11-15' }]);
    expect(defaultPlan(base().draft, 'PARTIAL', labels, today).tranches?.map((t) => t.amountMinor)).toEqual([270_000, 630_000]);
    expect(defaultPlan(base().draft, 'INSTALLMENTS', labels, today).tranches?.map((t) => t.dueDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    const rec = defaultPlan(base().draft, 'RECURRING', labels, today);
    expect(rec.recurrence).toEqual({ frequency: 'MONTHLY', installments: 12, startDate: '2026-11-15' });
    expect(rec.tranches).toHaveLength(12);
  });
  it('écart de somme : bloque, puis s’annule en corrigeant une tranche', () => {
    let s = run(base(), { type: 'setPlanType', planType: 'PARTIAL', labels, today });
    expect(planGap(s.draft)).toBe(0);
    s = run(s, { type: 'updateTranche', index: 0, patch: { amountMinor: 200_000 } });
    expect(planGap(s.draft)).toBe(70_000);
    expect(canContinue(s, ctx)).toBe(false);
    s = run(s, { type: 'addTranche', label: 'Tranche' });
    expect(s.draft.tranches?.[2]).toEqual({ label: 'Tranche 3', amountMinor: 70_000, dueDate: '2027-01-15' });
    expect(planGap(s.draft)).toBe(0);
    expect(canContinue(s, ctx)).toBe(true);
  });
  it('un plan unique devient partiel quand on ajoute une tranche', () => {
    const s = run(base(), { type: 'setPlanType', planType: 'SINGLE', labels, today }, { type: 'addTranche', label: 'Tranche' });
    expect(s.draft.planType).toBe('PARTIAL');
    expect(s.draft.tranches?.[1]?.amountMinor).toBe(0);
  });
  it('nombre de tranches échelonnées entre 2 et 12, reste sur la dernière', () => {
    const s = run(base(), { type: 'setPlanType', planType: 'INSTALLMENTS', labels, today }, { type: 'setInstallmentCount', count: 7, labels, today });
    expect(s.draft.tranches?.map((t) => t.amountMinor)).toEqual([128_571, 128_571, 128_571, 128_571, 128_571, 128_571, 128_574]);
    expect(run(s, { type: 'setInstallmentCount', count: 20, labels, today }).draft.tranches).toHaveLength(12);
    expect(run(s, { type: 'setInstallmentCount', count: 1, labels, today }).draft.tranches).toHaveLength(2);
  });
  it('le plan unique et le plan récurrent suivent le montant', () => {
    let s = run(base(), { type: 'setPlanType', planType: 'SINGLE', labels, today }, patch({ amountMinor: 1_000_000, desiredDate: '2026-12-01' }));
    expect(s.draft.tranches).toEqual([{ label: 'Paiement', amountMinor: 1_000_000, dueDate: '2026-12-01' }]);
    s = run(base(), { type: 'setPlanType', planType: 'RECURRING', labels, today },
      { type: 'setRecurrence', recurrence: { frequency: 'QUARTERLY', installments: 4, startDate: '2026-11-30' }, labels }, patch({ amountMinor: 1_000 }));
    expect(s.draft.tranches?.map((t) => [t.amountMinor, t.dueDate])).toEqual([[250, '2026-11-30'], [250, '2027-02-28'], [250, '2027-05-30'], [250, '2027-08-30']]);
  });
  it('choisir le même type ne réinitialise pas les tranches modifiées', () => {
    const s = run(base(), { type: 'setPlanType', planType: 'PARTIAL', labels, today }, { type: 'updateTranche', index: 0, patch: { label: 'Inscription' } });
    expect(run(s, { type: 'setPlanType', planType: 'PARTIAL', labels, today }).draft.tranches?.[0]?.label).toBe('Inscription');
  });
});

describe('assistant : pièces et reprise', () => {
  it('ajoute, remplace et retire une pièce', () => {
    let s = run(start(), { type: 'upsertDocument', doc: { ...doc('QUOTE'), status: 'UPLOADING' } });
    s = run(s, { type: 'upsertDocument', doc: doc('QUOTE') });
    expect(s.draft.documents).toEqual([doc('QUOTE')]);
    expect(run(s, { type: 'removeDocument', id: 'd-QUOTE' }).draft.documents).toEqual([]);
  });
  it('reprend un brouillon à sa dernière étape, sans dépasser la première étape incomplète', () => {
    const full = filledHealth().draft;
    expect(resumeStep({ ...full, step: 'documents' }, ctx)).toBe('documents');
    expect(resumeStep({ ...full, step: 'recap', provider: undefined }, ctx)).toBe('provider');
    expect(resumeStep({ ...emptyDraft('n', T0), step: undefined }, ctx)).toBe('type');
    const loaded = wizardReducer(start(), { type: 'load', draft: full, step: 'plan' });
    expect(loaded).toMatchObject({ step: 'plan', draft: { step: 'plan', purpose: 'Opération du genou' } });
  });
});

describe('compression des images', () => {
  it('ramène le côté long à 2000 px', () => {
    expect(compressedSize(4032, 3024)).toEqual({ width: 2000 });
    expect(compressedSize(3024, 4032)).toEqual({ height: 2000 });
    expect(compressedSize(1200, 900)).toBeNull();
  });
});
