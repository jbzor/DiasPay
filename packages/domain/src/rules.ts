import type { Currency, ReleaseMode, Vertical } from './types';

export interface ReleaseRule {
  releaseMode: ReleaseMode;
  contestHours: number;
  dualValidation: boolean;
}

// Valeurs de départ, à confirmer avec le client et son conseil juridique.
// Miroir de la table SQL release_rules.
export const RELEASE_RULES: Record<Vertical, ReleaseRule> = {
  EDUCATION:   { releaseMode: 'PROVIDER_CONFIRM', contestHours: 72, dualValidation: false },
  HEALTH:      { releaseMode: 'PROVIDER_CONFIRM', contestHours: 48, dualValidation: false },
  RENT:        { releaseMode: 'PROVIDER_CONFIRM', contestHours: 72, dualValidation: false },
  AGRO:        { releaseMode: 'PAYER_CONFIRM',    contestHours: 72, dualValidation: false },
  REAL_ESTATE: { releaseMode: 'EVIDENCE_REVIEW',  contestHours: 0,  dualValidation: true },
  LAND:        { releaseMode: 'EVIDENCE_REVIEW',  contestHours: 0,  dualValidation: true },
};

// Seuils de double validation (miroir de dual_thresholds), en unités mineures.
export const DUAL_THRESHOLDS: Record<Currency, number> = {
  EUR: 500_000,
  USD: 550_000,
  XAF: 3_000_000,
};

/** Nombre de validateurs distincts requis (1 ou 2). */
export function requiredValidations(vertical: Vertical, currency: Currency, amountMinor: number): 1 | 2 {
  if (RELEASE_RULES[vertical].dualValidation) return 2;
  return amountMinor >= DUAL_THRESHOLDS[currency] ? 2 : 1;
}

export type EvidenceOutcome = 'REJECTED' | 'PARTIAL' | 'APPROVED';

/** Résultat d'une décision de validateur sur un dossier ou une preuve. */
export function evidenceOutcome(input: {
  approved: boolean;
  approverIds: readonly string[]; // validateurs distincts ayant approuvé, décision courante incluse
  required: number;
}): EvidenceOutcome {
  if (!input.approved) return 'REJECTED';
  const distinct = new Set(input.approverIds).size;
  return distinct >= input.required ? 'APPROVED' : 'PARTIAL';
}
