import { DomainError } from './types';
import type { Currency } from './types';

// Lot X version 2 (X4, K3) : enrôlement et niveaux. Miroir de 0020_lotx2_x4.sql (mêmes règles, mêmes codes).
// N0 compte de base ; N1 particulier (pièce d’identité et selfie) ; N2 commerçant (N1 du représentant, immatriculation,
// justificatif d’activité) ; N3 institution (documents légaux, mandat du représentant, revue manuelle par le bureau).

export type EnrolmentLevel = 'N0' | 'N1' | 'N2' | 'N3';
export const ENROLMENT_LEVELS: readonly EnrolmentLevel[] = ['N0', 'N1', 'N2', 'N3'];
export type EnrolmentCaseStatus = 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
export type EnrolmentRoute = 'KYC' | 'MANUAL';
export type KycResult = 'APPROVED' | 'REJECTED' | 'REVIEW';
export type EnrolmentDocumentKind =
  | 'ID_DOCUMENT' | 'SELFIE' | 'BUSINESS_REGISTRATION' | 'ACTIVITY_PROOF' | 'LEGAL_DOCUMENTS' | 'REPRESENTATIVE_MANDATE';

/** Pièces exigées par niveau demandé (miroir de _enrolment_required_kinds). */
export const ENROLMENT_REQUIREMENTS: Record<Exclude<EnrolmentLevel, 'N0'>, readonly EnrolmentDocumentKind[]> = {
  N1: ['ID_DOCUMENT', 'SELFIE'],
  N2: ['BUSINESS_REGISTRATION', 'ACTIVITY_PROOF'],
  N3: ['LEGAL_DOCUMENTS', 'REPRESENTATIVE_MANDATE'],
};
export const ENROLMENT_DOCUMENT_KINDS: readonly EnrolmentDocumentKind[] = [
  'ID_DOCUMENT', 'SELFIE', 'BUSINESS_REGISTRATION', 'ACTIVITY_PROOF', 'LEGAL_DOCUMENTS', 'REPRESENTATIVE_MANDATE',
];

export const levelRank = (l: EnrolmentLevel | undefined): number => ENROLMENT_LEVELS.indexOf(l ?? 'N0');

export type InitiatorRole = 'PAYER' | 'REQUESTER' | 'PROVIDER';
/** Niveau requis pour initier (miroir de _required_level) : demandeur N1, prestataire (commerçant) N2, payeur N0. */
export function requiredLevelToInitiate(role: InitiatorRole): EnrolmentLevel {
  return role === 'PROVIDER' ? 'N2' : role === 'REQUESTER' ? 'N1' : 'N0';
}

/** Contrôle de save_draft et de la soumission (ENROLMENT_REQUIRED ; le serveur ajoute le détail : niveau requis et actuel). */
export function checkInitiation(level: EnrolmentLevel | undefined, role: InitiatorRole): void {
  const required = requiredLevelToInitiate(role);
  if (levelRank(level) < levelRank(required)) {
    throw new DomainError('ENROLMENT_REQUIRED', `Niveau d’enrôlement ${required} requis pour initier une demande`);
  }
}

/** Route d’un dossier : N1 et N2 passent par l’adaptateur KYC, N3 par la revue manuelle. */
export const enrolmentRoute = (level: EnrolmentLevel): EnrolmentRoute => (level === 'N3' ? 'MANUAL' : 'KYC');

export interface EnrolmentDocumentInput { kind: string; path: string; contentHash?: string; mimeType?: string; sizeBytes?: number }

/** Contrôle d’une soumission (miroir de submit_enrolment, dans le même ordre). */
export function checkEnrolmentSubmission(input: {
  userId: string; current: EnrolmentLevel | undefined; requested: string; hasOpenCase: boolean; documents: readonly EnrolmentDocumentInput[];
}): void {
  const req = input.requested as EnrolmentLevel;
  if (!['N1', 'N2', 'N3'].includes(req)) throw new DomainError('VALIDATION', 'Niveau demandé invalide');
  if (levelRank(req) <= levelRank(input.current)) throw new DomainError('ALREADY_ENROLLED', 'Niveau déjà atteint');
  if (req !== 'N1' && levelRank(input.current) < 1) {
    throw new DomainError('ENROLMENT_REQUIRED', 'Le niveau N1 du représentant est requis d’abord');
  }
  if (input.hasOpenCase) throw new DomainError('ENROLMENT_PENDING', 'Un dossier d’enrôlement est déjà en cours');
  if (input.documents.length === 0 || input.documents.length > 10) throw new DomainError('VALIDATION', 'Pièces du dossier manquantes');
  const pathRe = new RegExp(`^${input.userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z0-9._/-]{1,200}$`);
  for (const d of input.documents) {
    if (!pathRe.test(d.path) || d.path.includes('..')) throw new DomainError('VALIDATION', 'Chemin de pièce invalide');
    if (d.contentHash !== undefined && !/^[0-9a-fA-F]{64}$/.test(d.contentHash)) throw new DomainError('HASH_INVALID', 'Empreinte invalide');
  }
  const kinds = input.documents.map((d) => d.kind);
  const missing = ENROLMENT_REQUIREMENTS[req as Exclude<EnrolmentLevel, 'N0'>].find((k) => !kinds.includes(k));
  if (missing) throw new DomainError('DOCUMENT_REQUIRED', `Pièce obligatoire manquante : ${missing}`);
  if (kinds.some((k) => !(ENROLMENT_DOCUMENT_KINDS as readonly string[]).includes(k))) throw new DomainError('VALIDATION', 'Type de pièce inconnu');
}

