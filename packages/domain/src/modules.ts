import { DomainError } from './types';
import type { ReleaseMode, Vertical } from './types';
import { MAX_FILES_PER_KIND, REQUIRED_DOCUMENTS } from './documents';
import type { DocumentKind } from './documents';
import { DUAL_THRESHOLDS, RELEASE_RULES, VERTICALS, WAVE1_VERTICALS } from './rules';
import type { Currency, SettlementMode } from './types';

// Lot X (X6) : types de besoin configurables. Un noyau transactionnel commun, des modules décrits par des données
// (table request_modules, migration 0011). Les constantes du code (RELEASE_RULES, REQUIRED_DOCUMENTS, VERTICALS) restent
// les valeurs par défaut du simulateur et des tests ; un test vérifie qu’elles coïncident avec l’amorçage SQL.

/** Code d’un module (type de besoin) : les six connus du code, ou tout code ajouté par une ligne de données. */
export type ModuleCode = string;
export const MODULE_CODE_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
export type PlatformReview = 'ALWAYS' | 'RISK_BASED' | 'NEVER';
export const PLATFORM_REVIEWS: readonly PlatformReview[] = ['ALWAYS', 'RISK_BASED', 'NEVER'];

export interface Labels { fr: string; en: string }
/** Lot X v2 (X6) : sensibilité d’une pièce. SENSITIVE (santé, K13) : consultation journalisée sans nom de fichier ni chemin. */
export type DocumentSensitivity = 'STANDARD' | 'SENSITIVE';
export const DOCUMENT_SENSITIVITIES: readonly DocumentSensitivity[] = ['STANDARD', 'SENSITIVE'];
/** Lot X v2 (X6) : identification du bénéficiaire. REFERENCE_ONLY : code ou initiales, jamais un nom (K13). */
export type BeneficiaryMode = 'NAME' | 'REFERENCE_ONLY' | 'NONE';
export const BENEFICIARY_MODES: readonly BeneficiaryMode[] = ['NAME', 'REFERENCE_ONLY', 'NONE'];
/** Référence minimale du bénéficiaire (miroir de transactions_beneficiary_reference_check), après mise en majuscules. */
export const BENEFICIARY_REFERENCE_RE = /^[A-Z0-9][A-Z0-9./-]{0,15}$/;
export interface ModuleDocument { kind: string; required: boolean; maxFiles: number; labels: Labels; sensitivity: DocumentSensitivity }
export interface RequestModule {
  code: ModuleCode;
  labels: Labels;
  descriptions?: Partial<Labels>;
  enabled: boolean;
  wave: number;
  /** Mode de règlement par défaut des opérations de ce type (K1) : DIRECT en vague 1. */
  settlementMode: SettlementMode;
  /** Règle de libération (CONDITIONAL). */
  releaseMode: ReleaseMode;
  contestHours: number;
  dualValidation: boolean;
  platformReview: PlatformReview;
  /** Expiration d’une demande soumise, en jours (point ouvert 3 : absente = pas d’expiration). */
  requestExpiryDays?: number;
  multiplePayers: boolean;
  requiredDocuments: ModuleDocument[];
  displayOrder: number;
  /** Lot X v2 (X6) : identification du bénéficiaire (NAME par défaut ; santé : REFERENCE_ONLY). */
  beneficiaryMode: BeneficiaryMode;
  /** Durée de conservation en jours (point ouvert 6 : absente tant que non décidée, aucune purge). */
  retentionDays?: number;
}

const VERTICAL_TEXT: Record<Vertical, { labels: Labels; descriptions: Labels }> = {
  EDUCATION: { labels: { fr: 'Scolarité', en: 'Education' }, descriptions: { fr: 'Frais de scolarité, échelonnés si besoin', en: 'School fees, in instalments if needed' } },
  HEALTH: { labels: { fr: 'Santé', en: 'Health' }, descriptions: { fr: 'Soins, hospitalisation, médicaments', en: 'Care, hospital stay, medicines' } },
  RENT: { labels: { fr: 'Loyer', en: 'Rent' }, descriptions: { fr: 'Paiement récurrent au bailleur', en: 'Recurring payment to the landlord' } },
  AGRO: { labels: { fr: 'Agro', en: 'Agri' }, descriptions: { fr: 'Achat à un fournisseur, livraison confirmée', en: 'Purchase from a supplier, confirmed delivery' } },
  REAL_ESTATE: { labels: { fr: 'Immobilier', en: 'Real estate' }, descriptions: { fr: 'Paiement par jalons, avec preuves', en: 'Milestone payments, with evidence' } },
  LAND: { labels: { fr: 'Terrain', en: 'Land' }, descriptions: { fr: 'Paiement par jalons, avec preuves', en: 'Milestone payments, with evidence' } },
};

