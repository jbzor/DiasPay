import { DomainError } from './types';
import type { Actor, TrancheDraft, TxStatus } from './types';
import { validatePlan } from './plan';

// Lot X version 2 : machine d’états d’une opération (modèle cible, section 3.1). Miroir de allowed_transitions (0014).
// Qui : INITIATOR (l’initiateur de l’opération), STAFF (personnel non partie : validateur ou administrateur), SYSTEM.

export type OperationActor = 'INITIATOR' | 'STAFF' | 'SYSTEM';

export const OPERATION_TRANSITIONS: ReadonlyArray<readonly [TxStatus, TxStatus, readonly OperationActor[]]> = [
  ['DRAFT', 'ACTIVE', ['INITIATOR']],              // soumission, platform_review NEVER (ou sans risque) : AUTO_ACTIVATED
  ['DRAFT', 'PENDING_REVIEW', ['INITIATOR']],      // soumission, revue par le bureau
  ['PENDING_REVIEW', 'IN_REVIEW', ['STAFF']],      // prise en charge (file du lot 5)
  ['PENDING_REVIEW', 'ACTIVE', ['STAFF']],
  ['IN_REVIEW', 'ACTIVE', ['STAFF']],
  ['PENDING_REVIEW', 'CANCELLED', ['STAFF']],
  ['IN_REVIEW', 'CANCELLED', ['STAFF']],
  ['ACTIVE', 'SUSPENDED', ['SYSTEM', 'STAFF']],    // litige avant paiement, ou fraude
  ['SUSPENDED', 'ACTIVE', ['SYSTEM', 'STAFF']],    // litige résolu, ou levée par le personnel
  ['ACTIVE', 'CLOSED', ['SYSTEM']],
  ['DRAFT', 'CANCELLED', ['INITIATOR']],
  ['ACTIVE', 'CANCELLED', ['INITIATOR']],
];

export interface SubmitContext {
  totalMinor: number;
  tranches: readonly TrancheDraft[];
  hasSupportingDocument: boolean;
}

function whoOf(actor: Actor): OperationActor[] {
  if (actor.kind === 'SYSTEM') return ['SYSTEM'];
  const out: OperationActor[] = [];
  if (actor.isCreator) out.push('INITIATOR');
  if (actor.isValidator && actor.roles.length === 0) out.push('STAFF');
  return out;
}

export function canTransitionOperation(from: TxStatus, to: TxStatus, actor: Actor): boolean {
  const row = OPERATION_TRANSITIONS.find(([f, t]) => f === from && t === to);
  return !!row && whoOf(actor).some((w) => row[2].includes(w));
}

/**
 * Transition d’une opération (pure). Mêmes codes que transition_tx : TRANSITION_UNKNOWN, puis pour une transition du
 * personnel VALIDATOR_ONLY / VALIDATOR_IS_PARTY, sinon TRANSITION_FORBIDDEN. La soumission vérifie le plan et les pièces.
 */
export function transitionOperation(status: TxStatus, to: TxStatus, actor: Actor, ctx?: SubmitContext): TxStatus {
  const row = OPERATION_TRANSITIONS.find(([f, t]) => f === status && t === to);
  if (!row) throw new DomainError('TRANSITION_UNKNOWN', `Transition ${status} -> ${to} inconnue`);
  if (actor.kind === 'USER' && row[2].includes('STAFF') && !row[2].includes('INITIATOR')) {
    if (!actor.isValidator) throw new DomainError('VALIDATOR_ONLY', 'Réservé aux validateurs');
    if (actor.roles.length > 0) throw new DomainError('VALIDATOR_IS_PARTY', 'Un validateur ne peut pas agir sur un dossier dont il est partie');
  }
  if (!canTransitionOperation(status, to, actor)) throw new DomainError('TRANSITION_FORBIDDEN', `Transition ${status} -> ${to} non autorisée`);
  if (status === 'DRAFT' && (to === 'ACTIVE' || to === 'PENDING_REVIEW')) {
    if (!ctx) throw new DomainError('TX_CONTEXT_REQUIRED', 'Contexte de soumission manquant');
    validatePlan(ctx.totalMinor, ctx.tranches);
    if (!ctx.hasSupportingDocument) throw new DomainError('TX_NO_DOCUMENT', 'Au moins une pièce justificative est requise');
  }
  return to;
}

/** Statut après la soumission : ACTIVE sans revue (platform_review NEVER ou sans risque), PENDING_REVIEW sinon. */
export function submissionTarget(review: { review: boolean }): 'ACTIVE' | 'PENDING_REVIEW' {
  return review.review ? 'PENDING_REVIEW' : 'ACTIVE';
}
