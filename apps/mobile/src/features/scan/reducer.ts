// Machine d’états du scan : idle → scanning → resolving → ready | error → confirming → done.
// Fonction pure : l’heure arrive dans les actions, les appels serveur sont faits par l’écran.
import { decodeEqr, normalizeReference } from '@diaspay/domain';
import type { ReferenceInfo } from '@diaspay/api-client';

/** Un même contenu scanné de nouveau dans ce délai est ignoré. */
export const DEBOUNCE_MS = 2000;

export type ScanPhase = 'idle' | 'scanning' | 'resolving' | 'ready' | 'error' | 'confirming' | 'done';

export type ScanErrorCode =
  | 'EQR_MALFORMED' | 'UNKNOWN_REFERENCE' | 'TOKEN_EXPIRED' | 'TOKEN_USED' | 'NOT_PAID'
  | 'WRONG_MODE' | 'PROVIDER_ONLY' | 'NOT_A_PARTY' | 'DEVICE_TIME_INVALID' | 'GENERIC';

const KNOWN: readonly ScanErrorCode[] = [
  'EQR_MALFORMED', 'UNKNOWN_REFERENCE', 'TOKEN_EXPIRED', 'TOKEN_USED', 'NOT_PAID',
  'WRONG_MODE', 'PROVIDER_ONLY', 'NOT_A_PARTY', 'DEVICE_TIME_INVALID',
];

/** Code d’erreur serveur → code d’erreur d’écran (tout code inattendu devient GENERIC). */
export const toScanError = (code: unknown): ScanErrorCode =>
  KNOWN.includes(code as ScanErrorCode) ? (code as ScanErrorCode) : 'GENERIC';

export interface ScanState {
  phase: ScanPhase;
  /** Dernier contenu vu et quand (fenêtre glissante d’anti-rebond). */
  last: { text: string; at: number } | null;
  reference?: string;
  info?: ReferenceInfo;
  error?: ScanErrorCode;
}

export const initialScanState: ScanState = { phase: 'idle', last: null };

export type ScanAction =
  | { type: 'START' }
  | { type: 'RESET' }
  | { type: 'SCAN'; text: string; at: number }
  | { type: 'MANUAL'; text: string; at: number }
  | { type: 'RESOLVED'; info: ReferenceInfo; now: number; isProvider: boolean }
  | { type: 'FAILED'; code: unknown }
  | { type: 'CONFIRM' }
  | { type: 'CONFIRMED' };

const scanning = (last: ScanState['last']): ScanState => ({ phase: 'scanning', last });
const fail = (s: ScanState, error: ScanErrorCode): ScanState => ({ phase: 'error', last: s.last, error });

/** Vérifications locales sur la réponse de resolveReference (le serveur les rejoue à la confirmation). */
export function precheck(info: ReferenceInfo, now: number, isProvider: boolean): ScanErrorCode | null {
  if (!isProvider) return 'PROVIDER_ONLY';
  if (info.used) return 'TOKEN_USED';
  if (now > new Date(info.expiresAt).getTime()) return 'TOKEN_EXPIRED';
  if (info.status !== 'PAID_LOCKED') return 'NOT_PAID';
  return null;
}

export function scanReducer(s: ScanState, a: ScanAction): ScanState {
  switch (a.type) {
    case 'START':
      return s.phase === 'idle' ? scanning(s.last) : s;
    case 'RESET':
      return scanning(s.last);
    case 'SCAN': {
      // Même contenu dans la fenêtre : ignoré, et la fenêtre glisse tant que le QR reste devant la caméra.
      if (s.last && s.last.text === a.text && a.at - s.last.at < DEBOUNCE_MS) return { ...s, last: { text: a.text, at: a.at } };
      if (s.phase !== 'scanning') return s;
      const last = { text: a.text, at: a.at };
      try {
        const { reference } = decodeEqr(a.text);
        return { phase: 'resolving', last, reference };
      } catch {
        return { phase: 'error', last, error: 'EQR_MALFORMED' }; // aucun appel serveur
      }
    }
    case 'MANUAL': {
      if (s.phase !== 'scanning' && s.phase !== 'idle') return s;
      const last = { text: a.text, at: a.at };
      try {
        return { phase: 'resolving', last, reference: normalizeReference(a.text) };
      } catch {
        return { phase: 'error', last, error: 'UNKNOWN_REFERENCE' };
      }
    }
    case 'RESOLVED': {
      if (s.phase !== 'resolving') return s;
      const error = precheck(a.info, a.now, a.isProvider);
      return error ? { phase: 'error', last: s.last, reference: s.reference, info: a.info, error } : { phase: 'ready', last: s.last, reference: s.reference, info: a.info };
    }
    case 'FAILED':
      return s.phase === 'resolving' || s.phase === 'confirming' ? { ...fail(s, toScanError(a.code)), reference: s.reference, info: s.info } : s;
    case 'CONFIRM':
      return s.phase === 'ready' ? { ...s, phase: 'confirming' } : s;
    case 'CONFIRMED':
      return s.phase === 'confirming' ? { ...s, phase: 'done' } : s;
  }
}