// ——— Plafonds (point ouvert 1 : aucune valeur fournie, aucune inventée) ———

/** Ligne de enrolment_limits. Valeur absente : pas de plafond pour cette fenêtre. */
export interface EnrolmentLimit { level: EnrolmentLevel; currency: Currency; perOperationMinor?: number; perDayMinor?: number; perMonthMinor?: number; devOnly?: boolean }
export type LimitsWhenMissing = 'REFUSE' | 'ALLOW';

/**
 * Plafonds du payeur à l’acceptation d’une demande (miroir de _check_payer_limits) : ligne absente → refus prudent
 * (LIMITS_NOT_CONFIGURED) sauf réglage explicite ALLOW ; sinon par paiement, puis jour et mois civils UTC
 * (montants des tentatives en cours ou confirmées, dans la devise de la demande).
 */
export function checkLimits(input: {
  limit: EnrolmentLimit | undefined; level: EnrolmentLevel; currency: Currency; amountMinor: number;
  usedTodayMinor: number; usedThisMonthMinor: number; whenMissing?: LimitsWhenMissing;
}): void {
  const l = input.limit;
  if (!l) {
    if (input.whenMissing === 'ALLOW') return;
    throw new DomainError('LIMITS_NOT_CONFIGURED', 'Plafonds non configurés pour ce niveau : paiement refusé par prudence');
  }
  if (l.perOperationMinor != null && input.amountMinor > l.perOperationMinor) {
    throw new DomainError('LIMIT_EXCEEDED', 'Plafond par paiement dépassé');
  }
  if (l.perDayMinor != null && input.usedTodayMinor + input.amountMinor > l.perDayMinor) {
    throw new DomainError('LIMIT_EXCEEDED', 'Plafond journalier dépassé');
  }
  if (l.perMonthMinor != null && input.usedThisMonthMinor + input.amountMinor > l.perMonthMinor) {
    throw new DomainError('LIMIT_EXCEEDED', 'Plafond mensuel dépassé');
  }
}

/** Lignes de développement du simulateur (miroir de l’amorçage mock_mode) : tous niveaux et devises, sans plafond. */
export const DEV_ENROLMENT_LIMITS: readonly EnrolmentLimit[] = ENROLMENT_LEVELS.flatMap((level) =>
  (['XAF', 'EUR', 'USD'] as const).map((currency) => ({ level, currency, devOnly: true })));

// ——— KycPort (N1, N2) ———

export interface KycCheckInput { caseId: string; userId: string; level: 'N1' | 'N2'; documents: readonly EnrolmentDocumentInput[] }
export interface KycCheckResult { result: KycResult; reference: string; reason?: string; provider: string }

/** Prestataire de vérification d’identité. L’adaptateur réel appellera apply_kyc_result (rôle service) ; pas encore choisi. */
export interface KycPort {
  readonly provider: string;
  check(input: KycCheckInput): Promise<KycCheckResult>;
}

/** Adaptateur simulé : résultat configurable (comme app_config.kyc_simulated_result), éventuellement par dossier. */
export class SimulatedKycAdapter implements KycPort {
  readonly provider = 'SIMULATED';
  private n = 0;
  constructor(private readonly opts: { result?: KycResult | ((input: KycCheckInput) => KycResult) } = {}) {}
  async check(input: KycCheckInput): Promise<KycCheckResult> {
    const r = typeof this.opts.result === 'function' ? this.opts.result(input) : (this.opts.result ?? 'APPROVED');
    return { result: r, reference: `SIMKYC-${++this.n}`, provider: this.provider, ...(r === 'REJECTED' ? { reason: 'Refus simulé' } : {}) };
  }
}

/** Effet d’un résultat KYC sur un dossier (miroir de _apply_kyc) : un dossier tranché ne change plus. */
export function applyKycResult(status: EnrolmentCaseStatus, result: KycResult): EnrolmentCaseStatus {
  if (status === 'APPROVED' || status === 'REJECTED') return status;
  return result === 'APPROVED' ? 'APPROVED' : result === 'REJECTED' ? 'REJECTED' : status;
}
