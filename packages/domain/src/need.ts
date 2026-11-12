import { z } from 'zod';
import { DomainError } from './types';
import type { Currency, RecurrenceFreq, ReleaseMode, TrancheDraft } from './types';
import { addDays, addMonths, generateRecurringTranches, validatePlan } from './plan';
import { isNormalizablePhone } from './phone';
import type { ModuleDocumentKind } from './documents';
import { DEFAULT_MODULES, findModule, missingModuleDocuments } from './modules';
import type { ModuleCode, RequestModule } from './modules';

// Création d’un besoin (lot 3) : brouillon, validation étape par étape, constructeurs de plan.
// Les messages d’erreur sont des codes stables ; les textes sont traduits côté application.

export type PlanType = 'SINGLE' | 'PARTIAL' | 'INSTALLMENTS' | 'RECURRING';
export const PLAN_TYPES: readonly PlanType[] = ['SINGLE', 'PARTIAL', 'INSTALLMENTS', 'RECURRING'];
export const CURRENCIES: readonly Currency[] = ['XAF', 'EUR', 'USD'];

export const NEED_STEPS = ['type', 'details', 'provider', 'plan', 'documents', 'recap'] as const;
export type NeedStep = (typeof NEED_STEPS)[number];

export const PURPOSE_MIN = 3;
export const PURPOSE_MAX = 500;               // comme la contrainte SQL
export const INSTALLMENTS_MIN = 2;
export const INSTALLMENTS_MAX = 12;
export const RECURRING_MIN = 2;
export const RECURRING_MAX = 60;              // comme le schéma SQL
/** RG-12 : la première tranche est activée si son échéance tombe dans les 7 jours. */
export const ACTIVATION_WINDOW_DAYS = 7;

export type DocumentStatus = 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'MISSING';

export interface DraftDocument {
  id: string;
  kind: ModuleDocumentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** URI locale (appareil) ; sert à renvoyer le fichier si l’envoi a échoué. */
  uri?: string;
  status: DocumentStatus;
  uploadedAt?: string;
  /** Lot X (X4) : empreinte SHA-256 (hexadécimal) calculée par l’application avant l’envoi, immuable ensuite. */
  contentHash?: string;
}

export interface DraftDocumentInput {
  /** Identifiant à conserver (nouvelle tentative d’un envoi échoué). */
  id?: string;
  kind: ModuleDocumentKind;
  name: string;
  mimeType?: string;
  sizeBytes: number;
  uri: string;
  /** Empreinte déjà calculée (sinon l’API la calcule avant l’envoi). */
  contentHash?: string;
}

export interface NeedProvider { id?: string; name: string; invitedPhone?: string }

/** Rôle du créateur dans la demande. PROVIDER (lot X, X3) : demande initiée par un prestataire autorisé. */
export type CreatorRole = 'PAYER' | 'REQUESTER' | 'PROVIDER';
export const CREATOR_ROLES: readonly CreatorRole[] = ['PAYER', 'REQUESTER', 'PROVIDER'];

export interface NeedDraft {
  id: string;
  /** Code du type de besoin (module, lot X : X6). */
  vertical?: ModuleCode;
  amountMinor?: number;
  currency?: Currency;
  purpose?: string;
  beneficiaryName?: string;
  desiredDate?: string;            // AAAA-MM-JJ
  provider?: NeedProvider;
  counterpartyPhone?: string;      // payeur invité quand le créateur est demandeur (ou prestataire initiateur)
  /**
   * Rôle explicite du créateur (lot X). Absent : déduit du profil (demandeur, sinon payeur), comportement inchangé.
   * PROVIDER : exige l’autorisation can_initiate_requests et le téléphone du payeur ; le prestataire est le créateur.
   */
  creatorRole?: CreatorRole;
  planType?: PlanType;
  recurrence?: { frequency: RecurrenceFreq; installments: number; startDate: string };
  tranches?: TrancheDraft[];
  documents: DraftDocument[];
  updatedAt: string;
  /** Dernière étape ouverte (reprise du brouillon). */
  step?: NeedStep;
  /** Utilisateur propriétaire du brouillon. */
  ownerId?: string;
  /** Transaction rejetée dont ce brouillon est la correction, et motif du rejet. */
  correctionOf?: string;
  rejectionReason?: string;
}

