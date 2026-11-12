import { DomainError } from './types';
import type { ReleaseMode, Vertical } from './types';
import { MAX_FILES_PER_KIND, REQUIRED_DOCUMENTS } from './documents';
import type { DocumentKind } from './documents';
import { DUAL_THRESHOLDS, RELEASE_RULES, VERTICALS, WAVE1_VERTICALS } from './rules';
import type { Currency } from './types';

// Lot X (X6) : types de besoin configurables. Un noyau transactionnel commun, des modules décrits par des données
// (table request_modules, migration 0011). Les constantes du code (RELEASE_RULES, REQUIRED_DOCUMENTS, VERTICALS) restent
// les valeurs par défaut du simulateur et des tests ; un test vérifie qu’elles coïncident avec l’amorçage SQL.

/** Code d’un module (type de besoin) : les six connus du code, ou tout code ajouté par une ligne de données. */
export type ModuleCode = string;
export const MODULE_CODE_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
export type PlatformReview = 'ALWAYS' | 'RISK_BASED' | 'NEVER';
export const PLATFORM_REVIEWS: readonly PlatformReview[] = ['ALWAYS', 'RISK_BASED', 'NEVER'];

export interface Labels { fr: string; en: string }
export interface ModuleDocument { kind: string; required: boolean; maxFiles: number; labels: Labels }
export interface RequestModule {
  code: ModuleCode;
  labels: Labels;
  descriptions?: Partial<Labels>;
  enabled: boolean;
  wave: number;
  releaseMode: ReleaseMode;
  contestHours: number;
  dualValidation: boolean;
  platformReview: PlatformReview;
  multiplePayers: boolean;
  requiredDocuments: ModuleDocument[];
  displayOrder: number;
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

/** Modules par défaut : les valeurs actuelles du code (miroir de l’amorçage de request_modules, vérifié par test). */
export const DEFAULT_MODULES: readonly RequestModule[] = VERTICALS.map((v, i) => ({
  code: v,
  labels: VERTICAL_TEXT[v].labels,
  descriptions: VERTICAL_TEXT[v].descriptions,
  enabled: WAVE1_VERTICALS.includes(v),
  wave: WAVE1_VERTICALS.includes(v) ? 1 : 2,
  releaseMode: RELEASE_RULES[v].releaseMode,
  contestHours: RELEASE_RULES[v].contestHours,
  dualValidation: RELEASE_RULES[v].dualValidation,
  platformReview: 'ALWAYS',
  multiplePayers: false,
  requiredDocuments: REQUIRED_DOCUMENTS[v].map((d) => ({ kind: d.kind, required: d.required, maxFiles: MAX_FILES_PER_KIND, labels: DOCUMENT_LABELS[d.kind] })),
  displayOrder: i + 1,
}));

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

export type ReviewReason = 'ALWAYS' | 'DUAL_VALIDATION' | 'FIRST_REQUEST' | 'DUPLICATE';

/**
 * Le dossier passe-t-il par le bureau de contrôle (miroir de _platform_review, 0011) ? ALWAYS : oui ; NEVER : non ;
 * RISK_BASED : oui pour une première demande ou un doublon. Dans tous les cas, deux validateurs exigés (module ou seuil de
 * montant) : oui — la double validation est toujours appliquée.
 */
export function platformReviewDecision(module: RequestModule | undefined, ctx: { requiredValidations: 1 | 2; firstRequest: boolean; duplicate: boolean }):
  { review: boolean; reasons: ReviewReason[] } {
  const reasons: ReviewReason[] = [];
  if (!module || module.platformReview === 'ALWAYS') reasons.push('ALWAYS');
  if (ctx.requiredValidations >= 2) reasons.push('DUAL_VALIDATION');
  if (module?.platformReview === 'RISK_BASED') {
    if (ctx.firstRequest) reasons.push('FIRST_REQUEST');
    if (ctx.duplicate) reasons.push('DUPLICATE');
  }
  return { review: reasons.length > 0, reasons };
}

/** Contrôle d’un module décrit par des données (miroir de _check_module_documents). */
export function checkModule(m: RequestModule): void {
  const bad = (what: string) => { throw new DomainError('VALIDATION', `Module invalide : ${what}`); };
  if (!MODULE_CODE_RE.test(m.code)) bad('code');
  if (m.labels.fr.trim().length < 2 || m.labels.en.trim().length < 2) bad('libellés');
  if (!PLATFORM_REVIEWS.includes(m.platformReview)) bad('platform_review');
  const kinds = new Set<string>();
  for (const d of m.requiredDocuments) {
    if (!MODULE_CODE_RE.test(d.kind) || !Number.isInteger(d.maxFiles) || d.maxFiles < 1 || d.maxFiles > 10
        || d.labels.fr.trim().length < 2 || d.labels.en.trim().length < 2) bad(`pièce ${d.kind}`);
    if (kinds.has(d.kind)) bad(`pièce ${d.kind} en double`);
    kinds.add(d.kind);
  }
}
