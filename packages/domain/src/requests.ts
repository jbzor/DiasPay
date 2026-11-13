import { DomainError } from './types';
import type { TrancheStatus } from './types';

// Lot X : décisions du payeur sur une demande (X2), révocation des jetons et limitation des résolutions (X1).
// Miroirs des fonctions SQL de 0008 : même ordre de contrôles, mêmes codes (docs/error-codes.md).

/** Message ou motif d’une demande : 3 à 2000 caractères (miroir de _check_message). */
export const MESSAGE_MIN = 3;
export const MESSAGE_MAX = 2000;

export type RequestMessageKind = 'INFO_REQUEST' | 'INFO_ANSWER' | 'NOTE';

export function messageError(text: string | null | undefined): 'REASON_REQUIRED' | 'VALIDATION' | null {
  const t = (text ?? '').trim();
  if (t.length < MESSAGE_MIN) return 'REASON_REQUIRED';
  if (t.length > MESSAGE_MAX) return 'VALIDATION';
  return null;
}

/** Place de l’utilisateur dans la demande : payeur, initiateur (créateur du dossier). */
export interface RequestParty { isPayer: boolean; isCreator: boolean; /** Demande suspendue par un litige avant paiement. */ onHold?: boolean }

function checkMessage(text: string | null | undefined): void {
  const code = messageError(text);
  if (code) throw new DomainError(code, code === 'VALIDATION' ? 'Message trop long' : 'Message ou motif obligatoire');
}

/** Le payeur demande des informations complémentaires (miroir de request_info). */
export function requestInfoDecision(status: TrancheStatus, who: RequestParty, message: string): 'INFO_REQUESTED' {
  if (!who.isPayer) throw new DomainError('PAYER_ONLY', 'Réservé au payeur');
  if (status !== 'SUBMITTED') throw new DomainError('TRANSITION_UNKNOWN', `Transition de demande ${status} -> INFO_REQUESTED inconnue`);
  if (who.isCreator) throw new DomainError('TRANSITION_FORBIDDEN', 'Vous êtes l’initiateur de cette demande');
  if (who.onHold) throw new DomainError('REQUEST_ON_HOLD', 'Demande suspendue par un litige');
  checkMessage(message);
  return 'INFO_REQUESTED';
}

/** L’initiateur répond : la demande redevient soumise (miroir de answer_info). */
export function answerInfoDecision(status: TrancheStatus, who: RequestParty, message: string): 'SUBMITTED' {
  if (!who.isCreator) throw new DomainError('INITIATOR_ONLY', 'Réservé à l’initiateur de la demande');
  if (status !== 'INFO_REQUESTED') throw new DomainError('TRANSITION_UNKNOWN', `Transition de demande ${status} -> SUBMITTED inconnue`);
  checkMessage(message);
  return 'SUBMITTED';
}

/** Le payeur rejette la demande : REJECTED, terminal ; le jeton est révoqué (miroir de reject_request). */
export function rejectRequestDecision(status: TrancheStatus, who: RequestParty, reason: string): 'REJECTED' {
  if (!who.isPayer) throw new DomainError('PAYER_ONLY', 'Réservé au payeur');
  if (status !== 'SUBMITTED' && status !== 'INFO_REQUESTED') {
    throw new DomainError('TRANSITION_UNKNOWN', `Transition de demande ${status} -> REJECTED inconnue`);
  }
  checkMessage(reason);
  return 'REJECTED';
}

/** Statuts où l’initiateur peut encore révoquer le jeton : la demande n’est pas payée (miroir de _check_token_manager, 0014). */
export const REVOCABLE_BY_INITIATOR: readonly TrancheStatus[] = ['DRAFT', 'SUBMITTED', 'INFO_REQUESTED', 'ACCEPTED'];

/**
 * Qui révoque ou réémet un jeton (miroir de _check_token_manager) : l’initiateur tant que la tranche n’est pas payée,
 * ou un administrateur non partie au dossier, à tout moment.
 */
export function tokenRevocationError(status: TrancheStatus, who: { isCreator: boolean; isAdminNotParty?: boolean }): 'INITIATOR_ONLY' | 'NOT_REVOCABLE' | null {
  if (who.isAdminNotParty) return null;
  if (!who.isCreator) return 'INITIATOR_ONLY';
  if (!REVOCABLE_BY_INITIATOR.includes(status)) return 'NOT_REVOCABLE';
  return null;
}

/** Plus de 10 résolutions de référence échouées par utilisateur et par heure : refus (miroir de _reference_guard). */
export const REFERENCE_FAILURE_LIMIT = 10;
export const REFERENCE_FAILURE_WINDOW_MS = 3_600_000;

/** Nombre d’échecs dans la fenêtre glissante d’une heure. */
export function recentFailures(failures: readonly number[], now: number): number {
  return failures.filter((t) => t > now - REFERENCE_FAILURE_WINDOW_MS).length;
}

export function tooManyAttempts(failures: readonly number[], now: number, limit = REFERENCE_FAILURE_LIMIT): boolean {
  return recentFailures(failures, now) >= limit;
}