export interface NeedContext {
  /** Date du jour (AAAA-MM-JJ, heure locale de l’utilisateur). */
  today: string;
  /** Rôle principal du créateur (profil) : un demandeur doit indiquer le téléphone du payeur. */
  creatorRole?: CreatorRole;
  /** Types de besoin (listModules) ; défaut : modules du code (DEFAULT_MODULES). */
  modules?: readonly RequestModule[];
}

export interface NeedIssue {
  /** Champ concerné (`amountMinor`, `tranches.1.dueDate`, `documents.QUOTE`…). */
  path: string;
  code: string;
  params?: Record<string, string | number>;
}

/** Date locale AAAA-MM-JJ. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// ——— Schémas par étape ———

type Ctx = z.RefinementCtx;
const issue = (ctx: Ctx, path: Array<string | number>, code: string, params?: NeedIssue['params']) =>
  ctx.addIssue({ code: 'custom', path, message: code, params });

/** Type de besoin : connu des modules (VERTICAL_REQUIRED), et ouvert (VERTICAL_UNAVAILABLE, comme transition_tx). */
function typeIssues(draft: NeedDraft, modules: readonly RequestModule[]): NeedIssue[] {
  const m = findModule(draft.vertical, modules);
  if (!m) return [{ path: 'vertical', code: 'VERTICAL_REQUIRED' }];
  return m.enabled ? [] : [{ path: 'vertical', code: 'VERTICAL_UNAVAILABLE' }];
}

function detailsSchema(c: NeedContext) {
  return z.object({
    amountMinor: z.number({ error: 'AMOUNT_REQUIRED' }).int({ error: 'AMOUNT_INVALID' }).positive({ error: 'AMOUNT_INVALID' }),
    currency: z.enum(CURRENCIES as [Currency, ...Currency[]], { error: 'CURRENCY_REQUIRED' }),
    purpose: z.string({ error: 'PURPOSE_TOO_SHORT' }).trim()
      .min(PURPOSE_MIN, { error: 'PURPOSE_TOO_SHORT' }).max(PURPOSE_MAX, { error: 'PURPOSE_TOO_LONG' }),
    beneficiaryName: z.string({ error: 'BENEFICIARY_REQUIRED' }).trim().min(1, { error: 'BENEFICIARY_REQUIRED' }),
    desiredDate: z.string().optional(),
    counterpartyPhone: z.string().optional(),
  }).superRefine((d, ctx) => {
    if (d.desiredDate) {
      if (!isValidIsoDate(d.desiredDate)) issue(ctx, ['desiredDate'], 'DATE_INVALID');
      else if (d.desiredDate < c.today) issue(ctx, ['desiredDate'], 'DATE_IN_PAST');
    }
    const phone = d.counterpartyPhone?.trim();
    if ((c.creatorRole === 'REQUESTER' || c.creatorRole === 'PROVIDER') && !phone) issue(ctx, ['counterpartyPhone'], 'PAYER_PHONE_REQUIRED');
    else if (phone && !isNormalizablePhone(phone)) issue(ctx, ['counterpartyPhone'], 'PHONE_INVALID');
  });
}

const providerSchema = z.object({
  provider: z.object({
    id: z.string().optional(),
    name: z.string(),
    invitedPhone: z.string().optional(),
  }, { error: 'PROVIDER_REQUIRED' }).superRefine((p, ctx) => {
    if (p.id) return;
    if (p.name.trim().length < 2) issue(ctx, ['name'], 'PROVIDER_NAME_REQUIRED');
    if (!p.invitedPhone || !isNormalizablePhone(p.invitedPhone)) issue(ctx, ['invitedPhone'], 'PHONE_INVALID');
  }),
});

