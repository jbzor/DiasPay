import { DomainError } from './types';
import type { ErrorCode } from './errors';
import { DISPUTE_OUTCOMES } from './disputes';

/**
 * Décisions du bureau de contrôle (lot 5). Miroir de decide_tx, decide_tranche et resolve_dispute (0005, 0006) :
 * mêmes règles, mêmes codes ; la base les applique de toute façon.
 */
export const MIN_DECISION_TEXT = 3;

const textOk = (s: string | null | undefined) => (s ?? '').trim().length >= MIN_DECISION_TEXT;

/** Dossier : motif obligatoire pour un rejet ; case « J’ai vérifié que le montant correspond aux pièces » pour une approbation (D6). */
export function validatorDecisionError(d: { approved: boolean; amountChecked: boolean; reason?: string | null }): ErrorCode | null {
  if (!d.approved) return textOk(d.reason) ? null : 'REASON_REQUIRED';
  return d.amountChecked ? null : 'AMOUNT_NOT_CHECKED';
}

/** Preuve de jalon : motif obligatoire pour un rejet (la lisibilité de la pièce est un contrôle humain). */
export function evidenceDecisionError(d: { approved: boolean; reason?: string | null }): ErrorCode | null {
  return d.approved || textOk(d.reason) ? null : 'REASON_REQUIRED';
}

/** Lot X v2 : issues du litige distinct (miroir de _resolve_dispute_v2) ; note de décision obligatoire. */
export function disputeDecisionError(d: { outcome: string; note?: string | null }): ErrorCode | null {
  if (!(DISPUTE_OUTCOMES as readonly string[]).includes(d.outcome)) return 'INVALID_OUTCOME';
  return textOk(d.note) ? null : 'REASON_REQUIRED';
}

export function assertNoError(code: ErrorCode | null): void {
  if (code) throw new DomainError(code, code);
}