/** Libellés des pièces connues (mêmes textes que l’application, doc_<kind>). */
export const DOCUMENT_LABELS: Record<DocumentKind, Labels> = {
  QUOTE: { fr: 'Devis ou facture proforma', en: 'Quote or pro forma invoice' },
  BENEFICIARY_ID: { fr: 'Pièce d’identité du bénéficiaire', en: 'Beneficiary’s ID' },
  MEDICAL_CERTIFICATE: { fr: 'Certificat médical', en: 'Medical certificate' },
  ENROLMENT_CERTIFICATE: { fr: 'Attestation d’inscription', en: 'Enrolment certificate' },
  SCHOOL_SCHEDULE: { fr: 'Échéancier de l’école', en: 'School payment schedule' },
  LEASE: { fr: 'Bail', en: 'Lease' },
  LAST_RECEIPT: { fr: 'Dernière quittance', en: 'Latest rent receipt' },
  SUPPORTING_DOCUMENT: { fr: 'Pièce justificative', en: 'Supporting document' },
};

/** Modules par défaut (miroir de l’amorçage de request_modules et des mises à jour de 0014, vérifié par test). */
export const DEFAULT_MODULES: readonly RequestModule[] = VERTICALS.map((v, i) => ({
  code: v,
  labels: VERTICAL_TEXT[v].labels,
  descriptions: VERTICAL_TEXT[v].descriptions,
  enabled: WAVE1_VERTICALS.includes(v),
  wave: WAVE1_VERTICALS.includes(v) ? 1 : 2,
  settlementMode: WAVE1_VERTICALS.includes(v) ? 'DIRECT' : 'CONDITIONAL',
  releaseMode: RELEASE_RULES[v].releaseMode,
  contestHours: RELEASE_RULES[v].contestHours,
  dualValidation: RELEASE_RULES[v].dualValidation,
  platformReview: 'NEVER',   // K2 : le bureau ne valide plus chaque demande
  multiplePayers: false,
  requiredDocuments: REQUIRED_DOCUMENTS[v].map((d) => ({
    kind: d.kind, required: d.required, maxFiles: MAX_FILES_PER_KIND, labels: DOCUMENT_LABELS[d.kind],
    sensitivity: v === 'HEALTH' ? 'SENSITIVE' as const : 'STANDARD' as const,
  })),
  displayOrder: i + 1,
  beneficiaryMode: v === 'HEALTH' ? 'REFERENCE_ONLY' : 'NAME',   // K13 (0022)
}));

/**
 * Bénéficiaire d’un brouillon selon le module (miroir de save_draft, 0022) : NAME garde le nom ; REFERENCE_ONLY refuse un
 * nom (BENEFICIARY_NAME_NOT_ALLOWED) et n’accepte qu’une référence courte sans espace (BENEFICIARY_REFERENCE_INVALID) ;
 * NONE refuse un nom et ignore la référence. Renvoie les valeurs enregistrées.
 */
export function checkBeneficiary(module: RequestModule | undefined, input: { name?: string; reference?: string }): { name?: string; reference?: string } {
  const name = input.name?.trim() || undefined;
  const reference = input.reference?.trim().toUpperCase() || undefined;
  const mode = module?.beneficiaryMode ?? 'NAME';
  if (mode === 'NAME') return { name };
  if (name) throw new DomainError('BENEFICIARY_NAME_NOT_ALLOWED', 'Ce type de besoin n’enregistre pas le nom du bénéficiaire');
  if (mode === 'NONE') return {};
  if (reference && !BENEFICIARY_REFERENCE_RE.test(reference)) {
    throw new DomainError('BENEFICIARY_REFERENCE_INVALID', 'Référence : code ou initiales, sans espace (16 caractères au plus)');
  }
  return { reference };
}

/** Le type de pièce est-il prévu par le module ? (miroir de DOCUMENT_KIND_NOT_ALLOWED, 0022 et 0023 ; module sans liste : tout type). */
export function isAllowedKind(module: RequestModule | undefined, kind: string): boolean {
  // La preuve de jalon (EVIDENCE) n’est pas une pièce du module : toujours acceptée (0023).
  return !module || kind === 'EVIDENCE' || module.requiredDocuments.length === 0 || module.requiredDocuments.some((d) => d.kind === kind);
}

/** Pièce sensible (consultation journalisée sans nom de fichier ni chemin). */
export function isSensitiveKind(module: RequestModule | undefined, kind: string): boolean {
  return module?.requiredDocuments.some((d) => d.kind === kind && d.sensitivity === 'SENSITIVE') ?? false;
}

/** Module d’un code (undefined si inconnu). */
export function findModule(code: string | undefined, modules: readonly RequestModule[] = DEFAULT_MODULES): RequestModule | undefined {
  return code === undefined ? undefined : modules.find((m) => m.code === code);
}

/** Modules triés pour l’affichage (ordre, puis code). */
export function sortModules(modules: readonly RequestModule[]): RequestModule[] {
  return [...modules].sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));
}

/** Libellé d’un module dans une langue (code brut si inconnu). */
export function moduleLabel(code: string, locale: 'fr' | 'en', modules: readonly RequestModule[] = DEFAULT_MODULES): string {
  return findModule(code, modules)?.labels[locale] ?? code;
}