function planSchema(c: NeedContext, totalMinor: number | undefined, module: RequestModule | undefined) {
  const datesRequired = !module || module.releaseMode !== 'EVIDENCE_REVIEW';
  return z.object({
    planType: z.enum(PLAN_TYPES as [PlanType, ...PlanType[]], { error: 'PLAN_TYPE_REQUIRED' }),
    recurrence: z.object({ frequency: z.string(), installments: z.number(), startDate: z.string() }).optional(),
    tranches: z.array(z.object({ label: z.string(), amountMinor: z.number(), dueDate: z.string().optional() })).optional(),
  }).superRefine((p, ctx) => {
    const tranches = p.tranches ?? [];
    const n = tranches.length;
    if (n === 0) { issue(ctx, ['tranches'], 'PLAN_EMPTY'); return; }
    if (p.planType === 'SINGLE' && n !== 1) issue(ctx, ['tranches'], 'PLAN_SINGLE_ONE');
    if (p.planType === 'PARTIAL' && n < 2) issue(ctx, ['tranches'], 'PLAN_PARTIAL_MIN', { min: 2 });
    if (p.planType === 'INSTALLMENTS' && (n < INSTALLMENTS_MIN || n > INSTALLMENTS_MAX)) {
      issue(ctx, ['tranches'], 'PLAN_BAD_COUNT', { min: INSTALLMENTS_MIN, max: INSTALLMENTS_MAX });
    }
    if (p.planType === 'RECURRING') {
      const k = p.recurrence?.installments ?? 0;
      if (!p.recurrence || k < RECURRING_MIN || k > RECURRING_MAX || !Number.isInteger(k)) {
        issue(ctx, ['recurrence', 'installments'], 'PLAN_BAD_COUNT', { min: RECURRING_MIN, max: RECURRING_MAX });
      }
    }
    tranches.forEach((t, i) => {
      if (!t.label.trim()) issue(ctx, ['tranches', i, 'label'], 'TRANCHE_LABEL_REQUIRED');
      if (!t.dueDate) { if (datesRequired) issue(ctx, ['tranches', i, 'dueDate'], 'TRANCHE_DATE_REQUIRED'); }
      else if (!isValidIsoDate(t.dueDate)) issue(ctx, ['tranches', i, 'dueDate'], 'DATE_INVALID');
    });
    const dated = tranches.map((t) => t.dueDate).filter((d): d is string => !!d && isValidIsoDate(d));
    const first = dated[0];
    if (first !== undefined && first < c.today) issue(ctx, ['tranches', 0, 'dueDate'], 'FIRST_DATE_IN_PAST');
    for (let i = 1; i < dated.length; i++) {
      if ((dated[i] as string) < (dated[i - 1] as string)) { issue(ctx, ['tranches'], 'DATES_NOT_ASCENDING'); break; }
    }
    if (totalMinor === undefined) return;
    try {
      validatePlan(totalMinor, tranches);
    } catch (e) {
      const code = e instanceof DomainError ? e.code : 'VALIDATION';
      const sum = planSum(tranches);
      issue(ctx, ['tranches'], code, code === 'PLAN_SUM_MISMATCH' ? { sum, total: totalMinor, gap: totalMinor - sum } : undefined);
    }
  });
}

function toIssues(r: z.ZodSafeParseResult<unknown>, prefix = ''): NeedIssue[] {
  if (r.success) return [];
  return r.error.issues.map((i) => ({
    path: prefix + i.path.join('.'),
    code: i.message,
    params: (i as { params?: NeedIssue['params'] }).params,
  }));
}

/**
 * Rôle effectif du créateur, comme save_draft : le rôle explicite du brouillon, sinon demandeur si le profil l’est,
 * sinon payeur (un profil « prestataire » sans rôle explicite crée en payeur, comme avant le lot X).
 */
export function effectiveCreatorRole(draft: Pick<NeedDraft, 'creatorRole'>, profileRole?: CreatorRole): CreatorRole | undefined {
  if (draft.creatorRole) return draft.creatorRole;
  if (profileRole === undefined) return undefined;
  return profileRole === 'REQUESTER' ? 'REQUESTER' : 'PAYER';
}

/** Problèmes de l’étape (vide = étape valide). Le récapitulatif reprend tout le dossier. */
export function validateStep(step: NeedStep, draft: NeedDraft, context: NeedContext): NeedIssue[] {
  const ctx: NeedContext = { ...context, creatorRole: effectiveCreatorRole(draft, context.creatorRole) };
  const modules = ctx.modules ?? DEFAULT_MODULES;
  const module = findModule(draft.vertical, modules);
  switch (step) {
    case 'type': return typeIssues(draft, modules);
    case 'details': return toIssues(detailsSchema(ctx).safeParse(draft));
    // Demande initiée par un prestataire : le prestataire est le créateur, l’étape n’a rien à vérifier.
    case 'provider': return ctx.creatorRole === 'PROVIDER' ? [] : toIssues(providerSchema.safeParse(draft));
    case 'plan': return toIssues(planSchema(ctx, draft.amountMinor, module).safeParse(draft));
    case 'documents': {
      if (!module) return [{ path: 'vertical', code: 'VERTICAL_REQUIRED' }];
      const out: NeedIssue[] = missingModuleDocuments(module, draft.documents)
        .map((kind) => ({ path: `documents.${kind}`, code: 'DOCUMENT_REQUIRED', params: { kind } }));
      if (draft.documents.some((d) => d.status === 'UPLOADING')) out.push({ path: 'documents', code: 'DOCUMENT_UPLOADING' });
      return out;
    }
    case 'recap': return validateNeed(draft, ctx);
  }
}

