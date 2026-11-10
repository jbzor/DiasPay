import {
  NEED_STEPS, addMonths, buildInstallmentsPlan, buildPartialPlan, buildRecurringPlan, buildSinglePlan, defaultInstallmentDates,
  firstInvalidStep, planSum, validateStep,
} from '@diaspay/domain';
import type { DraftDocument, NeedContext, NeedDraft, NeedIssue, NeedStep, PlanType, RecurrenceFreq, TrancheDraft } from '@diaspay/domain';

// Assistant de création d’un besoin : réducteur pur. Les règles viennent du domaine (validateStep, constructeurs de plan).

export interface WizardState { draft: NeedDraft; step: NeedStep }

/** Libellés de tranches (traduits par l’écran). */
export interface PlanLabels { single: string; deposit: string; balance: string; installment: string; recurring: string; extra: string }

export type WizardAction =
  | { type: 'load'; draft: NeedDraft; step?: NeedStep }
  | { type: 'patch'; patch: Partial<NeedDraft>; labels: PlanLabels; today: string }
  | { type: 'goto'; step: NeedStep }
  | { type: 'next'; ctx: NeedContext }
  | { type: 'back' }
  | { type: 'setPlanType'; planType: PlanType; labels: PlanLabels; today: string }
  | { type: 'setInstallmentCount'; count: number; labels: PlanLabels; today: string }
  | { type: 'setRecurrence'; recurrence: NonNullable<NeedDraft['recurrence']>; labels: PlanLabels }
  | { type: 'updateTranche'; index: number; patch: Partial<TrancheDraft> }
  | { type: 'addTranche'; label: string }
  | { type: 'removeTranche'; index: number }
  | { type: 'upsertDocument'; doc: DraftDocument }
  | { type: 'removeDocument'; id: string };

export const STEP_COUNT = NEED_STEPS.length;
export const stepIndex = (s: NeedStep): number => NEED_STEPS.indexOf(s) + 1;
export const nextStep = (s: NeedStep): NeedStep => NEED_STEPS[Math.min(NEED_STEPS.length - 1, NEED_STEPS.indexOf(s) + 1)] as NeedStep;
export const prevStep = (s: NeedStep): NeedStep | null => (s === 'type' ? null : (NEED_STEPS[NEED_STEPS.indexOf(s) - 1] as NeedStep));

export const stepIssues = (st: WizardState, ctx: NeedContext): NeedIssue[] => validateStep(st.step, st.draft, ctx);
export const canContinue = (st: WizardState, ctx: NeedContext): boolean => stepIssues(st, ctx).length === 0;
/** Premier code d’erreur d’un champ (`amountMinor`, `tranches.0.dueDate`…). */
export const issueFor = (issues: readonly NeedIssue[], path: string): NeedIssue | undefined => issues.find((i) => i.path === path);

/** Étape à rouvrir : la dernière ouverte, sans dépasser la première étape incomplète. */
export function resumeStep(draft: NeedDraft, ctx: NeedContext): NeedStep {
  const last = draft.step ?? 'type';
  const firstBad = firstInvalidStep(draft, ctx);
  return NEED_STEPS.indexOf(firstBad) < NEED_STEPS.indexOf(last) ? firstBad : last;
}

const startOf = (d: NeedDraft, today: string) => d.desiredDate ?? today;
const DEFAULT_INSTALLMENTS = 3;
const DEFAULT_RECURRING = 12;

/** Plan par défaut d’un type, construit par le domaine. Un montant manquant ou trop faible donne une liste vide. */
export function defaultPlan(d: NeedDraft, planType: PlanType, labels: PlanLabels, today: string): Pick<NeedDraft, 'tranches' | 'recurrence'> {
  const total = d.amountMinor ?? 0;
  const start = startOf(d, today);
  try {
    switch (planType) {
      case 'SINGLE': return { tranches: buildSinglePlan(total, start, labels.single), recurrence: undefined };
      case 'PARTIAL': return {
        tranches: buildPartialPlan({ totalMinor: total, depositMinor: Math.floor(total * 0.3), depositDate: start, balanceDate: addMonths(start, 1), labels: [labels.deposit, labels.balance] }),
        recurrence: undefined,
      };
      case 'INSTALLMENTS': return { tranches: buildInstallmentsPlan(total, defaultInstallmentDates(start, DEFAULT_INSTALLMENTS), labels.installment), recurrence: undefined };
      case 'RECURRING': {
        const recurrence = { frequency: 'MONTHLY' as RecurrenceFreq, installments: Math.min(DEFAULT_RECURRING, Math.max(2, total)), startDate: start };
        return { tranches: buildRecurringPlan(total, recurrence, labels.recurring), recurrence };
      }
    }
  } catch {
    return { tranches: [], recurrence: planType === 'RECURRING' ? { frequency: 'MONTHLY', installments: DEFAULT_RECURRING, startDate: start } : undefined };
  }
}

