import { DomainError } from './types';
import type { Actor, TrancheDraft, TxRole, TxStatus } from './types';
import { validatePlan } from './plan';

type Who = TxRole | 'SYSTEM' | 'VALIDATOR';

// Miroir de allowed_transitions (SQL v0.1 + v0.2, niveau transaction).
const TX_TRANSITIONS: ReadonlyArray<readonly [TxStatus, TxStatus, readonly Who[]]> = [
  ['DRAFT', 'SUBMITTED', ['REQUESTER', 'PAYER']],
  ['SUBMITTED', 'IN_REVIEW', ['VALIDATOR']],
  ['IN_REVIEW', 'VALIDATED', ['VALIDATOR']],
  ['IN_REVIEW', 'REJECTED', ['VALIDATOR']],
  ['REJECTED', 'DRAFT', ['REQUESTER', 'PAYER']],
  // Décision D4 : abandon d’un dossier rejeté (aucune autre transition vers CANCELLED).
  ['REJECTED', 'CANCELLED', ['REQUESTER', 'PAYER']],
  ['VALIDATED', 'TOKEN_ISSUED', ['SYSTEM']],
  ['TOKEN_ISSUED', 'IN_PROGRESS', ['SYSTEM']],
  ['IN_PROGRESS', 'CLOSED', ['SYSTEM']],
  ['IN_PROGRESS', 'DISPUTED', ['PAYER', 'PROVIDER']],
];

export interface SubmitContext {
  totalMinor: number;
  tranches: readonly TrancheDraft[];
  hasSupportingDocument: boolean;
}

function allowedFor(from: TxStatus, to: TxStatus): readonly Who[] | undefined {
  return TX_TRANSITIONS.find(([f, t]) => f === from && t === to)?.[2];
}

export function canTransitionTx(from: TxStatus, to: TxStatus, actor: Actor): boolean {
  const who = allowedFor(from, to);
  if (!who) return false;
  if (actor.kind === 'SYSTEM') return who.includes('SYSTEM');
  if (who.includes('VALIDATOR')) {
    // Un validateur ne peut pas être partie au dossier.
    return actor.isValidator && actor.roles.length === 0;
  }
  return actor.roles.some((r) => who.includes(r));
}

/** Renvoie le nouveau statut ou lève une DomainError. Fonction pure. */
export function transitionTx(
  status: TxStatus,
  to: TxStatus,
  actor: Actor,
  ctx?: SubmitContext,
): TxStatus {
  if (!allowedFor(status, to)) {
    throw new DomainError('TX_TRANSITION_UNKNOWN', `Transition ${status} -> ${to} non autorisée`);
  }
  if (!canTransitionTx(status, to, actor)) {
    throw new DomainError('TX_TRANSITION_FORBIDDEN', `Rôle non autorisé pour ${status} -> ${to}`);
  }
  if (status === 'DRAFT' && to === 'SUBMITTED') {
    if (!ctx) throw new DomainError('TX_CONTEXT_REQUIRED', 'Contexte de soumission manquant');
    validatePlan(ctx.totalMinor, ctx.tranches);
    if (!ctx.hasSupportingDocument) {
      throw new DomainError('TX_NO_DOCUMENT', 'Au moins une pièce justificative est requise');
    }
  }
  return to;
}