/** Pièces obligatoires du module sans aucun fichier envoyé (miroir du contrôle DOCUMENT_REQUIRED de transition_tx). */
export function missingModuleDocuments(module: RequestModule, documents: ReadonlyArray<{ kind: string; status: string }>): string[] {
  return module.requiredDocuments
    .filter((d) => d.required && !documents.some((x) => x.kind === d.kind && x.status === 'UPLOADED'))
    .map((d) => d.kind);
}

/** Nombre maximal de fichiers pour un type de pièce (3 par défaut, décision D2). */
export function maxFilesFor(module: RequestModule | undefined, kind: string): number {
  return module?.requiredDocuments.find((d) => d.kind === kind)?.maxFiles ?? MAX_FILES_PER_KIND;
}

/** Nombre de validateurs requis (miroir de required_validations, lu dans le module) : 2 si le module l’exige ou au seuil. */
export function requiredValidationsFor(module: RequestModule | undefined, currency: Currency, amountMinor: number): 1 | 2 {
  if (module?.dualValidation) return 2;
  return amountMinor >= DUAL_THRESHOLDS[currency] ? 2 : 1;
}

export type ReviewReason = 'ALWAYS' | 'DUAL_VALIDATION' | 'THRESHOLD_NOT_CONFIGURED' | 'AMOUNT_THRESHOLD' | 'FIRST_REQUEST' | 'DUPLICATE';

/**
 * L’opération passe-t-elle par le bureau de contrôle (miroir de _platform_review, 0014) ? NEVER (défaut, K2) : non ;
 * ALWAYS : oui ; RISK_BASED : oui si le montant atteint le seuil (réglage risk_review_threshold, point ouvert 4 ; absent :
 * revue par prudence), pour une première demande de l’initiateur, ou pour un doublon. Dans tous les cas, deux validateurs
 * exigés (module ou seuil de montant) : oui — la double validation est toujours appliquée.
 */
export function platformReviewDecision(module: RequestModule | undefined, ctx: {
  requiredValidations: 1 | 2; firstRequest: boolean; duplicate: boolean; amountMinor?: number; riskThresholdMinor?: number;
}): { review: boolean; reasons: ReviewReason[] } {
  const reasons: ReviewReason[] = [];
  if (!module || module.platformReview === 'ALWAYS') reasons.push('ALWAYS');
  if (ctx.requiredValidations >= 2) reasons.push('DUAL_VALIDATION');
  if (module?.platformReview === 'RISK_BASED') {
    if (ctx.riskThresholdMinor === undefined) reasons.push('THRESHOLD_NOT_CONFIGURED');
    else if ((ctx.amountMinor ?? 0) >= ctx.riskThresholdMinor) reasons.push('AMOUNT_THRESHOLD');
    if (ctx.firstRequest) reasons.push('FIRST_REQUEST');
    if (ctx.duplicate) reasons.push('DUPLICATE');
  }
  return { review: reasons.length > 0, reasons };
}

/**
 * Lot X (X7) : un payeur de plus n’est accepté que si le module l’autorise (multiple_payers, faux partout). Miroir du
 * déclencheur _check_multiple_payers. `payers` : payeurs déjà au dossier.
 */
export function checkAddPayer(module: RequestModule | undefined, payers: number): void {
  if (payers >= 1 && !module?.multiplePayers) throw new DomainError('MULTIPLE_PAYERS_NOT_ALLOWED', 'Un seul payeur pour ce type de besoin');
}

/** Contrôle d’un module décrit par des données (miroir de _check_module_documents). */
export function checkModule(m: RequestModule): void {
  const bad = (what: string) => { throw new DomainError('VALIDATION', `Module invalide : ${what}`); };
  if (!MODULE_CODE_RE.test(m.code)) bad('code');
  if (m.labels.fr.trim().length < 2 || m.labels.en.trim().length < 2) bad('libellés');
  if (!PLATFORM_REVIEWS.includes(m.platformReview)) bad('platform_review');
  if (!BENEFICIARY_MODES.includes(m.beneficiaryMode)) bad('beneficiary_mode');
  if (m.retentionDays !== undefined && (!Number.isInteger(m.retentionDays) || m.retentionDays < 1 || m.retentionDays > 36_500)) bad('retention_days');
  const kinds = new Set<string>();
  for (const d of m.requiredDocuments) {
    if (!MODULE_CODE_RE.test(d.kind) || !Number.isInteger(d.maxFiles) || d.maxFiles < 1 || d.maxFiles > 10
        || d.labels.fr.trim().length < 2 || d.labels.en.trim().length < 2 || !DOCUMENT_SENSITIVITIES.includes(d.sensitivity)) bad(`pièce ${d.kind}`);
    if (kinds.has(d.kind)) bad(`pièce ${d.kind} en double`);
    kinds.add(d.kind);
  }
}