function safeRecurring(total: number, rec: NonNullable<NeedDraft['recurrence']>, label: string): TrancheDraft[] {
  try { return buildRecurringPlan(total, rec, label); } catch { return []; }
}

function withDraft(st: WizardState, patch: Partial<NeedDraft>): WizardState {
  return { ...st, draft: { ...st.draft, ...patch } };
}

export function wizardReducer(st: WizardState, a: WizardAction): WizardState {
  switch (a.type) {
    case 'load':
      return { draft: { ...a.draft, step: a.step ?? a.draft.step ?? 'type' }, step: a.step ?? a.draft.step ?? 'type' };

    case 'patch': {
      const prev = st.draft;
      let next: NeedDraft = { ...prev, ...a.patch };
      // Le prestataire dépend de la verticale.
      if (a.patch.vertical && a.patch.vertical !== prev.vertical) next.provider = undefined;
      // Le plan suit le montant et la date lorsqu’il est calculé automatiquement.
      const amountChanged = 'amountMinor' in a.patch && a.patch.amountMinor !== prev.amountMinor;
      const dateChanged = 'desiredDate' in a.patch && a.patch.desiredDate !== prev.desiredDate;
      if (next.planType === 'SINGLE' && (amountChanged || dateChanged) && next.tranches?.length === 1) {
        next = { ...next, tranches: [{ ...(next.tranches[0] as TrancheDraft), amountMinor: next.amountMinor ?? 0, dueDate: startOf(next, a.today) }] };
      }
      if (next.planType === 'RECURRING' && amountChanged && next.recurrence) {
        next = { ...next, tranches: safeRecurring(next.amountMinor ?? 0, next.recurrence, a.labels.recurring) };
      }
      return { ...st, draft: next };
    }

    case 'goto':
      return { step: a.step, draft: { ...st.draft, step: a.step } };
    case 'next': {
      if (!canContinue(st, a.ctx)) return st;
      const step = nextStep(st.step);
      return { step, draft: { ...st.draft, step } };
    }
    case 'back': {
      const step = prevStep(st.step);
      return step ? { step, draft: { ...st.draft, step } } : st;
    }

    case 'setPlanType':
      if (st.draft.planType === a.planType && (st.draft.tranches?.length ?? 0) > 0) return st;
      return withDraft(st, { planType: a.planType, ...defaultPlan(st.draft, a.planType, a.labels, a.today) });

    case 'setInstallmentCount': {
      const total = st.draft.amountMinor ?? 0;
      const count = Math.max(2, Math.min(12, Math.round(a.count)));
      const first = st.draft.tranches?.[0]?.dueDate ?? startOf(st.draft, a.today);
      try {
        return withDraft(st, { tranches: buildInstallmentsPlan(total, defaultInstallmentDates(first, count), a.labels.installment) });
      } catch {
        return st;
      }
    }

    case 'setRecurrence':
      return withDraft(st, { recurrence: a.recurrence, tranches: safeRecurring(st.draft.amountMinor ?? 0, a.recurrence, a.labels.recurring) });

    case 'updateTranche': {
      const tranches = (st.draft.tranches ?? []).map((t, i) => (i === a.index ? { ...t, ...a.patch } : t));
      return withDraft(st, { tranches });
    }
    case 'addTranche': {
      const tranches = st.draft.tranches ?? [];
      const last = tranches[tranches.length - 1];
      const gap = Math.max(0, (st.draft.amountMinor ?? 0) - planSum(tranches));
      const dueDate = last?.dueDate ? addMonths(last.dueDate, 1) : undefined;
      // Un plan unique devient partiel dès qu’il a deux tranches.
      const planType: PlanType | undefined = st.draft.planType === 'SINGLE' ? 'PARTIAL' : st.draft.planType;
      return withDraft(st, { planType, tranches: [...tranches, { label: `${a.label} ${tranches.length + 1}`, amountMinor: gap, dueDate }] });
    }
    case 'removeTranche':
      return withDraft(st, { tranches: (st.draft.tranches ?? []).filter((_, i) => i !== a.index) });

    case 'upsertDocument': {
      const docs = st.draft.documents.filter((d) => d.id !== a.doc.id);
      return withDraft(st, { documents: [...docs, a.doc] });
    }
    case 'removeDocument':
      return withDraft(st, { documents: st.draft.documents.filter((d) => d.id !== a.id) });
  }
}

/** Écart affiché sous le plan : positif = il manque, négatif = dépassement. */
export const planGap = (d: NeedDraft): number => (d.amountMinor ?? 0) - planSum(d.tranches ?? []);

/** Taille cible d’une image compressée : côté long ramené à 2000 px. `null` si déjà assez petite. */
export function compressedSize(width: number, height: number, maxSide = 2000): { width: number } | { height: number } | null {
  if (width <= maxSide && height <= maxSide) return null;
  return width >= height ? { width: maxSide } : { height: maxSide };
}