/** Tous les problèmes du dossier, dans l’ordre des étapes. */
export function validateNeed(draft: NeedDraft, ctx: NeedContext): NeedIssue[] {
  return NEED_STEPS.filter((s) => s !== 'recap').flatMap((s) => validateStep(s, draft, ctx));
}

/** Première étape incomplète (ou « recap » si tout est valide). */
export function firstInvalidStep(draft: NeedDraft, ctx: NeedContext): NeedStep {
  return NEED_STEPS.find((s) => s !== 'recap' && validateStep(s, draft, ctx).length > 0) ?? 'recap';
}

// ——— Constructeurs de plan (purs) ———

export const planSum = (tranches: readonly TrancheDraft[]): number => tranches.reduce((s, t) => s + t.amountMinor, 0);

/** Une tranche pour le montant total, échéance = date souhaitée. */
export function buildSinglePlan(totalMinor: number, dueDate: string | undefined, label: string): TrancheDraft[] {
  return [{ label, amountMinor: totalMinor, dueDate }];
}

/** Acompte et solde : le solde reçoit le reste. Le payeur peut ensuite ajouter des tranches. */
export function buildPartialPlan(input: {
  totalMinor: number; depositMinor: number; depositDate?: string; balanceDate?: string; labels: readonly [string, string];
}): TrancheDraft[] {
  const deposit = Math.min(Math.max(0, Math.round(input.depositMinor)), input.totalMinor);
  return [
    { label: input.labels[0], amountMinor: deposit, dueDate: input.depositDate },
    { label: input.labels[1], amountMinor: input.totalMinor - deposit, dueDate: input.balanceDate },
  ];
}

/** N tranches (2 à 12) aux dates choisies, montants égaux ; la dernière reçoit le reste. */
export function buildInstallmentsPlan(totalMinor: number, dates: readonly string[], label: string): TrancheDraft[] {
  const n = dates.length;
  if (n < INSTALLMENTS_MIN || n > INSTALLMENTS_MAX) throw new DomainError('PLAN_BAD_COUNT', 'Entre 2 et 12 tranches');
  const base = Math.floor(totalMinor / n);
  if (base <= 0) throw new DomainError('PLAN_TOO_SMALL', 'Montant trop faible pour ce nombre de tranches');
  return dates.map((dueDate, i) => ({ label: `${label} ${i + 1}`, amountMinor: i === n - 1 ? totalMinor - base * (n - 1) : base, dueDate }));
}

/** Dates mensuelles par défaut à partir d’une date de début (fin de mois plafonnée). */
export function defaultInstallmentDates(startDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(startDate, i));
}

/** Échéancier récurrent : hebdomadaire, mensuel ou trimestriel (generateRecurringTranches). */
export function buildRecurringPlan(totalMinor: number, recurrence: { frequency: RecurrenceFreq; installments: number; startDate: string }, label: string): TrancheDraft[] {
  return generateRecurringTranches({ totalMinor, ...recurrence, label });
}

/** RG-12 : la tranche est activée (à payer) si elle n’a pas d’échéance ou si l’échéance tombe dans les 7 jours. */
export function shouldActivateTranche(dueDate: string | undefined, today: string): boolean {
  return !dueDate || dueDate <= addDays(today, ACTIVATION_WINDOW_DAYS);
}

/** Règle de déblocage du type de besoin (module), pour l’afficher au récapitulatif. Module inconnu : VERTICAL_REQUIRED. */
export function describeRelease(vertical: ModuleCode, modules: readonly RequestModule[] = DEFAULT_MODULES):
  { releaseMode: ReleaseMode; contestHours: number; dualValidation: boolean } {
  const m = findModule(vertical, modules);
  if (!m) throw new DomainError('VALIDATION', 'Type de besoin inconnu');
  return { releaseMode: m.releaseMode, contestHours: m.contestHours, dualValidation: m.dualValidation };
}

/** Brouillon vide. */
export function emptyDraft(id: string, now: Date, ownerId?: string): NeedDraft {
  return { id, documents: [], updatedAt: now.toISOString(), step: 'type', ownerId };
}
